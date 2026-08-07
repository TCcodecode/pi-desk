# Multi-Session Runtime 接入方案

## 状态

方案草案 — 基于当前 **单 runtime Tabs（方案 A）** 与已确认的 **预留 B**。

## 1. 先对齐概念：我们已有什么、缺什么

| 概念 | 现状 | 说明 |
|------|------|------|
| 多 session **文件** | ✅ 已有 | JSONL on disk；侧栏 list / open / new / delete |
| 多 tab **工作集** | ✅ 已有 | 打开集合 + ⌘1–9 切换 UI |
| 切换时保留历史 | ✅ 基本有 | `startSession({ sessionPath })` 加载该文件 |
| **多 agent 同时跑** | ❌ 没有 | `PiHost` 只有一个 `runtime?: PiRuntimeLike` |
| 后台 tab 继续 streaming | ❌ 没有 | 切走前 abort |
| 每 tab 独立 timeline 缓存 | ❌ 没有 | 切走即丢投影，再切靠磁盘/runtime 重载 |

**Multi-session（产品语义）** 在此方案里指：

> 多个 **live session/runtime** 可同时存在；UI 用 **Tabs = 工作集（最多 9）** 聚焦正在看的活；**关 tab 不停止 agent**；侧栏档案显示含 running 在内的全貌。

不是「再做一个侧栏列表」——那已经有了。

### 三层生命周期（关键产品原则）

| 层 | 是什么 | 关掉 / 离开时 |
|----|--------|----------------|
| **Tab（工作集）** | 顶栏 1～9 个「正在关注」的入口 | **只摘掉 UI 槽**；runtime **继续跑**（若在跑） |
| **Live runtime** | Host 里真正的 agent | 仅 **显式 Stop**、进程退出、或 **删除 session 文件** 时结束 |
| **磁盘 JSONL** | 档案 | 侧栏 Delete 才删；关 tab 绝不删 |

因此：

- 关 tab ≠ abort ≠ dispose（除非用户明确 Stop / 删文件）  
- 被 9 槽 LRU **挤掉** 的未 pin tab：同关 tab——离开工作集，**不杀** session  
- 侧栏必须能显示 **running**（无 tab 的 live session 也要看得见）  
- 再点侧栏该 session → **重新挂回 tab**（attach），接到已有 runtime，不是重开一份

---

## 2. 目标与非目标

### 目标

1. Tab A 在跑 agent 时，用户可切到 Tab B 继续聊 / 开新任务，**A 不中断**  
2. 事件按 `sessionId` / tab 路由，前台只渲染 active tab  
3. 资源可控：有上限、可回收、可显式 Stop  
4. 与现有 Tabs UI / 侧栏 / Composer project 语义兼容  

### 非目标（首期可不做）

- 无限并发 runtime  
- 跨窗口共享 runtime  
- 真 worktree 隔离（可二期：每 session 可选 worktree cwd）  
- 云端 session 同步  

---

## 3. 架构总览

### 3.1 现在（单 runtime）

```
Renderer (tabs UI)
    │  startSession / switch / abort
    ▼
PiHost
    └── runtime  ──────────►  一个 AgentSession
         events ──────────►  全局 applyEvent → 唯一 timeline
```

### 3.2 目标（多 runtime）

```
Renderer
  openTabs[] + activeTabId
  tabViews: Record<tabId, { timeline, session, queue, ... }>
    │
    │  prompt/steer/... 带 tabId / sessionKey
    ▼
PiHost (SessionRuntimeRegistry)
  activeForegroundKey?: string   // 可选：仅影响 snapshot 默认
  runtimes: Map<sessionKey, RuntimeSlot>
    RuntimeSlot {
      key, projectId, cwd, sessionFile?,
      runtime: PiRuntimeLike,
      unsubscribe,
      lastSnapshot projection?,
      status: idle|running|error
    }
    │
    │ 每个 slot.subscribe → 事件打上 sessionKey / sessionId
    ▼
IPC: pi:event { sessionKey, sessionId, ...payload }
```

**sessionKey** 建议：稳定键  

- 有文件：`file:${absoluteSessionPath}`  
- 新建尚无 path：`tmp:${uuid}`，首次落盘后迁移到 `file:...`  

与现有 `SessionTab.id` 对齐最好——**tab.id === sessionKey**。

---

## 4. 分层改造

### 4.1 Host：`SessionRuntimeRegistry`（核心）

从 `PiHost` 拆出（或内部升级）注册表：

| API | 行为 |
|-----|------|
| `open(key, { cwd, sessionPath? })` | 若 key 已存在返回；否则 `createAgentSessionRuntime` 并 subscribe |
| `focus(key)` | 仅改 foreground；**不 dispose 其它** |
| `detach(key)` / UI 关 tab | **仅** renderer 去掉 tab；**host 不 abort、不 dispose** |
| `stop(key)` / abort | 用户显式停止当前 turn 或 session agent |
| `dispose(key)` | 释放 runtime（例如删文件后、或进程清理）；**默认不随关 tab 调用** |
| `prompt/steer/followUp/abort(key, …)` | 路由到对应 slot |
| `snapshot(key?)` | 默认 foreground；或返回全部 slot 的轻量 status |
| `listSlots()` / live status | 供侧栏显示 running（含无 tab 的 live session） |

