# Pi Desktop Workspace 第一阶段设计

## 状态

已确认第一阶段范围：Pi Parity GUI，单 Workspace、多 Session、单活跃 Pi Agent。Workspace 平台能力后置。

## 设计依据

本设计以 [Pi 官方网站](https://pi.dev/)、[Pi 官方文档](https://pi.dev/docs/latest) 和 Pi SDK/API 文档为依据。Pi 的定位是一个保持核心最小、通过 Extensions、Skills、Prompt Templates、Themes 和 Packages 进行工作流定制的 Agent Harness，而不是一个把所有研发流程都预先内置的封闭 IDE。

因此，本项目的桌面 UI 要做到两件事：

1. 用桌面界面把 Pi 的真实状态、工具过程、Session 分支和上下文管理展示清楚。
2. 让 Pi 的扩展能力在桌面环境中可发现、可使用、可配置，而不是把 Pi 的能力重新实现成另一套私有功能。

## 1. 产品定位

本项目第一阶段是一个完整复刻 Pi Agent 交互和能力边界的桌面 GUI。它先聚焦一个当前工作目录和多个可恢复的 Pi Session，提供清晰的桌面交互体验；多项目 Workspace、远程控制、跨项目知识索引和 Connector 放到 Pi Parity 稳定之后。

第一阶段的产品目标是：用户不打开 Pi TUI，也能完成 Pi 交互模式中的完整日常工作流，并清楚看到 Agent 正在做什么、修改了什么以及哪些操作需要批准。

### 1.1 Pi-first 设计原则

“Codex 风格”只表示交互层面的清晰度：时间线、流式输出、结构化工具卡片、Diff 和审批。它不表示复制 Codex 的产品工作流。

产品能力和默认行为应优先体现 Pi 的优势：

- 核心保持小而直接，不把所有能力强行内置进主流程。
- Extensions、Skills、Prompt Templates 和 Themes 是一等公民。
- 支持 Provider 无关的模型切换、自定义模型和 Thinking Level。
- 保留 Pi 的 Session 树、Fork、上下文压缩和可恢复工作流。
- 优先展示 Agent 的真实过程和原始工具结果，不用过度抽象的黑盒状态替代它们。
- UI 是 Pi Runtime 的可视化外壳，不修改 Pi 的核心行为；需要额外能力时，优先通过 Pi Extension 或独立 Workspace 模块增加。

因此，第一阶段应当做成“Pi-native 的 Codex-style UI”，而不是“把 Pi 改造成 Codex”。

### 1.2 与 Codex 风格的边界

借鉴 Codex 的部分：

- 信息层级清晰的消息时间线。
- 流式内容和 Tool Call 的实时状态。
- Diff、文件和审批的独立查看区域。
- 任务执行状态可见，而不是只显示最终回答。
- 错误、重试、取消和等待状态明确。

不复制 Codex 的部分：

- 不强制内置 Plan Mode。
- 不强制内置 Sub-agent 编排。
- 不把审批策略写死为固定弹窗流程。
- 不把所有外部工具抽象成必须安装的 MCP。
- 不把 Session 简化成线性聊天记录。
- 不牺牲 Pi 的命令、资源、配置和 Extension 机制来追求界面统一。

桌面 UI 只是 Pi 的另一种宿主。Pi TUI 中可以直接访问的能力，桌面 UI 应优先通过 Pi SDK 或 Extension Bridge 暴露，而不是复制一套平行 Agent 逻辑。

## 2. Pi-native 功能规格

### 2.1 Pi 的四区交互模型

Pi 官方交互界面可以抽象为四个区域：启动信息、消息流、编辑器和状态 Footer。桌面端保留这个信息模型，但转换成适合窗口的布局：

- 启动信息：Workspace Header 和 Session Header，展示已加载的 Context Files、Prompt Templates、Skills、Extensions、Project Trust 和当前工作目录。
- 消息流：中央 Timeline，展示用户消息、Agent 回复、Thinking、Tool Call、Tool Result、通知、错误和 Extension UI。
- 编辑器：底部 Composer，支持多行输入、`@` 文件引用、`/` 命令、Steer、Follow-up、模型和 Thinking Level。
- Footer：显示 Session 名称、模型、Context 使用量、Token、缓存、费用、当前状态和最近一次运行结果。

桌面 UI 可以增加左侧 Session 列表和右侧 Review Panel，但不能隐藏 Pi 的运行状态和上下文信息。Footer 信息是 Pi 体验的重要组成部分，不应被简化成一个不透明的“正在工作”图标。

### 2.2 输入和消息队列

Pi 的输入不是只有“发送一条新消息”：

- 普通 Prompt：开始新的 Agent Turn。
- Steer：Agent 工作期间插入新指令，在当前工具执行节点之后优先处理，并可能中断剩余工具调用。
- Follow-up：Agent 完成当前工作后再处理。
- Abort：停止当前运行，并恢复尚未发送的队列内容。
- `!command`：执行本地 Shell 命令，并把输出发送给 Agent。
- `!!command`：执行本地 Shell 命令，但不把输出加入 Agent 上下文。

Composer 必须明确区分这些输入类型。Steer 和 Follow-up 不应被实现为普通消息气泡，否则用户无法判断消息什么时候生效。

快捷键语义也必须保留：Enter 发送 Steer，Alt+Enter 发送 Follow-up，Escape 中断并恢复队列，Alt+Up 取回排队消息，Shift+Enter 输入多行，Ctrl+G 打开外部编辑器，Ctrl+X 复制最近回复，Ctrl+L 选择 Model，Ctrl+P 循环 Scoped Models。

### 2.3 Session、Branch 和 Workspace 的区别

需要区分三个概念：

- Workspace：Pi Parity 第一阶段指当前 Pi 工作目录；后续才扩展为由 workspace.yaml 声明的 Project 集合、关系和 Environment。
- Session：一个独立的 JSONL 对话文件。
- Branch：同一个 Session 文件中的一条历史分支。

Pi 的 Session 不是线性列表，而是以 `id` 和 `parentId` 组织的树。当前节点是 active leaf。桌面 UI 必须把 Session 列表和 Session Tree 分开：

- Session Sidebar 管理不同 Session 文件。
- Session Tree 管理当前 Session 内的历史分支。

操作语义：

- New Session：创建新的 Session 文件。
- Tree：在当前 Session 文件内回到历史节点并从该位置继续。
- Fork：从某个用户消息创建新的 Session 文件。
- Clone：复制当前 active branch 到新的 Session 文件。
- Compact：在当前分支中总结旧上下文，不创建新的 Session。

这一区分是 Pi 相比普通聊天 UI 的核心优势，不能把所有操作都设计成“新建一个聊天窗口”。

### 2.4 Session Tree 的桌面交互

Session Tree 至少需要支持：

- 展示用户、Agent、Tool、Compaction 和 Branch Summary 节点。
- 显示当前 active leaf。
- 按默认、仅用户消息、无 Tool、仅标记节点等模式过滤。
- 给重要节点设置 Label/Bookmark。
- 点击用户节点后将输入恢复到 Composer，并允许编辑后创建新分支。
- 点击 Agent 或 Tool 节点后从该节点继续，不重复创建 Session 文件。
- 从一个分支切换到另一个分支时，显示是否生成 Branch Summary。
- 在 Summary 中显示 Goal、Constraints、Progress、Key Decisions 和 Next Steps。

### 2.5 Context Engineering

Pi 的 Context Engineering 应成为桌面 Workspace 的可见能力，而不是隐藏在启动过程里。

第一阶段需要识别和展示：

- 全局 `~/.pi/agent/AGENTS.md`。
- 从项目父目录向下继承的 `AGENTS.md` 或 `CLAUDE.md`。
- 当前项目目录中的 Context Files。
- 项目 `.pi/SYSTEM.md` 和 `.pi/APPEND_SYSTEM.md`。
- 项目 Skills、Prompt Templates、Themes 和 Extensions。
- 当前使用的 Provider、Model、Thinking Level 和 Tool Allowlist。

Workspace Header 中应提供“Context Inspector”，让用户能看到本次 Session 实际加载了哪些文件、哪些资源被跳过，以及资源来源是 global、parent、project 还是 package。

### 2.6 Project Trust

Project Trust 不是安全沙箱，而是控制 Pi 是否加载项目本地 Settings、Extensions、Skills、Prompt Templates、Themes 和 Packages 的输入加载门槛。

桌面端需要：

- 首次打开包含 `.pi` 资源的项目时展示信任状态。
- 区分 global resources 和 project-local resources。
- 展示项目资源来源和待加载内容。
- 允许信任、拒绝或保持未决定。
- 将信任决策交给 Pi 的 Trust 机制保存，不在 UI 中复制另一份规则。
- 明确提示：信任项目不等于限制 Agent 的文件、进程或网络权限。

Pi 官方明确说明 Project Trust 不是 Sandbox；Pi 默认以启动它的用户权限运行。若需要真正隔离，应由 Container、VM、Gondolin、Docker 或其他策略沙箱提供。[Pi Security](https://pi.dev/docs/latest/security)、[Pi Containerization](https://pi.dev/docs/latest/containerization)

### 2.7 Compaction 和 Branch Summary

Context Compaction 是 Pi 的核心工作流，不应只做成一个设置项。

桌面端需要展示：

- 当前 Context 使用量和预留响应空间。
- 自动 Compaction 即将触发的提示。
- `/compact` 手动操作及可选的自定义总结指令。
- Compaction 节点及其 Summary。
- Summary 涉及的已读取文件和已修改文件。
- Branch Summary 与普通 Compaction 的区别。
- Compaction 所消耗的 Token 和模型。
- Compaction 失败、取消和重试状态。

Pi 的 Compaction 会保留最近消息并总结旧上下文；Branch Summary 则用于从一个 Session 分支切换到另一个分支时保留离开分支的重要信息。两者都应是 Timeline 中可检查的结构化节点，而不是静默地改变上下文。

### 2.8 Extensions、Skills、Prompt Templates、Themes

这四类资源在 UI 中需要明确区分：

- Extension：TypeScript 模块，可以注册 Tools、Commands、Events、Keybindings 和自定义 UI。
- Skill：按需加载的能力说明和工具入口，使用渐进式披露，默认只让模型看到描述。
- Prompt Template：Markdown 文件，通过 `/name` 展开为可复用 Prompt。
- Theme：控制 Pi 的视觉和状态表达。
- Pi Package：把以上资源打包，通过 npm、Git 或本地路径安装和共享。

Workspace UI 需要提供 Package/Resource 面板，至少支持：

- 查看 global、project 和 package 资源。
- 启用和禁用资源。
- 查看资源来源、版本和依赖。
- 安装、更新、移除和锁定 Package。
- 通过 `/reload` 或等价动作重新加载资源。
- 查看资源贡献的命令、Tool、Prompt、Skill、Theme 和 UI。
- 在当前 Session 中显示资源加载结果和失败原因。

Pi Package 和 Extension 具有完整系统访问能力，第三方资源必须展示安全提示和来源，不应设计成“安装后无感执行”。[Pi Packages](https://pi.dev/docs/latest/packages)

Pi 内置 Tools 至少包括 read、bash、edit、write、grep、find 和 ls。GUI 必须支持 Tool Allowlist、Exclude Tools、关闭全部 Tools，以及同时保留 Extension Tool 和 Custom Tool 的配置语义。

### 2.9 Models、Providers 和认证

模型选择是 Pi 的运行时能力，不是一个固定的下拉框。

第一阶段需要支持：

- 订阅型 Provider 的 OAuth 登录。
- API Key Provider。
- `models.json` 中的自定义 Model。
- 自定义 Provider 和 OAuth Flow。
- Session 内切换 Model。
- Scoped Models：限制当前 Session 可循环的 Model。
- Provider、Model、Thinking Level 的组合显示。
- Model Catalog 的刷新状态和缓存状态。
- 当前 Model 不可用时的明确错误。

认证信息只在 Main/Agent Host 中处理，Renderer 只接收 Provider 状态和不可逆的展示信息。Pi 已支持多种订阅、API Key、OpenAI-compatible、Anthropic-compatible、自定义 Provider 和本地模型配置。[Pi Providers](https://pi.dev/docs/latest/providers)、[Custom Models](https://pi.dev/docs/latest/models)、[Custom Providers](https://pi.dev/docs/latest/custom-provider)

### 2.10 多种运行模式

Pi 同时提供 Interactive、Print/JSON、RPC 和 SDK 四种模式。第一阶段使用 SDK，但 Host 和 UI 协议不应依赖 TUI 文本。

- Interactive：作为人工使用和体验基准。
- SDK：第一阶段 Electron Agent Host 的首选集成方式。
- JSON Event Stream：第一阶段用于调试、录制、回放和测试事件。
- RPC：第一阶段保留兼容适配和诊断入口，未来复用于 Web、手机、远程和非 Node Host。

第一阶段需要保留一个“Pi Runtime Diagnostics”面板，可以查看当前 SDK Session、Session File、Session ID、事件序号、Model、Context 和最近一次错误。

## 3. 范围

### 3.1 目标功能

- 选择一个本地项目目录作为当前 Pi 工作目录；Workspace manifest 和多 Project 管理属于 Pi Parity 之后的阶段。
- 在 Workspace 下创建多个 Session。
- Session 之间拥有独立的消息历史、上下文、模型和 Pi session 文件。
- 新建、切换、恢复、重命名、归档 Session。
- 同一时刻只运行一个活跃 Pi Agent；其他 Session 保持可恢复状态。
- 流式显示 Agent 回复、思考内容和 Markdown。
- 将工具调用显示为结构化卡片，包括读取、编辑和命令执行。
- 支持工具输出折叠、展开和长输出截断。
- 支持中断、Steer 和 Follow-up。
- 支持查看文件变更、Diff 和基础文件预览。
- 支持基本审批：允许、拒绝、停止。
- 支持模型切换和 Thinking Level 切换。
- 支持 Session 恢复和退出后继续使用。
- 支持 `/` 命令、Prompt Template、Skill 和 Extension 入口。
- 支持 `@` 文件引用，并保留 Pi 对项目 Context 文件的发现机制。
- 支持 Session 树、Fork、上下文 Compact 和可继续的分支工作流。
- 支持自定义 Provider、模型目录和 Pi 原生配置，不把模型选择限制为固定列表。
- 对 Extension 提供通用的状态、通知和自定义 UI 承载能力。
- 支持 Pi 的四个交互区域：Startup Header、Messages、Editor 和 Footer。
- 支持 Editor 的文件模糊搜索、路径补全、多行输入、外部编辑器、图片输入、!command 和 !!command。
- 覆盖 Pi 官方内置 Slash Commands、Keybindings、Settings、Package Commands、Session 导入/导出/分享和 /reload 热加载。
- 支持 Pi 的 Interactive、Print/JSON、RPC 和 SDK 运行模式；桌面主界面以 Interactive parity 为验收基准。

### 3.2 第一阶段优先级

为了避免第一版变成完整 IDE，目标功能分为两个交付层：

P0 是必须打通的 Pi 核心工作流：

- Workspace 选择和单活跃 Agent Host。
- 多 Session 的创建、切换、恢复和命名。
- Session Tree、Fork、Clone 和基础 Branch Summary。
- Streaming Message、Thinking、Tool Call 和 Tool Result。
- Prompt、Steer、Follow-up、Abort 和消息队列。
- `@` 文件引用和 `/` 命令入口。
- Model、Provider 和 Thinking Level 展示与切换。
- Context 使用量、Token、费用和运行状态。
- Diff、文件变更、错误和基础审批。
- 自动/手动 Compaction 的状态展示。

P1 是 Pi 原生生态接入：

- Context Inspector 和 Project Trust。
- Skills、Prompt Templates、Themes 和 Pi Packages 面板。
- Extension 命令、工具、通知、Keyboard Shortcuts、Events 和 UI Bridge。
- Pi Extension 的全屏 UI、Custom UI Components 和可降级的 TUI 承载。
- 自定义 Model、Provider 和认证管理。
- Session 导出、导入和分享。
- Runtime Diagnostics 和 JSON Event 录制。

P1 可以在 P0 之后逐项交付，但 P0 的数据模型必须从一开始为 P1 的资源和事件留出扩展字段。

### 3.3 Pi Parity 的定义

第一阶段的“完整 Pi Agent 功能”指 Pi 当前官方文档中可用的 Interactive Mode 和其官方扩展边界：

- 交互区、编辑器行为、消息队列、快捷键和设置行为与 Pi 保持语义一致。
- Slash Commands 不做功能子集，至少覆盖 /login、/logout、/llama、/model、/scoped-models、/settings、/resume、/new、/name、/session、/tree、/trust、/fork、/clone、/compact、/copy、/export、/import、/share、/reload、/hotkeys、/changelog 和 /quit。
- Context Files、System Prompt Files、Project Trust、Skills、Prompt Templates、Themes、Extensions 和 Packages 都必须可发现、可加载、可诊断。
- Model/Provider、OAuth/API Key、Thinking Level、Scoped Models、Custom Models 和 Custom Providers 不得被桌面 UI 的固定列表限制。
- Session 文件、树状历史、分支、Compaction、Branch Summary、恢复和分享必须保留 Pi 语义。
- GUI 的运行时事件必须能映射回 Pi SDK/RPC/JSON Event，而不是只模拟最终文本。

Pi 明确选择不内置的 MCP、Sub-agent、Plan Mode、内置 Todo、权限弹窗和后台 Bash 不属于第一阶段的“缺失功能”；如果以后需要，应通过 Pi Extension 或 Package 提供。

### 3.4 明确不包含

第一阶段不实现以下能力：

- 多 Workspace 同时运行。
- 多个 Pi Session 并行执行。
- 多 Agent 协同和任务编排。
- 手机端和远程控制。
- Workspace Manifest、Pi Workspace Manager 和跨项目 Project 关系管理。
- 跨项目 RAG、项目关系图和调用链分析。
- Jira、Wiki、Grafana 等外部 Connector。
- 云端同步和账号系统。
- 完整权限沙箱和企业级策略管理。
- 强制复制 Codex 的 Plan Mode、固定审批策略或内置多 Agent 工作流。

这些能力必须建立在第一阶段的 Session、事件模型和审批模型稳定之后。

## 4. 核心概念

### 4.1 Project

Project 是一个可被 Pi 管理和索引的代码项目，语义上接近 Codex 的 Project。它通常对应一个本地目录、Git 仓库或 Monorepo 中的子目录。

Project 至少包含：

- `projectId`
- `name`
- `path`
- `tags`
- `source`（可选）

第二阶段可以只支持本地目录和 Git 工作树，后续再支持远程仓库、Monorepo 子项目和其他代码源。

### 4.2 Workspace

在 Pi Parity 第一阶段，Workspace 仅作为当前工作目录的 UI 作用域存在；下面的 manifest 结构作为第二阶段的平台能力保留。

Workspace 是一个由 `workspace.yaml` 描述的研发工作上下文。它可以包含一个或多个 Project、Project 关系、Environment 和插件配置。第一阶段界面只激活一个 Workspace，但 Workspace 从设计上支持多个 Project。

Workspace 至少包含：

- `workspaceId`
- `displayName`
- `manifestPath`
- `projectIds`
- `activeEnvironmentId`
- `activeSessionId`
- `createdAt`
- `updatedAt`

### 4.3 Environment

Environment 是第二阶段 Workspace 中一组 Project 的运行上下文，例如 `local`、`development`、`staging` 或 `production`。Environment 可以指定分支、版本、Endpoint、日志来源和只读策略，但第一版只保留简单字段，复杂部署拓扑由后续插件扩展。

### 4.4 Session

Session 是一个独立的 Agent 工作上下文。不同 Session 不共享对话历史，但默认共享同一个 Workspace 文件目录。

Session 至少包含：

- `sessionId`
- `workspaceId`
- `projectId`
- `environmentId`
- `title`
- `piSessionFile`
- `model`
- `thinkingLevel`
- `status`
- `messageCount`
- `createdAt`
- `updatedAt`

`status` 至少包括 `idle`、`running`、`awaiting_approval`、`completed`、`error` 和 `archived`。

第一阶段采用“多 Session、单活跃运行时”策略：只有当前 Session 启动 Pi 运行时并接收流式事件；切换到其他 Session 时，当前运行时需要先完成、停止或进入可恢复状态。

## 5. UI 结构

### 5.1 左侧 Session Sidebar

- 当前 Workspace 名称和路径。
- 当前工作目录、Session 名称和 Pi 运行模式摘要。
- 新建 Session。
- Session 列表，按最近更新时间排序。
- Session 标题、状态、最近消息时间和变更提示。
- 搜索 Session。
- 重命名、归档和删除入口。

### 5.2 中央 Timeline

Timeline 是主交互区域，按顺序渲染：

- 用户消息。
- Agent 消息。
- 思考内容。
- Tool Call。
- Tool Result。
- 审批请求。
- 错误和状态通知。

所有内容都必须基于结构化事件渲染，不解析终端文本，也不把原始 stdout 直接当作 UI 数据模型。

### 5.3 Composer

Composer 支持：

- 多行输入。
- 发送消息。
- 中断当前执行。
- Steer 当前 Agent。
- Follow-up 排队消息。
- `@` 文件引用。
- `/` 命令和 Prompt Template 命令面板。
- Skill、Extension 和 Theme 的入口。
- Thinking Level 展示和切换。
- 当前模型展示和切换。

### 5.4 右侧 Review Panel

Review Panel 第一阶段包含：

- 当前 Session 状态。
- Changed Files 列表。
- 文件 Diff。
- 工具审批请求。
- 最近一次命令执行摘要。

右侧面板可以折叠，保证对话区域在小屏幕上仍然可用。

### 5.5 Pi Resource Inspector

Resource Inspector 不是普通的 Settings 页面，而是帮助用户理解“这次 Agent 为什么这样工作”的诊断界面。

它至少展示：

- 当前 Session 使用的 Model、Provider 和 Thinking Level。
- 已加载的 Context Files 及其路径。
- 已加载的 Skills、Prompt Templates、Themes 和 Extensions。
- 每个资源的来源、启用状态和加载错误。
- 当前 Tool Allowlist 和被排除的 Tool。
- Project Trust 状态。
- 当前 Compaction 配置和最近一次 Summary。

### 5.6 Session Tree Panel

Session Tree Panel 可以作为中央 Timeline 的抽屉或右侧面板，不要求始终占用空间。它必须支持在“阅读消息”和“管理分支”之间快速切换，而不是只展示一个不可操作的历史目录。

## 6. 运行时架构

第一阶段采用 Electron + React + TypeScript，并优先直接集成 Pi SDK，以降低首次实现成本。Pi SDK 与 React UI 之间必须通过应用内部的 `SessionDriver` 隔离。Pi 不直接运行在 Renderer 中，而是在独立的 Agent Host 中运行。

主要模块：

- `PiSessionDriver`：启动、发送消息、中断、恢复和销毁 Pi Session。
- `AgentHost`：在独立进程中承载 Pi SDK，管理运行时崩溃和 Session 生命周期。
- `PiRuntimeAdapter`：封装 `AgentSessionRuntime`，负责 `newSession`、`switchSession`、`fork`、`clone`、`compact` 和事件重新订阅。
- `PiWorkspaceManager`（第二阶段）：作为 Pi Extension 提供 Workspace 创建、Project 注册、Environment 切换、关系维护和索引操作；所有会写入 manifest 的操作先生成可审阅的变更。
- `WorkspaceEngine`（第二阶段）：解析和校验 `workspace.yaml`，维护 Project 关系图，调度索引并提供确定性的 Workspace 查询。
- `SessionManager`：管理 Workspace 下的 Session 元数据和当前活跃 Session。
- `PiResourceManager`：读取和展示 Pi 的 Context Files、Skills、Prompt Templates、Themes、Packages 和 Extensions。
- `ProjectTrustBridge`：把 Pi 的 Project Trust 事件转换为桌面确认流程，并将结果写回 Pi 的 Trust 机制。
- `PiExtensionBridge`：承载 Extension 的 Commands、Tools、Events、Notifications 和受支持的 UI 能力。
- `PiModelRegistry`：读取 Pi 的 Provider/Model Catalog、认证状态和 Scoped Models。
- `EventProjector`：将 Pi 事件转换为稳定的 UI 状态。
- `RuntimeDiagnostics`：记录 Pi 版本、Session File、Session ID、事件序列、资源加载和异常。
- `SessionStore`：保存消息、工具调用、审批、Diff 和 Session 状态。
- `TimelineRenderer`：渲染结构化时间线。
- `ReviewPanel`：展示 Diff、权限和运行状态。
- `ComposerController`：处理发送、Steer、Follow-up 和中断。
- `IpcContract`：定义 Renderer 与主进程之间的类型化 IPC 契约。

Renderer 不直接访问 Node、文件系统或 Pi SDK。所有系统能力通过受控 preload 和类型化 IPC 暴露。后续如果切换到 Pi RPC，替换 `AgentHost` 和 `PiSessionDriver` 即可，UI 状态模型不变。

`PiRuntimeAdapter` 必须基于 Pi 的 `AgentSessionRuntime`，而不是只持有一个裸 `AgentSession`。Pi 的 Runtime API 负责 Session 替换和 cwd 相关的运行时重建；切换、Fork 或创建新 Session 后，应用必须重新订阅新的 Session 事件，并重新绑定 Extension。

#### Extension 兼容级别

桌面 UI 不应承诺第一天就完整模拟所有 `pi-tui` 自定义组件。Extension 兼容分为三层：

1. Resource/Command/Tool 层：支持资源发现、命令注册、自定义 Tool、Model 事件和 Session 事件。
2. Desktop UI Primitive 层：把通知、确认、选择、输入、状态条、进度和可折叠内容映射为桌面组件。
3. Arbitrary TUI Component 层：对只依赖终端坐标、ANSI 或 `pi-tui` 组件的 Extension，第一阶段提供降级提示、终端 fallback 或原始事件查看，不强行把它们转换成 HTML。

长期可以设计一个与渲染器无关的 Desktop UI Schema，但不能为了兼容少量 TUI Extension 而在第一阶段复制整个 `pi-tui`。

## 7. 事件模型

内部事件模型参考 Codex 的 Thread、Turn、Item 设计，但不要求第一阶段完整复制 Codex 协议。

第一阶段至少需要以下事件：

- `session_started`
- `user_message_created`
- `assistant_message_started`
- `assistant_message_delta`
- `assistant_message_completed`
- `thinking_started`
- `thinking_delta`
- `thinking_completed`
- `tool_call_started`
- `tool_call_delta`
- `tool_call_completed`
- `queue_updated`
- `turn_started`
- `turn_completed`
- `compaction_started`
- `compaction_completed`
- `branch_summary_created`
- `resource_discovery_started`
- `resource_discovery_completed`
- `workspace_loaded`
- `workspace_operation_proposed`
- `workspace_manifest_changed`
- `workspace_environment_changed`
- `workspace_relation_changed`
- `workspace_index_status_changed`
- `project_trust_requested`
- `project_trust_resolved`
- `model_changed`
- `thinking_level_changed`
- `notification_created`
- `approval_requested`
- `approval_resolved`
- `file_changed`
- `session_completed`
- `session_error`

每个事件至少包含：

- `eventId`
- `workspaceId`
- `sessionId`（Workspace 级事件可以为空）
- `timestamp`
- `sequence`
- `type`
- `payload`

`sequence` 用于保证事件排序，并为未来的重连、回放和远程同步预留能力。

Pi SDK 的原始事件需要由 `PiRuntimeAdapter` 映射到这些 Workspace 事件。例如：

- `message_update/text_delta` → `assistant_message_delta`。
- `tool_execution_start` → `tool_call_started`。
- `tool_execution_update` → `tool_call_delta`。
- `tool_execution_end` → `tool_call_completed`。
- `queue_update` → `queue_updated`。
- `compaction_start/end` → `compaction_started/completed`。
- Extension 的资源、通知和自定义 UI 事件 → 对应的 Workspace Extension Event。

原始 Pi Event 需要保存在事件的 `raw` 字段或 Diagnostics Store 中，便于排查兼容性问题；业务 UI 只依赖稳定的 Workspace Event。

## 8. Session 持久化

Pi 的 Session 文件继续作为 Agent 对话的主要来源。应用自身只保存 UI 所需的元数据和派生状态，不复制一份不可维护的 Agent transcript。

应用需要保存：

- Workspace 元数据。
- Session 显示名称和标签。
- 当前模型和 Thinking Level。
- 最近一次 UI 状态。
- 文件变更索引。
- Tool Call 和审批的 UI 状态。
- Session 最近活动时间。
- 当前 Session Tree 的 active leaf、过滤器和选中节点。
- Context Inspector 的资源快照和加载错误。
- Project Trust 的展示状态和最近一次决策来源。
- Model Catalog 的缓存版本和 Provider 状态。
- Runtime Diagnostics 的错误摘要和最近事件序号。

第一阶段可以使用 SQLite 保存应用元数据，Pi Session transcript 继续使用 Pi 自己的存储机制。后续实现跨设备同步时，应用事件需要支持幂等 ID 和增量回放。

## 9. Diff 和审批

Diff 不应只作为 Agent 回复中的文本出现，而应作为 Workspace 状态独立展示。

基础 Diff 能力：

- 文件列表。
- 新增、修改、删除和重命名状态。
- 行级 Diff。
- 文件内搜索。
- 在对话和 Diff 之间跳转。
- 按文件批准或放弃修改。
- 区分 Pi Tool 产生的修改、用户手动修改和外部进程修改。
- 从 Diff 文件跳转到触发修改的 Tool Call 和 Session 节点。
- 显示修改发生前后的 Git 状态，但不把 Git 状态误认为 Pi Session 状态。

审批卡片至少展示：

- 工具名称。
- 实际命令或文件路径。
- 工作目录。
- 可能影响的文件。
- 允许、拒绝和停止按钮。

第一阶段的审批是交互控制，不等同于安全沙箱。真正的进程隔离、文件权限和命令策略属于后续安全阶段。

Pi 默认没有内置 Sandbox，Extension、Package 和 Tool 都可能以当前用户权限访问系统。第一阶段必须在安装 Package、加载 project-local Extension 和首次信任 Workspace 时展示风险提示；如果未来提供安全执行模式，应接入容器或微型虚拟机，而不是在 UI 中伪造一个不完整的权限系统。

## 10. 推荐技术栈

- Desktop：Electron；第一阶段优先兼容 Pi 的 Node/TypeScript SDK。
- Process：Electron `utilityProcess` 或独立 Node 子进程承载 `AgentHost`。
- UI：React + TypeScript。
- Build：Vite / electron-vite。
- State：Zustand 作为视图状态容器，核心状态由事件投影 Reducer 产生。
- IPC：preload + 类型化 MessagePort/IPC；使用 Zod 校验跨进程消息。
- Editor：CodeMirror 6。
- Terminal：xterm.js。
- Markdown：支持增量渲染的 Markdown renderer。
- Diff：基于结构化文件变更的 Diff renderer。
- Persistence：SQLite。
- Runtime：`@earendil-works/pi-coding-agent` SDK。
- Package manager：pnpm workspace；先不引入额外的构建编排层。
- Testing：Vitest + Playwright。

### 10.1 技术选型原则

- Electron 只负责桌面容器和系统集成，不承载业务状态。
- Agent Host 只负责 Pi Runtime 和事件，不直接渲染 UI。
- React Renderer 只消费 Workspace Event 和 Query Model。
- Workspace Event 必须独立于 Pi SDK 原始类型，保证未来 RPC/远程客户端可复用。
- `workspace.yaml`（第二阶段）是 Workspace 关系的可读源文件；索引、调用图和运行状态属于生成状态，存放在 `.workspace/`，不回写到 manifest。
- Pi Workspace Manager（第二阶段）负责理解用户意图和编排操作，Workspace Engine 负责确定性的解析、校验、索引和图查询；不能让 LLM 直接成为 Workspace 状态的唯一来源。
- Pi 的配置文件、Session 文件、资源发现和 Project Trust 尽量通过官方 API 完成，不直接改写内部 JSONL。
- UI 的 Pi 原生能力优先调用 Pi 已有的 `/new`、`/resume`、`/tree`、`/fork`、`/clone`、`/compact`、`/reload`、`/model` 等语义，而不是创建同名但行为不同的自定义功能。
- 第三方 Extension 与 Package 默认视为任意代码，展示来源、版本和权限风险。

后续如果需要 Web、手机和远程控制，可以将 `SessionDriver` 替换为 Pi RPC Bridge；UI 层不应感知底层是直接 SDK 还是 RPC。Pi SDK 本身已经提供 Session 生命周期、事件订阅、Steer、Follow-up、模型切换、Fork 和 Compact 等能力，应优先复用这些能力，而不是在 UI 层重复实现一套 Agent 逻辑。[Pi SDK 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[Pi RPC 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)、[Pi 官方仓库](https://github.com/earendil-works/pi)

## 11. 验收标准

第一阶段完成后，用户应该能够：

1. 打开应用并选择一个项目目录。
2. 创建三个不同主题的 Session。
3. 在 Session 之间切换，不丢失历史消息。
4. 在当前 Session 中让 Pi 读取、编辑和运行项目代码。
5. 看到流式回复和结构化 Tool Call。
6. 在右侧面板查看修改文件和 Diff。
7. 在命令执行前批准或拒绝操作。
8. 中断 Agent，并通过 Follow-up 继续工作。
9. 退出应用后重新打开并恢复任意 Session。
10. 在不打开终端的情况下完成一次真实代码修改任务。
11. 通过 `@` 搜索并引用一个项目文件。
12. 通过 `/` 调用内置命令、Prompt Template 或 Skill。
13. 在 Agent 工作期间分别发送一条 Steer 和一条 Follow-up，并看到两者不同的队列状态。
14. 在 Session Tree 中回到历史节点，编辑原始 Prompt 并创建新分支。
15. Fork 或 Clone 当前 Session，并在 Sidebar 中看到它们是不同的 Session 文件。
16. 触发一次自动或手动 Compaction，并查看 Summary、文件追踪和 Token 变化。
17. 看到 Context Inspector 中加载的 Context Files、Skills 和 Extensions。
18. 在 Project Trust 未决定时，不静默加载项目本地 Extension、Skill 或 Package。
19. 切换 Model 和 Thinking Level，并看到对应的 Runtime 状态变化。
20. 安装一个 Pi Package 前看到来源和任意代码风险提示。
21. Startup Header、Messages、Editor 和 Footer 都能展示 Pi 对应的真实状态。
22. 通过 `/` 命令面板调用 Pi 内置命令，并能看到未注册命令、参数错误和执行错误。
23. Editor 支持 `@` 文件搜索、路径补全、多行输入、`!command`、`!!command`、外部编辑器和图片输入。
24. 能完成 `/login`、`/model`、`/settings`、`/scoped-models` 和 Thinking Level 的完整配置流程。
25. 能完成 Session 的 `/export`、`/import`、`/share`、`/reload` 和 `/changelog` 流程。
26. 能安装、查看、启用、禁用和更新 Pi Package，并展示 package 来源与风险。
27. 安装一个 Extension 后，GUI 能承载它的 Command、Tool、Keyboard Shortcut、Event、Notification 和 Custom UI。
28. GUI 能录制并查看 JSON Event、SDK Session、RPC 状态和 Runtime Diagnostics。
29. 从 Pi TUI 启动的 Session 文件可以被 GUI 恢复，GUI 创建的 Session 也能被 Pi 继续使用。

## 12. 后续演进

第一阶段之后按以下顺序扩展：

1. Workspace Manifest、Pi Workspace Manager 和多 Project 关系。
2. 多 Session 并行运行。
3. Session Fork 和 Git Worktree。
4. Pi Extension 驱动的多 Agent Orchestrator。
5. 手机端远程控制。
6. 项目级结构索引和语义检索。
7. 跨项目依赖图和调用链。
8. Jira、Wiki、Grafana 等 Connector。
9. 多模型路由、成本控制和自动降级。

其中，Pi-native 的 P1 能力优先级高于泛化的 Workspace 功能：先完善 Session Tree、Compaction、资源管理和 Extension Bridge，再做多 Agent 和外部 Connector。

核心原则是：先把 Session、事件、Diff、审批和 Pi 原生扩展能力做稳定，再扩展 Workspace 的广度。所有新增能力都应先判断是否应该成为 Pi Extension、Workspace 模块或底层 Runtime 能力，避免把产品重新做成一个封闭的 Agent IDE。

## 13. 第二阶段：Workspace Manifest 与 Pi Workspace Manager

### 13.1 设计决策

Workspace 关系采用一个简单、可提交到 Git 的 workspace.yaml 描述。用户不需要手写复杂的项目图、环境绑定或索引配置；Pi Workspace Manager Extension 负责把自然语言意图转换为受控的 manifest 操作。

这不是把所有 Workspace 逻辑交给 Agent。Pi 负责理解意图、调用工具和解释结果；Workspace Engine 负责解析、Schema 校验、路径安全检查、关系图构建、索引任务和查询结果。workspace.yaml 是声明式源文件，LLM 的计划和推理不是持久化真相。

### 13.2 最小 manifest

第一版只要求 Project、关系和简单 Environment：

~~~yaml
apiVersion: pi.workspace/v1
kind: Workspace
metadata:
  name: commerce
projects:
  - id: web
    path: ./web
    tags: [frontend]
  - id: user-service
    path: ../user-service
    tags: [backend]
relations:
  - from: web
    to: user-service
    type: calls
environments:
  local:
    type: local
  staging:
    type: remote
    branch: staging
~~~

第一版刻意不加入复杂的 sources、bindings、部署拓扑、覆盖层和多级继承。只有在真实场景需要时，才通过向后兼容的 Schema 版本增加 source、runtime、环境绑定或插件专属字段。

### 13.3 Pi Workspace Manager 的用户入口

用户可以通过自然语言完成配置，也可以使用可发现的命令：

~~~text
/workspace init
/workspace add ../user-service
/workspace remove user-service
/workspace relate web user-service calls
/workspace env staging --branch staging
/workspace inspect
/workspace index
/workspace trace web -> user-service
~~~

扩展应支持以下能力：

- init：扫描当前目录和相邻 Git 项目，提出 Project 列表和标签建议。
- add/remove：注册或移除 Project，校验路径存在、Git 状态和 Project ID 冲突。
- relate：创建或删除 calls、depends_on、produces、consumes 等关系。
- env：设置当前 Environment、分支和受限操作策略。
- inspect：解释当前 manifest、Project 状态、关系和索引健康度。
- index：触发单个 Project 或整个 Workspace 的索引任务。
- trace：调用内置关系图和调用链工具，必要时再调用 Project 级 RAG。

### 13.4 变更流程

所有可能改变 Workspace 事实状态的操作统一走以下流程：

1. Pi Workspace Manager 读取当前 manifest 和 Workspace 状态。
2. Extension 扫描文件、Git、包配置或已有索引，补充事实信息。
3. Pi 生成结构化操作，而不是直接拼接 YAML 文本。
4. Workspace Engine 计算 manifest diff，并执行 Schema、路径、关系和权限校验。
5. UI 展示变更摘要；涉及 Project、Environment、关系、插件或索引范围时要求确认。
6. 用户确认后写入 workspace.yaml，再增量更新 .workspace/ 下的生成状态。
7. 失败时保留错误诊断，不产生半写入的 manifest。

这样既保持 Pi Agent 的自然语言和扩展优势，也避免用模型输出直接覆盖用户配置。

### 13.5 生成状态与插件边界

workspace.yaml 只保存用户希望审阅、提交和迁移的声明信息。以下内容不写入 manifest：

- 向量、倒排索引、AST 缓存和调用图缓存。
- 日志全文、临时扫描结果和运行时状态。
- Pi Session transcript、模型响应和调试事件。
- Token、API Key、Connector 密钥和其他 Secret。

这些内容统一放在 Workspace 根目录的 .workspace/，至少包括 index/、graph/、cache/ 和 status.json，并提供清理、重建和忽略规则。

内置能力按公共 Pi Extension API 实现，而不是写成 UI 私有特例：

- pi-workspace-manager：manifest、Project、Environment 和关系管理。
- pi-workspace-index：Project 级索引和跨 Project 检索。
- pi-workspace-graph：依赖关系、调用链和影响范围查询。

它们可以随桌面应用打包，但仍应允许用户使用本地 Extension、npm 包或 Git 包替换、叠加或扩展。第三方扩展继续遵循 Pi 的任意代码风险提示和 Project Trust 机制。

### 13.6 演进路线

当最小 manifest 被真实项目验证后，再按需求增加：

- projects[].source：本地、Git、远程仓库或 Monorepo 子项目来源。
- environments[].bindings：环境到多个 Project 分支、版本或 Endpoint 的绑定。
- runtime：容器、远程执行器或只读策略。
- relations[].evidence：来自代码扫描、人工确认或外部 Connector 的证据。
- plugins：Workspace 级插件启用和配置，但 Secret 仍由安全存储管理。

每次扩展都必须保持旧版 manifest 可读取，并继续让用户能在不理解全部高级字段的情况下完成日常配置。
