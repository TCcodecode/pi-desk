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
import {
  canAdmitTab,
  canBePreview,
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

export async function activateTab(tabId: string): Promise<void> {
  const api = getPiApi();
  const workspace = useWorkspaceStore.getState();
  const tabsAfterCommit = workspace.commitActiveMeta(useAppStore.getState().session);
  const tab = tabsAfterCommit.find((item) => item.id === tabId);
  if (!tab) return;
  const activation = nextActivation();
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
  useWorkspaceStore.getState().setSessionLoading(true);
  try {
    const project = useAppStore.getState().projects?.find((item) => item.id === tab.projectId);
    const cwd = project?.path ?? tab.projectId;

    let sessionPath = tab.sessionFile;
    if (!sessionPath && tab.sessionId && api?.listSessions) {
      const list = await api.listSessions(cwd);
      sessionPath = list.find((item) => item.sessionId === tab.sessionId)?.sessionFile;
    }

    const nextLiveHit =
      liveHit ??
      (sessionPath
        ? findLiveSessionForTab({ ...tab, sessionFile: sessionPath })
        : undefined);

    let snap: PiSnapshot | undefined;
    if (nextLiveHit && api?.focusSession) {
      snap = await api.focusSession(nextLiveHit.sessionKey) as PiSnapshot | undefined;
    } else if (sessionPath) {
      snap = await api?.startSession({ cwd, sessionPath, sessionKey: tabId });
    } else {
      snap = await api?.startSession({ cwd, sessionKey: tabId });
    }
    if (!isCurrentActivation(activation)) return;
    if (
      snap &&
      !sessionBelongsToTab(
        { ...tab, sessionFile: tab.sessionFile ?? sessionPath },
        {
          sessionId: snap.session.sessionId,
          sessionFile: snap.session.sessionFile,
          projectId: snap.session.cwd,
        },
      )
    ) {
      throw new Error("Loaded session does not belong to the selected tab");
    }
    applySnapshot(snap);
    useWorkspaceStore.getState().setSessionLoading(false);

    useWorkspaceStore.getState().setActiveTabId(tabId);
    const state = useAppStore.getState();
    const patched = dedupeTabs(useWorkspaceStore.getState().tabs.map((item) => {
      if (item.id !== tabId) return item;
      const status = state.session.status ?? item.status;
      const committed =
        item.pinned ||
        isCommitted(item.id) ||
        status === "running" ||
        status === "awaiting_approval";
      return {
        ...item,
        sessionId: state.session.sessionId || item.sessionId,
        sessionFile: state.session.sessionFile || item.sessionFile || sessionPath,
        title: state.session.name?.trim() ? state.session.name : item.title,
        status,
        isPreview: committed ? false : true,
      };
    }), tabId);
    useWorkspaceStore.getState().replaceWorkingSet(touchTab(patched, tabId), tabId);

    if (api?.listLiveSessions) {
      useWorkspaceStore.getState().setLiveSessions(await api.listLiveSessions());
    }
  } catch (error) {
    useWorkspaceStore.getState().setSessionLoading(false);
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
  const tabId = useWorkspaceStore.getState().activeTabId;
  if (!tabId) return undefined;
  const tab = useWorkspaceStore.getState().tabs.find((item) => item.id === tabId);
  if (!tab) return undefined;
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
  useWorkspaceStore.getState().replaceWorkingSet(reserved.tabs, reserved.activeTabId);

  const started = await api?.startSession({ cwd: project.path, sessionKey });
  if (!isCurrentActivation(navigation)) return;
  applySnapshot(started);
  await api?.newSession({ sessionKey });
  if (!isCurrentActivation(navigation)) return;
  const snap = await api?.getSnapshot();
  if (!isCurrentActivation(navigation)) return;
  applySnapshot(snap);
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
      isPreview: canBePreview(catalogSession?.status),
    },
    useWorkspaceStore.getState().activeTabId,
  );
  if (!reserved.ok) {
    pushError(reserved.message);
    return;
  }
  useWorkspaceStore.getState().replaceWorkingSet(reserved.tabs, reserved.activeTabId);
  if (catalogSession?.status === "running" || catalogSession?.status === "awaiting_approval") {
    markCommitted(reserved.activeTabId);
  }

  useWorkspaceStore.getState().setSessionLoading(true);
  let snap;
  try {
    snap = await api?.startSession({ cwd, sessionPath, sessionKey });
  } catch (error) {
    useWorkspaceStore.getState().setSessionLoading(false);
    pushError(error instanceof Error ? error.message : String(error));
    return;
  }
  if (!isCurrentActivation(navigation)) return;
  applySnapshot(snap);
  useWorkspaceStore.getState().setSessionLoading(false);
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
      isPreview: canBePreview(snap.session.status),
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
  applySnapshot(await api.getSnapshot());
  const project = useAppStore.getState().projects?.find((item) => item.id === projectId);
  await refreshSessionList(project?.path ?? projectId);
  if (tab) await closeWorkspaceTab(tab.id);
  else useWorkspaceStore.getState().removeBySessionFile(sessionPath);
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
  applySnapshot(snap);
  const project = useAppStore.getState().projects?.find((item) => item.id === projectId);
  await refreshSessionList(project?.path ?? useAppStore.getState().session.cwd);
  if (snap) syncTabFromSession(snap.session, projectId, snap.session.name);
}

export { markCommitted };
