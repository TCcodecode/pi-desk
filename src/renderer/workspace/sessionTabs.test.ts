import { describe, expect, test } from "vitest";
import {
  closeTab,
  dedupeTabs,
  displayTabTitle,
  ensureInWorkingSet,
  findRestorableTab,
  retainExistingSessionTabs,
  loadOpenTabs,
  promotePreviewTab,
  sortTabsPinnedFirst,
  tabIdForSession,
  tabShortcutLabel,
  togglePinTab,
  touchTab,
  trimWorkingSet,
  upsertTab,
  WORKING_SET_LIMIT,
  type SessionTab,
} from "./sessionTabs";

describe("sessionTabs", () => {
  test("upsert dedupes by sessionFile and activates existing", () => {
    const first = upsertTab([], {
      sessionId: "a",
      sessionFile: "/tmp/a.jsonl",
      projectId: "/tmp/p",
      title: "A",
    });
    expect(first.tabs).toHaveLength(1);

    const second = upsertTab(first.tabs, {
      sessionId: "a2",
      sessionFile: "/tmp/a.jsonl",
      projectId: "/tmp/p",
      title: "A renamed",
    });
    expect(second.tabs).toHaveLength(1);
    expect(second.tabs[0]?.title).toBe("A renamed");
    expect(second.activeTabId).toBe(first.activeTabId);
  });

  test("upsert adds a second distinct session", () => {
    let state = upsertTab([], {
      sessionId: "a",
      sessionFile: "/tmp/a.jsonl",
      projectId: "/tmp/p",
      title: "A",
    });
    state = upsertTab(state.tabs, {
      sessionId: "b",
      sessionFile: "/tmp/b.jsonl",
      projectId: "/tmp/p",
      title: "B",
    });
    expect(state.tabs).toHaveLength(2);
    expect(state.activeTabId).toBe(tabIdForSession("b", "/tmp/b.jsonl"));
  });

  test("close active selects neighbor", () => {
    let state = upsertTab([], {
      sessionId: "a",
      sessionFile: "/tmp/a.jsonl",
      projectId: "/p",
      title: "A",
    });
    state = upsertTab(state.tabs, {
      sessionId: "b",
      sessionFile: "/tmp/b.jsonl",
      projectId: "/p",
      title: "B",
    });
    state = upsertTab(state.tabs, {
      sessionId: "c",
      sessionFile: "/tmp/c.jsonl",
      projectId: "/p",
      title: "C",
    });
    // active is C; close C → B
    const closed = closeTab(state.tabs, state.activeTabId!, state.activeTabId);
    expect(closed.tabs.map((t) => t.title)).toEqual(["A", "B"]);
    expect(closed.tabs.find((t) => t.id === closed.activeTabId)?.title).toBe("B");
  });

  test("close last tab clears active", () => {
    const state = upsertTab([], {
      sessionId: "a",
      sessionFile: "/tmp/a.jsonl",
      projectId: "/p",
      title: "A",
    });
    const closed = closeTab(state.tabs, state.activeTabId!, state.activeTabId);
    expect(closed.tabs).toHaveLength(0);
    expect(closed.activeTabId).toBeUndefined();
  });

  test("blank shells are not merged into each other", () => {
    let state = upsertTab([], {
      sessionId: "",
      projectId: "/p",
      title: "Untitled",
    });
    state = upsertTab(state.tabs, {
      sessionId: "",
      projectId: "/p",
      title: "Untitled",
    });
    expect(state.tabs).toHaveLength(2);
  });

  test("displayTabTitle never surfaces undefined/null literals", () => {
    expect(displayTabTitle(undefined)).toBe("Untitled");
    expect(displayTabTitle("undefined")).toBe("Untitled");
    expect(displayTabTitle("  ")).toBe("Untitled");
    expect(displayTabTitle("Fix the sidebar")).toBe("Fix the sidebar");
  });

  test("togglePin preserves the order in which tabs are pinned", () => {
    let state = upsertTab([], {
      sessionId: "a",
      sessionFile: "/tmp/a.jsonl",
      projectId: "/p",
      title: "A",
    });
    state = upsertTab(state.tabs, {
      sessionId: "b",
      sessionFile: "/tmp/b.jsonl",
      projectId: "/p",
      title: "B",
    });
    state = upsertTab(state.tabs, {
      sessionId: "c",
      sessionFile: "/tmp/c.jsonl",
      projectId: "/p",
      title: "C",
    });

    let pinned = togglePinTab(state.tabs, state.tabs.find((tab) => tab.title === "A")!.id);
    pinned = togglePinTab(pinned, pinned.find((tab) => tab.title === "B")!.id);
    pinned = togglePinTab(pinned, pinned.find((tab) => tab.title === "C")!.id);

    expect(pinned.map((tab) => tab.title)).toEqual(["A", "B", "C"]);
    expect(pinned.every((tab) => tab.pinned)).toBe(true);
  });

  test("keeps pinned tabs first and preserves unpinned opening order", () => {
    const ordered = sortTabsPinnedFirst([
      { id: "old", sessionId: "old", projectId: "/p", title: "Old", lastFocusedAt: 10 },
      { id: "pin", sessionId: "pin", projectId: "/p", title: "Pinned", pinned: true, lastFocusedAt: 1 },
      { id: "new", sessionId: "new", projectId: "/p", title: "New", lastFocusedAt: 20 },
    ]);

    expect(ordered.map((tab) => tab.title)).toEqual(["Pinned", "Old", "New"]);
  });

  test("restores only a tab belonging to the current project", () => {
    const tabs: SessionTab[] = [
      { id: "etf", sessionId: "etf", sessionFile: "/sessions/etf.jsonl", projectId: "etf", title: "ETF" },
      { id: "pi", sessionId: "pi", sessionFile: "/sessions/pi.jsonl", projectId: "pi", title: "Pi" },
    ];

    expect(findRestorableTab(tabs, "etf", "pi", "/work/pi")).toMatchObject({ id: "pi" });
    expect(findRestorableTab(tabs, "pi", "pi", "/work/pi")).toMatchObject({ id: "pi" });
  });

  test("restores one active tab when persisted entries point to the same session", () => {
    localStorage.setItem(
      "pi.openTabs",
      JSON.stringify({
        tabs: [
          { id: "old-key", sessionId: "s1", sessionFile: "/sessions/a.jsonl", projectId: "pi", title: "Untitled", isPreview: false },
          { id: "active-key", sessionId: "s1", sessionFile: "/sessions/a.jsonl", projectId: "pi", title: "Real task", isPreview: false, lastFocusedAt: 20 },
        ],
        activeTabId: "active-key",
      }),
    );

    const loaded = loadOpenTabs();
    expect(loaded.tabs).toHaveLength(1);
    expect(loaded.tabs[0]).toMatchObject({ id: "active-key", title: "Real task" });
    expect(loaded.activeTabId).toBe("active-key");
    localStorage.removeItem("pi.openTabs");
  });

  test("dedupes transitive session identities without dropping a pinned tab", () => {
    const tabs: SessionTab[] = [
      { id: "a", sessionId: "s1", sessionFile: "/sessions/a.jsonl", projectId: "pi", title: "A" },
      { id: "b", sessionId: "s1", projectId: "pi", title: "B", pinned: true },
      { id: "c", sessionId: "s2", sessionFile: "/sessions/b.jsonl", projectId: "etf", title: "C" },
    ];

    const deduped = dedupeTabs(tabs);
    expect(deduped).toHaveLength(2);
    expect(deduped[0]).toMatchObject({ id: "b", pinned: true, sessionFile: "/sessions/a.jsonl" });
    expect(deduped.map((tab) => tab.title)).toEqual(["B", "C"]);
  });

  test("does not dedupe equal session ids from different projects", () => {
    const tabs: SessionTab[] = [
      {
        id: "pi-session",
        projectId: "/work/pi-workspace",
        sessionId: "shared-session-id",
        sessionFile: "/sessions/pi.jsonl",
        title: "1",
        pinned: true,
      },
      {
        id: "etf-session",
        projectId: "/work/etf-tc",
        sessionId: "shared-session-id",
        sessionFile: "/sessions/etf.jsonl",
        title: "2",
        pinned: true,
      },
    ];

    expect(dedupeTabs(tabs, "pi-session").map((tab) => tab.id)).toEqual([
      "pi-session",
      "etf-session",
    ]);
  });

  test("keeps the pinned identity when duplicate metadata prefers an unpinned tab", () => {
    const tabs: SessionTab[] = [
      {
        id: "pinned",
        projectId: "/work/pi-workspace",
        sessionId: "shared",
        sessionFile: "/sessions/shared.jsonl",
        title: "Pinned",
        pinned: true,
      },
      {
        id: "active",
        projectId: "/work/pi-workspace",
        sessionId: "shared",
        sessionFile: "/sessions/shared.jsonl",
        title: "Active",
      },
    ];

    expect(dedupeTabs(tabs, "active")).toMatchObject([
      { id: "pinned", pinned: true },
    ]);
  });

  test("upsert does not merge equal session ids from different projects", () => {
    const first = upsertTab([], {
      id: "pi-session",
      sessionId: "shared",
      sessionFile: "/sessions/pi.jsonl",
      projectId: "/work/pi-workspace",
      title: "Pi",
    });
    const second = upsertTab(first.tabs, {
      id: "etf-session",
      sessionId: "shared",
      sessionFile: "/sessions/etf.jsonl",
      projectId: "/work/etf-tc",
      title: "ETF",
    });

    expect(second.tabs.map((tab) => tab.id)).toEqual(["pi-session", "etf-session"]);
  });

  test("tabShortcutLabel includes modifier", () => {
    expect(tabShortcutLabel(0, "⌘")).toBe("⌘1");
    expect(tabShortcutLabel(2, "Ctrl")).toBe("Ctrl+3");
    expect(tabShortcutLabel(9, "⌘")).toBeUndefined();
  });
});

