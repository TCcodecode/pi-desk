import type { PiSnapshot } from "../../shared/protocol";
import {
  closeTab as closeTabInList,
  dedupeTabs,
  displayTabTitle,
  ensureInWorkingSet,
  patchTab,
  sameSessionIdentity,
  sessionBelongsToTab,
  sortTabsPinnedFirst,
  touchTab,
} from "./sessionTabs";
import { getPiApi } from "../app/piApi";
import { useAppStore } from "../session/store";
import { applySnapshotToView, createView } from "../session/views";
import {
  canAdmitTab,
  isCommitted,
  isCurrentActivation,
  markCommitted,
  nextActivation,
  syncTabFromSession,
  useWorkspaceStore,
  type SessionTab,
} from "./workspaceStore";

function pushError(message: string): void {
  useAppStore.getState().applyEvent({
    eventId: `error-${Date.now()}`,
    workspaceId: "local",
    timestamp: new Date().toISOString(),
    sequence: Date.now(),
    type: "session_error",
    payload: { message },
  });
}

export function applySnapshot(snapshot: PiSnapshot | undefined): void {
  if (!snapshot) return;
  const current = useAppStore.getState();
  useAppStore.getState().replaceSnapshot({
    ...current,
    ...snapshot,
    session: { ...current.session, ...snapshot.session },
  });
  if (snapshot.projects?.length) {
    useAppStore.setState({
      projects: snapshot.projects,
      activeProjectId: snapshot.activeProjectId ?? snapshot.projects[0]?.id,
    });
  }
}

function clearForegroundSession(): void {
  const state = useAppStore.getState();
  useAppStore.getState().replaceSnapshot({
    ...state,
    session: {
      ...state.session,
      sessionId: "",
      name: "Untitled session",
      status: "idle",
      sessionFile: undefined,
    },
    timeline: [],
    toolCalls: {},
    queue: { steering: [], followUp: [] },
  });
}

function findLiveSessionForTab(tab: SessionTab) {
  if (useAppStore.getState().getView(tab.id)?.cold) return undefined;
  const hit = useWorkspaceStore.getState().findLiveForTab(tab);
  if (hit) return hit;
  const current = useAppStore.getState().session;
  const activeTabId = useWorkspaceStore.getState().activeTabId;
  if (
    activeTabId === tab.id &&
    current.sessionId &&
    (
      (tab.sessionFile && current.sessionFile && tab.sessionFile === current.sessionFile) ||
      (tab.sessionId && tab.sessionId === current.sessionId) ||
      (!tab.sessionFile && !tab.sessionId)
    )
  ) {
    return {
      sessionKey: tab.id,
      sessionId: current.sessionId,
      sessionFile: current.sessionFile,
      cwd: current.cwd,
      projectId: tab.projectId,
      name: current.name,
      status: current.status,
    };
  }
  return undefined;
}

const inflightStarts = new Map<string, Promise<unknown>>();

function trackStart<T>(key: string, work: Promise<T>): Promise<T> {
  inflightStarts.set(key, work);
  return work.finally(() => {
    if (inflightStarts.get(key) === work) inflightStarts.delete(key);
  });
}

export function dropViewAndMaybeDispose(key: string): void {
  const live = useWorkspaceStore.getState().liveSessions.find((item) => item.sessionKey === key);
  const view = useAppStore.getState().getView(key);
  const status = live?.status ?? view?.session.status;
  useAppStore.getState().dropView(key);
  if (status === "running" || status === "awaiting_approval") return;
  void getPiApi()?.disposeSession?.(key);
}

async function loadSnapshotForTab(tab: SessionTab): Promise<PiSnapshot | undefined> {
  const api = getPiApi();
  const project = useAppStore.getState().projects?.find((item) => item.id === tab.projectId);
  const cwd = project?.path ?? tab.projectId;
  let sessionPath = tab.sessionFile;
  if (!sessionPath && tab.sessionId && api?.listSessions) {
    const list = await api.listSessions(cwd);
    sessionPath = list.find((item) => item.sessionId === tab.sessionId)?.sessionFile;
  }
  const liveHit =
    findLiveSessionForTab(tab) ??
    (sessionPath ? findLiveSessionForTab({ ...tab, sessionFile: sessionPath }) : undefined);
  if (liveHit && api?.focusSession) {
    return api.focusSession(liveHit.sessionKey) as Promise<PiSnapshot | undefined>;
  }
  if (sessionPath && api?.previewSession) {
    return api.previewSession({ cwd, sessionPath });
  }
  if (sessionPath) {
    return api?.startSession({ cwd, sessionPath, sessionKey: tab.id });
  }
  return api?.startSession({ cwd, sessionKey: tab.id });
}

