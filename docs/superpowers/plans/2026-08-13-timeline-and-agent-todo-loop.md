# Timeline 与 Agent Todo Loop 优化路线图

> 状态：调研 + 诊断完成，待实施
> 日期：2026-08-13
> 触发：主 Timeline 展示（thinking / 工具输入输出 / 执行状态）优化，结合实际运行 session 诊断

---

## 1. 一句话结论

pi-desk 的 Timeline 已是中上水平（turn 分组、工具折叠、状态点、file-change 汇总、stick-to-bottom 都做对了）。真正的问题分两层：

1. **agent 行为层**：todo 工具存在、系统提示也注入了使用指引，但模型不听话——真实 session 里 todo 工具 **0 次调用**，右侧 Todos 面板永远空。这是「没有机制约束、只有建议」的必然结果。
2. **UI 层**：折叠只隐藏了每一行的 body，没有减少行数。真实 session 里 36 次工具调用 + 20 个 thinking 块平铺成 ~56 行，折叠后依然是墙。

**两个问题本质是同一个问题**：没有任务分解 → 没有分组锚点 → 工具只能平铺。

---

## 2. 行业调研摘要

| 产品 | 关键模式 | 值得抄的点 |
| --- | --- | --- |
| **OpenCode** (SST) | 扁平 row 模型 + 判别联合 + 虚拟化 | `TimelineRow`（含 TurnDivider/Error/Retry）；`@tanstack/solid-virtual` |
| OpenCode | 工具状态 active→done 动效 | `tool-status-title.tsx`：`Searching… → Searched 8 files`，只对变化后缀做 shimmer |
| OpenCode | 同类聚合 | `AnimatedCountList`：连续同类工具压成「Read 8 files」+ 动画计数 |
| OpenCode | 按工具类型的默认展开策略 | `part-default-open.ts`：bash 默认开、edit/write 默认关、纯删除则开 |
| OpenCode | 延迟挂载 | `BasicTool.defer`：展开 body 空闲帧再挂载，从底部往上（viewport 在最新 turn） |
| OpenCode | 内联诊断 / mini-diff | `DiagnosticsDisplay`（edit 后内联 lint 错误）、`DiffChanges` |
| **Claude Code** | 用量标注 | 每条 assistant 消息后标 token + 耗时 |
| **Codex** | 思考呈现 | reasoning 折叠块标题是「Reasoned for 12s」而非原文第一行 |
| **Cline** | 工具卡 | icon + 工具名 + 状态(✓/✗/spinner) + 耗时 + token，折叠 JSON，edit 带 diff |

---

## 3. 现状诊断（真实 session `019ff6d0-0e8e-79b0-a84d-e375fd3fbaf2`）

| 指标 | 值 |
| --- | --- |
| 用户 turn | 2 |
| 工具调用总数 | 36（33 × bash + 3 × read）|
| thinking 块 | 20 |
| todo 工具（todowrite/create/update/read）| **0** |
| plan 工具（plan_save/list/read）| **0** |
| 模型 | deepseek-v4-flash → deepseek-v4-pro，thinking=high |

两个刺眼细节：

- 33 条 bash 里 **8 条就是 `cd /tmp`**，还有大量重复命令——纯噪音，却各占一行。
- 系统提示注入了 `SYSTEM_GUIDANCE`（「3+ 步任务第一个工具调用 MUST be todowrite」），模型依然 0 次调用——**证明光靠 prompt 提示不够，需要 host 层 nudge 机制**。

相关代码现状：

- `packages/session-todo/extensions/todo.ts`：工具已注册，`before_agent_start` 注入指引。
- `src/renderer/components/Timeline.tsx`：`groupTurns` 按 user 切 turn；工具行一律默认折叠；无同类聚合。
- `src/renderer/App.tsx:286-289, 1646`：stick-to-bottom + 检测上滚，但上滚后无「回到底部」可视态。
- `src/renderer/components/ResourceInspector.tsx:118-122`：Todos 面板空态只显示「No todos yet」。
- `src/shared/protocol.ts`：`PiEvent` 已含 `compaction_*` / `auto_retry_*` 事件，但 Timeline 不渲染。

---

## 4. 完整路线图（分梯队）

> 进度：✅ 第一梯队全部完成（#1 nudge、#2 todo 回灌、#3 同类聚合）；✅ 第二梯队全部完成（#4 按 task 分组、#5 thinking 元信息、#6 分界行）；✅ 第三梯队 #7 虚拟化、#8 状态过渡、#9 回到底部 pill、#10 危险操作告警、#11 内联 mini-diff 已完成；#12 长尾已做 copy 按钮，剩余 collapse-all / 密度开关 / per-turn 用量 / 内联诊断。

### 第一梯队 —— 治本（立即做）

