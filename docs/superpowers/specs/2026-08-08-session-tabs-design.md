# Session Tabs（中间栏标签）设计

## 状态

**已确认（2026-08-08）** — 可进入实现。

灵感来自 **iTerm2** 的 session tabs：工作集用标签管理，**⌘1–9** 快速切换。

### 已确认决策

| 项 | 选择 |
|----|------|
| 标签位置 | **替换 main topbar 中间**（iTerm 感）；右侧保留 inspector / help |
| v1 能力 | **方案 C：先做 A（单 runtime 切换），架构预留 B（多 runtime）** |
| 同时跑多个 agent | v1 **否**；切换 = switch/start 到该 session |
| 切换时 running | **自动 abort 再切**（v1） |
| ⌘N | **⌘1–9** 激活第 N 个 tab；不足 N 个则 no-op |
| New session / 换 project | **空 session**，不 resume 旧 JSONL |
| 同 session 多 tab | **去重**：同一 `sessionFile` 只保留一个 tab |

## 问题

当前中间栏一次只展示一个 Pi session：

- 侧栏管「磁盘上有哪些 session 文件」
- 中间区没有「我现在同时打开着哪些对话」的工作集
- 在多个活跃对话间切换只能回侧栏点，无键盘序号

用户期望：**中间栏像 iTerm2 一样一条标签条**，每个打开的对话一个 tab，**⌘1 / ⌘2 / ⌘3 / ⌘4…** 切到对应活跃 session。

## 目标

1. 主栏顶部（或 breadcrumb 位置）展示 **Open tabs** 工作集  
2. Tab = 一个已打开的 session（有 path / id），显示短标题 + 可选状态  
3. **⌘1–9** 切换到第 N 个 tab（1-based，与 iTerm2 一致）  
4. New session / 从侧栏打开 session 时，**进入 tab 集合** 并激活  
5. 关闭 tab ≠ 删除 session 文件（只是离开工作集）  

## 非目标（v1）

| 不做 | 原因 |
|------|------|
| 真正并行多 runtime（多 agent 同时跑） | 现 PiHost 单 runtime；并行是后续能力 |
| 拖拽重排 tab（可二期） | 先保证切换与快捷键 |
| Tab 内嵌 branch tree | Tree 仍在 dialog / inspector |
| 无限 tab 无上限 | 软上限 + 滚动即可 |
| 跨窗口 tab | 单窗口 v1 |

> **重要语义：** v1 tabs 是 **「打开集合 + 快速切换」**，不是「每个 tab 一个独立同时运行的 agent」。切换 = 把唯一 runtime **switch** 到该 session 文件（或恢复缓存视图后 switch）。后台 tab 的 agent 不会在后台继续跑（除非日后 multi-runtime）。

若产品以后要「tab A 还在跑、tab B 同时聊」，需 Phase 2 multi-runtime，UI 可复用同一套 tab 条。

---

## 信息架构

```
┌─ Sidebar ──────────┬─ Main column ──────────────────────────────────┐
│ Projects / all     │ [ Tab1 ][ Tab2* ][ Tab3 ][ + ]     ◈  ?      │  ← Session Tab Bar
│ sessions on disk   │ ─────────────────────────────────────────────  │
│                    │ Timeline (active tab only)                     │
│                    │ Composer (project pill · model · send)         │
└────────────────────┴────────────────────────────────────────────────┘
```

| 区域 | 管什么 |
|------|--------|
| **Sidebar** | Catalog：所有 project 下 session **文件**（打开 / rename / hide / delete） |
| **Tab bar** | Working set：本窗口 **当前打开** 的 sessions，快速切换 |
| **Timeline + Composer** | 仅 **active tab** 的内容与输入 |

关系：

- 侧栏点 session → **open/attach into tabs**（若已在 tabs 则激活；否则占一个工作集槽并激活；若该 session 已有 live runtime 则 **复用**，不新建）  
- Tab 关闭 → **仅离开工作集**；**不删** JSONL；**不停止** 正在跑的 agent（multi 后尤其重要）  
- 工作集挤出（未 pin LRU）→ 同关 tab：detach，不 stop  
- 侧栏应显示 **running** 状态（含当前没有 tab 的 live session）  
- 侧栏 Delete → 删文件 + stop/dispose runtime + 从 tabs 踢掉  
- New session → 空 session **append tab 并激活**  
- 工作集硬上限 **9**（⌘1–9 一一对应）；pin 免疫挤出；pin 满 9 则不能再往工作集加 tab  

### 关 Tab vs 停 Session（产品红线）

| 动作 | Tab | Agent running | 磁盘 JSONL |
|------|-----|---------------|------------|
| 关 tab / 被挤出 | 去掉 | **继续** | 保留 |
| 用户 Stop / abort | 可仍开着 | 停 turn | 保留 |
| 侧栏 Delete | 去掉 | 停并释放 | **删除** |

