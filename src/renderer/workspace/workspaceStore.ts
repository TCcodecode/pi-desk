import { create } from "zustand";
import type { LiveSessionSummary, SessionState, SessionStatus, SessionSummary } from "../../shared/protocol";
import {
  WORKING_SET_LIMIT,
  dedupeTabs,
  displayTabTitle,
  ensureInWorkingSet,
  loadOpenTabs,
  patchTab,
  promotePreviewTab,
  saveOpenTabs,
  sameSessionIdentity,
  sessionBelongsToTab,
  togglePinTab,
  touchTab,
  type SessionTab,
} from "./sessionTabs";

export function canBePreview(status?: SessionStatus): boolean {
  return status !== "running" && status !== "awaiting_approval";
}

const loaded = loadOpenTabs();

let activationGeneration = 0;
const committedTabIds = new Set<string>();

export function nextActivation(): number {
  activationGeneration += 1;
  return activationGeneration;
}

export function isCurrentActivation(generation: number): boolean {
  return generation === activationGeneration;
}

export function markCommitted(tabId: string): void {
  committedTabIds.add(tabId);
}

export function isCommitted(tabId: string): boolean {
  return committedTabIds.has(tabId);
}

export function resetWorkspaceRuntime(): void {
  activationGeneration = 0;
  committedTabIds.clear();
}

function persist(tabs: SessionTab[], activeTabId?: string): void {
  saveOpenTabs(tabs, activeTabId);
}

export interface WorkspaceState {
  tabs: SessionTab[];
  activeTabId?: string;
  liveSessions: LiveSessionSummary[];
  replaceWorkingSet: (tabs: SessionTab[], activeTabId?: string) => void;
  setActiveTabId: (activeTabId?: string) => void;
  setLiveSessions: (sessions: LiveSessionSummary[]) => void;
  togglePin: (tabId: string) => void;
  promote: (tabId?: string) => void;
  patchStatus: (sessionKey: string, status: SessionStatus) => void;
  patchTabFields: (tabId: string, fields: Partial<SessionTab>) => void;
  renameBySessionFile: (sessionFile: string, title: string) => void;
  removeBySessionFile: (sessionFile: string) => void;
  commitActiveMeta: (session: SessionState, tabId?: string) => SessionTab[];
  findLiveForTab: (tab: SessionTab) => LiveSessionSummary | undefined;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  tabs: loaded.tabs,
  activeTabId: loaded.activeTabId,
  liveSessions: [],

  replaceWorkingSet(tabs, activeTabId) {
    const nextTabs = dedupeTabs(tabs, activeTabId);
    const nextActive = nextTabs.some((tab) => tab.id === activeTabId)
      ? activeTabId
      : nextTabs[0]?.id;
    persist(nextTabs, nextActive);
    set({ tabs: nextTabs, activeTabId: nextActive });
  },

  setActiveTabId(activeTabId) {
    persist(get().tabs, activeTabId);
    set({ activeTabId });
  },

  setLiveSessions(liveSessions) {
    set({ liveSessions });
  },

  togglePin(tabId) {
    const next = togglePinTab(get().tabs, tabId);
    if (next.find((tab) => tab.id === tabId)?.pinned) markCommitted(tabId);
    persist(next, get().activeTabId);
    set({ tabs: next });
  },

  promote(tabId) {
    const id = tabId ?? get().activeTabId;
    if (!id) return;
    markCommitted(id);
    const next = promotePreviewTab(get().tabs, id);
    persist(next, get().activeTabId);
    set({ tabs: next });
  },

  patchStatus(sessionKey, status) {
    if (status === "running" || status === "awaiting_approval") markCommitted(sessionKey);
    const next = dedupeTabs(get().tabs.map((tab) =>
      tab.id === sessionKey
        ? {
            ...tab,
            status,
            isPreview:
              status === "running" || status === "awaiting_approval" ? false : tab.isPreview,
          }
        : tab,
    ), sessionKey);
    persist(next, get().activeTabId);
    set({ tabs: next });
  },

  patchTabFields(tabId, fields) {
    const next = patchTab(get().tabs, tabId, fields);
    persist(next, get().activeTabId);
    set({ tabs: next });
  },

  renameBySessionFile(sessionFile, title) {
    const next = get().tabs.map((tab) =>
      tab.sessionFile === sessionFile ? { ...tab, title } : tab,
    );
    persist(next, get().activeTabId);
    set({ tabs: next });
  },

  removeBySessionFile(sessionFile) {
    const next = get().tabs.filter((tab) => tab.sessionFile !== sessionFile);
    persist(next, get().activeTabId);
    set({ tabs: next });
  },

  commitActiveMeta(session, tabId = get().activeTabId) {
    if (!tabId) return get().tabs;
    if (!session.sessionId && !session.sessionFile) return get().tabs;
    const target = get().tabs.find((item) => item.id === tabId);
    if (
      !target ||
      !sessionBelongsToTab(target, {
        sessionId: session.sessionId,
        sessionFile: session.sessionFile,
        projectId: session.cwd,
      })
    ) return get().tabs;
    const committed = get().tabs.map((item) => {
      if (item.id !== tabId) return item;
      const status = session.status ?? item.status;
      const kept =
        item.pinned ||
        isCommitted(item.id) ||
        status === "running" ||
        status === "awaiting_approval";
      return {
        ...item,
        sessionId: session.sessionId || item.sessionId,
        sessionFile: session.sessionFile || item.sessionFile,
        title: session.name?.trim() ? session.name : item.title,
        status,
        isPreview: kept ? false : item.isPreview,
      };
    });
    const next = dedupeTabs(committed, tabId);
    persist(next, get().activeTabId);
    set({ tabs: next });
    return next;
  },

