import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "./App";
import { createInitialState, useAppStore } from "../session/store";
import type { PiApi, PiEvent, PiSnapshot } from "../../shared/protocol";

function makeFakeApi() {
  const listeners = new Set<(event: PiEvent) => void>();
  const api: PiApi = {
    getSnapshot: vi.fn(async () => ({
      workspaceId: "local",
      session: useAppStore.getState().session,
      sessions: useAppStore.getState().sessions,
      projects: useAppStore.getState().projects ?? [],
      activeProjectId: useAppStore.getState().activeProjectId,
      timeline: useAppStore.getState().timeline,
      toolCalls: useAppStore.getState().toolCalls,
      queue: useAppStore.getState().queue,
      resources: { contextFiles: [], skills: [], promptTemplates: [], themes: [], extensions: [], packages: [] },
      diagnostics: { piVersion: "test", sequence: 0, messages: [], errors: [] },
      models: [],
      tools: [],
    })),
    chooseWorkspace: vi.fn(async () => "/tmp/project"),
    chooseFile: vi.fn(async () => undefined),
    chooseAttachmentFiles: vi.fn(async () => []),
    persistImageAttachment: vi.fn(async (input) => ({ path: `/tmp/${input.name}`, name: input.name })),
    loadImagePreview: vi.fn(async (path: string) => `data:image/png;base64,preview-${btoa(path)}`),
    startSession: vi.fn(async (options: { cwd: string; sessionPath?: string; sessionKey?: string }) => {
      listeners.forEach((listener) =>
        listener({
          eventId: "e1",
          workspaceId: "local",
          sessionId: "s1",
          sessionKey: options.sessionKey,
          timestamp: new Date().toISOString(),
          sequence: 1,
          type: "session_started",
          payload: { sessionId: "s1", cwd: options.cwd, sessionName: "Test session" },
        }),
      );
      return {
        ...useAppStore.getState(),
        session: {
          ...useAppStore.getState().session,
          sessionId: "s1",
          cwd: options.cwd,
          name: "Test session",
        },
        projects: [{ id: options.cwd, name: options.cwd.split("/").pop() ?? "project", path: options.cwd, updatedAt: new Date().toISOString() }],
        activeProjectId: options.cwd,
        sessions: [],
      };
    }),
    focusSession: vi.fn(async () => useAppStore.getState()),
    disposeSession: vi.fn(async () => undefined),
    listLiveSessions: vi.fn(async () => []),
    prompt: vi.fn(async (text: string) => {
      listeners.forEach((listener) =>
        listener({
          eventId: "e2",
          workspaceId: "local",
          sessionId: "s1",
          timestamp: new Date().toISOString(),
          sequence: 2,
          type: "user_message_created",
          payload: { messageId: "m1", content: text },
        }),
      );
    }),
    steer: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
    undoFileChange: vi.fn(async () => undefined),
    openFile: vi.fn(async () => undefined),
    editFollowUp: vi.fn(async () => undefined),
    sendFollowUpNow: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    newSession: vi.fn(async () => undefined),
    resumeSession: vi.fn(async () => undefined),
    forkSession: vi.fn(async () => undefined),
    cloneSession: vi.fn(async () => undefined),
    importSession: vi.fn(async () => undefined),
    compact: vi.fn(async () => undefined),
    setThinkingLevel: vi.fn(async () => undefined),
    setTools: vi.fn(async () => undefined),
    setSkills: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined),
    executeCommand: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    getCommands: vi.fn(async () => []),
    getModels: vi.fn(async () => []),
    getTools: vi.fn(async () => []),
    getResources: vi.fn(async () => ({ contextFiles: [], skills: [], promptTemplates: [], themes: [], extensions: [], packages: [] })),
    getSessionTree: vi.fn(async () => []),
    resolveTrust: vi.fn(async () => undefined),
    getGitBranch: vi.fn(async () => "main"),
    listProjects: vi.fn(async () => useAppStore.getState().projects ?? []),
    listSessions: vi.fn(async () => useAppStore.getState().sessions ?? []),
    listProjectFiles: vi.fn(async () => [{ path: "src/App.tsx", isDir: false }, { path: "src", isDir: true }]),
    renameSession: vi.fn(async (_path: string, name: string) => ({ name })),
    deleteSession: vi.fn(async (_path: string) => ({ sessionPath: _path })),
    getSessionContext: vi.fn(async () => ({ name: "session", context: "" })),
    listProviders: vi.fn(async () => []),
    getProviderUsage: vi.fn(async () => ({
      providerId: "",
      session: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0, contextTokens: 0, contextWindow: 0 },
      account: { mode: "unsupported" as const, providerId: "", reason: "no_adapter" as const },
    })),
    loginWithApiKey: vi.fn(async () => ({ name: "DeepSeek" })),
    logoutProvider: vi.fn(async () => undefined),
    loginWithOAuth: vi.fn(async () => ({ name: "Anthropic" })),
    answerAuthPrompt: vi.fn(async () => undefined),
    cancelProviderLogin: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    removeProject: vi.fn(async () => ({ projects: [], activeProjectId: undefined })),
    revealInFolder: vi.fn(async () => undefined),
    indexStatus: vi.fn(async () => ({ state: "idle" as const, filesIndexed: 0, symbolsIndexed: 0 })),
    indexRefresh: vi.fn(async () => ({ filesIndexed: 0, symbolsIndexed: 0, filesChanged: 0, filesDeleted: 0, durationMs: 0 })),
    indexSearch: vi.fn(async () => []),
    indexFindUsages: vi.fn(async () => []),
    getMcpConfig: vi.fn(async () => ({ cwd: "/tmp/project", sources: [], servers: [] })),
    setMcpServerEnabled: vi.fn(async () => ({ changed: false, path: "/tmp/project/.pi/mcp.json" })),
    importCursorMcp: vi.fn(async () => ({ imported: [], skipped: [] })),
    openMcpConfigFile: vi.fn(async () => undefined),
    getUpdateState: vi.fn(async () => ({ status: "idle" as const, currentVersion: "0.1.0" })),
    checkForUpdate: vi.fn(async () => undefined),
    downloadUpdate: vi.fn(async () => undefined),
    installUpdate: vi.fn(async () => undefined),
    onUpdateState: vi.fn(() => () => undefined),
    addProject: vi.fn(async () => {
      const snapshot = await api.startSession({ cwd: "/tmp/project" });
      return {
        ...snapshot,
        projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() }],
        activeProjectId: "/tmp/project",
      };
    }),
    selectProject: vi.fn(async (projectId: string) => api.startSession({ cwd: projectId })),
    setActiveProject: vi.fn(async (projectId: string) => ({
      projects: useAppStore.getState().projects ?? [],
      activeProjectId: projectId,
    })),
    onEvent: (listener: (event: PiEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { api };
}

describe("Pi Desktop end-to-end send flow", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("sends a prompt when a project is active", async () => {
    const { api } = makeFakeApi();
    (window as unknown as { pi: PiApi }).pi = api;
    useAppStore.setState({
      ...createInitialState(),
      session: { ...createInitialState().session, cwd: "/tmp/project" },
      projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() }],
      activeProjectId: "/tmp/project",
    });

    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: /message/i }), { target: { value: "inspect the tests" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(api.startSession).toHaveBeenCalledWith({ cwd: "/tmp/project" }));
    await waitFor(() =>
      expect(api.prompt).toHaveBeenCalledWith("inspect the tests", expect.objectContaining({ sessionKey: expect.any(String) })),
    );
    await waitFor(() => expect(screen.getByText("inspect the tests")).toBeInTheDocument());

    delete (window as unknown as { pi?: PiApi }).pi;
  });

  test("edits an interrupted user message inline and resubmits it in the current session", async () => {
    const { api } = makeFakeApi();
    (window as unknown as { pi: PiApi }).pi = api;
    useAppStore.setState({
      ...createInitialState(),
      session: {
        ...createInitialState().session,
        sessionId: "s1",
        cwd: "/tmp/project",
        status: "idle",
      },
      projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() }],
      activeProjectId: "/tmp/project",
      timeline: [
        { id: "user-1", kind: "user", content: "first prompt", status: "completed" },
        { id: "assistant-1", kind: "assistant", content: "done", status: "completed" },
        { id: "user-2", kind: "user", content: "retry this", status: "completed" },
      ],
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /edit interrupted message/i }));
    expect(screen.getByRole("textbox", { name: /edit interrupted message/i })).toHaveValue("retry this");

    fireEvent.change(screen.getByRole("textbox", { name: /edit interrupted message/i }), {
      target: { value: "retry this with logs" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save interrupted message/i }));

    await waitFor(() => expect(api.startSession).not.toHaveBeenCalled());
    await waitFor(() => expect(api.prompt).toHaveBeenCalled());
    expect(vi.mocked(api.prompt).mock.calls[0]?.[0]).toBe("retry this with logs");

    delete (window as unknown as { pi?: PiApi }).pi;
  });

  test("still exposes copy and edit for the latest user message after a stopped partial assistant reply", async () => {
    const { api } = makeFakeApi();
    (window as unknown as { pi: PiApi }).pi = api;
    useAppStore.setState({
      ...createInitialState(),
      session: {
        ...createInitialState().session,
        sessionId: "s1",
        cwd: "/tmp/project",
        status: "idle",
      },
      projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() }],
      activeProjectId: "/tmp/project",
      timeline: [
        { id: "user-1", kind: "user", content: "first prompt", status: "completed" },
        { id: "assistant-1", kind: "assistant", content: "done", status: "completed" },
        { id: "user-2", kind: "user", content: "retry this", status: "completed" },
        { id: "assistant-2", kind: "assistant", content: "partial answer", status: "completed" },
      ],
    });

    render(<App />);

    expect(screen.getByRole("button", { name: /copy interrupted message/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /edit interrupted message/i }));
    expect(screen.getByRole("textbox", { name: /edit interrupted message/i })).toHaveValue("retry this");

    delete (window as unknown as { pi?: PiApi }).pi;
  });

  test("submits image attachments as internal prompt refs instead of visible textarea paths", async () => {
    const { api } = makeFakeApi();
    vi.mocked(api.chooseFile).mockResolvedValue("/tmp/shot-a.png");
    (window as unknown as { pi: PiApi }).pi = api;
    useAppStore.setState({
      ...createInitialState(),
      session: {
        ...createInitialState().session,
        sessionId: "s1",
        cwd: "/tmp/project",
        status: "idle",
      },
      projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() }],
      activeProjectId: "/tmp/project",
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /attach file/i }));
    expect(await screen.findByLabelText(/attachment preview shot-a\.png/i)).toBeInTheDocument();

    const input = screen.getByRole("textbox", { name: /message/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "describe this" } });
    expect(input.value).toBe("describe this");

    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(api.prompt).toHaveBeenCalled());
    expect(vi.mocked(api.prompt).mock.calls[0]?.[0]).toBe("describe this\n@/tmp/shot-a.png");
    await waitFor(() => expect(input.value).toBe(""));

    delete (window as unknown as { pi?: PiApi }).pi;
  });

  test("queues while running and can send a queued item now", async () => {
    const { api } = makeFakeApi();
    (window as unknown as { pi: PiApi }).pi = api;
    useAppStore.setState({
      ...createInitialState(),
      session: { ...createInitialState().session, sessionId: "s1", cwd: "/tmp/project", status: "running" },
      projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() }],
      activeProjectId: "/tmp/project",
      queue: { steering: [], followUp: ["inspect the result"] },
    });

    render(<App />);
    await waitFor(() => expect(screen.getByText("inspect the result")).toBeInTheDocument());

    fireEvent.change(screen.getByRole("textbox", { name: /message/i }), { target: { value: "also check tests" } });
    fireEvent.click(screen.getByRole("button", { name: /queue follow-up/i }));
    await waitFor(() => expect(api.followUp).toHaveBeenCalled());
    expect(vi.mocked(api.followUp).mock.calls[0]?.[0]).toBe("also check tests");

    fireEvent.click(screen.getByRole("button", { name: /send queued message 1 now/i }));
    await waitFor(() => expect(api.sendFollowUpNow).toHaveBeenCalled());
    expect(vi.mocked(api.sendFollowUpNow).mock.calls[0]?.[0]).toBe(0);
    expect(vi.mocked(api.sendFollowUpNow).mock.calls[0]?.[2]).toBe("inspect the result");

    delete (window as unknown as { pi?: PiApi }).pi;
  });

  test("⌘W closes (detaches) the active tab without aborting or disposing", async () => {
    const { api } = makeFakeApi();
    (window as unknown as { pi: PiApi }).pi = api;
    useAppStore.setState({
      ...createInitialState(),
      session: { ...createInitialState().session, cwd: "/tmp/project" },
      projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() }],
      activeProjectId: "/tmp/project",
    });

    render(<App />);
    // Send a message so a session tab gets seeded.
    fireEvent.change(screen.getByRole("textbox", { name: /message/i }), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(screen.getAllByRole("tab").length).toBeGreaterThan(0));

    // ⌘W closes the active tab…
    fireEvent.keyDown(window, { key: "w", metaKey: true });
    await waitFor(() => expect(screen.queryAllByRole("tab")).toHaveLength(0));

    // …and it is a detach: the host runtime is neither aborted nor disposed.
    expect(api.abort).not.toHaveBeenCalled();
    expect(api.disposeSession).not.toHaveBeenCalled();

    delete (window as unknown as { pi?: PiApi }).pi;
  });

  test("restored history stays replaceable until the user sends in this tab", async () => {
    const { api } = makeFakeApi();
    const project = { id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() };
    const historicalTimeline = [
      { id: "old-user", kind: "user" as const, content: "old prompt", status: "completed" as const },
    ];
    vi.mocked(api.startSession).mockImplementation(async ({ cwd, sessionPath }) => ({
      ...useAppStore.getState(),
      session: {
        ...useAppStore.getState().session,
        sessionId: sessionPath ? "s-history" : "s-new",
        sessionFile: sessionPath,
        cwd,
        name: sessionPath ? "Historical task" : "New task",
        status: "idle",
      },
      timeline: sessionPath ? historicalTimeline : [],
      projects: [project],
      activeProjectId: project.id,
      sessions: [],
    }));
    (window as unknown as { pi: PiApi }).pi = api;
    localStorage.setItem(
      "pi.openTabs",
      JSON.stringify({
        tabs: [
          {
            id: "tab-history",
            sessionId: "s-history",
            sessionFile: "/tmp/history.jsonl",
            projectId: project.id,
            title: "Historical task",
            isPreview: false,
          },
        ],
        activeTabId: "tab-history",
      }),
    );
    useAppStore.setState({
      ...createInitialState(),
      projects: [project],
      activeProjectId: project.id,
      sessions: [{
        sessionId: "s-history",
        cwd: project.path,
        name: "Historical task",
        status: "idle",
        model: "",
        thinkingLevel: "medium",
        messageCount: 1,
        updatedAt: new Date().toISOString(),
        sessionFile: "/tmp/history.jsonl",
      }],
    });

    render(<App />);
    await waitFor(() =>
      expect(api.startSession).toHaveBeenCalledWith({
        cwd: project.path,
        sessionPath: "/tmp/history.jsonl",
        sessionKey: "tab-history",
      }),
    );
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("pi.openTabs") ?? "{}");
      expect(saved.tabs?.[0]).toMatchObject({ id: "tab-history", isPreview: true });
    });

    fireEvent.keyDown(window, { key: "n", metaKey: true });
    await waitFor(() => expect(api.newSession).toHaveBeenCalledWith({ sessionKey: expect.any(String) }));
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("pi.openTabs") ?? "{}");
      expect(saved.tabs).toHaveLength(1);
      expect(saved.tabs[0]?.id).not.toBe("tab-history");
    });

    delete (window as unknown as { pi?: PiApi }).pi;
  });

  test("closing the active tab opens its neighbor without copying the closed session onto it", async () => {
    const { api } = makeFakeApi();
    vi.mocked(api.startSession).mockImplementation(async ({ cwd, sessionPath }) => {
      const isSecond = sessionPath === "/tmp/b.jsonl";
      return {
        ...useAppStore.getState(),
        session: {
          ...useAppStore.getState().session,
          sessionId: isSecond ? "s-b" : "s-a",
          sessionFile: sessionPath,
          cwd,
          name: isSecond ? "Second task" : "First task",
        },
        projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() }],
        activeProjectId: "/tmp/project",
        sessions: [],
      };
    });
    (window as unknown as { pi: PiApi }).pi = api;
    localStorage.setItem(
      "pi.openTabs",
      JSON.stringify({
        tabs: [
          { id: "tab-a", sessionId: "s-a", sessionFile: "/tmp/a.jsonl", projectId: "/tmp/project", title: "First task", isPreview: false },
          { id: "tab-b", sessionId: "s-b", sessionFile: "/tmp/b.jsonl", projectId: "/tmp/project", title: "Second task", isPreview: false },
        ],
        activeTabId: "tab-a",
      }),
    );
    useAppStore.setState({
      ...createInitialState(),
      session: {
        ...createInitialState().session,
        sessionId: "s-a",
        sessionFile: "/tmp/a.jsonl",
        cwd: "/tmp/project",
        name: "First task",
      },
      projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() }],
      activeProjectId: "/tmp/project",
    });

    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Close First task" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Close First task" }));

    await waitFor(() =>
      expect(api.startSession).toHaveBeenCalledWith({
        cwd: "/tmp/project",
        sessionPath: "/tmp/b.jsonl",
        sessionKey: "tab-b",
      }),
    );
    await waitFor(() => expect(screen.getByText("Second task")).toBeInTheDocument());
    expect(screen.queryByText("First task")).not.toBeInTheDocument();

    delete (window as unknown as { pi?: PiApi }).pi;
  });

  test("keeps the most recently selected tab when an earlier switch resolves late", async () => {
    const { api } = makeFakeApi();
    const snapshotFor = (sessionId: string, sessionFile: string, name: string): PiSnapshot => ({
      ...useAppStore.getState(),
      session: {
        ...useAppStore.getState().session,
        sessionId,
        sessionFile,
        cwd: "/tmp/project",
        name,
      },
      projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() }],
      activeProjectId: "/tmp/project",
      sessions: [],
    });
    let resolveSecond: ((snapshot: PiSnapshot) => void) | undefined;
    let resolveThird: ((snapshot: PiSnapshot) => void) | undefined;
    vi.mocked(api.startSession).mockImplementation(({ sessionPath }) => {
      if (sessionPath === "/tmp/b.jsonl") {
        return new Promise<PiSnapshot>((resolve) => { resolveSecond = resolve; });
      }
      if (sessionPath === "/tmp/c.jsonl") {
        return new Promise<PiSnapshot>((resolve) => { resolveThird = resolve; });
      }
      return Promise.resolve(snapshotFor("s-a", "/tmp/a.jsonl", "First task"));
    });
    (window as unknown as { pi: PiApi }).pi = api;
    localStorage.setItem(
      "pi.openTabs",
      JSON.stringify({
        tabs: [
          { id: "tab-a", sessionId: "s-a", sessionFile: "/tmp/a.jsonl", projectId: "/tmp/project", title: "First task", isPreview: false },
          { id: "tab-b", sessionId: "s-b", sessionFile: "/tmp/b.jsonl", projectId: "/tmp/project", title: "Second task", isPreview: false },
          { id: "tab-c", sessionId: "s-c", sessionFile: "/tmp/c.jsonl", projectId: "/tmp/project", title: "Third task", isPreview: false },
        ],
        activeTabId: "tab-a",
      }),
    );
    useAppStore.setState({
      ...createInitialState(),
      session: {
        ...createInitialState().session,
        sessionId: "s-a",
        sessionFile: "/tmp/a.jsonl",
        cwd: "/tmp/project",
        name: "First task",
      },
      projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() }],
      activeProjectId: "/tmp/project",
    });

    render(<App />);
    await waitFor(() => expect(screen.getByText("Second task")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Second task"));
    await waitFor(() => expect(resolveSecond).toBeDefined());
    fireEvent.click(screen.getByText("Third task"));
    await waitFor(() => expect(resolveThird).toBeDefined());

    await act(async () => { resolveThird?.(snapshotFor("s-c", "/tmp/c.jsonl", "Third task")); });
    await waitFor(() => expect(useAppStore.getState().session.sessionId).toBe("s-c"));
    await act(async () => { resolveSecond?.(snapshotFor("s-b", "/tmp/b.jsonl", "Second task")); });

    await waitFor(() => expect(useAppStore.getState().session.sessionId).toBe("s-c"));
    expect(screen.getByText("Third task").closest('[role="tab"]')).toHaveAttribute("aria-selected", "true");

    delete (window as unknown as { pi?: PiApi }).pi;
  });

  test("⌘N starts a new session in the active project", async () => {
    const { api } = makeFakeApi();
    (window as unknown as { pi: PiApi }).pi = api;
    useAppStore.setState({
      ...createInitialState(),
      session: { ...createInitialState().session, cwd: "/tmp/project" },
      projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() }],
      activeProjectId: "/tmp/project",
    });

    render(<App />);
    fireEvent.keyDown(window, { key: "n", metaKey: true });

    await waitFor(() =>
      expect(api.startSession).toHaveBeenCalledWith({ cwd: "/tmp/project", sessionKey: expect.any(String) }),
    );
    await waitFor(() => expect(api.newSession).toHaveBeenCalledWith({ sessionKey: expect.any(String) }));

    delete (window as unknown as { pi?: PiApi }).pi;
  });

  test("closes an unused unpinned tab before opening the next session", async () => {
    const { api } = makeFakeApi();
    (window as unknown as { pi: PiApi }).pi = api;
    useAppStore.setState({
      ...createInitialState(),
      session: { ...createInitialState().session, cwd: "/tmp/project" },
      projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() }],
      activeProjectId: "/tmp/project",
    });

    render(<App />);
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    await waitFor(() => expect(api.newSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));

    fireEvent.keyDown(window, { key: "n", metaKey: true });
    await waitFor(() => expect(api.newSession).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));

    delete (window as unknown as { pi?: PiApi }).pi;
  });

  test("opens a project when sending without one", async () => {
    const { api } = makeFakeApi();
    (window as unknown as { pi: PiApi }).pi = api;
    useAppStore.setState(createInitialState());

    render(<App />);
    fireEvent.change(screen.getByRole("textbox", { name: /message/i }), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(api.addProject).toHaveBeenCalled());
    await waitFor(() =>
      expect(api.prompt).toHaveBeenCalledWith("hello", expect.objectContaining({ sessionKey: expect.any(String) })),
    );

    delete (window as unknown as { pi?: PiApi }).pi;
  });

  test("runs a built-in command selected from the slash picker", async () => {
    const { api } = makeFakeApi();
    vi.mocked(api.getCommands).mockResolvedValue([
      { id: "compact", name: "/compact", description: "Compact context", source: "builtin" },
    ]);
    (window as unknown as { pi: PiApi }).pi = api;
    useAppStore.setState({
      ...createInitialState(),
      session: { ...createInitialState().session, sessionId: "s1", cwd: "/tmp/project" },
      projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() }],
      activeProjectId: "/tmp/project",
    });

    render(<App />);
    const input = screen.getByRole("textbox", { name: /message/i });
    fireEvent.change(input, { target: { value: "/compact" } });
    fireEvent.click(await screen.findByRole("option", { name: /compact/i }));
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(api.executeCommand).toHaveBeenCalledWith("/compact", ""));
    expect(api.prompt).not.toHaveBeenCalled();

    delete (window as unknown as { pi?: PiApi }).pi;
  });

  test("runs a skill command selected from the slash picker through the session prompt", async () => {
    const { api } = makeFakeApi();
    vi.mocked(api.getCommands).mockResolvedValue([
      { id: "skill:watch", name: "/skill:watch", description: "Watch a video", source: "skill" },
    ]);
    (window as unknown as { pi: PiApi }).pi = api;
    useAppStore.setState({
      ...createInitialState(),
      session: { ...createInitialState().session, sessionId: "s1", cwd: "/tmp/project" },
      projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() }],
      activeProjectId: "/tmp/project",
    });

    render(<App />);
    const input = screen.getByRole("textbox", { name: /message/i });
    fireEvent.change(input, { target: { value: "/skill:watch" } });
    fireEvent.click(await screen.findByRole("option", { name: /skill:watch/i }));
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(api.prompt).toHaveBeenCalledWith("/skill:watch", expect.objectContaining({ sessionKey: expect.any(String) })));
    expect(api.executeCommand).not.toHaveBeenCalled();

    delete (window as unknown as { pi?: PiApi }).pi;
  });

  test("shows project tree with nested sessions", async () => {
    const { api } = makeFakeApi();
    (window as unknown as { pi: PiApi }).pi = api;
    useAppStore.setState({
      ...createInitialState(),
      projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() }],
      activeProjectId: "/tmp/project",
      sessions: [{ sessionId: "s1", cwd: "/tmp/project", name: "First session", status: "idle", model: "", thinkingLevel: "medium", messageCount: 1, updatedAt: new Date().toISOString(), sessionFile: "/tmp/a.jsonl" }],
    });

    render(<App />);
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getAllByText("project").length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText("First session")).toBeInTheDocument());
    expect(screen.getByRole("searchbox", { name: /search sessions/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select project project" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("button", { name: /new task in project/i }).length).toBeGreaterThan(0);

    delete (window as unknown as { pi?: PiApi }).pi;
  });
});