**同 project 多 session：** 同一 `cwd` 可多个 slot（不同 sessionFile）。  
**同 sessionFile 不重复 open：** open 时 dedupe（与 tab 去重一致）。

#### 事件

所有 `emit` 必须带：

```ts
{ sessionKey, sessionId?, type, payload, ... }
```

Renderer：

```ts
if (event.sessionKey === activeTabId) applyToForegroundStore(event);
else applyToBackgroundTabCache(event); // 至少更新 status / 未读 / 可选 timeline append
```

#### 资源策略（产品决策：无并发上限、无软提示）

与 Pi「想开多少 session 开多少」一致：

| 策略 | 决定 |
|------|------|
| 最大 concurrent runtime | **无硬上限** |
| 同时 running 过多时 toast / 拦截 | **不要** |
| 关 tab / 工作集挤出 | **detach only** — session 继续跑；侧栏可见 running |
| 真正停止 | 用户 Stop / abort API / 删 session 文件 |
| 工作集 UI 上限 | **最多 9 个 tab**（⌘1–9）；pin 免疫挤出；未 pin LRU 挤出 = detach |
| Pin 满 9 | 不能再往工作集塞新 tab，直到 unpin（live session 仍可在侧栏跑） |
| 内存 | 可选：长期 **idle** 的 live session 惰性 dispose（与「关 tab」无关）；MVP 可不做 |
| 后台 timeline | MVP 可只保留 status；有 tab 或 attach 时再 hydrate |

### 4.2 IPC / Protocol

在现有 `PiApi` 上演进（兼容优先）：

**方案 A — 参数加 key（推荐）**

```ts
prompt(text: string, opts?: { sessionKey?: string })
// 缺省 = active foreground
```

**方案 B — 先 setActiveSessionKey 再调旧 API**  
实现简单，但并发 prompt 会串台。**不推荐**做 multi 真并行。

新增：

```ts
listSessionRuntimes(): Promise<RuntimeSlotSummary[]>
closeSessionRuntime(sessionKey: string): Promise<void>
// event 增加 sessionKey
```

### 4.3 Renderer state

今天：

- `useAppStore` = **唯一** session 投影  
- `openTabs` 在 App 本地 state  

目标：

```ts
// tabSessionStore 或扩展 appStore
activeTabId: string
tabs: SessionTab[]  // 已有
// 每 tab 一份投影（至少 status；timeline 按策略）
views: Record<string, TabViewState>
// TabViewState ≈ 现在的 session + timeline + queue + toolCalls 子集
```

**前台切换：**

1. `activeTabId = key`  
2. 主 timeline/composer 读 `views[key]`  
3. **不**再 abort 后台  

**首包数据：**

- open 时：host 返回 full snapshot 写入 `views[key]`  
- 后台：持续 apply 带 sessionKey 的事件  

### 4.4 UI（已有 Tabs 几乎够用）

| UI | Multi 时变化 |
|----|----------------|
| Tab 状态点 | 非 active 也可 `running`（真正用起来） |
| 切 tab | 去掉 abort-on-switch |
| Composer | 发送绑定 `activeTabId` |
| Running 指示 | tab 上动画 + 可选全局「N agents running」 |
| 关 tab 若 running | 确认：Stop and close？ |

侧栏、pin、两行 project/session 标题：**不变**。

---

## 5. 分阶段落地（推荐路径）

### Phase 0 — 现状固化（已完成大半）

- [x] Tabs UI、pin、⌘1–9  
- [x] tab.id 与 sessionFile 关联  
- [ ] 统一 **sessionKey = tab.id** 命名与文档  
- [ ] `activateTab` 收敛为单一 port（方便替换实现）  

### Phase 1 — **多 runtime 骨架（能并行，后台可简化）**

**目标：** 两个 tab 各 open 一个 runtime；B 在跑时切到 A 不 abort B；前台只显示 active。

工作包：

1. **Host Registry**  
   - `Map<key, RuntimeSlot>`  
   - `open/focus/close/prompt(key)`  
   - 事件打 `sessionKey`  

2. **Protocol**  
   - 事件 schema + preload  
   - prompt 等带 optional sessionKey  

3. **Renderer**  
   - `views[key]`  
   - applyEvent 按 key 路由  
   - 切 tab 只改 activeTabId + 换绑定 view  

4. **策略**  
   - 无并发上限、无软提示  
   - 关 tab = detach，**不** stop runtime  
   - 侧栏展示 live/running（含无 tab）  
   - 工作集最多 9 tab + pin/LRU  

**验收：**