---

## Tab 模型

```ts
interface SessionTab {
  /** Stable key for React + shortcuts */
  id: string;              // sessionId when known, else temp id for brand-new empty
  sessionId: string;       // Pi session id (may be empty until first persist)
  sessionFile?: string;    // JSONL path when available
  projectId: string;       // catalog project id / cwd
  title: string;           // display name (session name or "Untitled")
  /** Optional UI signals */
  status?: "idle" | "running" | "error" | "awaiting_approval";
  dirty?: boolean;         // reserved; v1 may ignore
}
```

### Store（renderer）

建议独立于完整 `PiSnapshot`，避免 snapshot 覆盖冲掉 tab 列表：

```ts
// appStore or sessionTabsStore
openTabs: SessionTab[];
activeTabId: string | undefined;
```

持久化（推荐 v1）：

- `localStorage` key `pi.openTabs`：`{ tabs: [...], activeTabId }`  
- 启动时校验 `sessionFile` 仍存在，失效 tab 丢弃  
- 恢复 active tab → `startSession({ cwd, sessionPath })`  

---

## 交互规格

### Tab 条

| 手势 | 行为 |
|------|------|
| 单击 tab | 激活该 tab，runtime switch 到对应 session |
| 中键 / 关闭按钮 × | 关闭 tab（不删文件） |
| 双击标题（可选 v1.1） | rename |
| Tab 条 `+` | 等同 New session（默认当前 project，空 session，新 tab） |
| 拖拽（v1.1） | 重排 openTabs 顺序（影响 ⌘N 序号） |

### 标题

- 优先 `session.name`  
- 空 session：`Untitled` 或 `New session`  
- 过长 ellipsis；tooltip 显示 project + path  

### 状态点（可选但推荐）

- Active tab 且 `running`：小蓝/金色点  
- `error`：红点  
- 非 active 的 running：v1 **不会出现**（单 runtime）；预留样式给 multi-runtime  

### 关闭 active tab

1. 从 `openTabs` 移除  
2. 激活 **右侧邻 tab**，否则左侧，否则无 tab  
3. 若还有 active → switchSession 到它  
4. 若无 tab → 主区空状态（与删当前 session 后一致）  

### 与 Composer project pill

- **Project pill 改 project** = 在**当前 active tab** 上换 cwd 并 **new empty session**（已有行为），并 **更新该 tab 的 projectId/title**，不要另开 tab 除非产品要「fork 到新 tab」  
- **New session（侧栏）** = 新 tab + 空 session  
- 侧栏点旧 session = 打开/激活对应 tab  

---

## 键盘快捷键

对标 iTerm2 / Chrome：

| 快捷键 | 行为 |
|--------|------|
| **⌘1 … ⌘9** | 激活第 1…9 个 tab（按 `openTabs` 顺序，1-based） |
| **⌘9** | 若不足 9 个：激活 **最后一个**（Chrome 习惯，可选；或仅 1–N 有效） |
| **⌘⌥→ / ⌘⌥←**（可选） | 下一个 / 上一个 tab |
| **⌘W**（可选 v1.1） | 关闭当前 tab |
| **⌘T**（可选） | New session tab |

实现注意：

- 在 `window` `keydown` 上处理，`metaKey`（mac）/ `ctrlKey`（win）  
- 输入框里 **仍应生效**（像浏览器 tab），不要被 textarea 吃掉  
- 与 ⌘K palette 不冲突  

推荐 v1 只做：**⌘1–9 + 可选 ⌘W / ⌘T**。

---

## 运行时切换（单 runtime v1）

```
activateTab(tabId):
  1. set activeTabId
  2. if tab.sessionFile:
       startSession({ cwd: project.path, sessionPath })  // or switchSession if same runtime cwd
     else if empty new tab without file yet:
       startSession({ cwd }) + newSession() if needed
  3. replaceSnapshot → timeline/composer 更新
```

### 性能与闪烁

- 切换时允许短暂 loading 态（tab 上 spinner 或 timeline 骨架）  
- 同 project 内切换优先 `switchSession(path)`，跨 project 用 `startSession`  
- **不要**为每个 tab 缓存完整 timeline 在 v1（可后续做）  

### 正在 streaming 时切换 tab

| 策略 | 说明 |
|------|------|
| **A. 阻止并提示** | 「Agent 运行中，先 Stop」 |
| **B. 自动 abort 再切**（推荐 v1） | 简单；避免 orphan stream |
| **C. 后台继续** | 需 multi-runtime |

**v1 推荐 B**：切换前 `abort()`，再 switch。Tab 上若曾 running 清掉。

---

## UI 草图

