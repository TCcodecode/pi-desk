# Working Set (≤9) + Multi-Session Runtime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a 9-slot working-set (pin + LRU + detach-only close) and true multi-runtime agents so closing/switching tabs never stops a running session; the sidebar shows all live status including detatched runtimes.

**Architecture:** Three layers stay decoupled: **Tabs = attention** (≤9, pin, LRU), **Host runtimes = life** (Map of slots, no dispose on tab close), **Disk JSONL = archive** (sidebar). Phase A ships working-set discipline on today’s single runtime. Phase B introduces `SessionRuntimeRegistry`, `sessionKey` on every event/API, per-key renderer views, and sidebar live merge. Phase C is polish (unread, key remap, optional idle dispose).

**Tech Stack:** Electron main (`PiHost`), React + Zustand renderer, Vitest, existing `sessionTabs.ts` / `SessionTabBar` / IPC via `src/shared/protocol.ts`.

**Product source of truth:** `docs/superpowers/specs/2026-08-08-working-set-and-multi-session.md`  
**Related:** `docs/superpowers/specs/2026-08-08-session-tabs-design.md`, `docs/superpowers/specs/2026-08-08-multi-session-runtime-plan.md` (defer to product spec on conflicts).

---

## Current baseline (do not re-litigate)

| Area | State |
|------|--------|
| Tab bar UI, pin, ⌘1–9, two-line project/session | ✅ Done |
| `sessionTabs.ts`: upsert/close/pin/sort | ✅ Done; **no** `lastFocusedAt`, **no** max-9 / LRU |
| `App.tsx` activate | Single runtime: **abort if running**, then `startSession` |
| `App.tsx` close last tab | **abort** if running + clear UI snapshot |
| `PiHost` | **One** `runtime?: PiRuntimeLike` |
| Concurrent limits / soft hints | **Out of scope forever** (product decision) |
| Close tab stops agent | **Forbidden** in target state (Phase B delivers) |

---

## File map

| File | Responsibility |
|------|----------------|
| `src/renderer/state/sessionTabs.ts` | Pure working-set ops: `ensureInWorkingSet`, `touchTab`, `trimWorkingSet`, `lastFocusedAt` |
| `src/renderer/state/sessionTabs.test.ts` | Unit tests for cap / pin-full / LRU |
| `src/renderer/App.tsx` | Wire ensure/touch; Phase B: no abort-on-switch/close; multi-view focus |
| `src/renderer/components/SessionTabBar.tsx` | Surface reject toast/message if needed (or App) |
| `src/renderer/state/appStore.ts` (+ tests) | Phase B: optional multi-view; foreground mirror |
| `src/renderer/state/sessionViews.ts` (new, Phase B) | `Record<sessionKey, TabViewState>` apply/route |
| `src/shared/protocol.ts` | `sessionKey` on events; API opts; `listLiveSessions`; live summary types |
| `electron/preload.ts` | Bridge new APIs |
| `electron/main.ts` | IPC handlers with key |
| `electron/sessionRuntimeRegistry.ts` (new, Phase B) | Map of slots; open/focus/detach/stop/dispose/prompt |
| `electron/sessionRuntimeRegistry.test.ts` (new) | Fake dual-runtime tests |
| `electron/piHost.ts` | Phase B: delegate to registry or become thin façade |
| `src/renderer/components/SessionSidebar.tsx` | Merge `listLiveSessions` status into rows |
| `docs/superpowers/specs/2026-08-08-working-set-and-multi-session.md` | Keep in sync if behavior drifts |

---

## Product red lines (every task must honor)

1. **Working set hard cap = 9** (attention, not agent quota).  
2. **Pin** tabs never LRU-evicted; **9 pins** → reject new attach with clear error string.  
3. **Close tab / LRU evict = detach only** — never delete JSONL; after Phase B never stop runtime.  
4. **Delete session (sidebar)** = dispose runtime + delete file + drop tab.  
5. **No concurrent hard/soft limits** on running agents.  
6. **⌘N** = visual index 1..N left-to-right after pin-first sort (not “⌘9 = last”).

---

# Phase A — Working-set discipline (single runtime OK)

**Deliverable:** Max 9 tabs, pin immunity, LRU eviction, pin-full reject, `lastFocusedAt` touch, startup trim. Close tab still does not delete files (already true). Honest: true “keep running after close” needs Phase B.

### Task A1: Extend `SessionTab` + pure helpers

**Files:**
- Modify: `src/renderer/state/sessionTabs.ts`
- Modify: `src/renderer/state/sessionTabs.test.ts`

- [ ] **Step 1: Write failing tests for ensureInWorkingSet / touch / trim**

Append to `sessionTabs.test.ts`:

