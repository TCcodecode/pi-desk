import { describe, expect, it } from "vitest";
import {
  formatTodoListText,
  makeTodoDetails,
  normalizeTodos,
  reconstructTodosFromMessages,
  todoProgress,
  todosFromToolResult,
} from "../src/state.js";

describe("normalizeTodos", () => {
  it("keeps valid items and drops invalid ones", () => {
    const todos = normalizeTodos([
      { id: "1", content: "A", status: "pending", priority: "high" },
      { id: "2", content: "B", status: "nope", priority: "medium" },
      { content: "missing id", status: "pending", priority: "low" },
      { id: "1", content: "duplicate", status: "completed", priority: "low" },
      { id: "3", content: "C", status: "in_progress", priority: "weird" },
    ]);
    expect(todos).toEqual([
      { id: "1", content: "A", status: "pending", priority: "high" },
      { id: "2", content: "B", status: "pending", priority: "medium" },
      { id: "3", content: "C", status: "in_progress", priority: "medium" },
    ]);
  });

  it("returns empty for non-arrays", () => {
    expect(normalizeTodos(null)).toEqual([]);
    expect(normalizeTodos({})).toEqual([]);
  });

  it("keeps at most one item in progress", () => {
    expect(normalizeTodos([
      { id: "1", content: "First", status: "in_progress", priority: "high" },
      { id: "2", content: "Second", status: "in_progress", priority: "medium" },
    ])).toEqual([
      { id: "1", content: "First", status: "in_progress", priority: "high" },
      { id: "2", content: "Second", status: "pending", priority: "medium" },
    ]);
  });
});

describe("todosFromToolResult", () => {
  it("reads nested details.todos", () => {
    const todos = todosFromToolResult({
      content: [{ type: "text", text: "ok" }],
      details: {
        todos: [{ id: "a", content: "Ship it", status: "completed", priority: "high" }],
        updatedAt: "2026-08-08T00:00:00.000Z",
      },
    });
    expect(todos).toEqual([{ id: "a", content: "Ship it", status: "completed", priority: "high" }]);
  });

  it("returns null when todos key is absent", () => {
    expect(todosFromToolResult({ content: [] })).toBeNull();
    expect(todosFromToolResult(null)).toBeNull();
  });
});

describe("reconstructTodosFromMessages", () => {
  it("uses the last successful todo tool result", () => {
    const messages = [
      {
        role: "toolResult",
        toolName: "todowrite",
        details: {
          todos: [{ id: "1", content: "Old", status: "pending", priority: "low" }],
        },
      },
      {
        role: "toolResult",
        toolName: "todowrite",
        details: {
          todos: [
            { id: "1", content: "Old", status: "completed", priority: "low" },
            { id: "2", content: "New", status: "in_progress", priority: "high" },
          ],
        },
      },
      {
        role: "toolResult",
        toolName: "todoread",
        isError: true,
        details: { todos: [] },
      },
    ];
    expect(reconstructTodosFromMessages(messages)).toEqual([
      { id: "1", content: "Old", status: "completed", priority: "low" },
      { id: "2", content: "New", status: "in_progress", priority: "high" },
    ]);
  });

  it("replays successful incremental todo results and skips failed ones", () => {
    expect(reconstructTodosFromMessages([
      {
        role: "toolResult",
        toolName: "todowrite",
        details: { todos: [{ id: "1", content: "First", status: "pending", priority: "medium" }] },
      },
      {
        role: "toolResult",
        toolName: "todoupdate",
        details: { todos: [{ id: "1", content: "First", status: "completed", priority: "medium" }] },
      },
      {
        role: "toolResult",
        toolName: "todocreate",
        isError: true,
        details: { todos: [{ id: "1", content: "Corrupt", status: "pending", priority: "low" }] },
      },
    ])).toEqual([
      { id: "1", content: "First", status: "completed", priority: "medium" },
    ]);
  });

  it("applies host-persisted reconcile messages (role custom, session-todo type)", () => {
    const todos = reconstructTodosFromMessages([
      {
        role: "toolResult",
        toolName: "todowrite",
        details: { todos: [{ id: "1", content: "Fix", status: "in_progress", priority: "high" }] },
      },
      {
        role: "custom",
        customType: "session-todo",
        content: "Todo list reconciled after the turn ended:",
        display: false,
        details: { todos: [{ id: "1", content: "Fix", status: "completed", priority: "high" }] },
      },
    ]);
    expect(todos).toEqual([{ id: "1", content: "Fix", status: "completed", priority: "high" }]);
  });

  it("applies raw custom_message branch entries with the session-todo type", () => {
    const todos = reconstructTodosFromMessages([
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "todowrite",
          details: { todos: [{ id: "1", content: "Fix", status: "in_progress", priority: "high" }] },
        },
      },
      {
        type: "custom_message",
        customType: "session-todo",
        content: "Todo list reconciled after the turn ended:",
        display: false,
        details: { todos: [{ id: "1", content: "Fix", status: "completed", priority: "high" }] },
      },
    ]);
    expect(todos).toEqual([{ id: "1", content: "Fix", status: "completed", priority: "high" }]);
  });

  it("ignores custom messages with other custom types", () => {
    const todos = reconstructTodosFromMessages([
      {
        role: "toolResult",
        toolName: "todowrite",
        details: { todos: [{ id: "1", content: "Fix", status: "in_progress", priority: "high" }] },
      },
      {
        role: "custom",
        customType: "some-other-extension",
        content: "note",
        display: true,
        details: { todos: [{ id: "1", content: "Fix", status: "completed", priority: "high" }] },
      },
    ]);
    expect(todos[0]?.status).toBe("in_progress");
  });
});

describe("format + progress", () => {
  it("formats list and counts completed", () => {
    const todos = normalizeTodos([
      { id: "1", content: "A", status: "completed", priority: "high" },
      { id: "2", content: "B", status: "cancelled", priority: "low" },
      { id: "3", content: "C", status: "in_progress", priority: "medium" },
    ]);
    expect(todoProgress(todos)).toEqual({ completed: 1, total: 3 });
    expect(formatTodoListText(todos)).toContain("[x]");
    expect(formatTodoListText([])).toBe("No todos");
    expect(makeTodoDetails(todos).todos).toHaveLength(3);
  });
});
