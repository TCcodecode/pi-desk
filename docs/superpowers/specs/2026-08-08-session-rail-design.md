# Session Rail v1 — 左侧栏设计

## 状态

已确认。规格覆盖 P0–P4；实现按 PR 分期，不要求一次交付。

## 背景与问题

Pi Desktop 左侧栏（`SessionSidebar`）已具备 Project → Session 树，数据模型正确：

- Project = 本地 catalog 中的 cwd（`~/.pi-desk/projects.json`）
- Session = Pi JSONL 文件（`SessionManager.list(cwd)`）
- 磁盘 session 是 source of truth（CLI 与 GUI 应同一真相）

但侧栏尚未完成「工作记忆外置」：工程师真实任务是 **Resume / Find / Attention / Safe declutter**，不是浏览品牌区或静态设置文案。

同类产品公开吐槽可归纳为：

| 吐槽 | 根因 | 对本设计的约束 |
|------|------|----------------|
| 挪文件夹后 history「消失」 | 绑定脆弱路径 / 列表不可信 | 诚实展示磁盘 session；Remove ≠ 删文件；路径迁移后置 |
| 列表被 CLI/子任务淹没 | 默认集合 = 全量日志 | 默认工作集 + 可 Hide/Archive |
| 找不回上周那次 | 无时间、弱搜索、烂标题 | 相对时间、可 rename、搜索可用 |
| 不知道该点哪条 | 无状态 | status 可视化（至少当前 running） |
| CLI 与 GUI 分裂 | 两套存储 | 继续以 JSONL catalog 为准，不另建聊天库 |

## 目标

侧栏成为**可恢复工作单元的索引**：

1. **Resume** — 低点击回到上次 session  
2. **Find** — 靠名称、时间、搜索、project 分组定位  
3. **Attention** — 可扫状态（running / 需处理 / error）  
4. **Safe declutter** — 移出列表 / 隐藏 / 确认后删除，不误毁资产  

## 非目标（v1）

- 侧栏内 Session Tree（分支）、Fork、Compact（仍在主区 / Tree dialog）
- 真并行 multi-agent panes / worktree 徽章 / 云端 session
- 嵌套 project 文件夹体系
- 跨机同步 history
- 全文向量检索（名称级搜索为 v1；全文索引后置）
- 路径 rename/move 后的自动 rebind（文档说明 + 手动 Re-add）

## 已有能力（Keep）

| 层 | 能力 | 处理 |
|----|------|------|
| Catalog | `addProject` / `listProjects` / `setActiveProject` | 保留 |
| Catalog | `removeProject`（已实现，未接线） | **接线到 IPC + UI** |
| Session | list / rename / delete / clone（active runtime） | 保留；补确认与 UX |
| Protocol | `SessionSummary`（name, status, messageCount, updatedAt…） | 侧栏消费 |
| Protocol | `SessionStatus` 含 `archived` | P4 对齐或本地 hide |
| UI | Project 树、行内 New、右键 rename/copy/delete、宽度拖拽 | 增强，不推翻 |
| 边界 | Session Tree 不在侧栏 | **保持** |

## 目标信息架构

```
┌──────────────────────────────────┐
│  [ 🔍 Search sessions…      ✕ ] │
│  [ + New session              ] │  → active project；无 project 则 add
├──────────────────────────────────┤
│  PROJECTS                   [+] │  + = Open folder / Add project
│                                  │
│  ▾ active-project               │  默认仅 active（或用户展开过的）展开
│      ● Session title            │  status 点 + title
│        2h ago                   │  相对时间
│      ○ Other session            │
│        yesterday                │
│  ▸ other-project                │
├──────────────────────────────────┤
│  ⚙  {model} · {thinking}        │  → Settings
└──────────────────────────────────┘
```

Brand（π / Pi Desktop）：

- 可保留作 macOS traffic-light 拖拽区轻标题
- **压缩高度**，不与 Search / New 抢第一视线
- 非主 CTA

---

## 交互规格

### Project 行

