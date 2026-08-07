export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type TodoPriority = "high" | "medium" | "low";

export interface SessionTodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
}

export interface TodoDetails {
  todos: SessionTodoItem[];
  updatedAt: string;
}

export const TODO_TOOL_NAMES = ["todowrite", "todoread", "todocreate", "todoupdate"] as const;
export type TodoToolName = (typeof TODO_TOOL_NAMES)[number];

export function isTodoToolName(name: string): name is TodoToolName {
  return (TODO_TOOL_NAMES as readonly string[]).includes(name);
}