describe("working set limit", () => {
  function tab(
    n: number,
    pinned = false,
    focusedAt = n,
  ): Omit<SessionTab, "id"> & { id?: string } {
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

  test("replaces the single preview tab before opening the next session", () => {
    const preview: SessionTab = { ...tab(1, false, 10), id: "preview", isPreview: true };
    const existing: SessionTab = { ...tab(2, false, 20), id: "existing" };
    const r = ensureInWorkingSet(
      [preview, existing],
      { ...tab(3, false, 30), isPreview: true },
      existing.id,
      30,
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.evicted?.id).toBe(preview.id);
    expect(r.tabs.map((item) => item.id)).not.toContain(preview.id);
    expect(r.tabs.map((item) => item.title)).toContain("T3");
    expect(r.activeTabId).not.toBe(preview.id);
  });

  test("retainExistingSessionTabs drops tabs whose files are gone", () => {
    const kept = { ...tab(1), id: "kept" };
    const gone = { ...tab(2), id: "gone", sessionFile: "/tmp/missing.jsonl" };
    const empty = { ...tab(3), id: "empty", sessionFile: undefined, sessionId: "" };
    expect(retainExistingSessionTabs([kept, gone, empty], [kept.sessionFile]).map((item) => item.id)).toEqual([
      "kept",
      "empty",
    ]);
  });

  test("loadOpenTabs forces sessionFile tabs out of preview", () => {
    localStorage.setItem(
      "pi.openTabs",
      JSON.stringify({
        tabs: [
          { ...tab(1, false, 10), id: "legacy-a", isPreview: true },
          { ...tab(2, false, 20), id: "legacy-b", isPreview: true },
        ],
        activeTabId: "legacy-b",
      }),
    );

    const loaded = loadOpenTabs();
    expect(loaded.tabs.map((item) => item.id).sort()).toEqual(["legacy-a", "legacy-b"]);
    expect(loaded.tabs.every((item) => item.isPreview === false)).toBe(true);
    localStorage.removeItem("pi.openTabs");
  });

  test("two historical opens both stay and neither is preview", () => {
    const first = ensureInWorkingSet([], { ...tab(1), isPreview: false }, undefined, 1);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = ensureInWorkingSet(first.tabs, { ...tab(2), isPreview: false }, first.activeTabId, 2);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.tabs.map((item) => item.title).sort()).toEqual(["T1", "T2"]);
    expect(second.tabs.every((item) => item.isPreview !== true)).toBe(true);
  });

  test("keeps a pinned tab out of preview replacement", () => {
    const pinned: SessionTab = { ...tab(1, true, 10), id: "pinned", isPreview: false };
    const r = ensureInWorkingSet(
      [pinned],
      { ...tab(2, false, 20), isPreview: true },
      pinned.id,
      20,
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.evicted).toBeUndefined();
    expect(r.tabs.map((item) => item.id)).toEqual([pinned.id, r.activeTabId]);
    expect(r.tabs[0]?.isPreview).toBe(false);
  });

  test("follows the preview lifecycle A → B → B+C → B+D", () => {
    let result = ensureInWorkingSet(
      [],
      { ...tab(1, false, 1), title: "A", isPreview: true },
      undefined,
      1,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    result = ensureInWorkingSet(
      result.tabs,
      { ...tab(2, false, 2), title: "B", isPreview: true },
      result.activeTabId,
      2,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tabs.map((item) => item.title)).toEqual(["B"]);

    const committedB = promotePreviewTab(result.tabs, result.activeTabId);
    expect(committedB[0]?.isPreview).toBe(false);

    result = ensureInWorkingSet(
      committedB,
      { ...tab(3, false, 3), title: "C", isPreview: true },
      committedB[0]?.id,
      3,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tabs.map((item) => item.title)).toEqual(["B", "C"]);
    expect(result.tabs.find((item) => item.title === "B")?.isPreview).toBe(false);
    expect(result.tabs.find((item) => item.title === "C")?.isPreview).toBe(true);

    result = ensureInWorkingSet(
      result.tabs,
      { ...tab(4, false, 4), title: "D", isPreview: true },
      result.activeTabId,
      4,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tabs.map((item) => item.title)).toEqual(["B", "D"]);
    expect(result.tabs.find((item) => item.title === "D")?.isPreview).toBe(true);
  });

  test("ensureInWorkingSet focuses existing without growing", () => {
    let r = ensureInWorkingSet([], tab(1, false, 100));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const id = r.tabs[0]!.id;
    r = ensureInWorkingSet(r.tabs, { ...tab(1, false, 200), id }, id, 500);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tabs).toHaveLength(1);
    expect(r.tabs[0]!.lastFocusedAt).toBe(500);
  });

  test("normalizes duplicates before deciding whether an incoming tab already exists", () => {
    const duplicateTabs: SessionTab[] = [
      { ...tab(1, false, 10), id: "old-key", isPreview: false },
      { ...tab(1, false, 20), id: "active-key", isPreview: false },
    ];

    const r = ensureInWorkingSet(duplicateTabs, tab(1, false, 30), "active-key", 30);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tabs).toHaveLength(1);
    expect(r.activeTabId).toBe("active-key");
    expect(r.evicted).toBeUndefined();
  });

  test("10th unpinned open evicts oldest unpinned by lastFocusedAt", () => {
    let tabs: SessionTab[] = [];
    let active: string | undefined;
    for (let i = 1; i <= 9; i++) {
      const r = ensureInWorkingSet(tabs, tab(i, false, i), active, i);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      tabs = r.tabs;
      active = r.activeTabId;
    }
    expect(tabs).toHaveLength(9);
    const r = ensureInWorkingSet(tabs, tab(10, false, 1000), active, 1000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tabs).toHaveLength(9);
    expect(r.evicted?.title).toBe("T1");
    expect(r.tabs.map((t) => t.title)).not.toContain("T1");
    expect(r.tabs.map((t) => t.title)).toContain("T10");
  });

  test("pinned tabs are never LRU victims", () => {
    let tabs: SessionTab[] = [];
    let active: string | undefined;
    for (let i = 1; i <= 8; i++) {
      const r = ensureInWorkingSet(tabs, tab(i, false, i), active, i);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      tabs = r.tabs;
      active = r.activeTabId;
    }
    const pinR = ensureInWorkingSet(tabs, tab(9, true, 0), active, 0);
    expect(pinR.ok).toBe(true);
    if (!pinR.ok) return;
    tabs = pinR.tabs;
    active = pinR.activeTabId;
    const r = ensureInWorkingSet(tabs, tab(10, false, 9999), active, 9999);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tabs.some((t) => t.title === "T9" && t.pinned)).toBe(true);
    expect(r.evicted?.title).toBe("T1");
  });

  test("all 9 pinned rejects new open", () => {
    let tabs: SessionTab[] = [];
    let active: string | undefined;
    for (let i = 1; i <= 9; i++) {
      const r = ensureInWorkingSet(tabs, tab(i, true, i), active, i);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      tabs = r.tabs;
      active = r.activeTabId;
    }
    const r = ensureInWorkingSet(tabs, tab(10, false, 100), active, 100);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("all_pinned");
    expect(r.message).toMatch(/9 pinned/i);
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
    expect(next[0]?.id).toBe(activeTabId);
  });

  test("trimWorkingSet keeps all pins then newest unpinned", () => {
    const tabs: SessionTab[] = [];
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
    expect(trimmed.some((t) => t.title === "T4")).toBe(false);
  });
});
