# 工作集 Tabs + Multi-Session Runtime 详细方案

## 状态

**已确认产品原则（2026-08-08）** — 本文是实施总纲。  
相关历史文档：`session-tabs-design.md`、`multi-session-runtime-plan.md`（细节以本文为准）。

---

## 0. 产品定位（为什么这样设计）

### 0.1 问题

Codex / Claude 类产品容易把 **档案历史** 和 **正在推进的工作** 糊在同一条长列表里：

- 过期对话舍不得删 → 淹没真正 active 的活  
- 用户高频动作其实是：在 **少数几摊正在干的活** 之间切换  

### 0.2 我们的选择

| 层 | 职责 | 用户心智 |
|----|------|----------|
| **顶栏 Tabs** | **工作集**（Working Set） | 桌上正在看的活，最多 9 个，⌘1–9 |
| **左侧栏** | **档案 + Live 状态** | 所有 session 文件；谁在 running 一眼能见 |
| **Host Runtime** | **生命** | agent 真在跑；与 tab 开闭解耦 |

**一句话：**  
Tab = 关注面；Session/Runtime = 生命面；侧栏 = 全貌。  
关 tab 只是不盯了，不是掐死。

### 0.3 与 iTerm2 / 竞品

| | iTerm2 | Codex/Claude 常见 | **我们** |
|--|--------|-------------------|----------|
| tab 数量 | 可 >9 | 侧栏很长 | **工作集硬上限 9** |
| ⌘1–9 | 仅前 9 | 弱或无 | **每个工作集 tab 都有** |
| 关 tab | 常结束会话 | 不一 | **不 stop agent** |
| 过期历史 | N/A | 挤主列表 | **沉在侧栏** |
| 真并行 | 多 pane/进程 | 有 | **Multi-runtime 目标** |

---

## 1. 三层生命周期（红线）

```
┌─────────────────────────────────────────────────────────────┐
│  Working Set (Tabs ≤ 9)     关注 / 快捷键 / pin / LRU 挤出   │
│  detach ←→ attach                                           │
└───────────────────────────┬─────────────────────────────────┘
                            │ 不蕴含 stop
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Live Runtimes (Map)        agent 是否在跑、事件流             │
│  stop / abort 仅显式操作                                      │
└───────────────────────────┬─────────────────────────────────┘
                            │ 不蕴含 delete
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Disk JSONL                 档案；侧栏 list / 搜索 / delete    │
└─────────────────────────────────────────────────────────────┘
```

### 1.1 动作矩阵

| 用户动作 | Tab | Live runtime | 磁盘 JSONL |
|----------|-----|--------------|------------|
| New session | 占 1 槽并激活 | 创建并启动 | 最终有新文件 |
| 侧栏打开 session | attach 到工作集（或激活已有） | 已有则复用；无则 open | 不变 |
| 点 tab / ⌘N | 换前台 | **不 stop 其它**（multi） | 不变 |
| **关 tab** | **去掉** | **继续跑（若在跑）** | **保留** |
| **LRU 挤出未 pin** | **去掉** | **继续跑** | **保留** |
| Composer Stop / abort | 可仍开着 | 停当前 turn | 保留 |
| 侧栏 Delete | 去掉 | stop + dispose | **删除** |
| Pin / Unpin | 重排；pin 免疫挤出 | 不变 | 不变 |

### 1.2 禁止混淆的 API 语义

| 名称 | 含义 |
|------|------|
| `detach(sessionKey)` | 仅 UI 离开工作集；**host 保持 runtime** |
| `attach(sessionKey)` | UI 占槽并 focus；**复用已有 runtime** |
| `open(sessionKey, …)` | 无 runtime 则创建 |
| `focus(sessionKey)` | 前台投影切换 |
| `stop` / `abort(sessionKey)` | 用户明确停止 |
| `dispose(sessionKey)` | 释放 runtime（删文件后、进程退出清理）；**默认不随关 tab** |

---

## 2. 工作集规则（Tabs ≤ 9）

### 2.1 硬约束

