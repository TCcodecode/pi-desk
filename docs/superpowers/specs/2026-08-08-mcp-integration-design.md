# MCP 集成设计（bundled adapter + 三处 UI 适配）

日期：2026-08-08
状态：已获用户批准，进入实现（M0–M3）

## 1. 背景与目标

pi-desk 是 Pi coding agent 的桌面 GUI（Electron + React + electron-vite）。产品对外发布是**一键式安装**：用户安装后即可使用，**不应要求用户再安装任何额外东西**（不 `pi install`、不装额外 CLI、不手动搭 MCP 框架）。

目标：把 MCP 能力**打进应用本体**——用户装好即有 MCP「可用」（运行时已内置 `pi-mcp-adapter`），具体的 MCP **服务器**按需在 GUI 里配置（或从 Cursor 导入），全程不接触命令行。

约束来自既有 spec `docs/superpowers/specs/2026-08-05-pi-desktop-workspace-design.md`：
- 不把所有外部工具抽象成必须安装的 MCP；
- 内置能力通过 Pi Extension / Package 形态随桌面应用打包，而不是平行运行时。

## 2. 现状

- `pi-coding-agent` SDK：`createAgentSessionServices({ resourceLoaderOptions: { extensionFactories } })` 是内置能力的注入点；`setActiveToolsByName(getAllTools().map(t => t.name))` 激活全部工具（含 extension 注册的）。
- 既有内置能力样板：`packages/session-todo` → `extensionFactories: [{ name: "session-todo", factory: sessionTodoExtension }]`（`electron/piHost.ts` `createSdkRuntime`），工具经 `getAllTools()` 浮现。
- 数据流：`PiHost`（main 进程）持有运行时状态，`emit` → `subscribe` → `pi:event` IPC → `appStore`（zustand）→ 组件。
- `electron.vite.config.ts`：main 构建用 `externalizeDepsPlugin({ exclude: [...] })`；被 exclude 的包（本地 workspace 包、`pi-mcp-adapter`）由 vite 打包（rollup 转译其 raw TS），其余 npm 依赖保持 external（运行时从 node_modules 解析）。

## 3. 技术验证结论（v1，已完成）

- `pi-mcp-adapter@2.21.0`（npm）是 Pi 生态事实上的 MCP 集成方案：`createMcpAdapter(options)` 返回 `(pi: ExtensionAPI) => void`，形状与 `extensionFactories` 完全一致；无 `config` 选项时走**文件合并模式**（读标准 `mcp.json`：`.mcp.json`、`~/.config/mcp/mcp.json`、`~/.agents/mcp.json`、`~/.pi/agent/mcp.json`、`.pi/mcp.json`）；注册单个 `mcp` 代理工具；经 `pi.events.emit(MCP_STATUS_EVENT, snapshot)` 发布类型化状态快照。
- **已验证**：`npx electron-vite build` 成功，`pi-mcp-adapter` 代码进入 main bundle；真实启动 Electron 主进程 `mcp-smoke` 日志确认运行时加载成功、应用窗口正常打开。
- **发现并修复的上游问题**：adapter 的 `sampling-handler.ts` 从 `@earendil-works/pi-ai` 根入口导入 `complete`，但 pi-ai 只在 `@earendil-works/pi-ai/compat`（文档明言"老代码把根入口换成 compat 即可"，compat re-export 根入口全部符号）导出它 → 顶层装了 `pi-ai@0.84.1` 后运行时 `SyntaxError`。**修复**：electron-vite main 构建加 transform 插件，把 adapter 源码里的 `from "@earendil-works/pi-ai"` 精确改写为 `from "@earendil-works/pi-ai/compat"`；pi-ai 保持 external（不内联、不产生双实例）。main.js 维持 ~1.86 MB。
- **附带修复**：main bundle 是 ESM，`__dirname` 未定义（既有 bug）→ 改用 `import.meta.dirname`；`main.ts` 菜单模板一个 `role: "quit"` 类型收窄问题。

## 4. 架构：MCP bridge

adapter 与 session-todo 完全同构注入，但需一个**薄 bridge** 把 `MCP_STATUS_EVENT` 从 extension 的 `EventBus`（每个 session 一个 `pi.events`）转发给 PiHost：

```
createAgentSessionServices({ resourceLoaderOptions: {
  extensionFactories: [
    { name: "session-todo", factory: sessionTodoExtension },
    { name: "mcp", factory: mcpAdapterBridgeFactory(onStatus) },   // 新增
  ],
}})
```

bridge factory 形态（`packages/mcp-bridge`，跟随 session-todo 的 workspace 包模式，vite exclude 打包）：

```ts
import { createMcpAdapter, MCP_STATUS_EVENT, type McpStatusSnapshot } from "pi-mcp-adapter";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function createMcpBridgeFactory(onStatus: (snapshot: McpStatusSnapshot) => void) {
  return (pi: ExtensionAPI): void => {
    pi.events.on(MCP_STATUS_EVENT, (data) => onStatus(data as McpStatusSnapshot));
    createMcpAdapter()(pi);
  };
}
```