```ts
import {
  closeTab,
  displayTabTitle,
  ensureInWorkingSet,
  tabIdForSession,
  tabShortcutLabel,
  togglePinTab,
  touchTab,
  trimWorkingSet,
  upsertTab,
  WORKING_SET_LIMIT,
} from "./sessionTabs";

describe("working set limit", () => {
  function tab(n: number, pinned = false, focusedAt = n): Parameters<typeof ensureInWorkingSet>[1] {
    return {
      sessionId: `s${n}`,
      sessionFile: `/tmp/s${n}.jsonl`,
      projectId: "/p",
      title: `T${n}`,
      pinned,
      lastFocusedAt: focusedAt,
    };
  }

  test("WORKING_SET_LIMIT is 9", () => {
    expect(WORKING_SET_LIMIT).toBe(9);
  });

  test("ensureInWorkingSet under cap appends and activates", () => {
    const r = ensureInWorkingSet([], tab(1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tabs).toHaveLength(1);
    expect(r.activeTabId).toBe(r.tabs[0]!.id);
    expect(r.evicted).toBeUndefined();
  });

  test("ensureInWorkingSet focuses existing without growing", () => {
    let r = ensureInWorkingSet([], tab(1, false, 100));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const id = r.tabs[0]!.id;
    r = ensureInWorkingSet(r.tabs, { ...tab(1, false, 200), id }, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tabs).toHaveLength(1);
    expect(r.tabs[0]!.lastFocusedAt).toBeGreaterThanOrEqual(200);
  });

  test("10th unpinned open evicts oldest unpinned by lastFocusedAt", () => {
    let tabs: ReturnType<typeof ensureInWorkingSet> extends { tabs: infer T } ? T : never = [];
    let active: string | undefined;
    // Build 9 unpinned with increasing focus times 1..9
    for (let i = 1; i <= 9; i++) {
      const r = ensureInWorkingSet(tabs, tab(i, false, i), active);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      tabs = r.tabs;
      active = r.activeTabId;
    }
    expect(tabs).toHaveLength(9);
    const r = ensureInWorkingSet(tabs, tab(10, false, 1000), active);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tabs).toHaveLength(9);
    expect(r.evicted?.title).toBe("T1"); // oldest lastFocusedAt
    expect(r.tabs.map((t) => t.title)).not.toContain("T1");
    expect(r.tabs.map((t) => t.title)).toContain("T10");
  });

  test("pinned tabs are never LRU victims", () => {
    let tabs: SessionTab[] = [];
    let active: string | undefined;
    // 8 unpinned + 1 pinned (oldest focus)
    for (let i = 1; i <= 8; i++) {
      const r = ensureInWorkingSet(tabs, tab(i, false, i), active);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      tabs = r.tabs;
      active = r.activeTabId;
    }
    const pinR = ensureInWorkingSet(tabs, tab(9, true, 0), active);
    expect(pinR.ok).toBe(true);
    if (!pinR.ok) return;
    tabs = pinR.tabs;
    active = pinR.activeTabId;
    // pin T9 has oldest focus but must stay
    const r = ensureInWorkingSet(tabs, tab(10, false, 9999), active);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tabs.some((t) => t.title === "T9" && t.pinned)).toBe(true);
    expect(r.evicted?.title).toBe("T1");
  });

  test("all 9 pinned rejects new open", () => {
    let tabs: SessionTab[] = [];
    let active: string | undefined;
    for (let i = 1; i <= 9; i++) {
      const r = ensureInWorkingSet(tabs, tab(i, true, i), active);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      tabs = r.tabs;
      active = r.activeTabId;
    }
    const r = ensureInWorkingSet(tabs, tab(10, false, 100), active);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("all_pinned");
    expect(tabs).toHaveLength(9);
  });

  test("touchTab updates lastFocusedAt", () => {
    const { tabs, activeTabId } = upsertTab([], {
      sessionId: "a",
      sessionFile: "/tmp/a.jsonl",
      projectId: "/p",
      title: "A",
      lastFocusedAt: 1,
    });
    const next = touchTab(tabs, activeTabId!, 5000);
    expect(next.find((t) => t.id === activeTabId)?.lastFocusedAt).toBe(5000);
  });

  test("trimWorkingSet keeps all pins then newest unpinned", () => {
    const tabs: SessionTab[] = [];
    // fabricate 11 via direct array (bypass ensure)
    for (let i = 1; i <= 11; i++) {
      tabs.push({
        id: `file:/tmp/s${i}.jsonl`,
        sessionId: `s${i}`,
        sessionFile: `/tmp/s${i}.jsonl`,
        projectId: "/p",
        title: `T${i}`,
        pinned: i <= 3,
        lastFocusedAt: i,
      });
    }
    const trimmed = trimWorkingSet(tabs);
    expect(trimmed).toHaveLength(9);
    expect(trimmed.filter((t) => t.pinned)).toHaveLength(3);
    // unpinned keep highest lastFocusedAt: T11.. among unpinned T4-T11 → keep 6 with highest focus
    expect(trimmed.some((t) => t.title === "T4")).toBe(false); // oldest unpinned dropped first
  });
});
```

