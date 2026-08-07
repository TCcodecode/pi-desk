# HTTP Workbench 设计方案

## 结论

HTTP Workbench 是 PI Desk 的独立模式，但测试资产属于 PI Desk 的应用数据空间，不属于项目源码仓库。

左侧目录的唯一业务根节点是 Project：

```text
Projects
└── <project>
    ├── <user-created-test-folder>/
    │   ├── *.http
    │   └── run-history/
    └── environments/
        ├── local.json
        ├── dev.json
        ├── staging.json
        └── production.json
```

不提供全局 Scratch、Smoke、Regression 或 History 节点。Smoke、Regression、Debug、Release 等只是用户创建的普通测试目录名称或目录元数据。

## 存储边界

物理位置使用 Electron `app.getPath("userData")`：

```text
<userData>/http-workbench/projects/<stable-project-uid>/
```

`http-workbench/catalog.json` 保留项目路径到 `projectUid` 的应用级映射。项目的 `projectPath` 只用于关联和显示，`.http`、Environment 和 Run History 都写入应用数据。项目从 PI Desk 列表移除时只解除关联，不自动删除测试空间，重新注册同一路径仍能找回原测试空间。

Project catalog 为老项目迁移生成 `projectUid`；HTTP Workbench 不使用路径作为长期存储目录名。

## 目录语义

- 用户测试目录：可嵌套，可自由命名；目录内可以放多个 `.http` 文件。
- `.http` 文件：唯一的测试源文件，保持可读、可编辑、可 review。
- `environments/`：Project 专属环境配置，不能创建测试文件。
- `run-history/`：由系统管理，放在执行目标所在目录下。
- 文件级执行：Run History 位于文件的父目录，记录中包含 `scopePath` 和请求 ID。
- 目录级执行：Run History 位于该目录，目录内的 `.http` 文件按稳定排序执行。

## 执行模型

GUI、Agent 和历史记录共用 `HttpWorkbenchStore`：

- 读取、保存、创建文件时校验路径必须位于应用数据空间。
- `environments` 和 `run-history` 是受保护目录。
- 当前内置 Runner 支持常见 `.http` 请求、多请求分隔、变量插值和 `expect-status` 基础断言。
- 运行结果保存为 JSON，包含环境名、时间、耗时、请求状态、脱敏响应和失败信息。
- UI 手动点击 Run 等同于用户明确批准本次执行；后续为 Agent 执行增加 production/变更请求确认门。

## Agent 边界

内置 `http-workbench` Extension 暴露：

- `http_workspace_info`
- `http_create_folder`
- `http_create_test`
- `http_read_test`
- `http_update_test`
- `http_run_test`
- `http_list_run_history`

Extension 只接受 Project 上下文和相对测试路径，不能接受任意绝对写入路径。Agent guidance 明确：curl/Bash 用于一次性探测，重复验证必须保存为 Project 下的 `.http` 资产。

本功能不依赖 MCP。MCP 继续作为独立的外部工具桥接能力存在。

## UI

顶部提供：

```text
[ PI Desk ] [ HTTP Workbench ]
```

HTTP Workbench 使用三栏：

1. 左侧：Project 选择器、Project 根目录、用户测试目录、Environments。
2. 中间：`.http` 或 Environment 编辑器、Run、Save、Run History 和 Response。
3. 右侧：带 Project、测试路径和 Environment 上下文的 HTTP Chat。

Run History 可从目录、文件和请求结果反向打开；历史记录不再作为全局左侧导航项。

## 验收条件

- 创建和保存 HTTP 测试不会产生项目 Git diff。
- 测试目录可由用户自由创建、嵌套和命名。
- Environment 只存在于对应 Project 下。
- Run History 只存在于执行目标的目录下。
- 从 `.http` 文件可以打开对应历史并查看 Response。
- Agent 不能把 HTTP 测试写入项目源码目录。
- 无 Project 时不能创建或运行 HTTP 测试。
- Project 移除不会隐式删除应用数据中的测试空间。