  findLiveForTab(tab) {
    const live = get().liveSessions;
    if (tab.id) {
      const byKey = live.find((item) => item.sessionKey === tab.id);
      if (byKey) return byKey;
    }
    if (tab.sessionFile) {
      const byFile = live.find((item) => item.sessionFile === tab.sessionFile);
      if (byFile) return byFile;
    }
    return undefined;
  },
}));

export function canAdmitTab(incoming: { sessionId?: string; sessionFile?: string; projectId?: string }): boolean {
  const tabs = useWorkspaceStore.getState().tabs;
  const file = incoming.sessionFile?.trim() || "";
  const sessionId = incoming.sessionId?.trim() || "";
  const projectId = incoming.projectId?.trim() || "";
  if (file && tabs.some((item) => item.sessionFile === file)) return true;
  if (
    sessionId &&
    projectId &&
    tabs.some((item) =>
      sameSessionIdentity(item, {
        id: "",
        sessionId,
        sessionFile: undefined,
        projectId,
      }),
    )
  ) return true;
  if (tabs.length < WORKING_SET_LIMIT) return true;
  if (tabs.some((item) => !item.pinned)) return true;
  return false;
}

export function syncTabFromSession(
  session: SessionState,
  projectId: string,
  titleHint?: string,
): string | undefined {
  const { tabs, activeTabId, replaceWorkingSet } = useWorkspaceStore.getState();
  nextActivation();
  const result = ensureInWorkingSet(
    tabs,
    {
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
      projectId,
      title: displayTabTitle(session.name || titleHint, "Untitled"),
      status: session.status,
      isPreview: session.sessionFile ? false : canBePreview(session.status),
    },
    activeTabId,
  );
  if (!result.ok) return undefined;
  if (session.status === "running" || session.status === "awaiting_approval") {
    markCommitted(result.activeTabId);
  }
  replaceWorkingSet(result.tabs, result.activeTabId);
  return result.activeTabId;
}

export function alignActiveTabWithSession(session: SessionState): void {
  if (!session.cwd) return;
  const { tabs, activeTabId, replaceWorkingSet } = useWorkspaceStore.getState();
  if (!activeTabId) return;
  const current = tabs.find((item) => item.id === activeTabId);
  if (!current) return;
  if (!sessionBelongsToTab(current, {
    sessionId: session.sessionId,
    sessionFile: session.sessionFile,
    projectId: session.cwd,
  })) return;
  const resolvedTitle = displayTabTitle(session.name, "");
  let changed = false;
  const nextTabs = tabs.map((item) => {
    if (item.id !== activeTabId) return item;
    const next = {
      ...item,
      sessionId: session.sessionId || item.sessionId,
      sessionFile: session.sessionFile || item.sessionFile,
      title: resolvedTitle || displayTabTitle(item.title),
      status: session.status ?? item.status,
    };
    if (
      next.sessionId !== item.sessionId ||
      next.sessionFile !== item.sessionFile ||
      next.title !== item.title ||
      next.status !== item.status
    ) {
      changed = true;
    }
    return next;
  });
  // No-op when nothing changed: avoid spurious workspace-store updates (and
  // the app-wide re-render they trigger) on every session.status flip.
  if (changed) replaceWorkingSet(nextTabs, activeTabId);
}

export function applyCatalogNames(sessions: SessionSummary[]): void {
  if (!sessions.length) return;
  const { tabs, activeTabId, replaceWorkingSet } = useWorkspaceStore.getState();
  let changed = false;
  const next = tabs.map((tab) => {
    const match = sessions.find(
      (item) =>
        (tab.sessionFile && item.sessionFile === tab.sessionFile) ||
        (tab.sessionId && item.sessionId === tab.sessionId),
    );
    const listName = displayTabTitle(match?.name, "");
    if (!listName) return tab;
    const current = displayTabTitle(tab.title, "");
    const currentIsGeneric =
      !current ||
      current === "Untitled" ||
      current === "Untitled session" ||
      current === "New session";
    if (currentIsGeneric && listName !== current) {
      changed = true;
      return { ...tab, title: listName };
    }
    if (!currentIsGeneric && listName !== current && match?.name && match.name === listName) {
      if (match.name !== tab.title) {
        changed = true;
        return { ...tab, title: listName };
      }
    }
    return tab;
  });
  if (changed) replaceWorkingSet(next, activeTabId);
}

export function touchActiveTab(tabId: string, extra: Partial<SessionTab> = {}): void {
  const { tabs, replaceWorkingSet, activeTabId } = useWorkspaceStore.getState();
  replaceWorkingSet(touchTab(patchTab(tabs, tabId, extra), tabId), activeTabId);
}

export { type SessionTab };