Also fix imports: export `SessionTab` type usage in test (already exported).

- [ ] **Step 2: Run tests — expect FAIL** (symbols missing)

```bash
npx vitest run src/renderer/state/sessionTabs.test.ts
```

Expected: FAIL — `ensureInWorkingSet` / `WORKING_SET_LIMIT` not exported.

- [ ] **Step 3: Implement pure helpers**

In `sessionTabs.ts`, replace/extend as follows:

```ts
export const WORKING_SET_LIMIT = 9;

export interface SessionTab {
  id: string;
  sessionId: string;
  sessionFile?: string;
  projectId: string;
  title: string;
  status?: SessionStatus;
  pinned?: boolean;
  /** Epoch ms; used for LRU among unpinned tabs. */
  lastFocusedAt?: number;
}

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

const ALL_PINNED_MESSAGE =
  "Working set full (9 pinned). Unpin a tab to open another.";

export function touchTab(
  tabs: SessionTab[],
  tabId: string,
  at: number = Date.now(),
): SessionTab[] {
  return tabs.map((tab) =>
    tab.id === tabId ? { ...tab, lastFocusedAt: at } : tab,
  );
}

/** Keep ≤ WORKING_SET_LIMIT: all pins first, then unpinned by newest lastFocusedAt. */
export function trimWorkingSet(tabs: SessionTab[]): SessionTab[] {
  if (tabs.length <= WORKING_SET_LIMIT) return sortTabsPinnedFirst(tabs);
  const pinned = tabs.filter((t) => t.pinned);
  const unpinned = tabs
    .filter((t) => !t.pinned)
    .slice()
    .sort((a, b) => (b.lastFocusedAt ?? 0) - (a.lastFocusedAt ?? 0));
  const room = Math.max(0, WORKING_SET_LIMIT - pinned.length);
  return sortTabsPinnedFirst([...pinned, ...unpinned.slice(0, room)]);
}

/**
 * Open or focus a session in the working set.
 * - Existing → touch + activate
 * - Under cap → append (via upsert semantics) + touch
 * - At cap → detach oldest unpinned by lastFocusedAt, then append
 * - 9 pins → reject
 */
export function ensureInWorkingSet(
  tabs: SessionTab[],
  incoming: Omit<SessionTab, "id"> & { id?: string },
  activeTabId?: string,
  now: number = Date.now(),
): EnsureInWorkingSetResult {
  // Dedupe probe using same rules as upsertTab
  const probe = upsertTab(tabs, { ...incoming });
  const alreadyExisted = probe.tabs.length === tabs.length;
  if (alreadyExisted) {
    const id = probe.activeTabId;
    const touched = touchTab(probe.tabs, id, now);
    return { ok: true, tabs: sortTabsPinnedFirst(touched), activeTabId: id };
  }

  if (tabs.length < WORKING_SET_LIMIT) {
    const created = upsertTab(tabs, { ...incoming, lastFocusedAt: incoming.lastFocusedAt ?? now });
    const touched = touchTab(created.tabs, created.activeTabId, now);
    return {
      ok: true,
      tabs: sortTabsPinnedFirst(touched),
      activeTabId: created.activeTabId,
    };
  }

  // length === 9, need a new slot
  const victims = tabs.filter((t) => !t.pinned);
  if (victims.length === 0) {
    return {
      ok: false,
      reason: "all_pinned",
      tabs,
      activeTabId,
      message: ALL_PINNED_MESSAGE,
    };
  }

  let victim = victims[0]!;
  for (const v of victims) {
    if ((v.lastFocusedAt ?? 0) < (victim.lastFocusedAt ?? 0)) victim = v;
  }

  const without = tabs.filter((t) => t.id !== victim.id);
  const created = upsertTab(without, {
    ...incoming,
    lastFocusedAt: incoming.lastFocusedAt ?? now,
  });
  const touched = touchTab(created.tabs, created.activeTabId, now);
  return {
    ok: true,
    tabs: sortTabsPinnedFirst(touched),
    activeTabId: created.activeTabId,
    evicted: victim,
  };
}
```

Also update:

1. `isSessionTab` — allow optional `lastFocusedAt` number (no require).  
2. `upsertTab` — preserve `lastFocusedAt` from existing / accept from `tab`; default `lastFocusedAt: tab.lastFocusedAt ?? Date.now()` on create.  
3. `loadOpenTabs` — after filter, `tabs: trimWorkingSet(tabs)` so corrupt >9 storage is fixed.

