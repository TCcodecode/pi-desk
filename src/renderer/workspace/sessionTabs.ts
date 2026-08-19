import type { SessionStatus } from "../../shared/protocol";

/** Hard cap for the working-set tab strip (⌘1–9). Attention limit, not agent quota. */
export const WORKING_SET_LIMIT = 9;

const ALL_PINNED_MESSAGE =
  "Working set full (9 pinned). Unpin a tab to open another.";

export interface SessionTab {
  /** Stable UI id (sessionId when known, else provisional). */
  id: string;
  sessionId: string;
  sessionFile?: string;
  projectId: string;
  title: string;
  status?: SessionStatus;
  /** A newly-opened empty session that will be replaced by the next open. */
  isPreview?: boolean;
  /** Pinned tabs stay at the front of the strip (⌘1… prefer them). */
  pinned?: boolean;
  /** Epoch ms; used for LRU eviction among unpinned tabs. */
  lastFocusedAt?: number;
}

type SessionIdentity = Pick<SessionTab, "id" | "sessionId" | "sessionFile" | "projectId">;

export type EnsureInWorkingSetResult =
  | {
      ok: true;
      tabs: SessionTab[];
      activeTabId: string;
      evicted?: SessionTab;
    }
  | {
      ok: false;
      reason: "all_pinned";
      tabs: SessionTab[];
      activeTabId?: string;
      message: string;
    };

const STORAGE_KEY = "pi.openTabs";

export function loadOpenTabs(): { tabs: SessionTab[]; activeTabId?: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { tabs: [] };
    const parsed = JSON.parse(raw) as { tabs?: unknown; activeTabId?: unknown };
    const savedActiveTabId =
      typeof parsed.activeTabId === "string" ? parsed.activeTabId : undefined;
    let tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.filter(isSessionTab)
          .map(normalizeStoredTab)
      : [];
    tabs = migrateLegacyPreviewTabs(tabs);
    tabs = trimWorkingSet(dedupeTabs(tabs, savedActiveTabId));
    let activeTabId = savedActiveTabId;
    if (activeTabId && !tabs.some((t) => t.id === activeTabId)) {
      activeTabId = tabs[0]?.id;
    }
    return { tabs, activeTabId };
  } catch {
    return { tabs: [] };
  }
}

export function saveOpenTabs(tabs: SessionTab[], activeTabId?: string): void {
  const deduped = dedupeTabs(tabs, activeTabId);
  const resolvedActiveTabId = deduped.some((tab) => tab.id === activeTabId)
    ? activeTabId
    : deduped[0]?.id;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ tabs: deduped, activeTabId: resolvedActiveTabId }),
  );
}

/** Drop working-set tabs whose session files are no longer on disk. */
export function retainExistingSessionTabs(
  tabs: SessionTab[],
  existingFiles: Iterable<string | undefined>,
): SessionTab[] {
  const files = new Set(Array.from(existingFiles).filter((item): item is string => Boolean(item)));
  return tabs.filter((tab) => !tab.sessionFile || files.has(tab.sessionFile));
}

/** Pick a persisted tab belonging to the project being restored. */
export function findRestorableTab(
  tabs: SessionTab[],
  activeTabId: string | undefined,
  projectId: string,
  projectPath: string,
): SessionTab | undefined {
  const projectTabs = tabs.filter(
    (tab) =>
      Boolean(tab.sessionFile) &&
      (tab.projectId === projectId || tab.projectId === projectPath),
  );
  return projectTabs.find((tab) => tab.id === activeTabId) ?? projectTabs[0];
}

function isSessionTab(value: unknown): value is SessionTab {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.sessionId === "string" &&
    typeof row.projectId === "string" &&
    typeof row.title === "string"
  );
}

/** Migrate the previous hasConversation marker into the explicit preview role. */
function normalizeStoredTab(tab: SessionTab): SessionTab {
  const legacy = tab as SessionTab & { hasConversation?: unknown };
  const hasLegacyMarker = Object.prototype.hasOwnProperty.call(legacy, "hasConversation");
  return {
    ...tab,
    isPreview:
      tab.pinned === true || Boolean(tab.sessionFile)
        ? false
        : tab.isPreview ?? (hasLegacyMarker ? legacy.hasConversation === false : undefined),
  };
}