- `openTabs.length ∈ [0, 9]` 恒成立  
- 从左到右序号 `1…N` 对应 **⌘1…⌘N**（macOS）/ **Ctrl+1…N**（其它）  
- 不足 N 个时该快捷键 no-op  
- **不做** Chrome 式「⌘9 = 最后一个」  

### 2.2 排序

```
[ pin₁, pin₂, … ][ unpinned by recency … ]
```

- Pin 的一律在左，**免疫 LRU 挤出**  
- 未 pin 在右；组内按 **最近激活时间 `lastFocusedAt`** 排序（新激活的更靠右或按实现选「最近的在 pin 区之后靠前」——见 2.4）  
- **⌘ 序号 = 当前从左到右的视觉顺序**（pin 占 1、2、…）  

**推荐未 pin 顺序：** 最近使用的更靠近 pin 区（或最右为最久——实现选一种并写死）。  
**LRU 淘汰对象：** `lastFocusedAt` **最旧** 的未 pin tab。

### 2.3 Pin

| 操作 | 行为 |
|------|------|
| 点图钉 / **⌘P** | toggle pin 当前（或该）tab |
| Pin 时 | 移到 **全部 tab 的最前**（所有 pin 的最左可再插入到首位） |
| Unpin 时 | 放到所有仍 pin 的后面（未 pin 区最前或按 LRU） |
| UI | 图钉 outline / 金色实心+微光；**不在 tab 面显示 ⌘P 文案**（避免与省略混淆） |
| Tooltip | `Pin "title"` / `Unpin "title"`（可无快捷键字；Help 里可写 ⌘P） |

**Pin 满 9 个：**

- 禁止：New session 进工作集、侧栏「打开为 tab」、任何会 `length>9` 的 attach  
- **允许：** session 继续在 live/磁盘存在；侧栏仍可看 running  
- 反馈：短错误/状态文案即可，例如 `Working set full (9 pinned). Unpin a tab to open another.`  
  （这是工作集规则反馈，不是「并发太多」类软提示。）

### 2.4 打开 / 挤出算法

```
function ensureInWorkingSet(sessionKey, meta):
  if tab exists for sessionKey:
    touch(sessionKey)
    focus(sessionKey)
    return { ok: true, activated: existing }

  if openTabs.length < 9:
    append tab (unpinned unless specified)
    touch + focus
    open-or-reuse runtime
    return { ok: true }

  // length === 9
  victims = openTabs.filter(t => !t.pinned)
  if victims is empty:
    return { ok: false, reason: "all_pinned" }

  victim = argmin(victims, lastFocusedAt)  // 最久未聚焦
  detach(victim)  // 只摘 tab，不 stop runtime
  append new tab
  touch + focus
  open-or-reuse runtime
  return { ok: true, evicted: victim }
```

**`touch(sessionKey)`：** 更新 `lastFocusedAt = now`（activate、在该 tab 发送消息时调用）。

**去重：** 同一 `sessionFile`（或同一 live key）只能有一个 tab。

### 2.5 启动恢复

从 `localStorage` 恢复 `openTabs`：

1. 丢弃无效 `sessionFile`（文件不存在）  
2. 若 `length > 9`：保留全部 pin，未 pin 按 `lastFocusedAt` 只留到总数 9  
3. **不**为所有 tab 立刻创建 runtime（懒 open）  
4. 仅对 **上次 active**（或第一个）做 `open+focus`  

### 2.6 Tab UI（当前实现可对齐）

```
[📌]  project-name     ⌘1  [×]
      session-title…
```

- 上行：project（小字 muted）  
- 下行：session 标题  
- 右：⌘N（完整，不省略）  
- 关 ×：detach  

---

## 3. 侧栏（档案 + Live）

### 3.1 数据源

```
sidebarSessions(project) =
  merge(
    SessionManager.list(cwd),           // 磁盘
    liveSlots.filter(s => s.cwd == cwd) // Host 仍活着的 runtime
  )
```

每行至少：

- `name`, `sessionFile`, `updatedAt`  
- **`liveStatus`**: `none | idle | running | awaiting_approval | error`  
- 可选：`hasTab`（是否在工作集）  

### 3.2 展示