```ts
export function loadOpenTabs(): { tabs: SessionTab[]; activeTabId?: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { tabs: [] };
    const parsed = JSON.parse(raw) as { tabs?: unknown; activeTabId?: unknown };
    let tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.filter(isSessionTab)
      : [];
    tabs = trimWorkingSet(tabs);
    let activeTabId =
      typeof parsed.activeTabId === "string" ? parsed.activeTabId : undefined;
    if (activeTabId && !tabs.some((t) => t.id === activeTabId)) {
      activeTabId = tabs[0]?.id;
    }
    return { tabs, activeTabId };
  } catch {
    return { tabs: [] };
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/renderer/state/sessionTabs.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/state/sessionTabs.ts src/renderer/state/sessionTabs.test.ts
git commit -m "feat(tabs): working set cap 9 with pin immunity and LRU eviction"
```

---

### Task A2: Wire `ensureInWorkingSet` + `touchTab` in App

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: tests if any cover open-tab flows (`src/renderer/app.send-flow.test.tsx` only if broken)

- [ ] **Step 1: Find every path that opens a tab**

In `App.tsx`, replace raw `upsertTab(...)` growth paths with `ensureInWorkingSet`:

| Call site | Behavior on fail |
|-----------|------------------|
| New session / tab bar `+` | show error via `pushError(result.message)` |
| Sidebar open session | same |
| Restoring/committing after startSession that creates new identity | prefer ensure; if dedupe hit, fine |

- [ ] **Step 2: Implement wiring pattern**

```ts
import {
  closeTab as closeTabInList,
  ensureInWorkingSet,
  loadOpenTabs,
  saveOpenTabs,
  touchTab,
  togglePinTab,
  // ...
  type SessionTab,
} from "./state/sessionTabs";

function applyWorkingSet(
  incoming: Omit<SessionTab, "id"> & { id?: string },
): boolean {
  const result = ensureInWorkingSet(
    openTabsRef.current,
    incoming,
    activeTabIdRef.current,
  );
  if (!result.ok) {
    pushError(result.message);
    return false;
  }
  openTabsRef.current = result.tabs;
  setOpenTabs(result.tabs);
  setActiveTabId(result.activeTabId);
  activeTabIdRef.current = result.activeTabId;
  // Note: Phase A does not dispose runtime for result.evicted
  return true;
}
```

On **activateTab** success path, always:

```ts
const touched = touchTab(openTabsRef.current, tabId);
openTabsRef.current = touched;
setOpenTabs(touched);
```

On **successful prompt send** for active tab (wherever send is handled), `touchTab(activeTabId)`.

- [ ] **Step 3: Close tab — Phase A honesty**

Keep: close = UI only + activate neighbor (no delete file).

Change if easy without multi-runtime:

- When closing **non-active** tab: pure UI (already).  
- When closing **active** and status running: **do not abort** solely because of close; either activate neighbor (which today aborts on switch — leave for B) **or** clear UI without abort if no neighbor.

Minimal Phase A change for “close last tab”:

```ts
// Before: abort if running
// After Phase A: still may abort on activate neighbor; for empty state:
// Prefer NOT abort when closing last tab — leave host runtime until Stop/Delete.
// Phase A optional improvement:
if (!result.activeTabId) {
  // clear renderer snapshot only; do NOT call api.abort()
  useAppStore.getState().replaceSnapshot({ /* empty session UI */ });
  return;
}
```

Document in comment: full “keep running” needs Phase B + sidebar live list.

- [ ] **Step 4: Manual checklist**

1. Open 10 distinct sessions from sidebar → oldest unpinned tab disappears; file still in sidebar.  
2. Pin 9 tabs → New session → error message; no 10th tab.  
3. Unpin one → New session succeeds.  
4. ⌘1–9 still maps left-to-right.

- [ ] **Step 5: Run unit tests + commit**

```bash
npx vitest run src/renderer/state/sessionTabs.test.ts src/renderer/components/SessionTabBar.test.tsx
git add src/renderer/App.tsx
git commit -m "feat(tabs): wire ensureInWorkingSet and lastFocusedAt touches"
```

---

### Task A3: Persist `lastFocusedAt` + pin-full copy in Help (optional small)

**Files:**
- Modify: `src/renderer/components/HelpDialog.tsx` (if shortcuts listed)
- Modify: `src/renderer/components/HelpDialog.test.tsx` if snapshot of help text

- [x] Document: working set max 9; pin protects; ⌘P pin; close tab ≠ delete (HelpDialog footer + ⌘W row).  
- [ ] Commit if Help changed.

---

### Phase A exit criteria

