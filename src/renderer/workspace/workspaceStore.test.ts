import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SessionTab } from "./sessionTabs";
import {
  alignActiveTabWithSession,
  canAdmitTab,
  isCurrentActivation,
  nextActivation,
  resetWorkspaceRuntime,
  useWorkspaceStore,
} from "./workspaceStore";

const tab = (id: string, extra: Partial<SessionTab> = {}): SessionTab => ({
  id,
  sessionId: `s-${id}`,
  sessionFile: `/${id}.jsonl`,
  projectId: "/tmp/project",
  title: id.toUpperCase(),
  ...extra,
});

describe("workspaceStore", () => {
  beforeEach(() => {
    localStorage.clear();
    resetWorkspaceRuntime();
    useWorkspaceStore.setState({
      tabs: [],
      activeTabId: undefined,
      liveSessions: [],
    });
  });

  afterEach(() => {
    localStorage.clear();
    resetWorkspaceRuntime();
  });

  test("replaceWorkingSet persists tabs and the active id", () => {
    useWorkspaceStore.getState().replaceWorkingSet([tab("a"), tab("b")], "b");

    expect(useWorkspaceStore.getState().tabs.map((item) => item.id)).toEqual(["a", "b"]);
    expect(useWorkspaceStore.getState().activeTabId).toBe("b");
    const saved = JSON.parse(localStorage.getItem("pi.openTabs") ?? "{}");
    expect(saved.activeTabId).toBe("b");
    expect(saved.tabs.map((item: SessionTab) => item.id)).toEqual(["a", "b"]);
  });

  test("togglePin marks a tab pinned without changing the active id", () => {
    useWorkspaceStore.getState().replaceWorkingSet([tab("a"), tab("b")], "a");
    useWorkspaceStore.getState().togglePin("b");

    expect(useWorkspaceStore.getState().tabs.find((item) => item.id === "b")?.pinned).toBe(true);
    expect(useWorkspaceStore.getState().activeTabId).toBe("a");
  });

  test("does not write stale session metadata into a tab while it is loading", () => {
    useWorkspaceStore.setState({
      tabs: [
        tab("1", {
          projectId: "/work/pi-workspace",
          sessionId: "pi-1",
          sessionFile: "/sessions/pi-1.jsonl",
          title: "1",
          pinned: true,
        }),
        tab("2", {
          projectId: "/work/etf-tc",
          sessionId: "etf-2",
          sessionFile: "/sessions/etf-2.jsonl",
          title: "2",
          pinned: true,
        }),
        tab("3", {
          projectId: "/work/etf-tc",
          sessionId: "etf-3",
          sessionFile: "/sessions/etf-3.jsonl",
          title: "3",
          pinned: true,
        }),
      ],
      activeTabId: "1",
    });

    alignActiveTabWithSession({
      sessionId: "etf-3",
      sessionFile: "/sessions/etf-3.jsonl",
      name: "3",
      status: "idle",
    } as Parameters<typeof alignActiveTabWithSession>[0]);

    const state = useWorkspaceStore.getState();
    expect(state.tabs.map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(state.tabs[0]).toMatchObject({
      sessionId: "pi-1",
      sessionFile: "/sessions/pi-1.jsonl",
      title: "1",
    });
  });

  test("admission treats session ids as project-scoped", () => {
    useWorkspaceStore.setState({
      tabs: Array.from({ length: 9 }, (_, index) => tab(`tab-${index}`, {
        projectId: index === 0 ? "/work/pi-workspace" : "/work/other",
        sessionId: index === 0 ? "shared" : `session-${index}`,
        sessionFile: `/sessions/${index}.jsonl`,
        pinned: true,
      })),
    });

    expect(canAdmitTab({
      projectId: "/work/etf-tc",
      sessionId: "shared",
      sessionFile: "/sessions/etf.jsonl",
    })).toBe(false);
    expect(canAdmitTab({
      projectId: "/work/pi-workspace",
      sessionId: "shared",
      sessionFile: "/sessions/pi.jsonl",
    })).toBe(true);
  });

  test("a newer activation invalidates an older one", () => {
    const first = nextActivation();
    const second = nextActivation();
    expect(isCurrentActivation(first)).toBe(false);
    expect(isCurrentActivation(second)).toBe(true);
  });
});

describe("activateTab stale generation", () => {
  beforeEach(() => {
    localStorage.clear();
    resetWorkspaceRuntime();
    useWorkspaceStore.setState({
      tabs: [tab("a"), tab("b")],
      activeTabId: "a",
      liveSessions: [],
    });
  });

  test("a slower older activate must not replace the tab the user selected later", async () => {
    const { activateTab } = await import("./workspaceActions");
    let releaseA: () => void = () => undefined;
    const aStarted = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const focusSession = vi.fn(async (sessionKey: string) => {
      if (sessionKey === "a") await aStarted;
      return {
        workspaceId: "local",
        session: {
          sessionId: `s-${sessionKey}`,
          sessionFile: `/${sessionKey}.jsonl`,
          cwd: "/tmp/project",
          name: sessionKey.toUpperCase(),
          status: "idle" as const,
        },
      };
    });

    window.pi = {
      focusSession,
      startSession: vi.fn(async ({ sessionKey }: { sessionKey?: string }) =>
        focusSession(sessionKey ?? "unknown"),
      ),
      previewSession: vi.fn(async ({ sessionPath }: { sessionPath: string }) =>
        focusSession(sessionPath.includes("/a.") ? "a" : "b"),
      ),
      listSessions: vi.fn(async () => []),
      listLiveSessions: vi.fn(async () => []),
    } as never;

    const older = activateTab("a");
    const newer = activateTab("b");
    await newer;
    releaseA();
    await older;

    expect(useWorkspaceStore.getState().activeTabId).toBe("b");
  });

  test("keeps all pinned tabs when selecting pi after two etf tabs with stale foreground metadata", async () => {
    const { activateTab } = await import("./workspaceActions");
    const { createInitialState, useAppStore } = await import("../session/store");
    const initial = createInitialState();
    const pinnedTabs = [
      tab("1", {
        projectId: "/work/pi-workspace",
        sessionId: "pi-1",
        sessionFile: "/sessions/pi-1.jsonl",
        title: "1",
        pinned: true,
      }),
      tab("2", {
        projectId: "/work/etf-tc",
        sessionId: "etf-2",
        sessionFile: "/sessions/etf-2.jsonl",
        title: "2",
        pinned: true,
      }),
      tab("3", {
        projectId: "/work/etf-tc",
        sessionId: "etf-3",
        sessionFile: "/sessions/etf-3.jsonl",
        title: "3",
        pinned: true,
      }),
    ];
    useWorkspaceStore.setState({
      tabs: pinnedTabs,
      activeTabId: "3",
      liveSessions: [],
    });
    // Reproduce the dangerous state: the foreground metadata has already
    // drifted to tab 1 while the workspace still considers tab 3 active.
    useAppStore.setState({
      ...initial,
      projects: [
        { id: "/work/pi-workspace", name: "pi-workspace", path: "/work/pi-workspace", updatedAt: "2026-08-17T00:00:00.000Z" },
        { id: "/work/etf-tc", name: "etf-tc", path: "/work/etf-tc", updatedAt: "2026-08-17T00:00:00.000Z" },
      ],
      activeProjectId: "/work/etf-tc",
      session: {
        ...initial.session,
        sessionId: "pi-1",
        sessionFile: "/sessions/pi-1.jsonl",
        cwd: "/work/pi-workspace",
        name: "1",
      },
    });

    const snap = {
      ...useAppStore.getState(),
      activeProjectId: "/work/pi-workspace",
      session: {
        ...useAppStore.getState().session,
        sessionId: "pi-1",
        sessionFile: "/sessions/pi-1.jsonl",
        cwd: "/work/pi-workspace",
        name: "1",
      },
      preview: true,
    };
    const startSession = vi.fn(async () => snap);
    const previewSession = vi.fn(async () => snap);
    window.pi = {
      startSession,
      previewSession,
      listSessions: vi.fn(async () => []),
      listLiveSessions: vi.fn(async () => []),
    } as never;

    await activateTab("1");

    const workspace = useWorkspaceStore.getState();
    expect(workspace.tabs.map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(workspace.tabs.every((item) => item.pinned)).toBe(true);
    expect(workspace.activeTabId).toBe("1");
    expect(startSession).not.toHaveBeenCalled();
    expect(previewSession).toHaveBeenCalledWith({
      cwd: "/work/pi-workspace",
      sessionPath: "/sessions/pi-1.jsonl",
    });
  });
});

describe("startNewSession and openWorkspaceSession", () => {
  beforeEach(async () => {
    const { createInitialState, useAppStore } = await import("../session/store");
    localStorage.clear();
    resetWorkspaceRuntime();
    useWorkspaceStore.setState({ tabs: [], activeTabId: undefined, liveSessions: [] });
    useAppStore.setState({
      ...createInitialState(),
      projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: "2026-08-16T00:00:00.000Z" }],
      activeProjectId: "/tmp/project",
    });
  });

  test("startNewSession reserves a preview tab and asks the host for a new session", async () => {
    const { useAppStore } = await import("../session/store");
    const { startNewSession } = await import("./workspaceActions");
    const startSession = vi.fn(async () => ({
      ...useAppStore.getState(),
      session: {
        ...useAppStore.getState().session,
        sessionId: "s-new",
        cwd: "/tmp/project",
        name: "Untitled",
      },
    }));
    const newSession = vi.fn(async () => undefined);
    window.pi = {
      startSession,
      newSession,
      getSnapshot: vi.fn(async () => ({
        ...useAppStore.getState(),
        session: { ...useAppStore.getState().session, sessionId: "s-new", cwd: "/tmp/project" },
      })),
      listLiveSessions: vi.fn(async () => []),
    } as never;

    await startNewSession("/tmp/project");

    expect(newSession).toHaveBeenCalledWith({ sessionKey: expect.any(String) });
    expect(useWorkspaceStore.getState().tabs).toHaveLength(1);
    expect(useWorkspaceStore.getState().tabs[0]?.projectId).toBe("/tmp/project");
  });

  test("new session does not focusSession before the host slot exists", async () => {
    const { useAppStore } = await import("../session/store");
    const { startNewSession, activateTab, ensureActiveTabRuntime } = await import("./workspaceActions");
    let releaseStart!: (snap: unknown) => void;
    const startSession = vi.fn(
      () => new Promise((resolve) => { releaseStart = resolve; }),
    );
    const focusSession = vi.fn(async (sessionKey: string) => {
      throw new Error(`Unknown sessionKey: ${sessionKey}`);
    });
    const newSession = vi.fn(async () => undefined);
    window.pi = {
      startSession,
      focusSession,
      newSession,
      listLiveSessions: vi.fn(async () => []),
    } as never;

    const pending = startNewSession("/tmp/project");
    await vi.waitFor(() => {
      expect(useWorkspaceStore.getState().tabs).toHaveLength(1);
    });
    const tabId = useWorkspaceStore.getState().activeTabId!;
    const duringStart = Promise.all([activateTab(tabId), ensureActiveTabRuntime()]);
    expect(focusSession).not.toHaveBeenCalled();

    releaseStart({
      ...useAppStore.getState(),
      session: {
        ...useAppStore.getState().session,
        sessionId: "s-new",
        cwd: "/tmp/project",
        name: "Untitled",
      },
    });
    await pending;
    await expect(duringStart).resolves.toEqual([undefined, tabId]);
    expect(focusSession).not.toHaveBeenCalled();
  });

  test("openWorkspaceSession focuses an existing tab instead of adding another", async () => {
    const { openWorkspaceSession } = await import("./workspaceActions");
    const { activateTab } = await import("./workspaceActions");
    const activateSpy = vi.spyOn({ activateTab }, "activateTab");
    void activateSpy;
    useWorkspaceStore.getState().replaceWorkingSet([
      tab("existing", { sessionFile: "/tmp/old.jsonl", sessionId: "s-old" }),
    ], "existing");

    const startSession = vi.fn(async () => undefined);
    window.pi = {
      startSession,
      focusSession: vi.fn(async () => ({ session: { sessionId: "s-old" } })),
      listSessions: vi.fn(async () => []),
      listLiveSessions: vi.fn(async () => []),
    } as never;

    await openWorkspaceSession("/tmp/old.jsonl", "/tmp/project", "s-old");

    expect(useWorkspaceStore.getState().tabs).toHaveLength(1);
    expect(useWorkspaceStore.getState().activeTabId).toBe("existing");
  });

  test("openWorkspaceSession puts a loading view while the snapshot is in flight", async () => {
    const { openWorkspaceSession } = await import("./workspaceActions");
    const { useAppStore } = await import("../session/store");

    let resolveStart!: (snap: unknown) => void;
    const previewSession = vi.fn(
      () => new Promise((resolve) => { resolveStart = resolve; }),
    );
    window.pi = {
      startSession: vi.fn(),
      previewSession,
      listLiveSessions: vi.fn(async () => []),
    } as never;

    const pending = openWorkspaceSession("/tmp/new.jsonl", "/tmp/project");
    expect(useAppStore.getState().views["file:/tmp/new.jsonl"]?.hydrate).toBe("loading");

    resolveStart({
      ...useAppStore.getState(),
      session: {
        ...useAppStore.getState().session,
        sessionId: "s-loaded",
        sessionFile: "/tmp/new.jsonl",
        cwd: "/tmp/project",
        name: "Loaded",
      },
    });
    await pending;

    expect(useAppStore.getState().views["file:/tmp/new.jsonl"]?.hydrate).toBe("ready");
  });
});