/** Give the newest unmarked legacy tab the one available preview slot. */
function migrateLegacyPreviewTabs(tabs: SessionTab[]): SessionTab[] {
  const legacy = tabs.filter((tab) => tab.isPreview === undefined && !tab.pinned);
  if (legacy.length === 0) return tabs;
  let preview = legacy[0]!;
  for (const candidate of legacy) {
    if ((candidate.lastFocusedAt ?? 0) >= (preview.lastFocusedAt ?? 0)) preview = candidate;
  }
  return tabs
    .filter((tab) => tab.isPreview !== undefined || tab.id === preview.id)
    .map((tab) => (tab.id === preview.id ? { ...tab, isPreview: true } : tab));
}

export function tabIdForSession(sessionId: string, sessionFile?: string): string {
  if (sessionFile) return `file:${sessionFile}`;
  if (sessionId) return `id:${sessionId}`;
  return `tmp:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Never show blank / literal "undefined" in the tab strip. */
export function displayTabTitle(title?: string | null, fallback = "Untitled"): string {
  const cleaned = (title ?? "").trim();
  if (!cleaned || cleaned === "undefined" || cleaned === "null") return fallback;
  return cleaned;
}

/** Modifier key glyph for shortcut hints (⌘ on Apple, Ctrl elsewhere). */
export function modKeyLabel(): string {
  if (typeof navigator === "undefined") return "⌘";
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "") ? "⌘" : "Ctrl";
}

/** e.g. ⌘1 / Ctrl+1 for tab index 0..8 */
export function tabShortcutLabel(index: number, mod = modKeyLabel()): string | undefined {
  if (index < 0 || index > 8) return undefined;
  return mod === "⌘" ? `⌘${index + 1}` : `Ctrl+${index + 1}`;
}

/** Toggle pin for active tab: ⌘P / Ctrl+P */
export function pinShortcutLabel(mod = modKeyLabel()): string {
  return mod === "⌘" ? "⌘P" : "Ctrl+P";
}

/** Pinned first; unpinned tabs retain their opening order. */
export function sortTabsPinnedFirst(tabs: SessionTab[]): SessionTab[] {
  const pinned = tabs.filter((tab) => tab.pinned);
  const unpinned = tabs.filter((tab) => !tab.pinned);
  return [...pinned, ...unpinned];
}

/**
 * A session file is globally unique; a session id is only unique within a
 * project. Keep this rule shared by all tab identity lookups.
 */
export function sameSessionIdentity(first: SessionIdentity, second: SessionIdentity): boolean {
  if (first.id === second.id) return true;
  const firstFile = first.sessionFile?.trim();
  const secondFile = second.sessionFile?.trim();
  if (firstFile && firstFile === secondFile) return true;
  const firstSessionId = first.sessionId.trim();
  const secondSessionId = second.sessionId.trim();
  const firstProjectId = first.projectId.trim().replace(/\/+$/, "");
  const secondProjectId = second.projectId.trim().replace(/\/+$/, "");
  return Boolean(
    firstProjectId &&
      firstProjectId === secondProjectId &&
      firstSessionId &&
      firstSessionId === secondSessionId,
  );
}

/**
 * Prove that foreground session metadata belongs to a tab before writing it.
 * Identified tabs require a matching file or project-scoped session id;
 * provisional tabs may claim the first session started in their project.
 */
export function sessionBelongsToTab(
  tab: SessionTab,
  session: { sessionId: string; sessionFile?: string; projectId: string },
): boolean {
  const sessionIdentity: SessionIdentity = {
    id: "",
    sessionId: session.sessionId.trim(),
    sessionFile: session.sessionFile?.trim() || undefined,
    projectId: session.projectId,
  };
  if (sameSessionIdentity(tab, sessionIdentity)) return true;
  if (tab.sessionId.trim() || tab.sessionFile?.trim()) return false;

  const tabProjectId = tab.projectId.trim().replace(/\/+$/, "");
  const sessionProjectId = session.projectId.trim().replace(/\/+$/, "");
  return Boolean(tabProjectId && tabProjectId === sessionProjectId);
}

function isGenericTabTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return !normalized || normalized === "untitled" || normalized === "untitled session" || normalized === "new session";
}

function preferTab(
  candidate: SessionTab,
  current: SessionTab,
  preferredTabId?: string,
): boolean {
  if (Boolean(candidate.pinned) !== Boolean(current.pinned)) return Boolean(candidate.pinned);
  if (candidate.id === preferredTabId) return current.id !== preferredTabId;
  if (current.id === preferredTabId) return false;
  return (candidate.lastFocusedAt ?? 0) > (current.lastFocusedAt ?? 0);
}

function mergeDuplicateTab(winner: SessionTab, duplicate: SessionTab): SessionTab {
  const pinned = Boolean(winner.pinned || duplicate.pinned);
  return {
    ...winner,
    sessionId: winner.sessionId || duplicate.sessionId,
    sessionFile: winner.sessionFile || duplicate.sessionFile,
    projectId: winner.projectId || duplicate.projectId,
    title: isGenericTabTitle(winner.title) && !isGenericTabTitle(duplicate.title)
      ? duplicate.title
      : winner.title,
    status: winner.status ?? duplicate.status,
    pinned: pinned || undefined,
    // A duplicate that represents an already-used or pinned tab must not make
    // the surviving tab replaceable as a preview.
    isPreview: pinned || winner.isPreview === false || duplicate.isPreview === false
      ? false
      : winner.isPreview ?? duplicate.isPreview,
    lastFocusedAt: Math.max(winner.lastFocusedAt ?? 0, duplicate.lastFocusedAt ?? 0) || undefined,
  };
}

/**
 * Restores the one-tab-per-session invariant after legacy storage or an
 * interrupted async switch. Pinned tabs win a conflict, then the active and
 * most recently focused tabs win. Components are transitive: if A matches B
 * by file and B matches C by session id, all three collapse to one tab.
 */
export function dedupeTabs(tabs: SessionTab[], preferredTabId?: string): SessionTab[] {
  const remaining = new Set(tabs.map((_, index) => index));
  const deduped: Array<{ index: number; tab: SessionTab }> = [];

  while (remaining.size > 0) {
    const firstIndex = remaining.values().next().value as number;
    const group = new Set<number>([firstIndex]);
    remaining.delete(firstIndex);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const index of [...remaining]) {
        if ([...group].some((member) => sameSessionIdentity(tabs[member]!, tabs[index]!))) {
          group.add(index);
          remaining.delete(index);
          expanded = true;
        }
      }
    }

    let winnerIndex = firstIndex;
    for (const index of group) {
      if (preferTab(tabs[index]!, tabs[winnerIndex]!, preferredTabId)) winnerIndex = index;
    }
    let winner = tabs[winnerIndex]!;
    for (const index of group) {
      if (index !== winnerIndex) winner = mergeDuplicateTab(winner, tabs[index]!);
    }
    deduped.push({ index: winnerIndex, tab: winner });
  }

  return sortTabsPinnedFirst(deduped.sort((a, b) => a.index - b.index).map((item) => item.tab));
}

/**
 * Pin → place after the existing pinned tabs.
 * Unpin → place after all remaining pinned tabs.
 */
export function togglePinTab(tabs: SessionTab[], tabId: string): SessionTab[] {
  tabs = dedupeTabs(tabs, tabId);
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return tabs;
  const tab = tabs[index]!;
  const others = tabs.filter((item) => item.id !== tabId);
  const nextPinned = !tab.pinned;
  // Pinning a preview promotes it to a regular tab. Unpinning never turns a
  // previously committed conversation back into a preview.
  const updated: SessionTab = { ...tab, pinned: nextPinned, isPreview: false };
  if (nextPinned) {
    const pinned = others.filter((item) => item.pinned);
    const unpinned = others.filter((item) => !item.pinned);
    return [...pinned, updated, ...unpinned];
  }
  const pinned = others.filter((item) => item.pinned);
  const unpinned = others.filter((item) => !item.pinned);
  return [...pinned, updated, ...unpinned];
}

/**
 * Open or focus a tab.
 * Dedupe on a non-empty sessionFile or on sessionId within the same project.
 * Never merge blank/untitled shells into each other.
 */
export function upsertTab(
  tabs: SessionTab[],
  tab: Omit<SessionTab, "id"> & { id?: string },
): { tabs: SessionTab[]; activeTabId: string } {
  tabs = dedupeTabs(tabs);
  const file = tab.sessionFile?.trim() || "";
  const sessionId = tab.sessionId?.trim() || "";
  const incomingIdentity: SessionIdentity = {
    id: tab.id ?? "",
    sessionId,
    sessionFile: file || undefined,
    projectId: tab.projectId,
  };
  const existingIndex = tabs.findIndex((item) => sameSessionIdentity(item, incomingIdentity));

  if (existingIndex >= 0) {
    const existing = tabs[existingIndex]!;
    const next = [...tabs];
    next[existingIndex] = {
      ...existing,
      ...tab,
      id: existing.id,
      title: tab.title || existing.title,
      sessionFile: file || existing.sessionFile,
      sessionId: sessionId || existing.sessionId,
      isPreview:
        tab.pinned === true || existing.pinned
          ? false
          : tab.isPreview ?? existing.isPreview,
      // Preserve pin unless explicitly provided
      pinned: tab.pinned ?? existing.pinned,
      lastFocusedAt: tab.lastFocusedAt ?? existing.lastFocusedAt,
    };
    return { tabs: sortTabsPinnedFirst(next), activeTabId: existing.id };
  }

  const id = tab.id ?? tabIdForSession(sessionId, file || undefined);
  const created: SessionTab = {
    id,
    sessionId,
    sessionFile: file || undefined,
    projectId: tab.projectId,
    title: tab.title || "Untitled",
    status: tab.status,
    isPreview: tab.pinned ? false : tab.isPreview ?? false,
    pinned: tab.pinned,
    lastFocusedAt: tab.lastFocusedAt ?? Date.now(),
  };
  return { tabs: sortTabsPinnedFirst([...tabs, created]), activeTabId: id };
}

export function touchTab(
  tabs: SessionTab[],
  tabId: string,
  at: number = Date.now(),
): SessionTab[] {
  return dedupeTabs(tabs.map((tab) =>
    tab.id === tabId ? { ...tab, lastFocusedAt: at } : tab,
  ), tabId);
}

function isPreviewTab(tab: SessionTab): boolean {
  return tab.isPreview === true && !tab.pinned;
}

/** Keep only the most recently focused preview when loading old state. */
function collapsePreviewTabs(tabs: SessionTab[]): SessionTab[] {
  let preview: SessionTab | undefined;
  for (const tab of tabs) {
    if (!isPreviewTab(tab)) continue;
    if (!preview || (tab.lastFocusedAt ?? 0) >= (preview.lastFocusedAt ?? 0)) {
      preview = tab;
    }
  }
  if (!preview) return tabs;
  return tabs.filter((tab) => !isPreviewTab(tab) || tab.id === preview.id);
}

/** Keep ≤ WORKING_SET_LIMIT while preserving tab-strip order. */
export function trimWorkingSet(tabs: SessionTab[]): SessionTab[] {
  tabs = collapsePreviewTabs(dedupeTabs(tabs));
  if (tabs.length <= WORKING_SET_LIMIT) return sortTabsPinnedFirst(tabs);
  const pinned = tabs.filter((t) => t.pinned);
  const unpinned = tabs.filter((t) => !t.pinned);
  const room = Math.max(0, WORKING_SET_LIMIT - pinned.length);
  // If more than 9 pins (corrupt storage), keep first WORKING_SET_LIMIT pins only.
  if (pinned.length >= WORKING_SET_LIMIT) {
    return sortTabsPinnedFirst(pinned.slice(0, WORKING_SET_LIMIT));
  }
  const newest = new Set(
    unpinned
      .slice()
      .sort((a, b) => (b.lastFocusedAt ?? 0) - (a.lastFocusedAt ?? 0))
      .slice(0, room)
      .map((tab) => tab.id),
  );
  return sortTabsPinnedFirst([...pinned, ...unpinned.filter((tab) => newest.has(tab.id))]);
}

/** Promote a preview into a regular tab after the user starts using it. */
export function promotePreviewTab(tabs: SessionTab[], tabId: string): SessionTab[] {
  return dedupeTabs(tabs.map((tab) =>
    tab.id === tabId && isPreviewTab(tab) ? { ...tab, isPreview: false } : tab,
  ), tabId);
}

/**
 * Open or focus a session in the working set.
 * - Existing → touch + activate
 * - A new open → replace the single unpinned preview tab, if present
 * - Under cap → append + touch
 * - At cap → detach oldest unpinned by lastFocusedAt, then append
 * - 9 pins → reject
 */
export function ensureInWorkingSet(
  tabs: SessionTab[],
  incoming: Omit<SessionTab, "id"> & { id?: string },
  activeTabId?: string,
  now: number = Date.now(),
): EnsureInWorkingSetResult {
  tabs = dedupeTabs(tabs, activeTabId);
  const probe = upsertTab(tabs, { ...incoming });
  const alreadyExisted = probe.tabs.length === tabs.length;
  if (alreadyExisted) {
    const id = probe.activeTabId;
    const touched = touchTab(probe.tabs, id, now);
    return { ok: true, tabs: sortTabsPinnedFirst(touched), activeTabId: id };
  }

  // Preview is a single replaceable slot, just like IntelliJ IDEA's preview
  // editor tab. Any new session open consumes that slot, even when the
  // incoming session is an existing conversation opened from the sidebar.
  const preview = tabs.find(isPreviewTab);
  let withoutPreview = tabs;
  const evicted = preview;
  if (preview) {
    withoutPreview = tabs.filter((tab) => tab.id !== preview.id);
  }

  if (withoutPreview.length < WORKING_SET_LIMIT) {
    const created = upsertTab(withoutPreview, {
      ...incoming,
      lastFocusedAt: incoming.lastFocusedAt ?? now,
    });
    const touched = touchTab(created.tabs, created.activeTabId, now);
    return {
      ok: true,
      tabs: sortTabsPinnedFirst(touched),
      activeTabId: created.activeTabId,
      evicted,
    };
  }

  // The working set is full after removing any preview; evict only a regular
  // unpinned tab. Pinned tabs never participate in Preview or LRU eviction.
  const victims = withoutPreview.filter((t) => !t.pinned);
  if (victims.length === 0) {
    return {
      ok: false,
      reason: "all_pinned",
      tabs: withoutPreview,
      activeTabId,
      message: ALL_PINNED_MESSAGE,
    };
  }

  let victim = victims[0]!;
  for (const v of victims) {
    if ((v.lastFocusedAt ?? 0) < (victim.lastFocusedAt ?? 0)) victim = v;
  }

  const without = withoutPreview.filter((t) => t.id !== victim.id);
  const created = upsertTab(without, {
    ...incoming,
    lastFocusedAt: incoming.lastFocusedAt ?? now,
  });
  const touched = touchTab(created.tabs, created.activeTabId, now);
  return {
    ok: true,
    tabs: sortTabsPinnedFirst(touched),
    activeTabId: created.activeTabId,
    evicted: evicted ?? victim,
  };
}

/** Close tab; activate neighbor (right, else left). */
export function closeTab(
  tabs: SessionTab[],
  tabId: string,
  activeTabId?: string,
): { tabs: SessionTab[]; activeTabId?: string } {
  const orderedTabs = dedupeTabs(tabs, activeTabId);
  const index = orderedTabs.findIndex((item) => item.id === tabId);
  if (index < 0) return { tabs: orderedTabs, activeTabId };

  const next = orderedTabs.filter((item) => item.id !== tabId);
  if (activeTabId !== tabId) {
    return { tabs: next, activeTabId };
  }
  if (next.length === 0) return { tabs: next, activeTabId: undefined };
  const neighbor = next[Math.min(index, next.length - 1)];
  return { tabs: next, activeTabId: neighbor?.id };
}

export function patchTab(
  tabs: SessionTab[],
  tabId: string,
  patch: Partial<SessionTab>,
): SessionTab[] {
  return dedupeTabs(
    tabs.map((item) => (item.id === tabId ? { ...item, ...patch, id: item.id } : item)),
    tabId,
  );
}

export function findTabIndex(tabs: SessionTab[], tabId?: string): number {
  if (!tabId) return -1;
  return tabs.findIndex((item) => item.id === tabId);
}