- [x] (after tasks) Unit tests green for cap / pin / LRU  
- [ ] UI never shows >9 tabs  
- [ ] Pin-full shows `Working set full (9 pinned)...`  
- [ ] No concurrent-limit toasts introduced  

---

# Phase B — Multi-session runtime MVP

**Deliverable:** Multiple live agents; switch/focus without abort; close tab = detach; sidebar shows running without a tab; re-open attaches same runtime.

### Task B1: Protocol types

**Files:**
- Modify: `src/shared/protocol.ts`

- [ ] **Step 1: Add types**

```ts
/** Stable key for a live runtime slot; equals SessionTab.id. */
// Conventions: file:${absPath} | tmp:${uuid} | id:${sessionId}

export type SessionStatus =
  // keep existing union if already defined; else:
  "idle" | "running" | "error" | "awaiting_approval" | "completed";

export interface LiveSessionSummary {
  sessionKey: string;
  sessionId: string;
  sessionFile?: string;
  cwd: string;
  projectId: string;
  name: string;
  status: SessionStatus;
}

// On PiEventBase add:
//   sessionKey?: string;  // required for session-scoped events after B2
```

Extend `PiEventBase`:

```ts
export interface PiEventBase<TType extends string, TPayload> {
  eventId: string;
  workspaceId: string;
  sessionId?: string;
  /** Routes events to the correct tab/view (Phase B). */
  sessionKey?: string;
  timestamp: string;
  sequence: number;
  type: TType;
  payload: TPayload;
  raw?: unknown;
}
```

Add event:

```ts
| PiEventBase<"session_key_remapped", { from: string; to: string }>
| PiEventBase<"live_sessions_changed", { sessions: LiveSessionSummary[] }>
```

Extend `PiApi` (backward compatible defaults):

```ts
startSession(options: {
  cwd: string;
  sessionPath?: string;
  sessionKey?: string;
}): Promise<PiSnapshot>;

prompt(text: string, opts?: { sessionKey?: string }): Promise<void>;
steer(text: string, opts?: { sessionKey?: string }): Promise<void>;
followUp(text: string, opts?: { sessionKey?: string }): Promise<void>;
abort(opts?: { sessionKey?: string }): Promise<void>;

/** Focus foreground without disposing others. */
focusSession(sessionKey: string): Promise<PiSnapshot>;

/** Explicitly release a runtime (delete file path, or app shutdown). Not used on tab close. */
disposeSession(sessionKey: string): Promise<void>;

listLiveSessions(): Promise<LiveSessionSummary[]>;
```

Keep old zero-arg `abort()` meaning “abort foreground” via overload or optional opts.

- [ ] **Step 2: Update preload + main IPC** to pass through new methods (stubs OK until B2 implements host).

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(protocol): sessionKey and live session list APIs"
```

---

### Task B2: `SessionRuntimeRegistry` + tests

**Files:**
- Create: `electron/sessionRuntimeRegistry.ts`
- Create: `electron/sessionRuntimeRegistry.test.ts`
- Modify: `electron/piHost.ts` (integrate or wrap)

- [ ] **Step 1: Failing tests with fake runtime factory**

```ts
// electron/sessionRuntimeRegistry.test.ts
import { describe, expect, test, vi } from "vitest";
import { SessionRuntimeRegistry } from "./sessionRuntimeRegistry";

function fakeFactory() {
  const runtimes: Array<{
    key: string;
    abort: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    prompt: ReturnType<typeof vi.fn>;
  }> = [];
  const factory = vi.fn(async (opts: { cwd: string; sessionPath?: string; sessionKey: string }) => {
    const abort = vi.fn(async () => {});
    const dispose = vi.fn(async () => {});
    const prompt = vi.fn(async () => {});
    const listeners = new Set<(e: { type: string }) => void>();
    const runtime = {
      cwd: opts.cwd,
      session: {
        sessionId: `id-${opts.sessionKey}`,
        sessionFile: opts.sessionPath,
        thinkingLevel: "off",
      },
      abort,
      dispose,
      prompt,
      subscribe(fn: (e: { type: string }) => void) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      emit(type: string) {
        for (const fn of listeners) fn({ type });
      },
    };
    runtimes.push({ key: opts.sessionKey, abort, dispose, prompt });
    return runtime;
  });
  return { factory, runtimes };
}