| # | 项 | 说明 | 落点 |
| --- | --- | --- | --- |
| 1 | **nudge 机制** | 检测「同一 turn 内工具调用 ≥ N 次 && todo 为空」→ 自动 steer「请用 todowrite 拆解」 | host 侧 + `session-todo` |
| 2 | **todo 回灌上下文** | 每个 turn 把当前 todo 状态（或「当前无 todo」）注入 context，模型才顺着 list 走 | `session-todo` 扩展 |
| 3 | **bash/read 同类聚合** | 连续同类工具压成一条「Ran 8 commands」（展开看明细），`cd /tmp` ×8 合并 | `Timeline.tsx` |

### 第二梯队 —— 结构 + 体验

| # | 项 | 说明 | 落点 |
| --- | --- | --- | --- |
| 4 | **按 task 分组** | 有 todo 时，工具行归属到当时的 `in_progress` todo 下，timeline 变「任务标题 → 工具组」 | `Timeline.tsx` + `appStore.ts` |
| 5 | **thinking 元信息** | 标题改「Thinking · 3s」而非原文第一行；紧邻工具的 thinking 折叠进工具行 | `Timeline.tsx` |
| 6 | **compaction/retry 分界行** | 协议数据已齐，渲染成分隔条（OpenCode `TurnDivider`） | `Timeline.tsx` + `appStore.ts` |

### 第三梯队 —— 债 + 质感（不阻塞，但要做）

| # | 项 | 说明 |
| --- | --- | --- |
| 7 | **虚拟化** | 长会话全量 DOM 是性能债；React 用 `@tanstack/react-virtual` 包 `Turn` |
| 8 | **工具状态 active→done 过渡** | running 显示 shimmer 文案，完成动画切到结果 |
| 9 | **回到底部 pill + 新消息提示** | 上滚时显示 `↓ 新消息`，复用已有 `stickToBottomRef` |
| 10 | **危险操作视觉告警** | delete/bash-rm 红色左边框，不只 error 才红 |
| 11 | **工具卡内联 mini-diff** | 复用 `FileChangeSummary.diff` 前几行 + `+n -n` |
| 12 | copy 按钮 / collapse-all / 密度开关 / per-turn 用量 / 内联诊断 | 长尾 |

---

## 5. 与早期 P0/P1/P2 清单的映射

早期（只看 UI）把「虚拟化 / 分界行 / 状态过渡」定为 P0；实际运行诊断后发现瓶颈更上游（todo 没被用 + 平铺墙），故让位。

| 早期清单 | 本次归属 |
| --- | --- |
| P0-1 虚拟化 | 第三梯队 #7 |
| P0-2 分界行 | 第二梯队 #6 |
| P0-3 状态过渡 | 第三梯队 #8 |
| P1-4 同类聚合 | 第一梯队 #3（升级）|
| P1-5 thinking 元信息 | 第二梯队 #5 |
| P1-6 pill / P1-7 告警 | 第三梯队 #9 / #10 |
| （新增）todo nudge + 回灌 | 第一梯队 #1 / #2 |
| （新增）按 task 分组 | 第二梯队 #4 |

---

## 6. 实施要点

### #1 nudge 机制
- 触发条件：同一 turn 内工具调用 ≥ 8 且 `session.todos` 为空，且请求非单步。
- 动作：走 pi 已有 `steer()`（`protocol.ts` 的 `PiApi.steer`），注入一条简短 steer，不打断运行。
- 阈值可配；flash 档模型阈值可更低（≤ 4）。

### #2 todo 回灌
- `session-todo` 扩展在 `before_agent_start` 里除注入静态 `SYSTEM_GUIDANCE` 外，追加当前 todo 快照（`todoread` 的输出形态）。
- 关键：把「当前无 todo」也显式写进上下文，作为负空间提示。

### #3 bash/read 同类聚合
- 位置：`Timeline.tsx` 的 `groupTurns` 之后、渲染之前，加一层 `groupConsecutive(trace, sameCategory)`。
- 聚合行显示「Ran N commands」+ 首条命令 preview；展开后逐个列原工具行。
- 注意保留 error 状态不聚合（error 永远单独成行）。

### #4 按 task 分组
- 依赖 #1/#2 先落地（否则无 todo 可分）。
- 数据：`todos_updated` 事件里的 `id/status`；渲染时按「工具行发生时处于 in_progress 的 todo」归属。
- 无 todo 时降级为 #3 的聚合视图。

### #5 thinking 元信息
- `thinkingSummary()` 改为优先 `timelineDuration(item)`（「Thinking · 3s」），原文第一行只作 tooltip。

### #6 分界行
- `appStore.ts` 把 `compaction_started/completed`、`auto_retry_started/completed` 落成 `TimelineItem`（新增 `kind: "divider"`），Timeline 渲染成细分隔条。

---

## 7. 验收标准

1. 同一个多步请求跑完后，右侧 Todos 面板**非空**，进度条更新，`Now: {当前任务}` 可见。
2. 长会话（≥ 20 工具调用）的 timeline 行数**显著下降**，同类工具聚合为分组。
3. thinking 行只占一行、标题为耗时，不泄露原文碎念。
4. 上下文压缩 / 自动重试发生时，timeline 有可见分界。
5. 长会话滚动不卡（虚拟化后）。