要点：
- `createMcpAdapter()` 无 options → 文件合并模式，标准 `mcp.json` 文件是**唯一事实源**；UI 只读写这些文件。
- 每个 session 的 adapter 实例把状态发到自己的 `pi.events`；PiHost 按 slot 记录、合并成全局快照（M1 数据模型见 §6）。
- 状态变化 → PiHost `emit("mcp_status_updated", snapshot)` → 渲染进程。
- 启停（M2）不重启进程：adapter 提供 `writeProjectServerDisabledOverride`（写 `.pi/mcp.json` 的 `disabled: true` 字段，仅字面 `true` 生效）；随后 `pi.reload()` / 重建 session 使配置生效（与 `setSkills` 同样的 reload 路径）。

## 5. 里程碑

### M0 依赖 + 注入（实现中）
- `package.json` 已加：`pi-mcp-adapter@^2.21.0`、`@earendil-works/pi-ai@^0.84.1`、`@earendil-works/pi-tui@^0.74.2`（后两者是 adapter 的 peer deps，顶层解析）。
- 新建 `packages/mcp-bridge`（bridge factory，raw TS，workspace 包 `@pi-desk/mcp-bridge`）。
- `electron/piHost.ts` `createSdkRuntime`：`extensionFactories` 追加 `{ name: "mcp", factory: ... }`；PiHost 构造时创建 bridge 回调，按 slot 合并状态。

### M1 protocol + Inspector 显示
- `src/shared/protocol.ts`：新增 `McpServerStatus` / `McpStatusSnapshot`（渲染进程安全视图，字段：`version`、`servers[{name,status,toolCount,failedAgoSeconds?,disabled}]`、`totalTools`、`connectedCount`、`disabledCount`）；`ResourceSnapshot` 加 `mcp?: McpStatusSnapshot`；`PiEvent` 加 `mcp_status_updated`。
- `PiHost`：订阅 bridge 回调 → 合并快照 → `emit("mcp_status_updated")`；`getResources()` 附带 mcp 字段。
- `appStore`：处理 `mcp_status_updated`。
- `ResourceInspector`：Extensions 页签下加 **MCP servers** 区块（状态点、toolCount、disabled/needs-auth 标记）。无服务器时显示空态提示（"未配置 MCP 服务器——可在设置中导入或编辑 mcp.json"）。

### M2 Settings 启停 / 状态管理
- `SettingsDialog` 新增 MCP 区块：
  - 服务器列表（名称、状态、工具数、启停开关）；
  - 切换开关 → `pi:setMcpServerEnabled`（main 进程用 adapter 的 `writeProjectServerDisabledOverride` 写 `.pi/mcp.json`，然后 `reload()` 重建 session 使 adapter 重读配置）；
  - 打开配置目录 / 编辑 `mcp.json`（`shell.openPath`）；
  - 从 `~/.cursor/mcp.json` 导入（adapter 提供 `findAvailableImportConfigs` / `getMcpDiscoverySummary`，M2 基础版可先做「发现 → 一键写入 .pi/mcp.json」）。
- `PiApi` 加 `setMcpServerEnabled(name, enabled)`、`getMcpConfig()`（返回合并后的 mcp.json 内容供 UI 展示/编辑）。

### M3 Timeline 轻标注（可选，低优先）
- `Timeline` 的 tool 渲染：对 `toolName === "mcp"`（或 `mcp_*` 前缀 / 来自 MCP 的工具）加 `via MCP` 小标签。不改变数据流，纯展示。

## 6. 数据模型（protocol 增量）

```ts
export type McpServerStatus =
  | "connected" | "cached" | "failed" | "needs-auth" | "not-connected" | "disabled";

export interface McpServerStatusView {
  name: string;
  status: McpServerStatus;
  toolCount: number;
  failedAgoSeconds?: number;
  disabled: boolean;
}

export interface McpStatusSnapshotView {
  version: number;
  servers: McpServerStatusView[];
  totalTools: number;
  connectedCount: number;
  disabledCount: number;
}
```

`ResourceSnapshot` 增 `mcp?: McpStatusSnapshotView`；`PiEvent` 增 `PiEventBase<"mcp_status_updated", McpStatusSnapshotView>`。跨进程只传视图字段（不含密钥/命令细节）。

## 7. 非目标

- 不预装任何 MCP 服务器（用户按需配置；"开箱即用"指框架已内置，不指服务器已就绪）。
- 不自研 MCP client / 不绕过 `pi-mcp-adapter`。
- 不把 pi-desk 所有内置工具改造成 MCP。
- M2 导入只支持 Cursor 的 `mcp.json` 这一常见格式（adapter 的 discovery 机制已覆盖主流路径）。

## 8. 验证计划

- `npm run typecheck`（renderer + node 两个 tsconfig）通过。
- vitest：bridge factory 单测（mock `pi.events`/`createMcpAdapter`，断言事件转发与快照合并）；appStore `mcp_status_updated` 处理测试；Inspector MCP 区块渲染测试。
- 手工验证：临时写一个 `.pi/mcp.json`（如 filesystem server），启动应用，确认 Inspector 显示服务器状态、Settings 开关能写入 disabled 并 reload 生效、工具调用出现在 Timeline。