- **running**：明显状态点/文案（无 tab 也要显示）  
- 点击：  
  - 已在工作集 → focus  
  - 不在且有槽 / 可挤出 → attach  
  - 工作集 9 pin 满 → 失败反馈，**不** stop 该 running  

### 3.3 与工作集关系

| 侧栏 | 工作集 |
|------|--------|
| 很长、可搜、可折叠 | 最多 9、干净 |
| 显示 running 全貌 | 只显示「正盯着的」 |
| Delete = 真删 | × = 仅 detach |

---

## 4. Multi-Session Runtime（工程）

### 4.1 目标

- 多 tab / 多 live session **可同时 running**  
- 切 tab = `focus`，**不 abort**  
- 关 tab = `detach`，**不 dispose**  
- 事件按 `sessionKey` 路由  

### 4.2 Host：`SessionRuntimeRegistry`

```ts
type SessionKey = string; // === tab.id

interface RuntimeSlot {
  key: SessionKey;
  projectId: string;
  cwd: string;
  sessionId: string;
  sessionFile?: string;
  runtime: PiRuntimeLike;
  unsubscribe: () => void;
  status: "idle" | "running" | "awaiting_approval" | "error" | "completed";
  name: string;
  // optional: lastEventAt, generation for stale events
}

class SessionRuntimeRegistry {
  private slots = new Map<SessionKey, RuntimeSlot>();
  private foregroundKey?: SessionKey;

  open(key, { cwd, sessionPath?, projectId }): Promise<Snapshot>
  // 已存在 → 返回现有；禁止同一 sessionFile 两个 key

  attach(key): void
  // 仅标记 UI 关注；key 必须已有 slot 或随后 open

  detach(key): void
  // no-op on host runtime; renderer drops tab
  // host 可记 "detached" 仅用于调试，不影响 running

  focus(key): void
  // foregroundKey = key; 不 dispose 其它

  stop(key): Promise<void>   // abort turn / 产品 Stop
  dispose(key): Promise<void> // abort + runtime.dispose + delete map

  prompt(key, text): Promise<void>
  steer(key, text): Promise<void>
  // ...全部写入带 key

  listLive(): RuntimeSlotSummary[]
  snapshot(key): PiSnapshot
}
```

**事件：**

```ts
PiEvent & {
  sessionKey: string;
  sessionId?: string;
}
```

Renderer：

```ts
onEvent(ev) {
  updateLiveIndex(ev);           // 侧栏 running
  views[ev.sessionKey]?.apply(ev);
  if (ev.sessionKey === activeTabId) mirrorToForegroundStore(ev);
}
```

### 4.3 sessionKey 规则

| 阶段 | key |
|------|-----|
| 新建尚无文件 | `tmp:${uuid}` |
| 已有 JSONL | `file:${absoluteNormalizedPath}` |
| 落盘后 | emit `session_key_remapped { from, to }`；更新 tab.id、Map、views |

**禁止：** 同一 `sessionFile` 两个 live slot。

### 4.4 Renderer 状态

```ts
// 工作集
openTabs: SessionTab[]  // length ≤ 9
activeTabId?: string

// 每 live session 的投影（有 tab 或无 tab 都可有 entry）
views: Record<SessionKey, {
  session: SessionState
  timeline: TimelineItem[]
  toolCalls: ...
  queue: ...
  // MVP 可精简后台 timeline
}>

// 侧栏 live 覆盖
liveByFile: Record<sessionFile, LiveStatus>
```

**切 tab：**

1. `activeTabId = key`  
2. 前台绑定 `views[key]`  
3. `host.focus(key)`  
4. **不** abort  

**关 tab：**

1. 从 `openTabs` 移除  
2. `host.detach(key)`（可为空操作）  
3. **保留** `views[key]` 与 host slot（若在跑）  
4. 若无 active → 选邻 tab 或空状态  

**侧栏再点：**

1. `ensureInWorkingSet(key)`（可能 LRU detach 其它）  
2. `focus` + 若 view 空则 `snapshot` hydrate  

### 4.5 IPC

在现有 `PiApi` 上扩展（推荐 **每调用带 key**）：

