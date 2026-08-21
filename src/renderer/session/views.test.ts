import { describe, expect, test } from "vitest";
import { applyEventToView, applySnapshotToView, createView, remapViewKey } from "./views";
import { createInitialState } from "./reduce";
import type { PiEvent } from "../../shared/protocol";

function started(key: string): PiEvent {
  return {
    type: "session_started",
    sessionKey: key,
    eventId: "e1",
    workspaceId: "local",
    timestamp: new Date().toISOString(),
    sequence: 1,
    payload: { sessionId: "s1", cwd: "/tmp/a", sessionName: "A" },
  };
}

describe("SessionView", () => {
  test("session_started does not create a view", () => {
    expect(applyEventToView(undefined, started("k"))).toBeUndefined();
  });

  test("session_started on a loading view only patches the session head", () => {
    const view = createView("k", { hydrate: "loading", title: "A" });
    view.timeline = [{ id: "keep", kind: "user", content: "x", status: "completed" }];
    const next = applyEventToView(view, started("k"));
    expect(next?.hydrate).toBe("loading");
    expect(next?.timeline).toEqual(view.timeline);
    expect(next?.session.sessionId).toBe("s1");
    expect(next?.session.cwd).toBe("/tmp/a");
  });

  test("session_started on a ready empty view stays ready and empty", () => {
    const view = createView("k", { hydrate: "ready" });
    const next = applyEventToView(view, started("k"));
    expect(next?.hydrate).toBe("ready");
    expect(next?.timeline).toEqual([]);
  });

  test("session_started resumes a cold preview without wiping its history or models", () => {
    const view = createView("k", { hydrate: "ready", session: { sessionId: "s1" } });
    view.timeline = [{ id: "t0", kind: "user", content: "hello", status: "completed" }];
    view.models = [{ id: "deepseek/deepseek-v4-flash", provider: "deepseek", label: "DeepSeek V4 Flash", available: true, thinkingLevels: [] }];
    view.cold = true;
    const next = applyEventToView(view, started("k"));
    expect(next?.hydrate).toBe("ready");
    expect(next?.timeline).toEqual(view.timeline);
    expect(next?.models).toEqual(view.models);
    expect(next?.cold).toBe(false);
    expect(next?.session.sessionId).toBe("s1");
  });

  test("session_started resets a ready view when a different session takes over the key", () => {
    const view = createView("k", { hydrate: "ready", session: { sessionId: "old" } });
    view.timeline = [{ id: "t0", kind: "user", content: "hello", status: "completed" }];
    const next = applyEventToView(view, started("k"));
    expect(next?.hydrate).toBe("ready");
    expect(next?.timeline).toEqual([]);
    expect(next?.session.sessionId).toBe("s1");
  });

  test("applySnapshotToView marks ready and records oldestId", () => {
    const view = createView("k", { hydrate: "loading" });
    const snap = {
      ...createInitialState(),
      session: { ...createInitialState().session, sessionId: "s1", name: "A" },
      timeline: [
        { id: "t0", kind: "user" as const, content: "old", status: "completed" as const },
        { id: "t1", kind: "user" as const, content: "new", status: "completed" as const },
      ],
      timelineHasMore: true,
    };
    const next = applySnapshotToView(view, snap);
    expect(next.hydrate).toBe("ready");
    expect(next.hasMore).toBe(true);
    expect(next.oldestId).toBe("t0");
    expect(next.timeline).toHaveLength(2);
  });

  test("applySnapshotToView keeps a cold preview when a later snapshot is not a preview", () => {
    const previewed = applySnapshotToView(createView("k"), {
      ...createInitialState(),
      session: { ...createInitialState().session, sessionId: "s1", sessionFile: "/tmp/a.jsonl" },
      timeline: [{ id: "t0", kind: "user", content: "hello", status: "completed" }],
      preview: true,
    });
    expect(previewed.cold).toBe(true);
    const next = applySnapshotToView(previewed, {
      ...createInitialState(),
      session: createInitialState().session,
      timeline: [],
    });
    expect(next.cold).toBe(true);
    expect(next.timeline).toEqual(previewed.timeline);
  });

  test("remapViewKey moves the view", () => {
    const views = { tmp: createView("tmp", { hydrate: "ready" }) };
    const next = remapViewKey(views, "tmp", "file:/x.jsonl");
    expect(next.tmp).toBeUndefined();
    expect(next["file:/x.jsonl"]?.key).toBe("file:/x.jsonl");
  });
});
