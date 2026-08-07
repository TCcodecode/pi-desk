# PI Desk

> 给 [Pi coding agent](https://github.com/earendil-works/pi) 一个真正可长期使用的桌面工作台。

**PI Desk** 是 Pi 的本地 Electron 客户端。它把会话、Agent 执行过程、代码变更、MCP 与可重复运行的 HTTP 验证汇集到同一个项目工作区，让你不必在终端、编辑器和 API 工具之间来回切换。

[下载最新版](https://github.com/TCcodecode/pi-desk/releases) · [提交问题或建议](https://github.com/TCcodecode/pi-desk/issues) · [了解 Pi](https://github.com/earendil-works/pi)

> **定位边界**：PI Desk 不是另一个模型，也不重写 Pi 的 Agent runtime。Pi 继续负责模型、Provider、工具循环、扩展与会话语义；PI Desk 专注于桌面工作区、可视化和本地集成。

## 为什么是 PI Desk？

终端很适合启动一次 Agent 任务；当任务变多、需要恢复上下文、审阅多轮改动和反复验证接口时，桌面工作台更合适。

```text
打开项目 → 新建或恢复会话 → 观察 Agent 执行 → 审阅文件变更
    → 搜索代码 / 使用 MCP → 运行 HTTP 验证 → 继续迭代
```

PI Desk 将这条链路留在本地，并继续使用你熟悉的 Pi 会话与配置体系。

## 主要能力

| 工作区 | 用来做什么 | 你会得到什么 |
| --- | --- | --- |
| **Agent Workbench** | 长期管理 Pi 会话和 Agent 任务 | 多项目、多会话、会话树、实时时间线、工具调用、文件 Diff、计划与待办 |
| **HTTP Workbench** | 将接口探测沉淀成可复跑验证 | `.http` 测试、环境配置、运行历史、脱敏响应，以及可由 Agent 调用的工具 |

### 面向 Agent 的工作体验

- 在一个项目中维护多个会话和打开中的 Tab；支持恢复、重命名、删除、导入、导出、fork 与 clone。
- 时间线流式显示回复、thinking、通知与工具调用；工具默认折叠，需要时再查看输入、输出与状态。
- 文件写入前后自动生成 unified diff，快速确认新增和删除内容。
- Agent 正在运行时仍可编辑并发送 follow-up；任务结束可通过系统通知得知结果。
- 在当前会话中选择模型、思考级别、工具和技能，并查看 token、上下文窗口和 Provider 用量。

### 本地代码与 MCP

- 使用 tree-sitter / WebAssembly 在本地建立代码符号索引，支持 `search_symbols` 和 `find_usages`。
- 索引能力以 Pi extension 的形式提供给 Agent；索引数据库保存在项目的 `.code-index/`，不依赖云端服务。
- 合并用户级与项目级 MCP 配置，支持导入 Cursor MCP 配置，并可在桌面端查看和启停项目服务器。

### 可复跑的 HTTP 验证

- 在 `.http` 文件中编写请求、选择环境并从编辑器运行。
- 按项目维护 `local`、`dev`、`staging`、`production` 等环境。
- 保存文件级和目录级的运行历史、状态、耗时、脱敏响应和错误信息。
- 通过内建 `http-workbench` extension，让 Agent 创建、读取和运行 HTTP 测试。
- 临时探测可以直接用 curl；需要重复验证时再沉淀为 `.http` 资产。

HTTP 测试、环境和运行历史位于应用数据目录，而非你的代码仓库，因此默认不会制造 Git diff。

## 快速开始

### 安装发布版本

从 [GitHub Releases](https://github.com/TCcodecode/pi-desk/releases) 下载对应系统和架构的安装包。

| 系统 | 推荐安装方式 |
| --- | --- |
| macOS | 下载 `.dmg`，将 `Pi Desk.app` 拖入 Applications |
| Windows | 运行 `.exe` 安装包；也可使用免安装的 `.zip` |
| Linux | 使用 `.AppImage`；Debian / Ubuntu 也可安装 `.deb` |

当前 macOS 构建尚未使用 Apple Developer ID 签名。首次启动请在 Finder 中对 `Pi Desk.app` 选择“右键 → 打开”，或在“系统设置 → 隐私与安全性”中选择“仍要打开”。如果系统提示应用“已损坏”，请先核对下载文件的 SHA256 是否与 Release 中的 `SHA256SUMS` 一致；确认无误后，可移除**该应用**的下载隔离标记：

```bash
xattr -dr com.apple.quarantine "/Applications/Pi Desk.app"
```

不要为了安装 PI Desk 全局关闭 Gatekeeper。完成 Developer ID 签名和公证后，macOS 将恢复普通双击启动流程。

### 从源码运行

准备 Node.js 20 或更高版本，然后在仓库根目录执行：

```bash
git clone https://github.com/TCcodecode/pi-desk.git
cd pi-desk
npm install
npm run dev
```

启动后选择一个本地项目目录，创建或恢复 Pi 会话，并在设置中配置所需的模型 Provider。PI Desk 会继续使用 Pi 的会话、Provider、skills、extensions 和 MCP 生态。

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发模式 |
| `npm run build` | 构建 main、preload 与 renderer |
| `npm run preview` | 预览构建产物 |
| `npm test` | 运行 Vitest 测试 |
| `npm run typecheck` | 运行 TypeScript 类型检查 |
| `npm run dist` | 构建当前系统的安装包（不发布） |
| `npm run dist:mac` | 构建 macOS 的 DMG 和 ZIP |
| `npm run dist:win` | 构建 Windows 的 NSIS 安装包和 ZIP |
| `npm run dist:linux` | 构建 Linux 的 AppImage、deb 和 tar.gz |

## 更新策略

Windows 的 NSIS 安装版与 Linux AppImage 会在启动后检查 GitHub Release。发现新版本后，应用会提示你；只有在你点击下载和确认重启安装后才会更新。

`.zip`、`.deb` 与 `.dmg` 通过下载下一版本更新。未签名的 macOS 构建不支持原地更新；待 Developer ID 签名可用后将启用同样的应用内更新体验。

## 设计与安全边界

```text
┌──────────────────────────────────────────────────────────────┐
│                         PI Desk · Electron                   │
│                                                              │
│  React Renderer                                               │
│  Timeline · Composer · Sessions · HTTP Workbench · Settings   │
│                 │ typed IPC                                   │
│                 ▼                                             │
│  Preload · contextBridge · contextIsolation · sandbox         │
│                 │                                             │
│                 ▼                                             │
│  Electron Main · desktop authority                            │
│  Pi host · sessions · projects · MCP · code index · HTTP       │
│  provider auth · notifications · file changes                  │
│                 │                                             │
│                 ▼                                             │
│  @earendil-works/pi-coding-agent                              │
│  Agent loop · providers · tools · extensions · session format │
└──────────────────────────────────────────────────────────────┘
```

- **Pi 管理 Agent 语义**：模型、Provider、工具循环、扩展、压缩和会话语义由 Pi 负责。
- **主进程管理桌面权限**：文件、进程、会话生命周期、MCP 配置、HTTP 资产与系统通知由 Electron main process 负责。
- **渲染层只负责呈现**：Renderer 只消费状态和收集用户意图，不直接获得文件系统、Shell 或 Node.js 能力。
- **明确而非绝对的安全保障**：`contextIsolation` 与 Electron sandbox 均开启；项目信任确认仅控制资源加载，不等同于操作系统级安全沙箱。需要强隔离时，请在容器、虚拟机或其他受控环境中运行 Agent。
- **外部链接受限**：Renderer 发起的外部链接仅允许 `http(s)` 地址。

## 数据存放位置

| 数据 | 位置 | 事实来源 / 所有者 |
| --- | --- | --- |
| Pi 会话 | `~/.pi/agent/sessions/` | Pi coding agent |
| 项目注册表 | Electron `userData/projects.json` | PI Desk |
| HTTP Workbench | `<userData>/http-workbench/<project-uid>/` | PI Desk |
| 代码索引 | `<project>/.code-index/index.db` | PI Desk / code-index extension |
| MCP 配置 | 用户级 `mcp.json` + 项目 `.mcp.json` / `.pi/mcp.json` | Pi MCP adapter 与 PI Desk |

PI Desk 不会复制并取代 Pi 的会话数据库。关闭应用后，Pi 的会话文件仍是可恢复的事实来源。

## 项目结构

```text
src/main/                  Electron 主进程，按领域拆
  app/                     窗口、IPC、更新、通知
  session/                 PiHost、runtime、session catalog、plan
  workspace/               项目注册表
  http/                    HTTP 工作台资产与 Agent 工具
  provider/                用量适配器与账号用量
src/preload/               暴露给 Renderer 的受限 PiApi
src/renderer/              React UI，与 main 同名领域
  app/  session/  workspace/  http/  ui/
src/shared/                跨进程合同（protocol + 领域类型）

packages/
  code-index/              符号索引引擎 + Pi extension
  mcp-bridge/              MCP 配置合并、导入与服务器控制
  session-todo/            todowrite / todoread 与会话状态
```

## 技术栈

| 层 | 技术 |
| --- | --- |
| Desktop shell | Electron 43 |
| Agent runtime | [`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) |
| Renderer | React 19、Vite、Zustand |
| UI | Radix UI、lucide-react |
| Markdown | react-markdown、remark-gfm |
| 代码智能 | web-tree-sitter 与本地索引 |
| 验证 | Vitest、Testing Library |

## 常见问题

### PI Desk 会替代 Pi CLI 吗？

不会。PI Desk 是 Pi 的桌面客户端；Pi 仍是 Agent engine。两者共享 Pi 的会话和配置体系，终端工作流可以继续使用。

### 我需要把代码或会话上传到云端吗？

不需要。PI Desk 的项目注册、HTTP Workbench 与代码索引都在本地；Pi 会话也沿用本地文件。模型 Provider 的网络请求则遵循你所选择 Provider 的配置和条款。

### 为什么 HTTP Workbench 不把 `.http` 文件写进项目目录？

环境配置、响应和运行历史通常属于个人本地状态，直接写入项目会制造无关的 Git diff。PI Desk 默认把这类资产按项目保存在应用数据目录；如需团队共享和版本控制，请在仓库中另行维护对应的测试资产。

### PI Desk 是安全沙箱吗？

不是。Electron 隔离、窄 IPC 接口和项目信任确认能够减少权限暴露与误操作，但不能替代容器或虚拟机等强隔离环境。

## 参与和支持

PI Desk 正在积极开发中。欢迎通过 [Issues](https://github.com/TCcodecode/pi-desk/issues) 报告 Bug、提出功能建议或参与讨论。提交问题时，请附上系统版本、PI Desk 版本、复现步骤与相关日志，并注意移除 API key、Cookie、令牌和私有路径等敏感信息。

## 许可与上游致谢

本仓库当前尚未声明项目许可证；在复用或分发代码前，请先与维护者确认授权范围。

PI Desk 建立在下列项目之上：

- [Pi Agent Harness](https://github.com/earendil-works/pi)
- [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
