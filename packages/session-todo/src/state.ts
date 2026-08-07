import { isTodoToolName } from "./types.js";
import type { SessionTodoItem, TodoDetails, TodoPriority, TodoStatus } from "./types.js";

const STATUSES = new Set<TodoStatus>(["pending", "in_progress", "completed", "cancelled"]);
const PRIORITIES = new Set<TodoPriority>(["high", "medium", "low"]);

/**
 * Custom entry/message type used by the host to persist todo reconciles into
 * the session trace. The host writes a `custom_message` entry (via
 * SessionManager.appendCustomMessageEntry) when it closes a stale
 * in_progress item after a settled turn, so the reconciled list survives
 * session reloads and the extension rebuilds the same state on replay.
 */
export const SESSION_TODO_CUSTOM_TYPE = "session-todo";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStatus(value: unknown): TodoStatus | undefined {
  return typeof value === "string" && STATUSES.has(value as TodoStatus) ? (value as TodoStatus) : undefined;
}

function asPriority(value: unknown): TodoPriority | undefined {
  return typeof value === "string" && PRIORITIES.has(value as TodoPriority) ? (value as TodoPriority) : undefined;
}

/** Normalize arbitrary LLM/tool input into a clean todo list. Invalid items are dropped. */
export function normalizeTodos(input: unknown): SessionTodoItem[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const result: SessionTodoItem[] = [];
  let hasInProgress = false;
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const id = asString(record.id);
    const content = asString(record.content);
    const requestedStatus = asStatus(record.status) ?? "pending";
    const status = requestedStatus === "in_progress" && hasInProgress ? "pending" : requestedStatus;
    const priority = asPriority(record.priority) ?? "medium";
    if (!id || !content) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    if (status === "in_progress") hasInProgress = true;
    result.push({ id, content, status, priority });
  }
  return result;
}

export function makeTodoDetails(todos: SessionTodoItem[]): TodoDetails {
  return { todos, updatedAt: new Date().toISOString() };
}

/** Extract todos from tool result details (or a full result object). */
export function todosFromToolResult(result: unknown): SessionTodoItem[] | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  const details = (record.details ?? record) as Record<string, unknown>;
  if (!details || typeof details !== "object") return null;
  if (!("todos" in details)) return null;
  return normalizeTodos(details.todos);
}

/**
 * Reconstruct the latest todo list from session messages / branch entries.
 * Last successful todowrite/todoread details wins.
 */
export function reconstructTodosFromMessages(messages: unknown[]): SessionTodoItem[] {
  let latest: SessionTodoItem[] = [];
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") continue;
    const message = raw as Record<string, unknown>;
    const role = message.role;
    const toolName = typeof message.toolName === "string" ? message.toolName : undefined;

    // toolResult messages from Pi session branch
    if ((role === "toolResult" || role === "tool") && toolName && isTodoToolName(toolName)) {
      if (message.isError) continue;
      const fromDetails = todosFromToolResult({ details: message.details });
      if (fromDetails) latest = fromDetails;
      continue;
    }

    // Host-persisted reconcile messages (role "custom" from custom_message
    // entries projected into agent messages).
    if (role === "custom" && message.customType === SESSION_TODO_CUSTOM_TYPE) {
      const fromDetails = todosFromToolResult(message);
      if (fromDetails) latest = fromDetails;
      continue;
    }

    // Some hosts may only keep tool result objects without role
    if (toolName && isTodoToolName(toolName)) {
      if (message.isError) continue;
      const parsed = todosFromToolResult(message);
      if (parsed) latest = parsed;
    }

    // Raw custom_message branch entries (extensions scan getBranch() directly).
    if (message.type === "custom_message" && message.customType === SESSION_TODO_CUSTOM_TYPE) {
      const parsed = todosFromToolResult(message);
      if (parsed) latest = parsed;
    }
  }
  return latest;
}

export function formatTodoListText(todos: SessionTodoItem[]): string {
  if (todos.length === 0) return "No todos";
  return todos
    .map((t) => {
      const mark =
        t.status === "completed" ? "x" : t.status === "cancelled" ? "-" : t.status === "in_progress" ? ">" : " ";
      return `[${mark}] (${t.priority}) ${t.id}: ${t.content} [${t.status}]`;
    })
    .join("\n");
}

export function todoProgress(todos: SessionTodoItem[]): { completed: number; total: number } {
  const total = todos.length;
  const completed = todos.filter((t) => t.status === "completed").length;
  return { completed, total };
}