describe("Timeline jump-to-latest pill", () => {
  test("appears when the user scrolls away from the bottom and dismisses on jump", async () => {
    const { api } = makeFakeApi();
    (window as unknown as { pi: PiApi }).pi = api;
    useAppStore.setState({
      ...createInitialState(),
      session: { ...createInitialState().session, cwd: "/tmp/project" },
      projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() }],
      activeProjectId: "/tmp/project",
      timeline: [
        { id: "u1", kind: "user", content: "Hello", status: "completed" },
        { id: "a1", kind: "assistant", content: "Hi there", status: "completed" },
      ],
    });

    const { container } = render(<App />);
    const wrap = container.querySelector(".timeline-wrap")!;
    expect(wrap).not.toBeNull();
    // jsdom reports 0 layout; simulate a tall scrollable list.
    Object.defineProperty(wrap, "scrollHeight", { value: 5000, configurable: true });
    Object.defineProperty(wrap, "clientHeight", { value: 600, configurable: true });
    Object.defineProperty(wrap, "scrollTop", { value: 4000, configurable: true });
    wrap.scrollTo = vi.fn();

    expect(screen.queryByRole("button", { name: /jump to latest/i })).not.toBeInTheDocument();
    fireEvent.scroll(wrap);
    expect(screen.getByRole("button", { name: /jump to latest/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /jump to latest/i }));
    expect(wrap.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
    expect(screen.queryByRole("button", { name: /jump to latest/i })).not.toBeInTheDocument();

    delete (window as unknown as { pi?: PiApi }).pi;
  });
});
