# Pi Agent 能力接入差距清单

> **用途**：作为 pi-desktop GUI 与 pi Agent 官方能力、生态以及同类开源项目的差距基准。本文档只记录事实与差距，实施顺序见计划文档 `plans/2026-08-06-pi-capability-completion.md`。

## 状态

已调研（2026-08-06）：pi Agent 官方能力（pi.dev 文档 + SDK 源码 + SDK 类型定义 v0.83.0）、本项目（electron/piHost.ts + src/shared/protocol.ts + renderer）、同类开源项目（PiDeck、OpenPi、pi-gui 系、pi-deck、pi-desktop、Zosma Cowork、PI-Desktop、OpenClaw）。

## 1. 结论摘要

1. **没有任何开源 GUI 完完整整接入 pi Agent 全部能力**。多数停留在"会话管理 + 聊天 UI + 终端"三件套。
2. **OpenClaw 是 SDK 集成深度的标杆**（`createAgentSession` + 自定义 tools + systemPrompt override + 多账号 auth + 沙箱），它是嵌入型产品而非 GUI。
3. **本项目的架构分最高**（唯一用 runtime 级 API `createAgentSessionRuntime` 的 GUI，接口抽象 `PiSessionLike`/`PiRuntimeLike` 与 minghinmatthewlam/pi-gui 的 SessionDriver 同级），**但完成度低**：UI 只调用 8/22 个 PiApi 方法，大量组件是空壳，`executeCommand` 大多数命令 throw。
4. **生态融合现状**：数据层融合好（能看到 skills/prompts/themes/extensions/packages），行为层融合差（不能执行扩展命令、不能安装包、不能信任项目、不能登录）。

## 2. pi Agent 官方能力全景

