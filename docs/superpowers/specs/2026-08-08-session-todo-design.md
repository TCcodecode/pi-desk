# Session Todo（默认 Workspace 能力）

## 状态

已确认；按方案 B 实现。

## 目标

- Agent 多步任务时维护 OpenCode 风格 checklist（四态 + priority）
- Inspector **Context** 页只读展示进度
- Workspace **默认启用**（用户不必 `pi install`）
- 形态为 Pi Extension / package，状态落在 session tool details（支持 fork/resume）

## 非目标（v1）

- 侧栏用户增删改 todo
- 跨 session 全局任务板
- Plan mode / subagent 编排

## 架构

```
packages/session-todo (@pi-desk/session-todo)
  · todowrite / todoread tools
  · details 持久化 + branch 重建 helper
  · before_agent_start 注入使用指引
        │
        │ extensionFactories 默认注入
        ▼
PiHost · 镜像 todos → SessionState / todos_updated
        ▼
ResourceInspector Context · TODOS 只读区
```

## 工具契约

### `todowrite`

整表替换：

```ts
todos: Array<{
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "high" | "medium" | "low";
}>
```

### `todoread`

返回当前 list；`details.todos` 与 write 一致。

## Protocol

- `SessionState.todos: SessionTodoItem[]`
- `PiEvent<"todos_updated", { todos: SessionTodoItem[] }>`

## UI

Context 页折叠区 **TODOS**：进度 `completed/total`（cancelled 计入 total，不计入 completed）；状态符号 ○ / ● / ✓ / –；只读。

## 默认加载

`createAgentSessionServices({ resourceLoaderOptions: { extensionFactories: [{ name: "session-todo", factory }] } })`。