function patchOpenedTab(tabId: string, snap: PiSnapshot, sessionPath?: string): void {
  const state = useAppStore.getState();
  const patched = dedupeTabs(useWorkspaceStore.getState().tabs.map((item) => {
    if (item.id !== tabId) return item;
    const status = snap.session.status ?? item.status;
    const committed =
      item.pinned ||
      isCommitted(item.id) ||
      status === "running" ||
      status === "awaiting_approval";
    return {
      ...item,
      sessionId: snap.session.sessionId || item.sessionId,
      sessionFile: snap.session.sessionFile || item.sessionFile || sessionPath,
      title: snap.session.name?.trim() ? snap.session.name : item.title,
      status,
      isPreview: committed ? false : item.isPreview,
    };
  }), tabId);
  useWorkspaceStore.getState().replaceWorkingSet(touchTab(patched, tabId), useWorkspaceStore.getState().activeTabId);
  void state;
}

export async function activateTab(tabId: string): Promise<void> {
  const api = getPiApi();
  const tabsAfterCommit = useWorkspaceStore.getState().commitActiveMeta(useAppStore.getState().session);
  const tab = tabsAfterCommit.find((item) => item.id === tabId);
  if (!tab) return;
  const previousActiveTabId = useWorkspaceStore.getState().activeTabId;
  const liveHit = findLiveSessionForTab(tab);
  if (
    tab.id === previousActiveTabId &&
    liveHit &&
    tab.sessionId &&
    tab.sessionId === useAppStore.getState().session.sessionId
  ) {
    useWorkspaceStore.getState().replaceWorkingSet(touchTab(tabsAfterCommit, tabId), tabId);
    return;
  }

  useWorkspaceStore.getState().setActiveTabId(tabId);
  const view = useAppStore.getState().getView(tabId);

  if (view?.hydrate === "ready") {
    useAppStore.getState().bindForeground(tabId);
    useWorkspaceStore.getState().replaceWorkingSet(touchTab(tabsAfterCommit, tabId), tabId);
    if (findLiveSessionForTab(tab)) {
      const activation = nextActivation();
      void api?.focusSession?.(tabId, { includeTimeline: false }).then(async (snap) => {
        if (!isCurrentActivation(activation)) return;
        if (useWorkspaceStore.getState().activeTabId !== tabId) return;
        useAppStore.getState().applyWorkspaceSnapshot(snap);
        if (snap.session.cwd && api.listSessions) {
          useAppStore.setState({ sessions: await api.listSessions(snap.session.cwd) });
        }
      }).catch((error) => {
        pushError(error instanceof Error ? error.message : String(error));
      });
      return;
    }
    const pending = inflightStarts.get(tabId);
    if (pending) {
      await pending;
      return;
    }
    return;
  }

  if (view?.hydrate === "loading") {
    useAppStore.getState().bindForeground(tabId);
    return;
  }

  const activation = nextActivation();
  useAppStore.getState().putView(createView(tabId, { hydrate: "loading", title: tab.title }));
  useAppStore.getState().bindForeground(tabId);
  try {
    const snap = await loadSnapshotForTab(tab);
    const current = useAppStore.getState().getView(tabId);
    if (!current || current.hydrate !== "loading") return;
    if (!snap) throw new Error("Failed to load session");
    if (
      !sessionBelongsToTab(
        { ...tab, sessionFile: tab.sessionFile ?? snap.session.sessionFile },
        {
          sessionId: snap.session.sessionId,
          sessionFile: snap.session.sessionFile,
          projectId: snap.session.cwd,
        },
      )
    ) {
      throw new Error("Loaded session does not belong to the selected tab");
    }
    useAppStore.getState().putView(applySnapshotToView(current, snap));
    if (useWorkspaceStore.getState().activeTabId === tabId) {
      useAppStore.getState().bindForeground(tabId);
    }
    patchOpenedTab(tabId, snap, tab.sessionFile);
    if (api?.listLiveSessions) {
      useWorkspaceStore.getState().setLiveSessions(await api.listLiveSessions());
    }
  } catch (error) {
    const current = useAppStore.getState().getView(tabId);
    if (current) {
      useAppStore.getState().putView({
        ...current,
        hydrate: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      if (useWorkspaceStore.getState().activeTabId === tabId) {
        useAppStore.getState().bindForeground(tabId);
      }
    }
    if (isCurrentActivation(activation) && useWorkspaceStore.getState().activeTabId === tabId) {
      const fallbackTabId = tabsAfterCommit.some((item) => item.id === previousActiveTabId)
        ? previousActiveTabId
        : undefined;
      useWorkspaceStore.getState().setActiveTabId(fallbackTabId);
    }
    pushError(error instanceof Error ? error.message : String(error));
  }
}

export async function closeWorkspaceTab(tabId: string): Promise<void> {
  const wasActive = useWorkspaceStore.getState().activeTabId === tabId;
  if (wasActive) nextActivation();
  dropViewAndMaybeDispose(tabId);
  const result = closeTabInList(
    useWorkspaceStore.getState().tabs,
    tabId,
    useWorkspaceStore.getState().activeTabId,
  );
  useWorkspaceStore.getState().replaceWorkingSet(result.tabs, result.activeTabId);
  if (!wasActive) return;
  if (result.activeTabId) {
    useWorkspaceStore.getState().setActiveTabId(tabId);
    await activateTab(result.activeTabId);
    return;
  }
  useWorkspaceStore.getState().setActiveTabId(undefined);
  try {
    clearForegroundSession();
  } catch {
    // ignore
  }
}

export async function closeWorkspaceTabs(tabIds: string[], preferredTabId?: string): Promise<void> {
  const ids = new Set(tabIds);
  if (ids.size === 0) return;

  const tabsBefore = useWorkspaceStore.getState().commitActiveMeta(useAppStore.getState().session);
  const previousActiveId = useWorkspaceStore.getState().activeTabId;
  if (previousActiveId && ids.has(previousActiveId)) nextActivation();
  const remaining = tabsBefore.filter((tab) => !ids.has(tab.id));
  let nextActiveId = previousActiveId && !ids.has(previousActiveId) ? previousActiveId : undefined;
  if (!nextActiveId && preferredTabId && remaining.some((tab) => tab.id === preferredTabId)) {
    nextActiveId = preferredTabId;
  }
  if (!nextActiveId && remaining.length > 0) {
    const previousIndex = tabsBefore.findIndex((tab) => tab.id === previousActiveId);
    nextActiveId = remaining[Math.min(Math.max(previousIndex, 0), remaining.length - 1)]?.id;
  }

  for (const id of ids) dropViewAndMaybeDispose(id);
  useWorkspaceStore.getState().replaceWorkingSet(remaining, nextActiveId);
  useWorkspaceStore.getState().setActiveTabId(previousActiveId);

  if (nextActiveId && nextActiveId !== previousActiveId) {
    await activateTab(nextActiveId);
    return;
  }
  if (nextActiveId) return;

  useWorkspaceStore.getState().setActiveTabId(undefined);
  try {
    clearForegroundSession();
  } catch {
    // ignore
  }
}

export function closeOtherTabs(tabId: string): Promise<void> {
  const ids = useWorkspaceStore.getState().tabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id);
  return closeWorkspaceTabs(ids, tabId);
}

export function closeTabsToRight(tabId: string): Promise<void> {
  const ordered = sortTabsPinnedFirst(useWorkspaceStore.getState().tabs);
  const index = ordered.findIndex((tab) => tab.id === tabId);
  if (index < 0) return Promise.resolve();
  return closeWorkspaceTabs(ordered.slice(index + 1).map((tab) => tab.id), tabId);
}

export function toggleWorkspacePin(tabId: string): void {
  useWorkspaceStore.getState().togglePin(tabId);
}

export async function ensureActiveTabRuntime(): Promise<string | undefined> {
  const api = getPiApi();
  const tabId = useWorkspaceStore.getState().activeTabId;
  if (!tabId) return undefined;
  const tab = useWorkspaceStore.getState().tabs.find((item) => item.id === tabId);
  if (!tab) return undefined;
  const view = useAppStore.getState().getView(tabId);
  const pending = inflightStarts.get(tabId);
  if (pending) {
    await pending;
    return tabId;
  }
  if (view?.hydrate === "ready" && findLiveSessionForTab(tab)) return tabId;
  if (view?.cold && tab.sessionFile) {
    const project = useAppStore.getState().projects?.find((item) => item.id === tab.projectId);
    const cwd = project?.path ?? tab.projectId;
    const started = await trackStart(
      tabId,
      api?.startSession({ cwd, sessionPath: tab.sessionFile, sessionKey: tabId }) ?? Promise.resolve(undefined),
    );
    if (started) {
      const current = useAppStore.getState().getView(tabId);
      if (current) {
        useAppStore.getState().putView({
          ...current,
          cold: false,
          session: { ...current.session, ...started.session },
        });
      }
    }
    if (findLiveSessionForTab(useWorkspaceStore.getState().tabs.find((item) => item.id === tabId) ?? tab)
      || useAppStore.getState().getView(tabId)?.session.sessionId) {
      return tabId;
    }
  }
  if (view?.hydrate === "loading" || (view?.hydrate === "ready" && !findLiveSessionForTab(tab))) {
    await activateTab(tabId);
    if (findLiveSessionForTab(useWorkspaceStore.getState().tabs.find((item) => item.id === tabId) ?? tab)) {
      return tabId;
    }
  }
  if (findLiveSessionForTab(tab)) return tabId;
  await activateTab(tabId);
  const refreshed = useWorkspaceStore.getState().tabs.find((item) => item.id === tabId);
  if (refreshed && findLiveSessionForTab(refreshed)) return tabId;
  if (useWorkspaceStore.getState().activeTabId === tabId && useAppStore.getState().session.sessionId) {
    return tabId;
  }
  throw new Error("当前会话尚未成功启动，请先激活该标签页后再试。");
}

export async function startNewSession(projectId: string): Promise<void> {
  const api = getPiApi();
  const project = useAppStore.getState().projects?.find((item) => item.id === projectId);
  if (!project) {
    pushError("Project not found");
    return;
  }
  useWorkspaceStore.getState().commitActiveMeta(useAppStore.getState().session);
  const navigation = nextActivation();
  if (!canAdmitTab({})) {
    pushError("Working set full (9 pinned). Unpin a tab to open another.");
    return;
  }
  const sessionKey = `tmp:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const reserved = ensureInWorkingSet(
    useWorkspaceStore.getState().tabs,
    {
      id: sessionKey,
      sessionId: "",
      projectId: project.id,
      title: "Untitled",
      isPreview: true,
    },
    useWorkspaceStore.getState().activeTabId,
  );
  if (!reserved.ok) {
    pushError(reserved.message);
    return;
  }
  if (reserved.evicted) dropViewAndMaybeDispose(reserved.evicted.id);
  useWorkspaceStore.getState().replaceWorkingSet(reserved.tabs, reserved.activeTabId);
  useAppStore.getState().putView(createView(sessionKey, { hydrate: "ready", title: "Untitled" }));
  useAppStore.getState().bindForeground(sessionKey);

  const started = await trackStart(
    sessionKey,
    api?.startSession({ cwd: project.path, sessionKey }) ?? Promise.resolve(undefined),
  );
  if (!isCurrentActivation(navigation)) return;
  if (started) {
    const current = useAppStore.getState().getView(sessionKey) ?? createView(sessionKey, { hydrate: "ready" });
    useAppStore.getState().putView({
      ...current,
      session: { ...current.session, ...started.session },
    });
    if (useWorkspaceStore.getState().activeTabId === sessionKey) {
      useAppStore.getState().bindForeground(sessionKey);
    }
  }
  await api?.newSession({ sessionKey });
  if (!isCurrentActivation(navigation)) return;
  const snap = started;
  if (snap) {
    const patched = patchTab(useWorkspaceStore.getState().tabs, sessionKey, {
      sessionId: snap.session.sessionId,
      sessionFile: snap.session.sessionFile,
      title: displayTabTitle(snap.session.name, "Untitled"),
      status: snap.session.status,
    });
    useWorkspaceStore.getState().replaceWorkingSet(touchTab(patched, sessionKey), sessionKey);
  }
  if (api?.listLiveSessions) {
    useWorkspaceStore.getState().setLiveSessions(await api.listLiveSessions());
  }
}

export async function openWorkspaceSession(
  sessionPath: string,
  projectId: string,
  sessionId?: string,
): Promise<void> {
  const api = getPiApi();
  const project = useAppStore.getState().projects?.find((item) => item.id === projectId);
  const cwd = project?.path ?? projectId;
  if (!sessionPath) {
    pushError("This session has no saved file path");
    return;
  }
  useWorkspaceStore.getState().commitActiveMeta(useAppStore.getState().session);
  const navigation = nextActivation();
  const catalogSession = useAppStore.getState().sessions.find(
    (item) => item.sessionFile === sessionPath,
  );
  const requestedSessionId = sessionId?.trim() || catalogSession?.sessionId;
  const sessionProjectId = project?.id ?? projectId;
  const existing = useWorkspaceStore.getState().tabs.find((item) =>
    sameSessionIdentity(item, {
      id: "",
      sessionId: requestedSessionId ?? "",
      sessionFile: sessionPath,
      projectId: sessionProjectId,
    }),
  );
  if (existing) {
    const patched = patchTab(useWorkspaceStore.getState().tabs, existing.id, {
      sessionId: existing.sessionId || requestedSessionId,
      sessionFile: existing.sessionFile || sessionPath,
    });
    useWorkspaceStore.getState().replaceWorkingSet(patched, existing.id);
    await activateTab(existing.id);
    return;
  }
  if (!canAdmitTab({ sessionFile: sessionPath, sessionId: requestedSessionId, projectId: sessionProjectId })) {
    pushError("Working set full (9 pinned). Unpin a tab to open another.");
    return;
  }
  const sessionKey = `file:${sessionPath}`;
  const reserved = ensureInWorkingSet(
    useWorkspaceStore.getState().tabs,
    {
      id: sessionKey,
      sessionId: requestedSessionId ?? "",
      sessionFile: sessionPath,
      projectId: sessionProjectId,
      title: displayTabTitle(catalogSession?.name, "Session"),
      status: catalogSession?.status,
      isPreview: false,
    },
    useWorkspaceStore.getState().activeTabId,
  );
  if (!reserved.ok) {
    pushError(reserved.message);
    return;
  }
  if (reserved.evicted) dropViewAndMaybeDispose(reserved.evicted.id);
  useWorkspaceStore.getState().replaceWorkingSet(reserved.tabs, reserved.activeTabId);
  if (catalogSession?.status === "running" || catalogSession?.status === "awaiting_approval") {
    markCommitted(reserved.activeTabId);
  }

  useAppStore.getState().putView(createView(sessionKey, {
    hydrate: "loading",
    title: displayTabTitle(catalogSession?.name, "Session"),
  }));
  useAppStore.getState().bindForeground(sessionKey);
  let snap;
  try {
    snap = await trackStart(
      sessionKey,
      api?.previewSession
        ? api.previewSession({ cwd, sessionPath })
        : api?.startSession({ cwd, sessionPath, sessionKey }) ?? Promise.resolve(undefined),
    );
  } catch (error) {
    const current = useAppStore.getState().getView(sessionKey);
    if (current) {
      useAppStore.getState().putView({
        ...current,
        hydrate: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
    pushError(error instanceof Error ? error.message : String(error));
    return;
  }
  if (!isCurrentActivation(navigation) && useAppStore.getState().getView(sessionKey)?.hydrate !== "loading") return;
  const current = useAppStore.getState().getView(sessionKey);
  if (snap && current?.hydrate === "loading") {
    useAppStore.getState().putView(applySnapshotToView(current, snap));
    if (useWorkspaceStore.getState().activeTabId === sessionKey) {
      useAppStore.getState().bindForeground(sessionKey);
    }
  }
  if (snap) {
    const title =
      snap.session.name ||
      useAppStore.getState().sessions.find((item) => item.sessionFile === sessionPath)?.name ||
      "Session";
    const patched = patchTab(useWorkspaceStore.getState().tabs, sessionKey, {
      sessionId: snap.session.sessionId,
      sessionFile: snap.session.sessionFile ?? sessionPath,
      title: displayTabTitle(title, "Session"),
      status: snap.session.status,
      isPreview: false,
    });
    if (snap.session.status === "running" || snap.session.status === "awaiting_approval") {
      markCommitted(sessionKey);
    }
    useWorkspaceStore.getState().replaceWorkingSet(patched, sessionKey);
  }
  if (api?.listLiveSessions) {
    useWorkspaceStore.getState().setLiveSessions(await api.listLiveSessions());
  }
}

export function defaultProjectId(): string | undefined {
  const { session, projects, activeProjectId } = useAppStore.getState();
  const fromCwd = session.cwd
    ? projects?.find((item) => item.path === session.cwd || item.id === session.cwd)?.id
    : undefined;
  return fromCwd ?? activeProjectId ?? projects?.[0]?.id;
}

export function requestNewSession(fallback?: () => void): void {
  const projectId = defaultProjectId();
  if (projectId) {
    void startNewSession(projectId);
    return;
  }
  fallback?.();
}

async function refreshSessionList(cwd?: string): Promise<void> {
  const api = getPiApi();
  const path = cwd ?? useAppStore.getState().session.cwd;
  if (path && api?.listSessions) {
    useAppStore.setState({ sessions: await api.listSessions(path) });
  }
}

export async function renameWorkspaceSession(sessionPath: string, name: string): Promise<string> {
  const api = getPiApi();
  if (!api?.renameSession) throw new Error("Rename is not available");
  const result = await api.renameSession(sessionPath, name);
  await refreshSessionList();
  useWorkspaceStore.getState().renameBySessionFile(sessionPath, result.name);
  return result.name;
}

export async function deleteWorkspaceSession(sessionPath: string, projectId: string): Promise<void> {
  const api = getPiApi();
  if (!api?.deleteSession) throw new Error("Delete is not available");
  const tab = useWorkspaceStore.getState().tabs.find((item) => item.sessionFile === sessionPath);
  await api.deleteSession(sessionPath);
  const project = useAppStore.getState().projects?.find((item) => item.id === projectId);
  await refreshSessionList(project?.path ?? projectId);
  if (tab) await closeWorkspaceTab(tab.id);
  else {
    useWorkspaceStore.getState().removeBySessionFile(sessionPath);
    const stale = Object.values(useAppStore.getState().views).find((view) => view.session.sessionFile === sessionPath);
    if (stale) dropViewAndMaybeDispose(stale.key);
  }
}

export async function cloneWorkspaceSession(
  session: { sessionId: string; sessionFile?: string },
  projectId: string,
): Promise<void> {
  const api = getPiApi();
  if (!api?.cloneSession) throw new Error("Clone is not available");
  if (session.sessionId !== useAppStore.getState().session.sessionId) {
    if (!session.sessionFile) throw new Error("Session has no file path");
    await openWorkspaceSession(session.sessionFile, projectId);
  }
  await api.cloneSession();
  const snap = await api.getSnapshot();
  const project = useAppStore.getState().projects?.find((item) => item.id === projectId);
  await refreshSessionList(project?.path ?? useAppStore.getState().session.cwd);
  if (snap) {
    const newTabId = syncTabFromSession(snap.session, projectId, snap.session.name);
    if (newTabId) {
      useAppStore.getState().putView(applySnapshotToView(createView(newTabId, { hydrate: "ready" }), snap));
      useWorkspaceStore.getState().setActiveTabId(newTabId);
      useAppStore.getState().bindForeground(newTabId);
    }
  }
}

export { markCommitted };
