/**
 * Session Todo Extension — OpenCode-style task checklist for Pi.
 *
 * Tools:
 * - todowrite: replace the full todo list
 * - todocreate: append one todo item
 * - todoupdate: patch one todo item by stable id
 * - todoread: read the current list
 *
 * State is stored in tool result `details` so session fork/resume can rebuild it.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  formatTodoListText,
  makeTodoDetails,
  normalizeTodos,
  reconstructTodosFromMessages,
  todoProgress,
  todosFromToolResult,
} from "../src/state.js";
import type { SessionTodoItem } from "../src/types.js";

const TodoItemSchema = Type.Object({
  id: Type.String({ description: "Unique stable id for this todo item" }),
  content: Type.String({ description: "Brief description of the task" }),
  status: Type.Union([
    Type.Literal("pending"),
    Type.Literal("in_progress"),
    Type.Literal("completed"),
    Type.Literal("cancelled"),
  ]),
  priority: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
});

const TodoCreateSchema = Type.Object({
  id: Type.Optional(Type.String({ description: "Optional stable id; one is generated when omitted" })),
  content: Type.String({ description: "Brief description of the task" }),
  status: Type.Optional(Type.Union([
    Type.Literal("pending"),
    Type.Literal("in_progress"),
    Type.Literal("completed"),
    Type.Literal("cancelled"),
  ])),
  priority: Type.Optional(Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")])),
});

const TodoUpdateSchema = Type.Object({
  id: Type.String({ description: "Stable id of the todo to update" }),
  content: Type.Optional(Type.String({ description: "Replacement task description" })),
  status: Type.Optional(Type.Union([
    Type.Literal("pending"),
    Type.Literal("in_progress"),
    Type.Literal("completed"),
    Type.Literal("cancelled"),
  ])),
  priority: Type.Optional(Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")])),
});
const SYSTEM_GUIDANCE = `
# Session todos
You have todowrite, todoread, todocreate, and todoupdate tools for multi-step work.

When to use:
- For any request that needs roughly 3+ meaningful actions, or when you are unsure whether it is multi-step, your first tool call MUST be todowrite.
- Create the full checklist before inspecting files, editing code, or running other tools; do not wait until the work is underway.
- Skip todos only for genuinely trivial single-step questions or actions.

How to use:
- Use todowrite for the initial plan or a deliberate full-list replacement.
- Use todocreate to add one task and todoupdate to change one existing task; do not rewrite the full list for a single status change.
- Use todoread when you need to refresh the current list before deciding what to do next.
- Keep stable ids; never invent a new id when updating an existing task.
- Keep at most one item in_progress at a time.
- Update the list as soon as a step completes or is cancelled — do not wait until the end.
- Prefer short, actionable content strings.

Statuses: pending | in_progress | completed | cancelled
Priorities: high | medium | low
`.trim();

export type SessionTodoBranchChangeHandler = (todos: SessionTodoItem[], sessionManager: unknown) => void;

export function registerSessionTodoTools(
  pi: ExtensionAPI,
  onBranchChanged?: SessionTodoBranchChangeHandler,
): void {
  // In-memory list; reconstructed from session branch on session events.
  let todos: SessionTodoItem[] = [];

  const reconstruct = (ctx: ExtensionContext) => {
    try {
      const branch = ctx.sessionManager?.getBranch?.() ?? [];
      const messages: unknown[] = [];
      for (const entry of branch) {
        if (!entry || typeof entry !== "object") continue;
        const record = entry as { type?: string; message?: unknown };
        if (record.type === "message" && record.message) messages.push(record.message);
        else messages.push(entry);
      }
      todos = reconstructTodosFromMessages(messages);
    } catch {
      // Keep existing in-memory state if branch is unavailable.
    }
  };

  pi.on("session_start", async (_event, ctx) => reconstruct(ctx));
  pi.on("session_tree", async (_event, ctx) => {
    reconstruct(ctx);
    onBranchChanged?.(todos, ctx.sessionManager);
  });

  /**
   * Snapshot the current checklist for the system prompt. The empty case is
   * injected on purpose — a visible "no tasks yet" nudges the model to call
   * todowrite instead of drifting through a multi-step request.
   */
  const todoStateSection = (): string => {
    if (todos.length === 0) {
      return [
        "## Current task list",
        "",
        "No tasks tracked yet. For multi-step work, call todowrite first to break it into a checklist.",
      ].join("\n");
    }
    const progress = todoProgress(todos);
    const active = todos.find((todo) => todo.status === "in_progress");
    const lines = [
      "## Current task list",
      "",
      formatTodoListText(todos),
      "",
      `Progress: ${progress.completed}/${progress.total} completed.`,
    ];
    if (active) lines.push(`Currently in progress: ${active.content}`);
    return lines.join("\n");
  };

  pi.on("before_agent_start", async (event) => {
    const base = event.systemPrompt ?? "";
    const section = todoStateSection();
    return { systemPrompt: base ? `${base}\n\n${SYSTEM_GUIDANCE}\n\n${section}` : `${SYSTEM_GUIDANCE}\n\n${section}` };
  });

  pi.registerTool({
    name: "todowrite",
    label: "Todo Write",
    description:
      "Create or replace the session todo list. Pass the FULL list each time (not a patch). Use for multi-step tasks; update status as work progresses.",
    parameters: Type.Object({
      todos: Type.Array(TodoItemSchema, {
        description: "Complete todo list after this update",
      }),
    }),
    async execute(_toolCallId, params) {
      todos = normalizeTodos(params.todos);
      const details = makeTodoDetails(todos);
      const progress = `${todos.filter((t) => t.status === "completed").length}/${todos.length} completed`;
      return {
        content: [
          {
            type: "text" as const,
            text: todos.length ? `Updated todos (${progress}):\n${formatTodoListText(todos)}` : "Cleared todos",
          },
        ],
        details,
      };
    },
  });

  const nextTodoId = (): string => {
    const used = new Set(todos.map((todo) => todo.id));
    let index = 1;
    while (used.has("todo-" + index)) index += 1;
    return "todo-" + index;
  };

  const todoResult = (text: string, isError = false) => ({
    content: [{ type: "text" as const, text }],
    details: makeTodoDetails(todos),
    ...(isError ? { isError: true } : {}),
  });

  pi.registerTool({
    name: "todocreate",
    label: "Todo Create",
    description: "Add one todo item without replacing the existing list.",
    parameters: TodoCreateSchema,
    async execute(_toolCallId, params) {
      const id = params.id?.trim() || nextTodoId();
      if (todos.some((todo) => todo.id === id)) {
        return todoResult("Todo id already exists: " + id, true);
      }
      const existingTodos = params.status === "in_progress"
        ? todos.map((todo) => todo.status === "in_progress" ? { ...todo, status: "pending" as const } : todo)
        : todos;
      todos = normalizeTodos([
        ...existingTodos,
        {
          id,
          content: params.content,
          status: params.status ?? "pending",
          priority: params.priority ?? "medium",
        },
      ]);
      return todoResult("Created todo " + id + ": " + params.content);
    },
  });

  pi.registerTool({
    name: "todoupdate",
    label: "Todo Update",
    description: "Update one existing todo by stable id without replacing the list.",
    parameters: TodoUpdateSchema,
    async execute(_toolCallId, params) {
      const index = todos.findIndex((todo) => todo.id === params.id);
      if (index < 0) return todoResult("Todo id not found: " + params.id, true);
      const current = todos[index]!;
      const next = {
        ...current,
        ...(params.content !== undefined ? { content: params.content } : {}),
        ...(params.status !== undefined ? { status: params.status } : {}),
        ...(params.priority !== undefined ? { priority: params.priority } : {}),
      };
      const existingTodos = params.status === "in_progress"
        ? todos.map((todo) => todo.id !== params.id && todo.status === "in_progress" ? { ...todo, status: "pending" as const } : todo)
        : todos;
      todos = normalizeTodos(existingTodos.map((todo) => todo.id === params.id ? next : todo));
      return todoResult("Updated todo " + params.id);
    },
  });

  pi.registerTool({
    name: "todoread",
    label: "Todo Read",
    description: "Read the current session todo list.",
    parameters: Type.Object({}),
    async execute() {
      const details = makeTodoDetails(todos);
      return {
        content: [{ type: "text" as const, text: formatTodoListText(todos) }],
        details,
      };
    },
  });
}

export default function sessionTodoExtension(
  pi: ExtensionAPI,
  onBranchChanged?: SessionTodoBranchChangeHandler,
): void {
  registerSessionTodoTools(pi, onBranchChanged);
}

// Re-export for hosts that only import the extension path.
export { todosFromToolResult, reconstructTodosFromMessages, normalizeTodos };
