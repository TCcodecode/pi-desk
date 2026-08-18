import { describe, expect, test } from "vitest";
import { hydrateTimeline, loadOlderItems, timelineHasMore } from "./snapshot.js";
import type { PiSessionLike } from "./types.js";

function sessionWithTurns(count: number): PiSessionLike {
  const messages: Array<Record<string, unknown>> = [];
  for (let i = 0; i < count; i += 1) {
    messages.push({ role: "user", id: `u${i}`, content: `q${i}` });
    messages.push({ role: "assistant", id: `a${i}`, content: `ans${i}` });
  }
  return { messages } as PiSessionLike;
}

describe("hydrateTimeline tail", () => {
  test("keeps the last 30 user turns by default", () => {
    const items = hydrateTimeline(sessionWithTurns(40));
    const users = items.filter((item) => item.kind === "user");
    expect(users).toHaveLength(30);
    expect(users[0]?.id).toBe("u10");
    expect(timelineHasMore(sessionWithTurns(40))).toBe(true);
  });

  test("tailTurns Infinity keeps everything", () => {
    const items = hydrateTimeline(sessionWithTurns(40), { tailTurns: Number.POSITIVE_INFINITY });
    expect(items.filter((item) => item.kind === "user")).toHaveLength(40);
    expect(timelineHasMore(sessionWithTurns(40), { tailTurns: Number.POSITIVE_INFINITY })).toBe(false);
  });

  test("includeTimeline false does not attach a timeline", async () => {
    const { buildSnapshot } = await import("./snapshot.js");
    const session = {
      ...sessionWithTurns(40),
      getSessionStats: () => undefined,
    };
    const snap = buildSnapshot({
      workspaceId: "w",
      sequence: 1,
      sessionTodos: [],
      resources: { contextFiles: [], skills: [], promptTemplates: [], themes: [], extensions: [], packages: [] },
      runtime: { session, cwd: "/tmp" } as never,
      includeTimeline: false,
    });
    expect(snap.timeline).toEqual([]);
    expect(snap.toolCalls).toEqual({});
    expect(snap.timelineHasMore).toBe(false);
  });

  test("loadOlder returns complete turns strictly before beforeId", () => {
    const session = sessionWithTurns(40);
    const tail = hydrateTimeline(session);
    const oldest = tail[0]!;
    const page = loadOlderItems(session, oldest.id, 30);
    expect(page.items.some((item) => item.id === oldest.id)).toBe(false);
    expect(page.items.filter((item) => item.kind === "user")).toHaveLength(10);
    expect(page.hasMore).toBe(false);
  });
});