| 手势 | 行为 |
|------|------|
| Twistie | 仅展开 / 折叠 |
| 单击项目名 | 设为 `activeProjectId`；**不**自动切换 / 重开 session（避免打断当前对话） |
| 行尾 `+` | 在该 project 下 New session |
| 右键或 ⋯ | New session · Reveal in Finder · Copy path · **Remove from list** |

**Remove from list**

- 调用 `removeProject`：只改 catalog，**不删除**任何 JSONL
- 若移除的是当前 active：catalog 已有逻辑切到剩余第一个；主区 session 若仍指向已移除 project 的 cwd，保持打开直到用户另选（实现时：active 切换后不强制 `startSession`，除非当前 runtime cwd 已无效）

**App 启动恢复**（已有「list + open most recent」）保持不变；与「单击 project 不重开 session」不冲突。

### Session 行

| 元素 | 规则 |
|------|------|
| 主标题 | `name`，单行 ellipsis |
| 次行 | 相对时间（基于 `updatedAt`） |
| 状态点 | 见下表 |
| 单击 | `startSession({ cwd, sessionPath })` |
| 右键 | Rename · Duplicate · Copy session ID · Hide（P4）· Delete… |

**相对时间文案（建议）**

- &lt; 1 min → `just now`
- &lt; 60 min → `Nm`
- &lt; 24 h → `Nh`
- 昨天 → `yesterday`
- 更早 → 本地短日期（如 `Aug 3`）

**Status 映射**

| `SessionStatus` | 侧栏 |
|-----------------|------|
| `running` | accent 点（可微动效） |
| `awaiting_approval` | 警告色（需注意力） |
| `error` | 危险色 |
| `idle` / `completed` | 中性灰；active 行沿用现有高亮 |
| `archived` / hidden | 默认不出现在主列表 |

**Status 数据现实**

- `listSessions` 映射的 summary 可能多为 `idle`
- **必须**：若 app store 当前 session 的 `sessionId` 匹配某行，用 store 的 `status` 覆盖该行展示
- 其余行：有真实 status 则显示，否则灰点 + 时间

### 搜索

- 匹配：`project.name`、`session.name`（大小写不敏感）
- 有 query：过滤；**命中 project 强制展开**
- Clear 按钮（接上已有 `.sidebar-search-clear` 样式）
- 无命中：`No matches`
- P1：`⌘F` / `Ctrl+F` 聚焦搜索框（不与全局冲突时）

### 删除 Session（已确认）

1. 菜单文案：`Delete…`
2. 确认对话框：
   - 标题：Delete session?
   - 正文：永久删除「{name}」。此操作不可撤销。
   - Cancel / Delete
3. 确认后调用现有 `deleteSession(sessionPath)`（硬删文件）
4. **若删除的是当前正在查看的 session**：
   - **不**自动打开同 project 最近 session
   - **不**自动 new session
   - 关闭 / 清空当前 runtime 视图，主区进入 **空状态**（提示选择已有 session 或 New）
   - 侧栏列表刷新后去掉该行

### New session

- 顶部主按钮 **New session** → 对 `activeProjectId`；无 project → 走 add project
- Project 行 `+` 行为不变

### Settings 底栏（P1）

- 主行：当前 `model`（截断）
- 副行：`thinkingLevel`（或 provider）
- 点击 → 现有 Settings

### 展开状态

- 默认：`activeProjectId === true`，其余 `false`
- 用户 toggle → 持久化 `localStorage`：`pi.sidebar.expanded`（`Record<projectId, boolean>`）
- 新 add 的 project：默认 `true` 一次，便于看到 sessions

### Duplicate

- 目标：任意带 `sessionFile` 的 session 可 Duplicate
- 若 host 仅支持 clone **当前** runtime：
  - 实现顺序：open 该 session → `cloneSession` → 刷新列表；或
  - 扩展 `cloneSession(sessionPath?)`（优先，避免误伤当前上下文）
- 在 API 未扩前：菜单可对非 active 显示，点击走「open then clone」并在失败时 toast

---

## 数据与 API

### 接线已有

```
projectCatalog.removeProject
  → piHost.removeProject
  → ipc: pi:removeProject
  → preload + protocol PiApi.removeProject
  → SessionSidebar onRemoveProject
```

