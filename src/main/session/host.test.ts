import { describe, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiHost, type PiRuntimeLike, type PiSessionLike } from "./host.js";
import { PlanModeStore } from "./plan/store.js";

function createFakeRuntime(cwd = "/tmp/project", history: unknown[] = []) {
  const listeners = new Set<(event: unknown) => void>();
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const customEntries: Array<{ customType: string; content: string; display: boolean; details?: unknown }> = [];
  let streaming = false;
  let steeringQueue: string[] = [];
  let followUpQueue: string[] = [];
  const toolNames = ["read", "grep", "find", "ls", "write", "edit", "bash", "plan_save", "plan_list", "plan_read", "mcp_search"];
  let activeToolNames = [...toolNames];
  const session: PiSessionLike & {
    getLastAssistantText?: () => string;
    setSessionName?: (name: string) => void;
    getSteeringMessages: () => string[];
    getFollowUpMessages: () => string[];
    modelRuntime?: {
      getModels(): ReadonlyArray<{ provider?: string; id?: string; name?: string }>;
      getModel(provider: string, id: string): unknown;
      getAvailable?(): Promise<ReadonlyArray<{ provider?: string; id?: string; name?: string }>>;
      getAvailableSnapshot?(): ReadonlyArray<{ provider?: string; id?: string; name?: string }>;
      hasConfiguredAuth?(providerId: string): boolean;
    };
    settingsManager?: {
      getPackages(): Array<string | { source: string }>;
      getDefaultProvider?(): string | undefined;
      getDefaultModel?(): string | undefined;
    };
  } = {
    sessionId: "session-1",
    sessionFile: "/tmp/session.jsonl",
    sessionName: "Test session",
    cwd,
    model: { provider: "openai", id: "gpt-5" },
    thinkingLevel: "medium",
    get isStreaming() { return streaming; },
    get messages() { return history; },
    getActiveToolNames: () => activeToolNames,
    getAllTools: () => toolNames.map((name) => ({ name })),
    getSessionStats: () => ({ sessionFile: "/tmp/session.jsonl", sessionId: "session-1", userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 }),
    getContextUsage: () => undefined,
    subscribe: (listener: (event: unknown) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    prompt: async (text: string, options?: unknown) => { calls.push({ method: "prompt", args: [text, options] }); },
    steer: async (text: string) => { calls.push({ method: "steer", args: [text] }); steeringQueue.push(text); },
    followUp: async (text: string) => { calls.push({ method: "followUp", args: [text] }); followUpQueue.push(text); },
    clearQueue: () => {
      calls.push({ method: "clearQueue", args: [] });
      const current = { steering: [...steeringQueue], followUp: [...followUpQueue] };
      steeringQueue = [];
      followUpQueue = [];
      return current;
    },
    getSteeringMessages: () => steeringQueue,
    getFollowUpMessages: () => followUpQueue,
    abort: async () => { calls.push({ method: "abort", args: [] }); },
    setThinkingLevel: (level: string) => { calls.push({ method: "setThinkingLevel", args: [level] }); },
    setActiveToolsByName: (tools: string[]) => { activeToolNames = [...tools]; calls.push({ method: "setActiveToolsByName", args: [tools] }); },
    compact: async (instructions?: string) => { calls.push({ method: "compact", args: [instructions] }); return {}; },
    reload: async () => { calls.push({ method: "reload", args: [] }); },
    getLastAssistantText: () => "",
    exportToJsonl: () => "",
    sessionManager: {
      getTree: () => [],
      buildSessionContext: () => ({ messages: history }),
      appendCustomMessageEntry: (customType: string, content: string, display: boolean, details?: unknown) => {
        calls.push({ method: "appendCustomMessageEntry", args: [customType, content, display, details] });
        customEntries.push({ customType, content, display, details });
        return `custom-${customEntries.length}`;
      },
    },
  };
  const runtime: PiRuntimeLike = {
    session,
    cwd,
    switchSession: async () => { calls.push({ method: "switchSession", args: [] }); return { cancelled: false }; },
    newSession: async () => { calls.push({ method: "newSession", args: [] }); return { cancelled: false }; },
    fork: async () => { calls.push({ method: "fork", args: [] }); return { cancelled: false }; },
    importFromJsonl: async () => { calls.push({ method: "importFromJsonl", args: [] }); return { cancelled: false }; },
    dispose: async () => { calls.push({ method: "dispose", args: [] }); },
  };
  return {
    runtime,
    session,
    calls,
    customEntries,
    setStreaming: (value: boolean) => { streaming = value; },
    emit: (event: unknown) => listeners.forEach((listener) => listener(event)),
  };
}

describe("PiHost", () => {
  test("returns no plans before a runtime has started", () => {
    const host = new PiHost({ workspaceId: "workspace-1" });

    expect(host.listPlans()).toEqual([]);
  });

  test("maps prompt controls to the real Pi session", async () => {
    const fake = createFakeRuntime();
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });

    await host.prompt("inspect the project");
    await host.steer("focus on tests");
    await host.followUp("summarize the result");
    await host.abort();
    host.setThinkingLevel("high");
    host.setTools(["read"]);
    await host.compact("keep decisions");
    await host.reload();

    expect(fake.calls.map((call) => call.method)).toEqual([
      "prompt", "steer", "followUp", "abort", "setThinkingLevel", "setActiveToolsByName", "compact", "reload",
    ]);
  });

  test("switches the active runtime into a read-only plan tool policy", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-mode-test-"));
    try {
      const fake = createFakeRuntime(cwd);
      const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
      fake.calls.length = 0;

      const mode = await host.setMode("plan");

      expect(mode.mode).toBe("plan");
      expect(fake.calls.map((call) => call.method)).toEqual(["setThinkingLevel", "setActiveToolsByName"]);
      expect(fake.calls[1]?.args[0]).toEqual(["read", "grep", "find", "ls", "plan_save", "plan_list", "plan_read", "mcp_search"]);
      expect(host.snapshot().session.modeState?.mode).toBe("plan");
      const stored = JSON.parse(readFileSync(join(cwd, ".pai/session-modes.json"), "utf8"));
      expect(stored.sessions["session-1"]?.mode).toBe("plan");
      expect(stored.sessions["file:/tmp/session.jsonl"]).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("temporarily locks local write tools in Plan without losing Execute or MCP selection", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-mode-tools-test-"));
    try {
      const fake = createFakeRuntime(cwd);
      const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });

      host.setTools(["read", "bash", "edit", "write", "mcp_search"]);
      await host.setMode("plan");
      expect(fake.session.getActiveToolNames()).toEqual(["read", "mcp_search", "plan_save", "plan_list", "plan_read"]);

      // Plan permits choosing connected tools but cannot turn local write back on.
      host.setTools(["read", "mcp_search", "bash"]);
      expect(fake.session.getActiveToolNames()).toEqual(["read", "mcp_search", "plan_save", "plan_list", "plan_read"]);

      await host.setMode("execute");
      expect(fake.session.getActiveToolNames()).toEqual(["read", "mcp_search", "bash", "edit", "write"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("restores a sole session-owned plan when older mode state lacks activePlan", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-plan-restore-"));
    try {
      const saved = new PlanModeStore(cwd).savePlan({
        title: "Recovered plan",
        content: "# Recovered plan\n\n## Goal\nRestore the plan preview.",
        sourceSession: "session-1",
      });
      const fake = createFakeRuntime(cwd);
      const host = new PiHost({ workspaceId: "workspace-1", runtimeFactory: async () => fake.runtime });

      const snapshot = await host.start({ cwd, sessionPath: "/tmp/session.jsonl" });

      expect(snapshot.session.modeState?.activePlan).toMatchObject({ id: saved.summary.id, title: "Recovered plan" });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("edits a follow-up queue item and can send it now", async () => {
    const fake = createFakeRuntime();
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    await fake.session.followUp("first");
    await fake.session.followUp("second");
    fake.calls.length = 0;
    fake.setStreaming(true);

    await host.editFollowUp(1, "updated");
    expect(fake.session.getFollowUpMessages?.()).toEqual(["first", "updated"]);

    await host.sendFollowUpNow(0);
    expect(fake.session.getSteeringMessages?.()).toEqual(["first"]);
    expect(fake.session.getFollowUpMessages?.()).toEqual(["updated"]);
    expect(fake.calls.map((call) => call.method)).toEqual([
      "clearQueue", "followUp", "followUp", "clearQueue", "steer", "followUp",
    ]);
  });

  test("mirrors todowrite tool results into snapshot and todos_updated events", async () => {
    const fake = createFakeRuntime();
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    const events: Array<{ type: string; payload?: unknown }> = [];
    host.subscribe((event) => events.push({ type: event.type, payload: event.payload }));

    fake.emit({
      type: "tool_execution_end",
      toolCallId: "tc-todo-1",
      toolName: "todowrite",
      isError: false,
      result: {
        content: [{ type: "text", text: "ok" }],
        details: {
          todos: [
            { id: "1", content: "First", status: "completed", priority: "high" },
            { id: "2", content: "Second", status: "in_progress", priority: "medium" },
          ],
          updatedAt: "2026-08-08T00:00:00.000Z",
        },
      },
    });

    const updated = events.find((e) => e.type === "todos_updated");
    expect(updated?.payload).toEqual({
      todos: [
        { id: "1", content: "First", status: "completed", priority: "high" },
        { id: "2", content: "Second", status: "in_progress", priority: "medium" },
      ],
      revision: 1,
    });
    expect(host.snapshot().session.todos).toEqual([
      { id: "1", content: "First", status: "completed", priority: "high" },
      { id: "2", content: "Second", status: "in_progress", priority: "medium" },
    ]);
  });

  test("publishes restored todos after the initial session reset", async () => {
    const fake = createFakeRuntime();
    Object.defineProperty(fake.session, "messages", {
      get: () => [
        {
          role: "toolResult",
          toolName: "todowrite",
          details: { todos: [{ id: "1", content: "Restore me", status: "pending", priority: "high" }] },
        },
      ],
    });
    const host = new PiHost({ workspaceId: "workspace-1", runtimeFactory: async () => fake.runtime });
    const events: Array<{ type: string; payload?: unknown }> = [];
    host.subscribe((event) => events.push({ type: event.type, payload: event.payload }));

    await host.start({ cwd: "/tmp/project", sessionPath: "/tmp/session.jsonl" });

    expect(events.filter((event) => event.type === "session_started")).toHaveLength(1);
    expect(events.find((event) => event.type === "todos_updated")?.payload).toEqual({
      todos: [{ id: "1", content: "Restore me", status: "pending", priority: "high" }],
      revision: 0,
    });
  });

  test("refreshes todos when navigating to another session-tree branch", () => {
    const fake = createFakeRuntime();
    let messages: unknown[] = [
      {
        role: "toolResult",
        toolName: "todowrite",
        details: { todos: [{ id: "1", content: "Old branch", status: "pending", priority: "low" }] },
      },
    ];
    Object.defineProperty(fake.session, "messages", { get: () => messages });
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    const events: Array<{ type: string; payload?: unknown }> = [];
    host.subscribe((event) => events.push({ type: event.type, payload: event.payload }));

    messages = [];
    fake.emit({ type: "session_tree", newLeafId: null, oldLeafId: "old" });

    expect(events.at(-1)).toEqual({ type: "todos_updated", payload: { todos: [], revision: 1 } });
    expect(host.snapshot().session.todos).toEqual([]);
  });

  test("prompt resolves on preflight acceptance without waiting for the turn", async () => {
    const fake = createFakeRuntime();
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    fake.session.prompt = async (_text: string, options?: unknown) => {
      (options as { preflightResult?: (ok: boolean) => void } | undefined)?.preflightResult?.(true);
      return new Promise(() => {}); // turn never settles — acceptance already resolved the host promise
    };
    await expect(host.prompt("inspect the project")).resolves.toBeUndefined();
  });

  test("turn errors after acceptance surface as session_error", async () => {
    const fake = createFakeRuntime();
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    const errors: string[] = [];
    host.subscribe((event) => {
      if (event.type === "session_error") errors.push((event as { payload: { message: string } }).payload.message);
    });
    fake.session.prompt = async (_text: string, options?: unknown) => {
      (options as { preflightResult?: (ok: boolean) => void } | undefined)?.preflightResult?.(true);
      throw new Error("boom");
    };
    await expect(host.prompt("inspect the project")).resolves.toBeUndefined();
    expect(errors).toEqual(["boom"]);
  });

  test("surfaces terminal provider errors carried by assistant events", () => {
    const fake = createFakeRuntime();
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    const events: Array<{ type: string; payload: unknown }> = [];
    host.subscribe((event) => events.push({ type: event.type, payload: event.payload }));
    const failedAssistant = {
      role: "assistant",
      stopReason: "error",
      errorMessage: "429: rate limit exceeded",
      content: [],
    };

    fake.emit({ type: "message_start", message: failedAssistant });
    fake.emit({ type: "message_end", message: failedAssistant });
    fake.emit({ type: "turn_end", message: failedAssistant, toolResults: [] });
    fake.emit({ type: "agent_end", messages: [failedAssistant], willRetry: false });

    expect(events.filter((event) => event.type !== "live_sessions_changed")).toEqual([
      expect.objectContaining({ type: "assistant_message_started" }),
      expect.objectContaining({ type: "assistant_message_completed" }),
      expect.objectContaining({ type: "turn_completed" }),
      expect.objectContaining({ type: "session_error", payload: { message: "429: rate limit exceeded" } }),
    ]);
    expect(events.at(-1)).toEqual(expect.objectContaining({
      type: "live_sessions_changed",
      payload: expect.objectContaining({
        sessions: [expect.objectContaining({ status: "error" })],
      }),
    }));
  });

  test("waits for an automatic retry before surfacing a provider error", () => {
    const fake = createFakeRuntime();
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    const events: string[] = [];
    host.subscribe((event) => events.push(event.type));
    const failedAssistant = {
      role: "assistant",
      stopReason: "error",
      errorMessage: "503: service unavailable",
      content: [],
    };

    fake.emit({ type: "agent_end", messages: [failedAssistant], willRetry: true });

    expect(events).not.toContain("session_error");
    expect(events).not.toContain("session_completed");
  });

  test("preflight rejection propagates as a prompt failure", async () => {
    const fake = createFakeRuntime();
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    fake.session.prompt = async (_text: string, options?: unknown) => {
      (options as { preflightResult?: (ok: boolean) => void } | undefined)?.preflightResult?.(false);
      throw new Error("no model selected");
    };
    await expect(host.prompt("inspect the project")).rejects.toThrow("no model selected");
  });

  test("normalizes Pi session events without cloning the raw SDK payload", () => {
    const fake = createFakeRuntime();
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    const events: unknown[] = [];
    host.subscribe((event) => events.push(event));

    fake.emit({ type: "message_start", message: { role: "assistant" } });
    fake.emit({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "bash", args: { command: "pwd" } });

    expect(events).toEqual([
      expect.objectContaining({ type: "assistant_message_started" }),
      expect.objectContaining({ type: "tool_call_started", payload: expect.objectContaining({ toolCallId: "tool-1", toolName: "bash" }) }),
    ]);
    expect(events.every((event) => !("raw" in (event as object) && (event as { raw?: unknown }).raw))).toBe(true);
  });

  test("includes the session name when an agent finishes", () => {
    const fake = createFakeRuntime();
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    const events: unknown[] = [];
    host.subscribe((event) => events.push(event));

    fake.emit({ type: "agent_end" });

    expect(events).toContainEqual(expect.objectContaining({
      type: "session_completed",
      payload: { sessionId: "session-1", sessionName: "Test session" },
    }));
  });

  test("emits real line changes for an edited file", () => {
    const project = mkdtempSync(join(tmpdir(), "pi-change-"));
    mkdirSync(join(project, "src"));
    writeFileSync(join(project, "src", "App.tsx"), "one\ntwo\nthree\n");
    try {
      const fake = createFakeRuntime(project);
      const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
      const events: unknown[] = [];
      host.subscribe((event) => events.push(event));

      fake.emit({
        type: "tool_execution_start",
        toolCallId: "edit-1",
        toolName: "edit",
        args: { path: "src/App.tsx", edits: [{ oldText: "two", newText: "updated" }] },
      });
      writeFileSync(join(project, "src", "App.tsx"), "one\nupdated\nthree\nfour\n");
      fake.emit({
        type: "tool_execution_end",
        toolCallId: "edit-1",
        toolName: "edit",
        isError: false,
        result: { content: [{ type: "text", text: "ok" }] },
      });

      expect(events).toContainEqual(expect.objectContaining({
        type: "tool_call_completed",
        payload: expect.objectContaining({
          change: expect.objectContaining({ path: "src/App.tsx", additions: 2, deletions: 1, diff: expect.stringContaining("+updated") }),
        }),
      }));
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("undoes a tracked file change only when the file is still at the edited version", async () => {
    const project = mkdtempSync(join(tmpdir(), "pi-undo-"));
    mkdirSync(join(project, "src"));
    const file = join(project, "src", "App.tsx");
    writeFileSync(file, "before\n");
    try {
      const fake = createFakeRuntime(project);
      const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
      const events: unknown[] = [];
      host.subscribe((event) => events.push(event));

      fake.emit({ type: "tool_execution_start", toolCallId: "edit-1", toolName: "edit", args: { path: "src/App.tsx" } });
      writeFileSync(file, "after\n");
      fake.emit({ type: "tool_execution_end", toolCallId: "edit-1", toolName: "edit", isError: false, result: "ok" });

      await host.undoFileChange("src/App.tsx");
      expect(readFileSync(file, "utf8")).toBe("before\n");
      expect(events).toContainEqual(expect.objectContaining({
        type: "file_change_undone",
        payload: { path: "src/App.tsx" },
      }));
      await expect(host.undoFileChange("src/App.tsx")).rejects.toThrow("no longer undoable");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("snapshot includes models and tools from the runtime", () => {
    const fake = createFakeRuntime();
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    const snapshot = host.snapshot();
    expect(snapshot.models).toBeDefined();
    expect(snapshot.tools).toBeDefined();
  });

  test("snapshot display name falls back to first user message like the sidebar", async () => {
    const fake = createFakeRuntime();
    fake.session.sessionName = undefined;
    Object.defineProperty(fake.session, "messages", {
      get: () => [{ id: "u1", role: "user", content: "fix the auth flow" }],
    });
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    expect(host.snapshot().session.name).toBe("fix the auth flow");
  });

  test("renameSession updates active session name without wiping runtime", async () => {
    const fake = createFakeRuntime();
    const names: string[] = [];
    fake.session.sessionFile = "/tmp/session.jsonl";
    fake.session.sessionName = "Old name";
    fake.session.setSessionName = (name: string) => {
      names.push(name);
      fake.session.sessionName = name;
    };
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    const events: unknown[] = [];
    host.subscribe((event) => events.push(event));

    const result = await host.renameSession("/tmp/session.jsonl", "  New title  ");
    expect(result.name).toBe("New title");
    expect(names).toEqual(["New title"]);
    expect(host.snapshot().session.name).toBe("New title");
    expect(events).toEqual([
      expect.objectContaining({
        type: "session_name_changed",
        payload: expect.objectContaining({ name: "New title" }),
      }),
    ]);
  });

  test("listProviders maps auth status and login capabilities", async () => {
    const prompts: string[] = [];
    const login = vi.fn(async (_id: string, _type: string, interaction: { prompt: (p: { type: string }) => Promise<string> }) => {
      const value = await interaction.prompt({ type: "secret" });
      prompts.push(value);
      return { type: "api_key", key: value };
    });
    const logout = vi.fn(async () => undefined);
    const authRuntime = {
      getAvailable: async () => [],
      getProviders: () => [
        {
          id: "deepseek",
          name: "DeepSeek",
          auth: { apiKey: { login: async () => ({ type: "api_key", key: "x" }) } },
        },
        {
          id: "anthropic",
          name: "Anthropic",
          auth: {
            apiKey: { login: async () => ({ type: "api_key", key: "x" }) },
            oauth: {},
          },
        },
      ],
      getProvider: (id: string) =>
        id === "deepseek"
          ? { id: "deepseek", name: "DeepSeek", auth: { apiKey: { login: async () => ({ type: "api_key", key: "x" }) } } }
          : { id: "anthropic", name: "Anthropic", auth: { apiKey: { login: async () => ({ type: "api_key", key: "x" }) }, oauth: {} } },
      getProviderAuthStatus: (id: string) =>
        id === "deepseek"
          ? { configured: true, source: "environment", label: "DEEPSEEK_API_KEY" }
          : { configured: false },
      listCredentials: async () => [],
      login,
      logout,
    };

    const host = new PiHost({
      workspaceId: "workspace-1",
      authRuntimeFactory: async () => authRuntime as never,
    });
    const providers = await host.listProviders();
    expect(providers.find((p) => p.id === "deepseek")).toEqual(
      expect.objectContaining({
        name: "DeepSeek",
        configured: true,
        source: "environment",
        hasApiKeyLogin: true,
        canLogout: false,
      }),
    );
    expect(providers.find((p) => p.id === "anthropic")).toEqual(
      expect.objectContaining({
        configured: false,
        hasApiKeyLogin: true,
        hasOAuthLogin: true,
      }),
    );

    await expect(host.loginWithApiKey("deepseek", "  sk-abc  ")).resolves.toEqual({ name: "DeepSeek" });
    expect(login).toHaveBeenCalledWith("deepseek", "api_key", expect.any(Object));
    expect(prompts).toEqual(["sk-abc"]);

    await host.logoutProvider("deepseek");
    expect(logout).toHaveBeenCalledWith("deepseek");
  });

  test("listProviders works without an active chat session", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-auth-"));
    try {
      const host = new PiHost({ workspaceId: "workspace-1", agentDir });
      const providers = await host.listProviders();
      expect(providers.length).toBeGreaterThan(5);
      expect(providers.some((p) => p.id === "deepseek" && p.hasApiKeyLogin)).toBe(true);
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  test("uses the live runtime for auth changes and switches to the new provider model", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-auth-sync-test-"));
    const agentDir = mkdtempSync(join(tmpdir(), "pi-auth-settings-"));
    try {
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
        defaultProvider: "amazon-bedrock",
        defaultModel: "deepseek.v3.2",
      }));
      const fake = createFakeRuntime(cwd);
      const configured = new Set(["amazon"]);
      const models = [
        { provider: "amazon", id: "nova", name: "Amazon Nova" },
        { provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
      ];
      const login = vi.fn(async (providerId: string) => { configured.add(providerId); });
      const logout = vi.fn(async (providerId: string) => { configured.delete(providerId); });
      fake.session.model = { provider: "amazon", id: "nova" };
      fake.session.setModel = async (model: unknown) => {
        const next = model as { provider?: string; id?: string };
        fake.session.model = { provider: next.provider, id: next.id };
        fake.calls.push({ method: "setModel", args: [model] });
      };
      fake.session.modelRuntime = {
        getModels: () => models,
        getModel: (provider: string, id: string) => models.find((model) => model.provider === provider && model.id === id),
        getAvailable: async (providerId?: string) => models.filter((model) => configured.has(model.provider) && (!providerId || model.provider === providerId)),
        getAvailableSnapshot: () => [],
        hasConfiguredAuth: (providerId: string) => configured.has(providerId),
        getProvider: (providerId: string) => ({
          id: providerId,
          name: providerId === "deepseek" ? "DeepSeek" : "Amazon",
          auth: { apiKey: { login: async () => ({ type: "api_key", key: "test" }) } },
        }),
        login,
        logout,
        refresh: vi.fn(async () => undefined),
      };
      const authRuntimeFactory = vi.fn(async () => {
        throw new Error("the dedicated auth runtime should not be used while a session is live");
      });
      const host = new PiHost({ workspaceId: "workspace-1", agentDir, runtime: fake.runtime, authRuntimeFactory });

      await host.logoutProvider("amazon");
      await host.loginWithApiKey("deepseek", "sk-test");

      expect(authRuntimeFactory).not.toHaveBeenCalled();
      expect(logout).toHaveBeenCalledWith("amazon");
      expect(login).toHaveBeenCalledWith("deepseek", "api_key", expect.any(Object));
      expect(fake.session.model).toEqual({ provider: "deepseek", id: "deepseek-v4-flash" });
      expect(host.snapshot().session.modeState?.executeProfile.modelKey).toBe("deepseek/deepseek-v4-flash");
      expect(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"))).toEqual(expect.objectContaining({
        defaultProvider: "deepseek",
        defaultModel: "deepseek-v4-flash",
      }));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  test("auth-driven model switching clamps unsupported thinking levels", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-auth-thinking-test-"));
    const agentDir = mkdtempSync(join(tmpdir(), "pi-auth-thinking-agent-"));
    try {
      const fake = createFakeRuntime(cwd);
      const configured = new Set(["amazon"]);
      const models = [
        { provider: "amazon", id: "nova", name: "Amazon Nova" },
        {
          provider: "deepseek",
          id: "deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          thinkingLevelMap: { minimal: null, low: "low", medium: null, high: "high", max: "max" },
        },
      ];
      fake.session.model = { provider: "amazon", id: "nova" };
      fake.session.getAvailableThinkingLevels = () => ["off", "low", "high", "max"];
      fake.session.setModel = async (model: unknown) => {
        const next = model as { provider?: string; id?: string };
        fake.session.model = { provider: next.provider, id: next.id };
        fake.calls.push({ method: "setModel", args: [model] });
      };
      fake.session.modelRuntime = {
        getModels: () => models,
        getModel: (provider: string, id: string) => models.find((model) => model.provider === provider && model.id === id),
        getAvailable: async (providerId?: string) => models.filter((model) => configured.has(model.provider) && (!providerId || model.provider === providerId)),
        getAvailableSnapshot: () => [],
        hasConfiguredAuth: (providerId: string) => configured.has(providerId),
        getProvider: (providerId: string) => ({
          id: providerId,
          name: providerId === "deepseek" ? "DeepSeek" : "Amazon",
          auth: { apiKey: { login: async () => ({ type: "api_key", key: "test" }) } },
        }),
        login: vi.fn(async (providerId: string) => { configured.add(providerId); }),
        logout: vi.fn(async () => undefined),
        refresh: vi.fn(async () => undefined),
      };
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
        defaultProvider: "amazon-bedrock",
        defaultModel: "deepseek.v3.2",
      }));
      const host = new PiHost({ workspaceId: "workspace-1", agentDir, runtime: fake.runtime });

      await expect(host.loginWithApiKey("deepseek", "sk-test")).resolves.toEqual({ name: "DeepSeek" });

      expect(host.snapshot().session.modeState?.executeProfile.modelKey).toBe("deepseek/deepseek-v4-flash");
      expect(host.snapshot().session.modeState?.executeProfile.thinkingLevel).toBe("low");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  test("login without a live session updates default provider and model in settings", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-auth-detached-"));
    try {
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
        defaultProvider: "amazon-bedrock",
        defaultModel: "deepseek.v3.2",
      }));

      const login = vi.fn(async () => undefined);
      const authRuntime = {
        getProvider: (providerId: string) => ({
          id: providerId,
          name: providerId === "deepseek" ? "DeepSeek" : providerId,
          auth: { apiKey: { login: async () => ({ type: "api_key", key: "test" }) } },
        }),
        getAvailable: async (providerId?: string) =>
          providerId === "deepseek"
            ? [{ provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }]
            : [{ provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
        login,
        logout: vi.fn(async () => undefined),
      };

      const host = new PiHost({
        workspaceId: "workspace-1",
        agentDir,
        authRuntimeFactory: async () => authRuntime as never,
      });

      await expect(host.loginWithApiKey("deepseek", "sk-test")).resolves.toEqual({ name: "DeepSeek" });

      expect(login).toHaveBeenCalledWith("deepseek", "api_key", expect.any(Object));
      expect(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"))).toEqual(expect.objectContaining({
        defaultProvider: "deepseek",
        defaultModel: "deepseek-v4-flash",
      }));
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  test("refreshAvailableModels only returns usable models (not full catalog)", async () => {
    const fake = createFakeRuntime();
    fake.session.modelRuntime = {
      getModels: () => [
        { provider: "openai", id: "gpt-5", name: "GPT-5" },
        { provider: "anthropic", id: "claude", name: "Claude" },
        { provider: "google", id: "gemini", name: "Gemini" },
        { provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
      ],
      getModel: (provider: string, id: string) => ({ provider, id, name: id }),
      getAvailable: async () => [{ provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
      getAvailableSnapshot: () => [],
      hasConfiguredAuth: (provider: string) => provider === "deepseek",
    };
    fake.session.model = { provider: "deepseek", id: "deepseek-v4-flash" };
    fake.session.settingsManager = {
      getPackages: () => [],
      getDefaultProvider: () => "deepseek",
      getDefaultModel: () => "deepseek-v4-flash",
    };
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    const models = await host.refreshAvailableModels();
    expect(models).toEqual([
      expect.objectContaining({ id: "deepseek/deepseek-v4-flash", provider: "deepseek", available: true }),
    ]);
    expect(models.some((model) => model.provider === "google")).toBe(false);
  });

  test("refreshAvailableModels recovers when the live runtime reports stale empty availability", async () => {
    const fake = createFakeRuntime();
    let liveConfigured = false;
    const models = [
      { provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
      { provider: "deepseek", id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    ];
    let refreshed = false;
    fake.session.model = { provider: "deepseek", id: "deepseek-v4-flash" };
    fake.session.settingsManager = {
      getPackages: () => [],
      getDefaultProvider: () => "deepseek",
      getDefaultModel: () => "deepseek-v4-flash",
    };
    fake.session.modelRuntime = {
      getModels: () => models,
      getModel: (provider: string, id: string) => models.find((m) => m.provider === provider && m.id === id),
      // Simulates a stale snapshot that predates env-based configuration.
      getAvailable: async () => (refreshed ? models : []),
      getAvailableSnapshot: () => [],
      hasConfiguredAuth: (provider: string) => provider === "deepseek" && liveConfigured,
      refresh: async () => {
        refreshed = true;
        liveConfigured = true;
      },
    };
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });

    const modelsList = await host.refreshAvailableModels();
    expect(refreshed).toBe(true);
    expect(modelsList.map((m) => m.id).sort()).toEqual([
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-pro",
    ].sort());
    expect(modelsList.every((m) => m.available)).toBe(true);
  });

  test("refreshAvailableModels ignores ambient env providers (e.g. Anthropic) when default is deepseek", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-models-"));
    try {
      // Empty auth.json — only DEEPSEEK env would be intentional via settings.
      mkdirSync(agentDir, { recursive: true });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
        defaultProvider: "deepseek",
        defaultModel: "deepseek-v4-flash",
      }));
      writeFileSync(join(agentDir, "auth.json"), "{}");

      const fake = createFakeRuntime();
      // Session currently on an anthropic model (e.g. resumed chat) must not open the whole catalog.
      fake.session.model = { provider: "anthropic", id: "claude-sonnet-4-6" };
      fake.session.settingsManager = {
        getPackages: () => [],
        getDefaultProvider: () => "deepseek",
      };
      fake.session.modelRuntime = {
        getModels: () => [],
        getModel: (provider: string, id: string) => ({ provider, id, name: id }),
        getAvailable: async () => [
          { provider: "anthropic", id: "claude-opus-4-6", name: "Claude Opus 4.6" },
          { provider: "anthropic", id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
          { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
          { provider: "deepseek", id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
          { provider: "deepseek", id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
        ],
        getAvailableSnapshot: () => [],
        hasConfiguredAuth: (provider: string) => provider === "anthropic" || provider === "deepseek",
      };

      const host = new PiHost({ workspaceId: "workspace-1", agentDir, runtime: fake.runtime });
      const models = await host.refreshAvailableModels();

      expect(models.map((m) => m.id).sort()).toEqual([
        "anthropic/claude-sonnet-4-6", // current session model only
        "deepseek/deepseek-v4-flash",
        "deepseek/deepseek-v4-pro",
      ].sort());
      expect(models.some((m) => m.id === "anthropic/claude-opus-4-6")).toBe(false);
      expect(models.some((m) => m.id === "anthropic/claude-haiku-4-5")).toBe(false);
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  test("snapshot hydrates timeline from existing session messages on resume", async () => {
    const fake = createFakeRuntime();
    Object.defineProperty(fake.session, "messages", {
      get: () => [
        { id: "u1", role: "user", content: "hello from history" },
        { id: "a1", role: "assistant", content: [{ type: "text", text: "hi back" }] },
      ],
    });
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    await host.switchSession("/tmp/session.jsonl");
    const snapshot = host.snapshot();
    expect(snapshot.timeline).toEqual([
      expect.objectContaining({ kind: "user", content: "hello from history" }),
      expect.objectContaining({ kind: "assistant", content: "hi back" }),
    ]);
  });

  test("hydrates persisted assistant parts in their original trace order", () => {
    const fake = createFakeRuntime();
    Object.defineProperty(fake.session, "messages", {
      get: () => [
        { id: "u1", role: "user", content: "fix the test" },
        {
          id: "a1",
          role: "assistant",
          content: [
            { type: "text", text: "I will inspect it." },
            { type: "thinking", thinking: "Find the failing assertion." },
            { type: "toolCall", id: "read-1", name: "read", arguments: { path: "src/App.test.tsx" } },
            { type: "text", text: "Now I know what to change." },
            { type: "toolCall", id: "edit-1", name: "edit", arguments: { path: "src/App.test.tsx" } },
          ],
        },
        { id: "read-result", role: "toolResult", toolCallId: "read-1", toolName: "read", content: [{ type: "text", text: "file contents" }] },
        { id: "a2", role: "assistant", content: [{ type: "text", text: "The test is fixed." }] },
      ],
    });
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });

    expect(host.snapshot().timeline.map((item) => item.id)).toEqual([
      "u1", "a1-text-0", "a1-thinking-1", "read-1", "a1-text-3", "edit-1", "read-result", "a2-text-0",
    ]);
  });

  test("hydrates persisted edit metadata into the timeline", () => {
    const fake = createFakeRuntime();
    Object.defineProperty(fake.session, "messages", {
      get: () => [
        {
          id: "assistant-1",
          role: "assistant",
          content: [{ type: "toolCall", id: "edit-1", name: "edit", arguments: { path: "src/App.tsx", edits: [] } }],
        },
        {
          id: "result-1",
          role: "toolResult",
          toolCallId: "edit-1",
          toolName: "edit",
          content: [{ type: "text", text: "ok" }],
          details: { patch: "--- a/src/App.tsx\n+++ b/src/App.tsx\n@@\n-two\n+updated\n" },
        },
      ],
    });
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });

    expect(host.snapshot().timeline).toContainEqual(expect.objectContaining({
      kind: "tool",
      change: expect.objectContaining({ path: "src/App.tsx", additions: 1, deletions: 1, diff: expect.stringContaining("+updated") }),
    }));
  });

  test("start with sessionPath hydrates history into the snapshot timeline", async () => {
    const fake = createFakeRuntime();
    Object.defineProperty(fake.session, "messages", {
      get: () => [
        { id: "u1", role: "user", content: [{ type: "text", text: "open me" }] },
        { id: "a1", role: "assistant", content: "opened" },
      ],
    });
    const host = new PiHost({
      workspaceId: "workspace-1",
      runtimeFactory: async () => fake.runtime,
    });
    const snapshot = await host.start({ cwd: "/tmp/project", sessionPath: "/tmp/session.jsonl" });
    expect(snapshot.timeline.map((item) => item.kind)).toEqual(["user", "assistant"]);
    expect(snapshot.timeline[0]).toEqual(expect.objectContaining({ content: "open me" }));
    expect(snapshot.timeline[1]).toEqual(expect.objectContaining({ content: "opened" }));
  });

  test("executeCommand /copy returns last assistant text", async () => {
    const fake = createFakeRuntime();
    fake.session.getLastAssistantText = () => "last reply";
    const written: string[] = [];
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime, clipboardWriter: (text) => written.push(text) });
    await expect(host.executeCommand("copy")).resolves.toBeUndefined();
    expect(written).toEqual(["last reply"]);
  });

  test("executeCommand /export writes jsonl when asked", async () => {
    const fake = createFakeRuntime();
    const exportToJsonl = vi.fn((_path?: string) => "");
    fake.session.exportToJsonl = exportToJsonl;
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    await host.executeCommand("export", "session.jsonl");
    expect(exportToJsonl).toHaveBeenCalledWith("session.jsonl");
  });

  test("creates a real Pi SDK session without making a model request", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-desk-"));
    const project = join(root, "project");
    const agentDir = join(root, "agent");
    mkdirSync(project);
    mkdirSync(agentDir);
    const host = new PiHost({ workspaceId: "workspace-1", agentDir });

    try {
      const snapshot = await host.start({ cwd: project });
      expect(snapshot.session.cwd).toBe(project);
      expect(snapshot.session.sessionId).not.toBe("");
    } finally {
      await host.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("listSkills groups skills by top-level directory and reflects disabled state", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-desk-"));
    const agentDir = join(root, "agent");
    // Skill files live under agentDir/skills/<group>/<skill>/SKILL.md — the second scan root.
    const skillsRoot = join(agentDir, "skills");
    mkdirSync(join(skillsRoot, "superpowers", "brainstorming"), { recursive: true });
    mkdirSync(join(skillsRoot, "superpowers", "executing-plans"), { recursive: true });
    mkdirSync(join(skillsRoot, "watch"), { recursive: true });
    writeFileSync(join(skillsRoot, "superpowers", "brainstorming", "SKILL.md"), "# Brainstorming\n");
    writeFileSync(join(skillsRoot, "superpowers", "executing-plans", "SKILL.md"), "# Executing Plans\n");
    writeFileSync(join(skillsRoot, "watch", "SKILL.md"), "# Watch\n");
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ skills: ["!skills/superpowers/brainstorming"] }));
    const host = new PiHost({ workspaceId: "workspace-1", agentDir });

    try {
      const skills = host.listSkills().filter((skill) => skill.path.startsWith(skillsRoot));
      const brainstorm = skills.find((skill) => skill.name === "brainstorming");
      const executing = skills.find((skill) => skill.name === "executing-plans");
      expect(brainstorm?.group).toBe("superpowers");
      expect(brainstorm?.enabled).toBe(false);
      expect(executing?.group).toBe("superpowers");
      expect(executing?.enabled).toBe(true);
      expect(skills.some((skill) => skill.group === "watch" && skill.enabled !== false)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("setSkills writes patterns to settings.json and reloads the session", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-desk-"));
    const agentDir = join(root, "agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "settings.json"), "{}");
    const fake = createFakeRuntime();
    const reload = vi.fn(async () => undefined);
    fake.session.reload = reload;
    const host = new PiHost({ workspaceId: "workspace-1", agentDir, runtime: fake.runtime });

    try {
      await host.setSkills(["!skills/superpowers"]);
      const written = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
      expect(written.skills).toEqual(["!skills/superpowers"]);
      expect(reload).toHaveBeenCalled();

      await host.setSkills([]);
      const cleared = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
      expect(cleared.skills).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("getResources sets pkgSource on extension items from sourceInfo", () => {
    const fake = createFakeRuntime();
    fake.session.resourceLoader = {
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSkills: () => ({ skills: [] }),
      getPrompts: () => ({ prompts: [] }),
      getThemes: () => ({ themes: [] }),
      getExtensions: () => ({
        extensions: [
          { path: "/installed/pkg-a/index.ts", name: "pkg-ext", sourceInfo: { source: "npm:pkg-a", origin: "package", baseDir: "/installed/pkg-a" } },
          { path: "/top/index.ts", name: "top-ext", sourceInfo: { source: "auto", origin: "project" } },
          { path: "/bare/index.ts", name: "bare-ext" },
        ],
        errors: [],
      }),
    };
    fake.session.settingsManager = {
      getPackages: () => ["npm:pkg-a"],
      getDefaultProvider: () => undefined,
    };
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    const resources = host.getResources();
    const pkgExt = resources.extensions.find((ext) => ext.name === "pkg-ext");
    const topExt = resources.extensions.find((ext) => ext.name === "top-ext");
    const bareExt = resources.extensions.find((ext) => ext.name === "bare-ext");
    expect(pkgExt?.pkgSource).toBe("npm:pkg-a");
    expect(topExt?.pkgSource).toBeUndefined();
    expect(bareExt?.pkgSource).toBeUndefined();
  });

  test("getResources groups contributed resources by package source", () => {
    const fake = createFakeRuntime();
    // resourceLoader with sourceInfo on extensions/skills/prompts/themes
    fake.session.resourceLoader = {
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSkills: () => ({
        skills: [
          { name: "my-skill", filePath: "/pkg/skills/my-skill/SKILL.md", sourceInfo: { source: "npm:pkg-a", origin: "package", baseDir: "/installed/pkg-a" } },
          { name: "other", filePath: "/pkg/skills/other/SKILL.md", sourceInfo: { source: "auto", origin: "project" } },
        ],
      }),
      getPrompts: () => ({
        prompts: [
          { name: "my-prompt", filePath: "/pkg/prompts/my-prompt.md", sourceInfo: { source: "npm:pkg-a", origin: "package", baseDir: "/installed/pkg-a" } },
        ],
      }),
      getThemes: () => ({
        themes: [
          { name: "my-theme", filePath: "/pkg/themes/my-theme.json", sourceInfo: { source: "npm:pkg-a", origin: "package", baseDir: "/installed/pkg-a" } },
        ],
      }),
      getExtensions: () => ({
        extensions: [
          { path: "/installed/pkg-a/index.ts", name: "pkg-a-ext", sourceInfo: { source: "npm:pkg-a", origin: "package", baseDir: "/installed/pkg-a" } },
          { path: "/other/index.ts", name: "other-ext", sourceInfo: { source: "auto", origin: "project" } },
        ],
        errors: [],
      }),
    };
    fake.session.settingsManager = {
      getPackages: () => ["npm:pkg-a"],
      getDefaultProvider: () => undefined,
    };
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    const resources = host.getResources();
    expect(resources.packages).toHaveLength(1);
    expect(resources.packages[0].name).toBe("npm:pkg-a");
    expect(resources.packages[0].enabled).toBe(true);
    expect(resources.packages[0].resources).toEqual({
      extensions: 1,
      skills: 1,
      prompts: 1,
      themes: 1,
    });
  });

  test("getResources returns zero resource counts for packages with no matches", () => {
    const fake = createFakeRuntime();
    fake.session.resourceLoader = {
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSkills: () => ({ skills: [] }),
      getPrompts: () => ({ prompts: [] }),
      getThemes: () => ({ themes: [] }),
      getExtensions: () => ({ extensions: [], errors: [] }),
    };
    fake.session.settingsManager = {
      getPackages: () => ["npm:empty-pkg"],
      getDefaultProvider: () => undefined,
    };
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    const resources = host.getResources();
    expect(resources.packages).toHaveLength(1);
    expect(resources.packages[0].resources).toEqual({
      extensions: 0,
      skills: 0,
      prompts: 0,
      themes: 0,
    });
  });

  test("getResources derives enabled from package config filters", () => {
    const fake = createFakeRuntime();
    fake.session.resourceLoader = {
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSkills: () => ({ skills: [] }),
      getPrompts: () => ({ prompts: [] }),
      getThemes: () => ({ themes: [] }),
      getExtensions: () => ({ extensions: [], errors: [] }),
    };
    // Object form with no filters → enabled
    // Object form with non-empty filter → enabled
    // Object form with only empty filters → disabled
    fake.session.settingsManager = {
      getPackages: () => [
        "npm:str-pkg",
        { source: "npm:no-filters" },
        { source: "npm:has-exts", extensions: ["*"] },
        { source: "npm:empty-exts", extensions: [] },
        { source: "npm:empty-all", extensions: [], skills: [], prompts: [], themes: [] },
      ],
      getDefaultProvider: () => undefined,
    };
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    const resources = host.getResources();
    const pkgs = resources.packages;
    expect(pkgs.find((p) => p.name === "npm:str-pkg")?.enabled).toBe(true);
    expect(pkgs.find((p) => p.name === "npm:no-filters")?.enabled).toBe(true);
    expect(pkgs.find((p) => p.name === "npm:has-exts")?.enabled).toBe(true);
    expect(pkgs.find((p) => p.name === "npm:empty-exts")?.enabled).toBe(false);
    expect(pkgs.find((p) => p.name === "npm:empty-all")?.enabled).toBe(false);
  });

  test("getResources uses basename for extension display name", () => {
    const fake = createFakeRuntime();
    fake.session.resourceLoader = {
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSkills: () => ({ skills: [] }),
      getPrompts: () => ({ prompts: [] }),
      getThemes: () => ({ themes: [] }),
      getExtensions: () => ({
        extensions: [
          { path: "/installed/pkg-a/index.ts", name: "index", sourceInfo: { source: "npm:pkg-a", origin: "package" } },
        ],
        errors: [],
      }),
    };
    fake.session.settingsManager = {
      getPackages: () => ["npm:pkg-a"],
      getDefaultProvider: () => undefined,
    };
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    const resources = host.getResources();
    expect(resources.extensions[0].name).toBe("index");
  });

  test("getCommands lists builtins plus extension, skill, and prompt-template commands", () => {
    const fake = createFakeRuntime();
    fake.session.resourceLoader = {
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSkills: () => ({
        skills: [
          { name: "watch", description: "Watch a video", filePath: "/s/watch/SKILL.md" },
          { name: "supabase", description: "Supabase work", filePath: "/s/supabase/SKILL.md" },
        ],
      }),
      getPrompts: () => ({
        prompts: [
          { name: "release-notes", description: "Write release notes", filePath: "/p/release-notes.md" },
        ],
      }),
      getThemes: () => ({ themes: [] }),
      getExtensions: () => ({ extensions: [], errors: [] }),
    };
    fake.session.extensionRunner = {
      getRegisteredCommands: () => [
        { name: "hello", invocationName: "hello", description: "Say hi" },
      ],
    };
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    const commands = host.getCommands();
    const names = commands.map((command) => command.name);
    expect(names).toContain("/compact");
    expect(names).toContain("/hello");
    expect(names).toContain("/skill:watch");
    expect(names).toContain("/skill:supabase");
    expect(names).toContain("/release-notes");
    expect(commands.find((command) => command.name === "/skill:watch")).toMatchObject({
      source: "skill",
      description: "Watch a video",
    });
    expect(commands.find((command) => command.name === "/release-notes")).toMatchObject({
      source: "prompt",
      description: "Write release notes",
    });
    expect(commands.find((command) => command.name === "/hello")).toMatchObject({ source: "extension" });
    // Skill names without a name are skipped; builtin ids stay unique.
    expect(new Set(commands.map((command) => command.id)).size).toBe(commands.length);
  });

  test("getCommands without a runtime returns only the builtin commands", () => {
    const host = new PiHost({ workspaceId: "workspace-1" });
    expect(host.getCommands().map((command) => command.name)).toEqual(["/compact", "/export", "/copy", "/reload"]);
  });

  test("warmupTools pre-fetches rg and fd without throwing", async () => {
    const host = new PiHost({ workspaceId: "workspace-1" });
    await expect(host.warmupTools()).resolves.toBeUndefined();
  });

  test("loginWithOAuth streams auth_url and prompts, then completes via answerAuthPrompt", async () => {
    const opened: string[] = [];
    const authRuntime = makeOAuthAuthRuntime();
    const host = new PiHost({
      workspaceId: "workspace-1",
      authRuntimeFactory: async () => authRuntime as never,
      openExternal: (url) => opened.push(url),
    });
    const events: unknown[] = [];
    host.subscribe((event) => events.push(event));

    const loginPromise = host.loginWithOAuth("anthropic");

    // The flow notifies auth_url and asks an interactive select prompt.
    await vi.waitFor(() => {
      expect(events.some((e) => (e as { type: string }).type === "provider_login_event")).toBe(true);
    });
    const promptEvent = events.find(
      (e) =>
        (e as { type: string }).type === "provider_login_event" &&
        (e as { payload: { event: { type: string } } }).payload.event.type === "prompt",
    );
    expect(promptEvent).toBeDefined();
    const promptId = (promptEvent as { payload: { event: { prompt: { promptId: string } } } }).payload.event.prompt.promptId;
    expect(opened).toEqual(["https://auth.example.com/start"]);

    await host.answerAuthPrompt(promptId, "device");

    await expect(loginPromise).resolves.toEqual({ name: "Anthropic" });

    const loginEvents = events
      .filter((e) => (e as { type: string }).type === "provider_login_event")
      .map((e) => (e as { payload: { event: unknown } }).payload.event);
    expect(loginEvents).toContainEqual(expect.objectContaining({ type: "auth_url" }));
    expect(loginEvents).toContainEqual(expect.objectContaining({ type: "progress", message: "Exchanging code…" }));
    expect(loginEvents).toContainEqual(expect.objectContaining({ type: "done", name: "Anthropic" }));
  });

  test("loginWithOAuth auto-opens device code verification URIs", async () => {
    const opened: string[] = [];
    const runtime = {
      getAvailable: async () => [],
      getProviders: () => [],
      getProvider: (id: string) => ({
        id,
        name: "OpenAI",
        auth: {
          oauth: {
            login: async (interaction: { prompt: (p: unknown) => Promise<string>; notify: (e: unknown) => void }) => {
              interaction.notify({ type: "device_code", userCode: "ABCD-EFGH", verificationUri: "https://example.com/device" });
              return { type: "oauth", providerId: id, name: "OpenAI", token: "tok" };
            },
          },
        },
      }),
      getProviderAuthStatus: (_id: string) => ({ configured: false }),
      listCredentials: async () => [],
      login: async (id: string, _type: string, interaction: { prompt: (p: unknown) => Promise<string>; notify: (e: unknown) => void }) =>
        runtime.getProvider(id).auth.oauth.login(interaction),
      logout: async () => undefined,
    };
    const host = new PiHost({
      workspaceId: "workspace-1",
      authRuntimeFactory: async () => runtime as never,
      openExternal: (url) => opened.push(url),
    });

    await expect(host.loginWithOAuth("openai")).resolves.toEqual({ name: "OpenAI" });
    expect(opened).toEqual(["https://example.com/device"]);
  });

  test("cancelProviderLogin rejects a pending prompt and emits an error event", async () => {
    const authRuntime = makeOAuthAuthRuntime();
    const host = new PiHost({
      workspaceId: "workspace-1",
      authRuntimeFactory: async () => authRuntime as never,
    });
    const events: unknown[] = [];
    host.subscribe((event) => events.push(event));

    const loginPromise = host.loginWithOAuth("anthropic");

    await vi.waitFor(() => {
      expect(events.some((e) => (e as { type: string }).type === "provider_login_event")).toBe(true);
    });

    await host.cancelProviderLogin("anthropic");

    await expect(loginPromise).rejects.toThrow("Login cancelled");
    const errorEvent = events.find(
      (e) =>
        (e as { type: string }).type === "provider_login_event" &&
        (e as { payload: { event: { type: string } } }).payload.event.type === "error",
    );
    expect(errorEvent).toBeDefined();
    expect((errorEvent as { payload: { event: { message: string } } }).payload.event.message).toBe("Login cancelled");
  });

  test("multi-session: two sessionKeys keep both runtimes alive", async () => {
    const created: Array<{ key: string; dispose: ReturnType<typeof vi.fn> }> = [];
    const host = new PiHost({
      workspaceId: "workspace-1",
      runtimeFactory: async (opts) => {
        const fake = createFakeRuntime();
        fake.session.sessionId = `sid-${opts.sessionPath ?? opts.cwd}`;
        fake.session.sessionFile = opts.sessionPath ?? `/tmp/${created.length}.jsonl`;
        fake.runtime.cwd = opts.cwd;
        const dispose = vi.fn(async () => {
          await fake.runtime.dispose();
        });
        fake.runtime.dispose = dispose;
        created.push({ key: opts.sessionPath ?? opts.cwd, dispose });
        return fake.runtime;
      },
    });

    await host.start({ cwd: "/p", sessionPath: "/tmp/a.jsonl", sessionKey: "file:/tmp/a.jsonl" });
    await host.start({ cwd: "/p", sessionPath: "/tmp/b.jsonl", sessionKey: "file:/tmp/b.jsonl" });

    expect(host.listLiveSessions()).toHaveLength(2);
    expect(created[0]!.dispose).not.toHaveBeenCalled();
    expect(created[1]!.dispose).not.toHaveBeenCalled();

    await host.focusSession("file:/tmp/a.jsonl");
    expect(host.snapshot().session.sessionFile).toBe("/tmp/a.jsonl");
    expect(host.listLiveSessions()).toHaveLength(2);
  });

  test("previewSession reads a file tail without creating a live slot", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "pi-preview-"));
    const sessionPath = join(dir, "chat.jsonl");
    const entries = [
      { type: "session", version: 3, id: "sid-preview", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/p" },
      { type: "message", id: "u0", parentId: null, timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: "hello", id: "u0" } },
      { type: "message", id: "a0", parentId: "u0", timestamp: "2026-01-01T00:00:02.000Z", message: { role: "assistant", content: "hi", id: "a0" } },
    ];
    writeFileSync(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
    const host = new PiHost({ workspaceId: "workspace-1" });
    const snap = host.previewSession({ cwd: "/p", sessionPath });
    expect(snap.preview).toBe(true);
    expect(snap.session.sessionId).toBe("sid-preview");
    expect(snap.timeline.some((item) => item.kind === "user")).toBe(true);
    expect(host.listLiveSessions()).toHaveLength(0);
  });

  test("focusSession({ includeTimeline: false }) skips timeline hydrate", async () => {
    const history = [
      { role: "user", id: "u0", content: "hello" },
      { role: "assistant", id: "a0", content: "world" },
    ];
    const host = new PiHost({
      workspaceId: "workspace-1",
      runtimeFactory: async (opts) => {
        const fake = createFakeRuntime(opts.cwd, history);
        fake.session.sessionFile = opts.sessionPath;
        fake.session.sessionId = "sid-a";
        fake.runtime.cwd = opts.cwd;
        return fake.runtime;
      },
    });
    await host.start({ cwd: "/p", sessionPath: "/tmp/a.jsonl", sessionKey: "file:/tmp/a.jsonl" });
    const full = await host.focusSession("file:/tmp/a.jsonl");
    expect(full.timeline.length).toBeGreaterThan(0);
    const light = await host.focusSession("file:/tmp/a.jsonl", { includeTimeline: false });
    expect(light.timeline).toEqual([]);
    expect(light.session.sessionId).toBe(full.session.sessionId);
    expect(light.resources).toBeDefined();
  });

  test("multi-session: disposeSession removes one slot only", async () => {
    const host = new PiHost({
      workspaceId: "workspace-1",
      runtimeFactory: async (opts) => {
        const fake = createFakeRuntime();
        fake.session.sessionFile = opts.sessionPath;
        fake.session.sessionId = opts.sessionPath ?? "x";
        fake.runtime.cwd = opts.cwd;
        return fake.runtime;
      },
    });
    await host.start({ cwd: "/p", sessionPath: "/tmp/a.jsonl", sessionKey: "k1" });
    await host.start({ cwd: "/p", sessionPath: "/tmp/b.jsonl", sessionKey: "k2" });
    await host.disposeSession("k1");
    expect(host.listLiveSessions().map((s) => s.sessionKey)).toEqual(["k2"]);
  });

  test("multi-session: events carry sessionKey", async () => {
    let emitA: ((e: unknown) => void) | undefined;
    const host = new PiHost({
      workspaceId: "workspace-1",
      runtimeFactory: async (opts) => {
        const fake = createFakeRuntime();
        fake.session.sessionFile = opts.sessionPath;
        fake.session.sessionId = "sid-a";
        fake.runtime.cwd = opts.cwd;
        if (opts.sessionPath === "/tmp/a.jsonl") {
          emitA = fake.emit;
        }
        return fake.runtime;
      },
    });
    const events: Array<{ type: string; sessionKey?: string }> = [];
    host.subscribe((event) => events.push({ type: event.type, sessionKey: event.sessionKey }));

    await host.start({ cwd: "/p", sessionPath: "/tmp/a.jsonl", sessionKey: "key-a" });
    events.length = 0;
    emitA?.({ type: "turn_start" });
    expect(events.some((e) => e.type === "turn_started" && e.sessionKey === "key-a")).toBe(true);
  });

  test("multi-session: reusing same sessionPath does not create a second slot", async () => {
    let factoryCalls = 0;
    const host = new PiHost({
      workspaceId: "workspace-1",
      runtimeFactory: async (opts) => {
        factoryCalls += 1;
        const fake = createFakeRuntime();
        fake.session.sessionFile = opts.sessionPath;
        fake.session.sessionId = "same";
        fake.runtime.cwd = opts.cwd;
        return fake.runtime;
      },
    });
    await host.start({ cwd: "/p", sessionPath: "/tmp/a.jsonl", sessionKey: "file:/tmp/a.jsonl" });
    await host.start({ cwd: "/p", sessionPath: "/tmp/a.jsonl", sessionKey: "file:/tmp/a.jsonl" });
    expect(factoryCalls).toBe(1);
    expect(host.listLiveSessions()).toHaveLength(1);
  });
});

describe("PiHost todo nudge", () => {
  test("steers a nudge once a turn crosses the tool threshold with no todos", async () => {
    const fake = createFakeRuntime();
    new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime, todoNudgeThreshold: 3 });

    fake.emit({ type: "turn_start" });
    fake.emit({ type: "tool_execution_end", toolCallId: "t1", toolName: "bash", isError: false, result: "ok" });
    fake.emit({ type: "tool_execution_end", toolCallId: "t2", toolName: "read", isError: false, result: "ok" });
    expect(fake.session.getSteeringMessages()).toEqual([]);

    fake.emit({ type: "tool_execution_end", toolCallId: "t3", toolName: "bash", isError: false, result: "ok" });
    expect(fake.session.getSteeringMessages()).toHaveLength(1);
    expect(fake.session.getSteeringMessages()[0]).toContain("todowrite");

    // Only once per turn, no matter how many more tools run.
    fake.emit({ type: "tool_execution_end", toolCallId: "t4", toolName: "bash", isError: false, result: "ok" });
    expect(fake.session.getSteeringMessages()).toHaveLength(1);
  });

  test("does not nudge when a todo list already exists", async () => {
    const fake = createFakeRuntime();
    new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime, todoNudgeThreshold: 2 });

    fake.emit({
      type: "tool_execution_end",
      toolCallId: "td",
      toolName: "todowrite",
      isError: false,
      result: {
        content: [{ type: "text", text: "ok" }],
        details: {
          todos: [{ id: "1", content: "Do it", status: "in_progress", priority: "high" }],
          updatedAt: "2026-08-08T00:00:00.000Z",
        },
      },
    });

    fake.emit({ type: "turn_start" });
    fake.emit({ type: "tool_execution_end", toolCallId: "t1", toolName: "bash", isError: false, result: "ok" });
    fake.emit({ type: "tool_execution_end", toolCallId: "t2", toolName: "bash", isError: false, result: "ok" });
    expect(fake.session.getSteeringMessages()).toEqual([]);
  });

  test("uses a lower threshold for fast models", async () => {
    const fake = createFakeRuntime();
    fake.session.model = { provider: "deepseek", id: "deepseek-v4-flash" };
    new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime, todoNudgeThreshold: 8, todoNudgeFastThreshold: 2 });

    fake.emit({ type: "turn_start" });
    fake.emit({ type: "tool_execution_end", toolCallId: "t1", toolName: "bash", isError: false, result: "ok" });
    fake.emit({ type: "tool_execution_end", toolCallId: "t2", toolName: "bash", isError: false, result: "ok" });
    expect(fake.session.getSteeringMessages()).toHaveLength(1);
  });

  test("resets the nudge budget on each new turn", async () => {
    const fake = createFakeRuntime();
    new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime, todoNudgeThreshold: 2 });

    fake.emit({ type: "turn_start" });
    fake.emit({ type: "tool_execution_end", toolCallId: "t1", toolName: "bash", isError: false, result: "ok" });
    fake.emit({ type: "tool_execution_end", toolCallId: "t2", toolName: "bash", isError: false, result: "ok" });
    expect(fake.session.getSteeringMessages()).toHaveLength(1);

    fake.emit({ type: "turn_start" });
    fake.emit({ type: "tool_execution_end", toolCallId: "t3", toolName: "bash", isError: false, result: "ok" });
    fake.emit({ type: "tool_execution_end", toolCallId: "t4", toolName: "bash", isError: false, result: "ok" });
    expect(fake.session.getSteeringMessages()).toHaveLength(2);
  });

  test("ignores todo tools when counting toward the threshold", async () => {
    const fake = createFakeRuntime();
    new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime, todoNudgeThreshold: 2 });

    fake.emit({ type: "turn_start" });
    fake.emit({ type: "tool_execution_end", toolCallId: "tr1", toolName: "todoread", isError: false, result: {} });
    fake.emit({ type: "tool_execution_end", toolCallId: "tr2", toolName: "todoread", isError: false, result: {} });
    fake.emit({ type: "tool_execution_end", toolCallId: "tr3", toolName: "todoread", isError: false, result: {} });
    expect(fake.session.getSteeringMessages()).toEqual([]);
  });
});

describe("PiHost todo reconcile on turn end", () => {
  const todoResult = (todos: Array<{ id: string; content: string; status: string }>) => ({
    content: [{ type: "text", text: "ok" }],
    details: { todos, updatedAt: "2026-08-08T00:00:00.000Z" },
  });

  test("closes an in_progress todo when a worked turn settles normally", async () => {
    const fake = createFakeRuntime();
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });
    const events: Array<{ type: string; payload?: unknown }> = [];
    host.subscribe((event) => events.push({ type: event.type, payload: event.payload }));

    fake.emit({
      type: "tool_execution_end",
      toolCallId: "td",
      toolName: "todowrite",
      isError: false,
      result: todoResult([
        { id: "t1", content: "Explore", status: "in_progress" },
        { id: "t2", content: "Implement", status: "completed" },
      ]),
    });
    fake.emit({ type: "turn_start" });
    fake.emit({ type: "tool_execution_end", toolCallId: "w1", toolName: "bash", isError: false, result: "ok" });

    fake.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }], willRetry: false });

    expect(host.snapshot().session.todos?.map((t) => t.status)).toEqual(["completed", "completed"]);
    const last = events.filter((e) => e.type === "todos_updated").at(-1)?.payload as { todos: Array<{ status: string }> };
    expect(last.todos.map((t) => t.status)).toEqual(["completed", "completed"]);
    expect(fake.session.getSteeringMessages().join(" ")).toContain("todoupdate");
  });

  test("persists the reconciled list into the session trace", async () => {
    const fake = createFakeRuntime();
    new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });

    fake.emit({
      type: "tool_execution_end",
      toolCallId: "td",
      toolName: "todowrite",
      isError: false,
      result: todoResult([{ id: "t1", content: "Explore", status: "in_progress" }]),
    });
    fake.emit({ type: "turn_start" });
    fake.emit({ type: "tool_execution_end", toolCallId: "w1", toolName: "bash", isError: false, result: "ok" });

    fake.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }], willRetry: false });

    expect(fake.customEntries).toHaveLength(1);
    const entry = fake.customEntries[0]!;
    expect(entry.customType).toBe("session-todo");
    expect(entry.display).toBe(false);
    expect(entry.content).toContain("reconciled");
    const todos = (entry.details as { todos: Array<{ status: string }> }).todos;
    expect(todos.map((t) => t.status)).toEqual(["completed"]);
  });

  test("leaves todos untouched when the turn errors out", async () => {
    const fake = createFakeRuntime();
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });

    fake.emit({
      type: "tool_execution_end",
      toolCallId: "td",
      toolName: "todowrite",
      isError: false,
      result: todoResult([{ id: "t1", content: "Explore", status: "in_progress" }]),
    });
    fake.emit({ type: "turn_start" });
    fake.emit({ type: "tool_execution_end", toolCallId: "w1", toolName: "bash", isError: false, result: "ok" });

    fake.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error", errorMessage: "boom" }], willRetry: false });

    expect(host.snapshot().session.todos?.[0]?.status).toBe("in_progress");
    expect(fake.session.getSteeringMessages()).toEqual([]);
  });

  test("does not reconcile when the turn did no real work", async () => {
    const fake = createFakeRuntime();
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });

    fake.emit({
      type: "tool_execution_end",
      toolCallId: "td",
      toolName: "todowrite",
      isError: false,
      result: todoResult([{ id: "t1", content: "Explore", status: "in_progress" }]),
    });
    fake.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }], willRetry: false });

    expect(host.snapshot().session.todos?.[0]?.status).toBe("in_progress");
  });

  test("reconciles even when the final model segment had no tools", async () => {
    const fake = createFakeRuntime();
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });

    fake.emit({
      type: "tool_execution_end",
      toolCallId: "td",
      toolName: "todowrite",
      isError: false,
      result: todoResult([{ id: "t1", content: "Explore", status: "in_progress" }]),
    });
    fake.emit({ type: "agent_start" });
    fake.emit({ type: "turn_start" });
    fake.emit({ type: "tool_execution_end", toolCallId: "w1", toolName: "bash", isError: false, result: "ok" });
    // Pi emits turn_start per model call; the final segment (summary only) has
    // no tools, so a per-turn counter would be 0 here and skip the reconcile.
    fake.emit({ type: "turn_start" });

    fake.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }], willRetry: false });

    expect(host.snapshot().session.todos?.[0]?.status).toBe("completed");
  });
});

