import { describe, expect, it, vi } from "vitest";
import sessionTodoExtension, { registerSessionTodoTools } from "../extensions/todo.js";

describe("session-todo extension", () => {
  it("registers full-list and incremental todo tools", () => {
    const pi = { registerTool: vi.fn(), on: vi.fn() };
    registerSessionTodoTools(pi as never);
    const names = pi.registerTool.mock.calls.map((c) => (c[0] as { name: string }).name);
    expect(names).toEqual(["todowrite", "todocreate", "todoupdate", "todoread"]);
  });

  it("injects todo guidance on before_agent_start", async () => {
    const pi = { registerTool: vi.fn(), on: vi.fn() };
    sessionTodoExtension(pi as never);
    const handler = pi.on.mock.calls.find(([event]) => event === "before_agent_start")?.[1] as
      | ((event: { systemPrompt?: string }) => Promise<{ systemPrompt: string }> | { systemPrompt: string })
      | undefined;
    expect(handler).toBeTypeOf("function");
    const result = await handler!({ systemPrompt: "base" });
    expect(result.systemPrompt).toContain("base");
    expect(result.systemPrompt).toContain("todowrite");
    expect(result.systemPrompt).toContain("todoread");
    expect(result.systemPrompt).toContain("todocreate");
    expect(result.systemPrompt).toContain("todoupdate");
    expect(result.systemPrompt).toContain("first tool call MUST be todowrite");
    expect(result.systemPrompt).toContain("before inspecting files");
  });

  it("injects the current todo snapshot on before_agent_start", async () => {
    const tools = new Map<string, (id: string, params: any) => Promise<any>>();
    const pi = {
      registerTool: vi.fn((definition: { name: string; execute: (id: string, params: any) => Promise<unknown> }) => {
        tools.set(definition.name, definition.execute);
      }),
      on: vi.fn(),
    };
    registerSessionTodoTools(pi as never);
    const handler = pi.on.mock.calls.find(([event]) => event === "before_agent_start")?.[1] as
      | ((event: { systemPrompt?: string }) => Promise<{ systemPrompt: string }>)
      | undefined;

    const empty = await handler!({ systemPrompt: "" });
    expect(empty.systemPrompt).toContain("No tasks tracked yet");

    await tools.get("todowrite")!("w1", {
      todos: [
        { id: "t1", content: "Alpha", status: "completed", priority: "high" },
        { id: "t2", content: "Beta", status: "in_progress", priority: "medium" },
      ],
    });

    const withTodos = await handler!({ systemPrompt: "" });
    expect(withTodos.systemPrompt).toContain("Alpha");
    expect(withTodos.systemPrompt).toContain("Beta");
    expect(withTodos.systemPrompt).toContain("Progress: 1/2 completed");
    expect(withTodos.systemPrompt).toContain("Currently in progress: Beta");
  });

  it("todowrite replaces list and returns details", async () => {
    const tools = new Map<string, (id: string, params: unknown) => Promise<{ content: unknown[]; details: unknown }>>();
    const pi = {
      registerTool: vi.fn((def: { name: string; execute: (id: string, params: unknown) => Promise<unknown> }) => {
        tools.set(def.name, def.execute as never);
      }),
      on: vi.fn(),
    };
    registerSessionTodoTools(pi as never);

    const write = tools.get("todowrite")!;
    const written = await write("c1", {
      todos: [
        { id: "t1", content: "First", status: "in_progress", priority: "high" },
        { id: "t2", content: "Second", status: "pending", priority: "medium" },
      ],
    });
    expect(written.details).toMatchObject({
      todos: [
        { id: "t1", content: "First", status: "in_progress", priority: "high" },
        { id: "t2", content: "Second", status: "pending", priority: "medium" },
      ],
    });

    const read = tools.get("todoread")!;
    const listed = await read("c2", {});
    expect(listed.details).toMatchObject({
      todos: [
        { id: "t1", content: "First", status: "in_progress", priority: "high" },
        { id: "t2", content: "Second", status: "pending", priority: "medium" },
      ],
    });
    expect(String((listed.content[0] as { text: string }).text)).toContain("First");
  });

  it("notifies the host after reconstructing a tree branch", async () => {
    const onBranchChanged = vi.fn();
    const pi = { registerTool: vi.fn(), on: vi.fn() };
    registerSessionTodoTools(pi as never, onBranchChanged);
    const handler = pi.on.mock.calls.find(([event]) => event === "session_tree")?.[1] as
      | ((event: unknown, ctx: { sessionManager: { getBranch: () => unknown[] } }) => Promise<void>)
      | undefined;
    const sessionManager = {
      getBranch: () => [
        {
          type: "message",
          message: {
            role: "toolResult",
            toolName: "todowrite",
            details: {
              todos: [{ id: "branch-1", content: "Branch task", status: "pending", priority: "medium" }],
            },
          },
        },
      ],
    };

    await handler?.({}, { sessionManager });

    expect(onBranchChanged).toHaveBeenCalledWith(
      [{ id: "branch-1", content: "Branch task", status: "pending", priority: "medium" }],
      sessionManager,
    );
  });

  it("rebuilds the reconciled state from a host-persisted custom_message entry", async () => {
    const onBranchChanged = vi.fn();
    const pi = { registerTool: vi.fn(), on: vi.fn() };
    registerSessionTodoTools(pi as never, onBranchChanged);
    const handler = pi.on.mock.calls.find(([event]) => event === "session_tree")?.[1] as
      | ((event: unknown, ctx: { sessionManager: { getBranch: () => unknown[] } }) => Promise<void>)
      | undefined;
    const sessionManager = {
      getBranch: () => [
        {
          type: "message",
          message: {
            role: "toolResult",
            toolName: "todowrite",
            details: {
              todos: [{ id: "t1", content: "Fix flicker", status: "in_progress", priority: "high" }],
            },
          },
        },
        {
          type: "custom_message",
          customType: "session-todo",
          content: "Todo list reconciled after the turn ended:",
          display: false,
          details: {
            todos: [{ id: "t1", content: "Fix flicker", status: "completed", priority: "high" }],
          },
        },
      ],
    };

    await handler?.({}, { sessionManager });

    expect(onBranchChanged).toHaveBeenCalledWith(
      [{ id: "t1", content: "Fix flicker", status: "completed", priority: "high" }],
      sessionManager,
    );
  });

  it("creates and updates one item without replacing other todos", async () => {
    const tools = new Map<string, (id: string, params: any) => Promise<any>>();
    const pi = {
      registerTool: vi.fn((definition: { name: string; execute: (id: string, params: any) => Promise<unknown> }) => {
        tools.set(definition.name, definition.execute);
      }),
      on: vi.fn(),
    };
    registerSessionTodoTools(pi as never);

    await tools.get("todowrite")!("w1", {
      todos: [
        { id: "first", content: "First", status: "pending", priority: "medium" },
        { id: "second", content: "Second", status: "pending", priority: "low" },
      ],
    });
    await tools.get("todoupdate")!("u1", { id: "first", status: "in_progress" });
    await tools.get("todoupdate")!("u2", { id: "second", status: "in_progress" });
    await tools.get("todocreate")!("c1", { content: "Third" });
    const result = await tools.get("todoread")!("r1", {});

    expect(result.details.todos).toEqual([
      { id: "first", content: "First", status: "pending", priority: "medium" },
      { id: "second", content: "Second", status: "in_progress", priority: "low" },
      { id: "todo-1", content: "Third", status: "pending", priority: "medium" },
    ]);
  });

  it("returns tool errors for invalid incremental operations without mutating the list", async () => {
    const tools = new Map<string, (id: string, params: any) => Promise<any>>();
    const pi = {
      registerTool: vi.fn((definition: { name: string; execute: (id: string, params: any) => Promise<unknown> }) => {
        tools.set(definition.name, definition.execute);
      }),
      on: vi.fn(),
    };
    registerSessionTodoTools(pi as never);

    await tools.get("todowrite")!("w1", {
      todos: [{ id: "first", content: "First", status: "pending", priority: "medium" }],
    });
    const duplicate = await tools.get("todocreate")!("c1", { id: "first", content: "Duplicate" });
    const missing = await tools.get("todoupdate")!("u1", { id: "missing", status: "completed" });

    expect(duplicate.isError).toBe(true);
    expect(missing.isError).toBe(true);
    expect((await tools.get("todoread")!("r1", {})).details.todos).toEqual([
      { id: "first", content: "First", status: "pending", priority: "medium" },
    ]);
  });
});