### 删除当前 session 的 host 行为

- `deleteSession` 后若 path 属于 active runtime：host 应释放/清空当前 session 状态，使 snapshot 表现为「无 session 或空 session」，以便主区空状态
- 具体字段与现有 `PiSnapshot` 对齐；渲染层根据 `!session.sessionId` 或等价条件显示 empty state（若尚无文案，补最少：选择 session 或 New）

### P4 Hide / Archive

**推荐：本地 Hide set（不依赖 Pi runtime archive API）**

- 存储：`localStorage` 或 `~/.pi-desk/session-prefs.json`：`hiddenSessionPaths: string[]`
- 主列表过滤 hidden
- 菜单：Hide / Unhide（Unhide 可在搜索「含已隐藏」或 Settings 后置；v1 可仅 Hide + 搜索修饰 `show:hidden` 后置）
- **不要**仅把 UI status 写成 `archived` 却不改 list 过滤

若未来 Pi 提供真正 archive：再映射到 `SessionStatus.archived` 与 host API。

### 刷新策略

- 避免：任意 `sessions` 变化对 **每个** project 调 `listSessions`
- 目标：变更发生在 project P 时只 refresh P；add/remove project 时 refresh 相关集合
- `loadSessions` 仍可按 project 懒加载；展开时若无缓存再拉

### Reveal in Finder

- Electron：`shell.showItemInFolder(project.path)` 或 session 文件 path
- 经 preload 暴露 `revealInFolder(path: string)`

---

## 组件边界

| 单元 | 职责 |
|------|------|
| `SessionSidebar` | 搜索、展开、列表、菜单、确认触发 |
| Session 行 UI | 标题、时间、status、rename input |
| Project 行 UI | twistie、名、+、context menu |
| `App.tsx` | 接线 remove/delete/new、空状态、store |
| `projectCatalog` / `piHost` / preload / protocol | removeProject、reveal、delete 后空状态 |
| `styles.css` | 次行、status 色、压缩 brand；清理无用死 CSS |
| `SessionTree` / TreeDialog | **不改** |

---

## 主区空状态（删除当前 session 后）

当无有效 `session.sessionId`（或等价）：

- Timeline 区域：简短空状态  
  - 文案建议：No session open  
  - 次要：Select a session in the sidebar, or create a new one  
  - 可选按钮：New session（调 active project）
- Composer：禁用或仅允许在确保 session 后发送（与现有 `ensureSession` 策略对齐：空状态下点发送可 new，或强制先选——**推荐空状态显式 New，发送不静默建 session**，避免「发一条却建了无标题 session」；若现有 ensureSession 行为相反，在实现 PR 中二选一并测，**优先显式**）

---

## 分期实现（PR Plan）

### PR1 — 可读与安全（P0 核心）

**标题：** `feat(sidebar): session row meta, search finish, delete confirm`

- Session 行：相对时间 + status 点（含 active status 覆盖）
- Delete 确认对话框
- 删除当前 session → 主区空状态（host + UI）
- 搜索 clear + 命中强制展开
- 默认只展开 active project
- 测试：Sidebar 单元测；delete active 后 snapshot/UI

**依赖：** 无  

### PR2 — Project 生命周期（P0 收尾）

**标题：** `feat(sidebar): remove project and project context menu`

- 全链路 `removeProject`
- Project 菜单：Remove / Copy path / Reveal in Finder
- preload `revealInFolder`
- 测试：catalog remove；IPC

**依赖：** 无（可与 PR1 并行，合并顺序 PR1 → PR2 更稳）

### PR3 — 主 CTA 与底栏（P1）

**标题：** `feat(sidebar): new-in-active, settings summary, expand persist`

- 顶部 New session（active project）
- 底栏 model · thinking → Settings
- `localStorage` 展开状态
- Duplicate：非 active 策略（open-then-clone 或 API 扩展）
- 可选：⌘F 聚焦搜索

**依赖：** PR1 更佳  

### PR4 — Declutter 与清理（P4）

**标题:** `feat(sidebar): hide sessions and dead CSS cleanup`