describe("PiHost todo reconcile on session open", () => {
  const todoHistory = (overrides: {
    trailing?: unknown[];
    workAfterWrite?: boolean;
    stopReason?: string;
  } = {}) => {
    const messages: unknown[] = [
      {
        role: "toolResult",
        toolName: "todowrite",
        isError: false,
        details: {
          todos: [
            { id: "f1", content: "Fix flicker", status: "in_progress", priority: "high" },
            { id: "f2", content: "Verify", status: "pending", priority: "medium" },
          ],
          updatedAt: "2026-08-13T00:00:00.000Z",
        },
      },
    ];
    if (overrides.workAfterWrite !== false) {
      messages.push({ role: "toolResult", toolName: "bash", isError: false, content: "ok" });
    }
    messages.push({
      role: "assistant",
      content: [{ type: "text", text: "Done." }],
      stopReason: overrides.stopReason ?? "stop",
    });
    if (overrides.trailing) messages.push(...overrides.trailing);
    return messages;
  };

  test("closes a stale in_progress todo when the last turn settled", () => {
    const fake = createFakeRuntime("/tmp/project", todoHistory());
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });

    expect(host.snapshot().session.todos?.map((t) => t.status)).toEqual(["completed", "pending"]);
    expect(fake.customEntries).toHaveLength(1);
    const todos = (fake.customEntries[0]!.details as { todos: Array<{ status: string }> }).todos;
    expect(todos.map((t) => t.status)).toEqual(["completed", "pending"]);
  });

  test("leaves todos untouched when a user message follows the settled answer", () => {
    const fake = createFakeRuntime("/tmp/project", todoHistory({
      trailing: [{ role: "user", content: "keep going" }],
    }));
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });

    expect(host.snapshot().session.todos?.[0]?.status).toBe("in_progress");
    expect(fake.customEntries).toHaveLength(0);
  });

  test("leaves todos untouched when the last turn stopped mid-tools", () => {
    const fake = createFakeRuntime("/tmp/project", todoHistory({ stopReason: "toolUse" }));
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });

    expect(host.snapshot().session.todos?.[0]?.status).toBe("in_progress");
    expect(fake.customEntries).toHaveLength(0);
  });

  test("leaves todos untouched when no tool work happened after the todo write", () => {
    const fake = createFakeRuntime("/tmp/project", todoHistory({ workAfterWrite: false }));
    const host = new PiHost({ workspaceId: "workspace-1", runtime: fake.runtime });

    expect(host.snapshot().session.todos?.[0]?.status).toBe("in_progress");
    expect(fake.customEntries).toHaveLength(0);
  });
});

function makeOAuthAuthRuntime() {
  const runtime = {
    getAvailable: async () => [],
    getProviders: () => [],
    getProvider: (id: string) => ({
      id,
      name: "Anthropic",
      auth: {
        oauth: {
          login: async (interaction: { prompt: (p: unknown) => Promise<string>; notify: (e: unknown) => void }) => {
            interaction.notify({ type: "auth_url", url: "https://auth.example.com/start", instructions: "Authorize" });
            const answer = await interaction.prompt({
              type: "select",
              message: "How do you want to log in?",
              options: [
                { id: "browser", label: "Browser login (default)" },
                { id: "device", label: "Device code login (headless)" },
              ],
            });
            interaction.notify({ type: "progress", message: "Exchanging code…" });
            return { type: "oauth", providerId: id, name: "Anthropic", token: "tok", answer };
          },
        },
      },
    }),
    getProviderAuthStatus: (_id: string) => ({ configured: false }),
    listCredentials: async () => [],
    login: async (id: string, _type: string, interaction: { prompt: (p: unknown) => Promise<string>; notify: (e: unknown) => void }) =>
      runtime.getProvider(id).auth.oauth.login(interaction),
    logout: async () => undefined,
  };
  return runtime;
}