```ts
// 示例
prompt(text: string, opts?: { sessionKey?: string })
// 缺省 = foreground（兼容旧调用）

listLiveSessions(): Promise<LiveSessionSummary[]>
// 供侧栏 merge

// 事件统一带 sessionKey
```

新建/打开：

```ts
openSession({ sessionKey, cwd, sessionPath? }): Promise<PiSnapshot>
// 幂等
```

删除文件：

```ts
deleteSession(path) 
// → 找到 key → stop+dispose → 通知 renderer 踢 tab + 刷新侧栏
```

### 4.6 并发与资源（已确认）

| 项 | 决定 |
|----|------|
| 同时 running 数量 | **无硬上限、无软提示** |
| 工作集 tab | **最多 9**（注意力，不是 agent 配额） |
| 关 tab | **不** dispose |
| 真释放 | Stop / Delete / 进程退出 / 可选长期 idle 回收 |

---

## 5. 单 runtime 阶段（现状 → 过渡）

在 Multi 完成前，诚实降级：

| 能力 | 单 runtime 现状 | 过渡期可做 |
|------|-----------------|------------|
| 工作集 9 + pin + LRU | 可完整做 UI | **优先做** |
| 关 tab 不杀 running | **做不到完整**（只有一个 runtime） | 关 tab 仍可不 **删文件**；若关的是前台 running，可选择 keep running 直到切走（仍只有一个） |
| 侧栏 running | 仅当前 | 先显示当前 session status |
| 真并行 | 否 | Multi Phase 1 |

**过渡期建议行为（单 runtime）：**

- 关 **非当前** tab：只摘 UI（该 tab 本就没有独立 runtime）  
- 关 **当前** tab：detach UI；若仍 running，**暂不 abort**（用户 Stop 才停）；无 tab 时主区空状态但 footer/侧栏可显示仍在跑——需一点状态机，可选  
- 切 tab：暂可继续 abort（或尽快上 multi 去掉）  

**目标态（multi）以第 1、4 节为准，不被过渡期绑死。**

---

## 6. 数据模型

### 6.1 SessionTab

```ts
interface SessionTab {
  id: string;                 // sessionKey
  sessionId: string;
  sessionFile?: string;
  projectId: string;
  title: string;
  status?: SessionStatus;     // 来自 live 或最后快照
  pinned?: boolean;
  lastFocusedAt: number;      // LRU
}
```

### 6.2 持久化

`localStorage["pi.openTabs"]`:

```json
{
  "tabs": [ { "id", "sessionId", "sessionFile", "projectId", "title", "pinned", "lastFocusedAt" } ],
  "activeTabId": "..."
}
```

不持久化完整 timeline（太大）；live status 不进 localStorage。

---

## 7. UI / 交互细则

### 7.1 Tab 条

- 两行：上 project、下 session  
- Pin 图钉；固定金色微光  
- ⌘1–9 完整显示在 tab 上  
- **不在 tab 面显示 ⌘P 文案**（免误解）；⌘P 仍绑定 pin  
- 横向滚动（≤9 时一般不必）  

### 7.2 快捷键

| 键 | 动作 |
|----|------|
| ⌘1–⌘9 | 激活工作集第 N 个 tab |
| ⌘P | Pin/Unpin **当前** tab |
| （可选后续）⌘W | 关当前 tab = detach |

### 7.3 Composer

- 绑定 `activeTabId`  
- 换 project：当前 tab 上新开空 session（不 resume 旧文件）  
- Stop：abort(activeKey)  

### 7.4 审批 / Diff（multi 后）

- 事件带 sessionKey  
- 后台 awaiting_approval：侧栏 + 可选角标；点进 attach  
- 禁止静默丢审批  

---

## 8. 分阶段实施计划

### Phase A — 工作集纪律（可先做，单 runtime 也可）

**目标：** 产品心智「桌上最多 9 摊」落地。

1. `SessionTab` 增加 `lastFocusedAt`、`pinned`（pinned 已有）  
2. `ensureInWorkingSet`：满 9 未 pin LRU detach；全 pin 拒绝  
3. 启动裁剪 >9  
4. 关 tab = 仅 UI（并整理与 abort 的边界，尽量不因关 tab 杀进程）  
5. touch on activate / send  