- 本地 hidden set + 菜单 Hide
- 主列表过滤
- 删除无用 CSS（`.workspace-card`、未用 chat-search 等，确认无引用后）
- 文档：路径迁移需 Re-add project

**依赖：** PR1  

### 可选后续（规格外实现）

- Recents 扁平视图 / pin  
- 全文索引  
- path rebind  
- 真 `archived` host API  

---

## 验收剧本

| # | 剧本 | 通过标准 |
|---|------|----------|
| 1 | 昨天改到一半，今天打开 | 启动恢复或 ≤2 次点击回到同 session |
| 2 | 记得大致 session 名 | 搜索命中且行可见（展开） |
| 3 | 临时加 project B | 可 Remove from list；磁盘 session 仍在 |
| 4 | 误触 Delete | 确认框；Cancel 无变化 |
| 5 | 删除**当前** session | 列表更新；主区空状态；**不**自动打开其它 session |
| 6 | 5+ projects | 默认不全展开；可扫 |
| 7 | 当前 turn running | 侧栏对应行状态可辨 |
| 8 | Hide 某 session（P4） | 主列表消失；文件仍在；可再出现的路径存在（实现时定义 Unhide 最小路径） |

---

## Key Decisions

| 决策 | 选择 | 理由 |
|------|------|------|
| 侧栏职责 | Session **文件**索引，不管 branch | Pi 规格；与第一性原理一致 |
| 分组 | Project = cwd | 工程师心智；已有 catalog |
| 默认视图 | 树 + 仅展开 active | 防淹没；Recents 后置 |
| 删当前 session | 主区空状态，不自动接力 | 用户明确选择；最少假设 |
| 删除文件 | 硬删 + 确认 | JSONL 真相；Hide 负责软清桌面 |
| Remove project | 只改 catalog | 与「清桌面 ≠ 毁证据」一致 |
| Hide | 本地 prefs，不假扮 runtime archive | 避免无 API 的虚假 status |
| 搜索 | v1 名称级 | 成本低；时间 + rename 补记忆 |
| Brand | 压缩非主 CTA | Resume / New / Find 优先 |
| 实现节奏 | 规格写全 P0–P4，PR 分期 | 方向一次对齐，交付可切片 |
| **UI 原语** | **Radix headless + 自有 CSS** | 菜单/确认/焦点用成熟库；视觉与领域自研；不上整站 MUI/shadcn |

### Implementation constraint: UI stack

- **领域层（自研）**：project catalog、session JSONL、refresh 契约、展开策略、Hide prefs、与 `piHost` 的空状态语义。
- **交互原语（Radix）**：
  - `@radix-ui/react-alert-dialog` — 删除确认
  - `@radix-ui/react-context-menu` — Session / Project 右键菜单
  - 后续可选：Tooltip、Dropdown（Settings 等）
- **皮肤**：继续 `styles.css` class，不引入 Tailwind / shadcn 管道。
- **图标**：可逐步 `lucide-react` 或保持局部 SVG；不强制一次换完。
- **禁止**：为侧栏引入 Ant Design / MUI 等重型 Design System。

---

## 风险

1. **listSessions status 不准** — 用 store 覆盖当前行；接受历史行多为 idle  
2. **clone 非 active** — 可能污染当前 runtime；优先扩展 API 或 open-then-clone 并测  
3. **空状态与 ensureSession** — 发送路径不得悄悄违背「删除后空状态」的产品选择  
4. **路径迁移** — id = path 的固有限制；v1 不自动修复  

---

## 开放问题（已关闭）

| 问题 | 决议 |
|------|------|
| v1 规格范围 | 全量写入 P0–P4，实现分期 |
| 删除当前 session 后 | 主区空状态，用户再点 |

---

## 参考

- 既有设计：`docs/superpowers/specs/2026-08-05-pi-desktop-workspace-design.md`（Session 列表 vs Session Tree）
- 实现入口：`src/renderer/components/SessionSidebar.tsx`、`electron/projectCatalog.ts`、`electron/sessionCatalog.ts`
- 第一性原理讨论结论：侧栏 = 工作记忆外置（Resume / Find / Attention / Safe declutter）