来源：[pi.dev](https://pi.dev)、[SDK 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[Extensins 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)、本地安装的 SDK 类型定义（v0.83.0）。

### 2.1 核心 Agent 循环

- prompt / steer / followUp / abort
- 文本流式（`message_update` + `text_delta`）
- 思考流式（`thinking_start`/`thinking_delta`/`thinking_end`）
- 工具调用流（`tool_execution_start`/`update`/`end`）
- 消息队列（`queue_update`）
- 回合生命周期（`agent_start`/`agent_end`/`turn_start`/`turn_end`）
- 压缩（`compaction_start`/`compaction_end`）
- 重试（`auto_retry_start`/`auto_retry_end`/`summarization_retry_*`）
- bash 执行（`bash_execution_update`）
- 自定义 entry（`entry_appended`）

### 2.2 模型与认证

- `/login` `/logout`：OAuth/API key 凭据管理
- `/model`：模型切换（`setModel`）
- Thinking Level：off/minimal/low/medium/high/xhigh/max
- `/scoped-models`：Ctrl+P 循环模型
- `/llama`：本地 llama.cpp 模型管理
- 模型目录：内置 Provider + `models.json` 自定义 + 自定义 Provider/OAuth

### 2.3 会话管理

- `/new` `/resume` `/fork` `/clone` `/import`（runtime 级 `newSession`/`switchSession`/`fork`/`importFromJsonl`）
- `/tree`：`navigateTree`（session 内回退历史节点）
- `/name`：`setSessionName`
- `/session`：会话元数据展示
- `/copy`：复制最近回复
- `/export` `/import`：HTML/JSONL 导出导入（`exportToHtml`/`exportToJsonl`）
- `/share`：私有 gist 分享
- 会话列表/排序/恢复：`SessionManager.list`
- 会话树：`SessionManager.getTree`/`getSessionTree`

### 2.4 资源生态

- Context Files：`AGENTS.md`/`CLAUDE.md`（global/parent/project/package）
- Skills（Agent Skills 标准，`/skill:name`）
- Prompt Templates（`/name` 展开）
- Themes
- Extensions（TypeScript 模块：registerTool/registerCommand/registerShortcut/registerFlag/事件拦截/ctx.ui/appendEntry）
- Pi Packages（`pi install/remove/update/list/config`，bundle 以上资源）
- Project Trust（`.pi` 项目资源的加载门槛）
- `/reload`：热加载以上全部

### 2.5 扩展系统深度能力（生态融合试金石）

- 自定义工具注入 `customTools`
- system prompt 覆盖/追加
- 扩展事件拦截（`before_provider_headers`/`before_provider_request`/`after_provider_response`/`tool_call` block）
- `ctx.ui`（select/confirm/input/notify/custom）
- 多账号 auth 轮换
- `appendEntry` 持久化

### 2.6 安全

- **pi 官方没有内置权限/沙箱系统**（明确"runs with the permissions of the user"）。Project Trust 只是资源加载门槛，不是沙箱。
- 隔离方案由外部提供：Gondolin/Docker/OpenShell（文档见 containerization.md）。
- 官方明确不内置：MCP、sub-agents、plan mode、permission popups、background bash。

## 3. 本项目当前接入状态

### 3.1 SDK 导入面（electron/）

`electron/piHost.ts`：`createAgentSessionFromServices`、`createAgentSessionRuntime`、`createAgentSessionServices`、`getAgentDir`、`SessionManager`、`type AgentSessionRuntime`。
`electron/sessionCatalog.ts`：`SessionManager`、`type SessionInfo`。
其余文件零 SDK 导入。

### 3.2 PiHost 方法 → SDK 调用（已接 ✓）

| PiHost 方法 | SDK 调用 |
|---|---|
| start | SessionManager.open/create → createAgentSessionServices → createAgentSessionFromServices → createAgentSessionRuntime |
| prompt/steer/followUp/abort | session.prompt/steer/followUp/abort |
| setThinkingLevel | session.setThinkingLevel |
| setTools | session.setActiveToolsByName |
| compact | session.compact |
| reload | session.reload |
| setModel | session.modelRuntime.getModel + session.setModel |
| getCommands | session.extensionRunner.getRegisteredCommands |
| getModels | session.modelRuntime.getModels + getAvailableThinkingLevels |
| getTools | session.getActiveToolNames + getAllTools |
| getResources | resourceLoader.getExtensions/getAgentsFiles/getSkills/getPrompts/getThemes + settingsManager.getPackages |
| getSessionTree | sessionManager.getTree |
| newSession/switchSession/forkSession/importSession | runtime.newSession/switchSession/fork/importFromJsonl |
| snapshot | session.getSessionStats + getContextUsage |
| listSessions | SessionManager.list |
| dispose | runtime.dispose |

### 3.3 已订阅的 SDK 事件

`message_start`、`message_update`（text/thinking 各阶段）、`message_end`、`tool_execution_start/update/end`、`queue_update`、`thinking_level_changed`、`agent_end`、`session_info_changed`。

### 3.4 事件协议缺口（SDK 有、未订阅）

`agent_start`、`turn_start`、`turn_end`、`compaction_start`、`compaction_end`、`auto_retry_start`、`auto_retry_end`、`summarization_retry_scheduled`、`summarization_retry_attempt_start`、`summarization_retry_finished`、`bash_execution_update`、`entry_appended`、`model_select`、`session_start`、`session_shutdown`、`session_before_switch/fork/tree`、`project_trust_*`。

### 3.5 未接入能力清单（按严重度排序）

**A. UI 层（能力已过 IPC 但 renderer 不调用）** — 22 个 PiApi 中只调用 8 个：
- ✓ 调用：getSnapshot、startSession、chooseWorkspace、prompt、steer、followUp、abort、onEvent
- ✗ 未调用：newSession、resumeSession、forkSession、importSession、compact、setThinkingLevel、setTools、reload、executeCommand、setModel、getCommands、getModels、getTools、getResources、getSessionTree
- 后果：ModelSelector、CommandPalette、SettingsDialog、PackagePanel、DiagnosticsPanel、SessionSidebar 等组件大半是死的

**B. executeCommand 抛 "needs a desktop UI flow" 的命令**：
- /login、/logout、/llama、/scoped-models、/tree、/copy、/share、/session、/trust、/changelog
- /export 只实现 exportToHtml，未实现 exportToJsonl

**C. 会话导出**：`exportToJsonl` 在接口声明但从未调用。

**D. Project Trust**：`project_trust` 事件未接，`/trust` 未实现。后果：不信任的 `.pi` 项目资源无法加载，安全门槛缺失。

**E. 扩展系统深度**：只读命令列表，不执行扩展命令、不接 ctx.ui、不接扩展 UI、不接事件拦截。

**F. 包管理**：PackagePanel 只有 3 行占位，无 install/remove/update/list 逻辑。

**G. 事件缺口**：见 3.4。

**H. Diagnostics**：`createSdkRuntime` 里收集了 `services.diagnostics` 但被 `as unknown as PiRuntimeLike` 丢弃；snapshot().diagnostics 的 messages/errors 硬编码为空。

**I. 对比项缺失**：无内置终端（PTY）、无 Git 面板、无代码编辑器（PiDeck/OpenPi/pi-gui 都有）。

**J. SettingsManager 从未 import**：SDK 一等配置服务未接入。

## 4. 同类开源项目对比

| 项目 | 接入方式 | 亮点 | 缺口 |
|---|---|---|---|
| PiDeck (ayuayue, 476⭐) | spawn `pi --mode rpc` | 会话管理全、导入 Codex/Claude 会话、Git、终端、包管理 | RPC 协议深度受限；无扩展 UI |
| OpenPi (heyhuynhgiabuu) | SDK 内嵌 | 三层职责分离、Git 面板、diff、PTY、token/cost | 无审批、无 trust |
| pi-gui (minghinmatthewlam) | SDK 内嵌 + SessionDriver | 线程时间线、worktree、终端、diff、多 agent | 无认证流、无包管理 |
| pi-deck (Relrin) | 本地 pi CLI | Plan mode + tool-call 审批、Git review、代码编辑器、WSL | 依赖用户本机 CLI |
| pi-desktop (gustavonline) | spawn `pi --mode rpc` | 包管理 in-app、认证 picker、首启 CLI 检查 | 无扩展 UI |
| Zosma Cowork | Tauri + Node sidecar | sidecar 进程分离、扩展兼容 | 无 trust、无审批 |
| PI-Desktop (vastsa) | Electron + Rust host + sidecar | 插件 default-deny、权限分离 | 早期预览 |
| **OpenClaw（标杆）** | `createAgentSession` 直接 import | 自定义工具、systemPrompt override、多账号 auth、沙箱 | 非 GUI |

**结论**：功能覆盖最全的是 PiDeck；架构最接近标杆的是 OpenClaw；本项目架构分第一但完成度最后。

## 5. 差距优先级

按价值/成本比排序（详见计划文档）：

1. **P0-UI 接线**：22 个 PiApi 全部在 renderer 接线（纯体力活，价值最大）
2. **P0-命令补齐**：实现 throw 的命令（login/logout/copy/session/export JSONL 等）
3. **P1-事件补齐**：订阅 compaction/retry/model_select 等缺失事件
4. **P1-Project Trust**：安全门槛 + 生态资源钥匙
5. **P1-扩展执行/包管理**：与 PiDeck/gustavonline 拉开差距的生态融合点
6. **P2-终端/Git 面板**：对齐功能基线
7. **P2-diagnostics 透传 + SettingsManager 接入**