- Tab1 prompt 长任务 → 切 Tab2 → Tab1 仍 running（tab 点亮）→ 切回续上  
- Tab1 在跑 → **关掉 Tab1** → agent **继续跑** → 侧栏该 session 显示 running → 再点开 → attach 回 tab，输出还在  
- 第 10 个未 pin 打开 → 挤掉最久未用的未 pin tab（detach），被挤的若在跑仍 running  

### Phase 2 — **体验补齐**

- 后台 timeline 完整缓存 or 智能裁剪  
- sessionFile 落盘后 key 从 tmp→file 的迁移  
- 未读角标（无 tab 的 live 完成时也可在侧栏标）  
- 可选：长期 idle 的 live 惰性 dispose  

### Phase 3 — **增强（可选）**

- 每 session 可选 git worktree cwd  
- 崩溃恢复：重启后按 openTabs 重建 runtime（idle hydrate，不自动 resume running）  

---

## 6. 关键路径选择

| 路径 | 做法 | 评价 |
|------|------|------|
| **P1 真多 runtime**（推荐） | 每 tab 一个 `createAgentSessionRuntime` | 语义干净，匹配「同时跑」 |
| P1b 伪多 session | 单 runtime + 不 abort + 队列 | **不可行**：Pi 一个 session 对象不能同时两套消息流 |
| P1c 多进程/多窗口 | 每 tab BrowserWindow | 隔离强、成本高、状态难共享 |

结论：必须走 **每 tab 一个 runtime（或等价 AgentSession 实例）**。

---

## 7. 风险与对策

| 风险 | 对策 |
|------|------|
| 内存 / 句柄涨 | 关 tab 即 dispose；可选 idle 惰性回收（无产品上限） |
| 事件串台 | 强制 sessionKey；测试双 runtime 交错 delta |
| API key / model 全局 | 各 runtime 共享 auth 文件即可；注意并发 login |
| 同文件双开 | open dedupe by sessionFile |
| tmp key → file path | 落盘时 emit `session_key_remapped` |
| 测试复杂度 | Host 层用 fake runtimeFactory 单测 registry |
| 切换闪烁 | 前台 view 已有缓存则秒开；无缓存再等 snapshot |
| 用户同时跑太多 agent | **不拦截、不提示**；由用户与 provider 配额自行承担 |

---

## 8. 与当前代码的映射

| 现状文件 | 改造 |
|----------|------|
| `electron/piHost.ts` | 单 `runtime` → `runtimes: Map`；`start` 变为 `open` 语义 |
| `electron/main.ts` IPC | 透传 sessionKey；list/close runtime |
| `src/shared/protocol.ts` | Event 加 sessionKey；PiApi 方法签名 |
| `src/renderer/App.tsx` `activateTab` | 去 abort；改 focus + 换 view |
| `src/renderer/state/appStore.ts` | 多 view 或旁路 tabViews store |
| `SessionTabBar` | 非 active running 样式（已有 class，接真数据） |

---

## 9. 建议的实施顺序（可排期）

```
Week 1  Host Registry + 双 fake runtime 单测
Week 1  Protocol sessionKey + 双路事件
Week 2  Renderer views + 去 abort-on-switch
Week 2  手动验收双 tab 并行
Week 3  关 tab dispose / 未读点 / 可选 idle 回收
```

**最小可演示（MVP）：** 无上限、无软提示；不做后台 timeline 完整缓存——后台只更新 `status` + 切回时 full snapshot 一次。仍能证明「A 在跑 B 能聊」。

---

## 10. 决策清单

| # | 问题 | 决定 |
|---|------|------|
| 1 | 默认 max concurrent / 软提示 | **都不要**（与 Pi 开多少窗口一致） |
| 2 | 后台是否缓存完整 timeline | MVP **否**（切回再 hydrate）；完整缓存作 Phase 2 |
| 3 | 关 tab | **detach only**，不 abort / 不 dispose |
| 4 | 切 tab 是否还 abort | Multi 上线后 **否** |
| 5 | sessionKey 是否等于 tab.id | **是**（attach 时复用已有 runtime） |
| 6 | 工作集 tab 上限 | **9**；pin 保护；未 pin LRU 挤出 = detach |
| 7 | 侧栏 | 必须能显示 **running**（含无 tab 的 live） |
| 8 | 是否一上来就改 PiHost 大爆炸 | **先 Registry 旁路 + 单测，再切 IPC** |

---

## 11. 一句话路线图

> **现在：** 多 tab 是「单舞台多剧本，换角要停戏」。  
> **Multi-session：** 每 tab 自己的舞台；UI 只换镜头；事件按 `sessionKey` 进各自时间线；**开多少不设限**。  
> **路径：** Host Map&lt;key, runtime&gt; → 事件打标 → Renderer 多 view → 去掉 abort-on-switch → 关 tab 释放资源。

可从 **Host Registry + 双 runtime 单测** 开第一个 PR。