describe("SessionRuntimeRegistry", () => {
  test("open two keys keeps both alive", async () => {
    const { factory, runtimes } = fakeFactory();
    const reg = new SessionRuntimeRegistry({ runtimeFactory: factory as any });
    await reg.open("k1", { cwd: "/a" });
    await reg.open("k2", { cwd: "/a" });
    expect(runtimes).toHaveLength(2);
    await reg.focus("k2");
    expect(reg.listLive()).toHaveLength(2);
  });

  test("detach does not dispose", async () => {
    const { factory, runtimes } = fakeFactory();
    const reg = new SessionRuntimeRegistry({ runtimeFactory: factory as any });
    await reg.open("k1", { cwd: "/a" });
    reg.detach("k1");
    expect(runtimes[0]!.dispose).not.toHaveBeenCalled();
    expect(reg.listLive().some((s) => s.sessionKey === "k1")).toBe(true);
  });

  test("dispose aborts and removes", async () => {
    const { factory, runtimes } = fakeFactory();
    const reg = new SessionRuntimeRegistry({ runtimeFactory: factory as any });
    await reg.open("k1", { cwd: "/a" });
    await reg.dispose("k1");
    expect(runtimes[0]!.dispose).toHaveBeenCalled();
    expect(reg.listLive()).toHaveLength(0);
  });

  test("dedupe same sessionFile reuses slot", async () => {
    const { factory } = fakeFactory();
    const reg = new SessionRuntimeRegistry({ runtimeFactory: factory as any });
    await reg.open("file:/tmp/a.jsonl", { cwd: "/a", sessionPath: "/tmp/a.jsonl" });
    await reg.open("file:/tmp/a.jsonl", { cwd: "/a", sessionPath: "/tmp/a.jsonl" });
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
```

Adapt fakes to match whatever `PiRuntimeLike` actually needs — inspect `electron/piHost.ts` interface at top of file and mirror minimal fields.

- [ ] **Step 2: Implement registry**

Core shape:

```ts
// electron/sessionRuntimeRegistry.ts
export type SessionKey = string;

export interface RuntimeSlot {
  key: SessionKey;
  projectId: string;
  cwd: string;
  sessionId: string;
  sessionFile?: string;
  runtime: PiRuntimeLike;
  unsubscribe: () => void;
  status: SessionStatus;
  name: string;
}

export class SessionRuntimeRegistry {
  private slots = new Map<SessionKey, RuntimeSlot>();
  private foregroundKey?: SessionKey;
  // constructor: factory, emit bridge

  async open(key: SessionKey, opts: { cwd: string; sessionPath?: string; projectId?: string }): Promise<RuntimeSlot> {
    const byFile = opts.sessionPath
      ? [...this.slots.values()].find((s) => s.sessionFile === opts.sessionPath)
      : undefined;
    if (byFile) {
      this.foregroundKey = byFile.key;
      return byFile;
    }
    if (this.slots.has(key)) {
      this.foregroundKey = key;
      return this.slots.get(key)!;
    }
    // create runtime, subscribe → emit events with sessionKey: key
    // set status from agent events
    // store slot
  }

  focus(key: SessionKey): void {
    if (!this.slots.has(key)) throw new Error(`Unknown sessionKey: ${key}`);
    this.foregroundKey = key;
  }

  detach(_key: SessionKey): void {
    // intentionally no-op on host life; optional telemetry flag
  }

  async stop(key: SessionKey): Promise<void> {
    await this.slots.get(key)?.runtime.abort();
  }

  async dispose(key: SessionKey): Promise<void> {
    const slot = this.slots.get(key);
    if (!slot) return;
    try {
      await slot.runtime.abort();
    } catch { /* ignore */ }
    slot.unsubscribe();
    await slot.runtime.dispose();
    this.slots.delete(key);
    if (this.foregroundKey === key) this.foregroundKey = undefined;
  }

  async prompt(key: SessionKey, text: string): Promise<void> {
    const slot = this.require(key);
    await slot.runtime.session.prompt(text); // match real API
  }

  listLive(): LiveSessionSummary[] { /* map slots */ }

  get foreground(): SessionKey | undefined {
    return this.foregroundKey;
  }
}
```

**Critical:** every `emit` from a slot includes `sessionKey: slot.key`.

- [ ] **Step 3: Integrate into PiHost**

Preferred approach (incremental):

1. PiHost holds `private registry = new SessionRuntimeRegistry(...)`.  
2. `start({ cwd, sessionPath, sessionKey })`:  
   - if `sessionKey` provided → `registry.open` without disposing others  
   - if legacy single-session callers: still support “replace” only when no key and product still single-path — **for Phase B cutover**, always require renderer to pass sessionKey for tab opens.  
3. Legacy `start` that disposes all is **removed** for tab flows; app quit still `disposeAll()`.  
4. `prompt/abort` without key → use `foregroundKey`.  
5. `deleteSession(path)`: find slot by file → `dispose` then unlink file.

- [ ] **Step 4: Run registry tests**

```bash
npx vitest run electron/sessionRuntimeRegistry.test.ts electron/piHost.test.ts
```

Fix any host tests that assumed dispose-on-start.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(host): SessionRuntimeRegistry for multi live sessions"
```

---

### Task B3: Renderer multi-view + remove abort-on-switch

**Files:**
- Create: `src/renderer/state/sessionViews.ts` (+ test)
- Modify: `src/renderer/state/appStore.ts`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: TabViewState**

```ts
// src/renderer/state/sessionViews.ts
import type { PiEvent, PiSnapshot, SessionState, TimelineItem, ToolCallState } from "../../shared/protocol";

export interface TabViewState {
  session: SessionState;
  timeline: TimelineItem[];
  toolCalls: Record<string, ToolCallState>;
  queue: { steering: string[]; followUp: string[] };
  lastError?: string;
}

export function emptyView(partial?: Partial<SessionState>): TabViewState {
  return {
    session: {
      sessionId: "",
      name: "Untitled session",
      status: "idle",
      // fill required SessionState fields from existing appStore defaults
      ...partial,
    } as SessionState,
    timeline: [],
    toolCalls: {},
    queue: { steering: [], followUp: [] },
  };
}

export function viewFromSnapshot(snap: PiSnapshot): TabViewState {
  return {
    session: snap.session,
    timeline: snap.timeline,
    toolCalls: snap.toolCalls,
    queue: snap.queue,
    lastError: snap.lastError,
  };
}

/** Apply one event to a view (extract from appStore.applyEvent logic). */
export function applyEventToView(view: TabViewState, event: PiEvent): TabViewState {
  // Move/port the existing applyEvent switch from appStore, operating on view only.
  return view;
}
```

MVP strategy (product allowed):

- Always keep **status** updates for all keys.  
- Timeline: full apply for active key; background keys may only update status + append coarse markers OR full apply if cheap. Prefer **full apply for all live keys that have a view entry** to avoid “lost stream” bugs; cap memory later in Phase C.

- [ ] **Step 2: Event routing in App / store**

```ts
onEvent(ev) {
  const key = ev.sessionKey;
  if (!key) {
    // global events: trust, provider login, index — apply to store as today
    applyGlobal(ev);
    return;
  }
  updateLiveIndex(ev);
  setViews((prev) => {
    const cur = prev[key] ?? emptyView();
    return { ...prev, [key]: applyEventToView(cur, ev) };
  });
  if (key === activeTabIdRef.current) {
    mirrorViewToAppStore(views[key]); // timeline UI reads appStore today
  }
}
```

- [ ] **Step 3: activateTab becomes focus**

```ts
const activateTab = useCallback(async (tabId: string) => {
  commitActiveTabMeta();
  const tab = openTabsRef.current.find((t) => t.id === tabId);
  if (!tab) return;

  // NO abort here
  const touched = touchTab(openTabsRef.current, tabId);
  openTabsRef.current = touched;
  setOpenTabs(touched);
  setActiveTabId(tabId);
  activeTabIdRef.current = tabId;

  if (viewsRef.current[tabId]) {
    mirrorViewToAppStore(viewsRef.current[tabId]);
    await api?.focusSession?.(tabId);
    return;
  }

  // open-or-reuse
  const project = ...;
  const snap = await api?.startSession({
    cwd,
    sessionPath: tab.sessionFile,
    sessionKey: tabId,
  });
  if (snap) {
    const view = viewFromSnapshot(snap);
    viewsRef.current[tabId] = view;
    mirrorViewToAppStore(view);
  }
}, [...]);
```

- [ ] **Step 4: handleCloseTab = detach only**

```ts
const handleCloseTab = useCallback(async (tabId: string) => {
  const result = closeTabInList(...);
  // update tabs state
  await api?. /* no dispose */ ;
  // host.detach is no-op; do NOT call disposeSession
  // KEEP views[tabId] and live runtime
  if (result.activeTabId) await activateTab(result.activeTabId);
  else {
    // empty main UI; do NOT abort/dispose
    clearForegroundUiOnly();
  }
}, [...]);
```

- [ ] **Step 5: prompt/send always pass sessionKey**

```ts
await api.prompt(text, { sessionKey: activeTabIdRef.current });
```

- [ ] **Step 6: Tests**

- Unit: `applyEventToView` two keys interleaved deltas do not cross.  
- App/integration: mock api — close running tab does not call abort/dispose.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(renderer): multi-view focus and detach-only tab close"
```

---

### Task B4: Sidebar live merge

**Files:**
- Modify: `src/renderer/components/SessionSidebar.tsx`
- Modify: `src/renderer/components/SessionSidebar.test.tsx`
- Modify: `src/renderer/App.tsx` (poll or subscribe `live_sessions_changed`)

- [ ] **Step 1: Data**

```ts
const live = await api.listLiveSessions();
// Map by sessionFile and/or sessionId
// For each sidebar row: liveStatus = liveMap.get(file)?.status ?? "none"
```

- [ ] **Step 2: UI**

- Running indicator even if `!hasTab`.  
- Click row: `ensureInWorkingSet` + `activateTab` / open with **same** `sessionKey` as live slot when present.

Key alignment:

```ts
const sessionKey =
  liveByFile.get(sessionFile)?.sessionKey ??
  tabIdForSession(sessionId, sessionFile);
```

- [ ] **Step 3: deleteSession path**

Host already disposes; renderer removes tab + view entry.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(sidebar): show live/running sessions including detached"
```

---

### Phase B acceptance (manual)

| # | Scenario | Pass |
|---|----------|------|
| 1 | Tab A long prompt → switch B → A still running (tab/side status) | |
| 2 | Close A while running → A gone from tabs, still running in sidebar | |
| 3 | Re-open A from sidebar → same stream continues | |
| 4 | 10th unpinned open → evict unpinned; if victim was running, still running | |
| 5 | 9 pins + new → reject; runtimes unaffected | |
| 6 | Delete session file → dispose + tab gone + not in live | |
| 7 | Two tabs stream → timelines never cross | |

---

# Phase C — Polish (after B ships)

| Task | Detail |
|------|--------|
| C1 `session_key_remapped` | tmp→file on first persist; update tab.id, views map, registry map atomically |
| C2 Unread / needs-you | Badge on tab + sidebar when background awaiting_approval or completed |
| C3 Background timeline policy | If memory high: keep status-only for detatched non-tab slots; hydrate on attach |
| C4 Optional idle dispose | Only for long idle **and** not in working set; never on tab close; **off by default** |
| C5 ⌘W | Close (detach) active tab — **done** (main.ts installs custom menu dropping the ⌘W `close` role; renderer global keydown closes active tab; Help documents it; regression test in app.send-flow.test.tsx) |
| C6 Worktree isolation | Out of scope unless product reopens |

---

## Testing commands (full)

```bash
# Unit
npx vitest run src/renderer/state/sessionTabs.test.ts
npx vitest run electron/sessionRuntimeRegistry.test.ts
npx vitest run electron/piHost.test.ts
npx vitest run src/renderer/state/appStore.test.ts
npx vitest run src/renderer/components/SessionSidebar.test.tsx
npx vitest run src/renderer/components/SessionTabBar.test.tsx

# Broader
npx vitest run
```

---

## Risk register (implementation)

| Risk | Mitigation in tasks |
|------|---------------------|
| Event crosstalk | B2 force sessionKey; B3 interleaved unit test |
| activate still calls newSession | Already forbidden; B3 only startSession/focus with key |
| dispose-on-start left in PiHost.start | B2 rewrite start to open-without-dispose-others |
| Memory growth with many live | Accept product choice; C4 optional idle only |
| Same file two keys | Registry dedupe by sessionFile |
| Phase A users expect keep-running | Docs + empty-state may still single-runtime until B |

---

## Out of scope (explicit)

- Concurrent agent caps or “too many running” soft prompts  
- Working set > 9  
- Close tab = stop  
- Multi-window shared registry  
- Git worktree per session (Phase C optional / later)  
- Fake multi-timeline on one AgentSession object  

---

## Suggested PR slices

| PR | Content | Ship value |
|----|---------|------------|
| **PR1** | Phase A pure + App wire | Attention model live |
| **PR2** | Protocol + Registry + host tests | Backend multi ready |
| **PR3** | Renderer views + no abort switch/close | True parallel UX |
| **PR4** | Sidebar live merge + delete dispose | Close-tab-keeps-running complete |

---

## Self-review (plan vs product spec)

| Spec requirement | Plan task |
|------------------|-----------|
| Tabs ≤ 9, ⌘1–9 | A1, A2 |
| Pin immunity + 9-pin reject | A1 |
| LRU unpinned by lastFocusedAt | A1 |
| Close tab ≠ stop | B3 (A optional soft); product red line |
| Multi runtime Map | B2 |
| sessionKey routing | B1–B3 |
| Sidebar running without tab | B4 |
| No concurrency soft limits | Red lines + out of scope |
| ensureInWorkingSet algorithm | A1 exact |
| key remap tmp→file | C1 |
| No worktree in MVP | Out of scope |

**Placeholder scan:** no TBD steps in Phase A/B; Phase C is intentionally thinner.

**Type consistency:** `sessionKey === SessionTab.id`; `LiveSessionSummary.sessionKey`; registry `SessionKey`.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-08-working-set-and-multi-session.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session, batch with checkpoints via executing-plans  

**Recommended start:** Task A1 only (pure functions + tests) — small, merges cleanly, unblocks attention model without host rewrite.

Which approach, and should we start with **Phase A** or jump to **Phase B Registry** first?