describe("rename, delete, and clone session", () => {
  beforeEach(async () => {
    const { createInitialState, useAppStore } = await import("../session/store");
    localStorage.clear();
    resetWorkspaceRuntime();
    useWorkspaceStore.setState({
      tabs: [tab("keep", { sessionFile: "/tmp/keep.jsonl", title: "Old name" })],
      activeTabId: "keep",
      liveSessions: [],
    });
    useAppStore.setState({
      ...createInitialState(),
      session: {
        ...createInitialState().session,
        sessionId: "s-keep",
        sessionFile: "/tmp/keep.jsonl",
        cwd: "/tmp/project",
        name: "Old name",
      },
      projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: "2026-08-16T00:00:00.000Z" }],
      activeProjectId: "/tmp/project",
      sessions: [],
    });
  });

  test("renameWorkspaceSession updates the matching tab title", async () => {
    const { renameWorkspaceSession } = await import("./workspaceActions");
    window.pi = {
      renameSession: vi.fn(async (_path: string, name: string) => ({ name })),
      listSessions: vi.fn(async () => []),
    } as never;

    await expect(renameWorkspaceSession("/tmp/keep.jsonl", "New name")).resolves.toBe("New name");
    expect(useWorkspaceStore.getState().tabs[0]?.title).toBe("New name");
  });

  test("deleteWorkspaceSession removes the matching tab", async () => {
    const { deleteWorkspaceSession } = await import("./workspaceActions");
    const { useAppStore } = await import("../session/store");
    window.pi = {
      deleteSession: vi.fn(async () => ({ sessionPath: "/tmp/keep.jsonl" })),
      getSnapshot: vi.fn(async () => useAppStore.getState()),
      listSessions: vi.fn(async () => []),
    } as never;

    await deleteWorkspaceSession("/tmp/keep.jsonl", "/tmp/project");
    expect(useWorkspaceStore.getState().tabs.some((item) => item.sessionFile === "/tmp/keep.jsonl")).toBe(false);
  });
});