```
┌────────────────────────────────────────────────────────────┐
│ pi-workspace  ·  main                    [◈] [?]           │  ← 可缩成仅 tab 条，breadcrumb 并入 tab title
├────────────────────────────────────────────────────────────┤
│ ● Fix sidebar   │ Untitled │ Explore index │ + │            │
│     (active)    │          │               │   │            │
├────────────────────────────────────────────────────────────┤
│                                                            │
│   Timeline…                                                │
│                                                            │
├────────────────────────────────────────────────────────────┤
│  [message…]                                                │
│  [Project ▾] [branch] [model] [thinking]            [↑]    │
└────────────────────────────────────────────────────────────┘
```

样式：

- 贴近现有 dark topbar：`#212121` 底，active tab 底边金色或略抬起背景 `#2a2a2a`  
- 高度约 36–40px，可横向 scroll（多 tab）  
- 关闭按钮 hover 才明显（或始终小 ×）  

---

## 组件边界

| 单元 | 职责 |
|------|------|
| `SessionTabBar.tsx` | 渲染 tabs、+、关闭、点击；可接收 `onActivate` / `onClose` / `onNew` |
| `useSessionTabs` 或 store slice | openTabs / activeTabId / open / close / reorder |
| `App.tsx` | 键盘 ⌘1–9；把 openSession / newSession 接到 tab API；switch 时 abort+start |
| `SessionSidebar` | 打开 session 时调用 `tabs.open(session)` 而非只 `openSession` |
| Host | v1 尽量不改；沿用 startSession / switchSession / newSession |

---

## 与现有行为对齐

| 现有 | Tab 化后 |
|------|----------|
| New session → 空对话 | 新 tab + 空 session，激活 |
| 侧栏点 session | open/activate tab |
| Composer 换 project → 空 session | **更新当前 tab** 的 project + 空 session（不 resume 旧文件） |
| 删当前 session 文件 | 关 tab + 空状态 |
| Topbar breadcrumb | 可改为显示 active tab title，或 project/tab 二级 |

---

## 分期

### PR-T1 — 数据与切换（核心）

- `openTabs` + `activeTabId` store  
- `SessionTabBar` UI  
- open / activate / close  
- New session & 侧栏 open 接入  
- ⌘1–9  

### PR-T2 — 体验

- 持久化 tabs  
- streaming 时 abort-on-switch  
- tab 状态点、横向滚动、关闭确认（running 时）  

### PR-T3 — 增强（可选）

- ⌘W / ⌘T / ⌘⌥←→  
- 拖拽排序  
- multi-runtime 真并行（大）  

---

## Key Decisions（已确认）

| # | 决策 | 选择 |
|---|------|------|
| 1 | 并行 agent | v1 **否**；代码用 `SessionTab` + `activateTab` 抽象，便于以后接 multi-runtime |
| 2 | 切换时 running | **abort 再切** |
| 3 | ⌘N | **第 N 个 tab**；不足则 no-op（不做 Chrome「⌘9=最后一个」） |
| 4 | Composer 换 project | **当前 tab 换为空 session** |
| 5 | 标签位置 | **替换 topbar 中部** |
| 6 | 去重 | 同一 `sessionFile` 一个 tab |
| 7 | 上限 | 软性；多 tab 横向滚动 |

### 架构预留 B（multi-runtime）的边界

v1 实现时遵守，避免将来撕开重写：

1. **`SessionTab` 不假设全局只有一个 timeline** — store 可先只缓存 active 的 snapshot 投影，但 `activateTab` / `openTab` API 独立。  
2. **Host 调用集中在一个 `SessionRuntimePort`**（或 App 内 `activateTab` 函数）：v1 内是 abort + start/switch；未来换成 per-tab runtime map。  
3. **事件 `onEvent` 带 `sessionId`** 时，只更新匹配 active（或匹配 tab）的投影 — 为多路事件预留过滤点。  
4. **UI 状态点** 支持非 active 的 `running` 样式（v1 几乎用不到，CSS/类型先留着）。

---

## 验收剧本

| # | 剧本 | 通过 |
|---|------|------|
| 1 | New session 两次 | 两条 tab，第二条 active，内容空 |
| 2 | ⌘1 / ⌘2 | 在两个 tab 间切换，timeline 对应 |
| 3 | 侧栏打开旧 session | 出现/激活 tab，内容是历史 |
| 4 | 关 active tab | 落到邻 tab 或空状态；文件仍在侧栏 |
| 5 | Agent running 时 ⌘2 | abort 后切走，无卡死 stream |
| 6 | 同一 session 点两次侧栏 | 仍只有一个 tab，被激活 |

---

## 实现入口

按 **PR-T1 → PR-T2** 开工即可。完整交互与模型见上文。