**验收：**

- 开第 10 个未 pin → 最久未用未 pin 消失，侧栏文件仍在  
- Pin 9 个 → New 失败有反馈  
- ⌘1–9 始终覆盖全部工作集 tab  

### Phase B — Multi Runtime MVP

**目标：** 关 tab / 切 tab 不杀后台 agent。

1. `SessionRuntimeRegistry` + fake 双 runtime 单测  
2. 事件强制 `sessionKey`  
3. Renderer `views` + 路由  
4. activate = focus；close tab = detach  
5. `listLiveSessions` → 侧栏 merge running  
6. attach 复用 slot  

**验收：**

- A running → 关 A 的 tab → A 仍 running（侧栏）→ 再打开 → 输出连续  
- A running → 切 B 聊天 → A 不停  

### Phase C — 体验

- 后台 timeline 策略加强  
- 未读 / needs-you  
- key remap tmp→file  
- 可选 idle dispose（与关 tab 无关）  

---

## 9. 测试矩阵（摘要）

| # | 场景 | 期望 |
|---|------|------|
| 1 | 2 个 tab 切换 | 各历史正确；multi 后均不误 abort |
| 2 | 关 running tab | runtime 仍跑；侧栏 running |
| 3 | 再 attach | 同一 key，续流 |
| 4 | 10th unpinned open | 挤 1 个未 pin；被挤若 running 仍跑 |
| 5 | 9 pinned + new | 拒绝 |
| 6 | Delete 磁盘 | dispose + 无 running + tab 消失 |
| 7 | 双 runtime 交错 delta | 不串 timeline |
| 8 | 同 file 点两次 | 单 tab 单 slot |

---

## 10. 风险清单

| 风险 | 缓解 |
|------|------|
| 事件串台 | sessionKey 强制；单测交错 |
| key 迁移 | remapped 事件 |
| 无 tab 的 zombie runtime | 侧栏可见；Delete/Stop 清理；可选 idle 回收 |
| 同 cwd 双 agent 改文件 | 后续 path lock / worktree（非 MVP） |
| 内存 | 关 tab 不释放 → 依赖用户 Stop/Delete + 可选 idle；**接受**无上限产品选择 |
| 单 runtime 过渡体验 | 文档与实现标明能力边界，尽快上 Phase B |

---

## 11. 明确不做什么

- 工作集超过 9 个 tab  
- 用「并发上限 / 跑太多」类软提示  
- 关 tab 默认 abort/dispose  
- 把侧栏做成第二套无限 active 列表抢焦点  
- 假并行（单 session 对象双时间线）  

---

## 12. 成功标准（产品）

1. 用户能用 **≤9 个 tab** 管理当前工作，过期对话沉在侧栏不淹顶栏。  
2. 用户关掉 tab 后，**长任务仍跑**，侧栏能看见，还能点回来。  
3. Pin + ⌘1–9 让主线工作稳定可触达。  
4. Multi 上线后，2+ agent 真并行，导航模型不变。  

---

## 13. 文档与代码入口

| 区域 | 路径 |
|------|------|
| 本方案 | `docs/superpowers/specs/2026-08-08-working-set-and-multi-session.md` |
| Tab UI | `SessionTabBar.tsx`、`sessionTabs.ts`、`App.tsx` |
| Host | `electron/piHost.ts` → 演进为 Registry |
| Protocol | `src/shared/protocol.ts` |
| 侧栏 | `SessionSidebar.tsx` + list merge live |

---

## 14. 建议实施顺序

```
Phase A  工作集 9 + pin LRU + detach 语义（UI）
    ↓
Phase B  Registry + sessionKey + 真并行 + 侧栏 running
    ↓
Phase C  未读 / 缓存 / key remap / idle 回收
```

**第一个可合并的工程切片：** Phase A 的 `ensureInWorkingSet` + LRU + pin 满拒绝（在现有单 runtime 上即可交付注意力模型）。  
**第二个切片：** Phase B Host Registry（交付「关 tab 还在跑」）。
