import { describe, expect, test } from "vitest";
import type { SessionSummary } from "../../shared/protocol";
import { MAX_VISIBLE_SESSIONS, splitSessionList } from "./sessionListDisplay";

function makeSession(id: string, updatedAt: string): SessionSummary {
  return {
    sessionId: id,
    cwd: "/tmp/project",
    name: id,
    status: "idle",
    model: "",
    thinkingLevel: "medium",
    sessionFile: `/tmp/project/${id}.jsonl`,
    messageCount: 1,
    updatedAt,
  };
}

describe("splitSessionList", () => {
  test("sorts sessions newest first before splitting", () => {
    const sessions = [
      makeSession("old", "2026-08-01T00:00:00.000Z"),
      makeSession("newest", "2026-08-08T00:00:00.000Z"),
      makeSession("middle", "2026-08-04T00:00:00.000Z"),
    ];

    const result = splitSessionList(sessions);

    expect(result.recent.map((item) => item.sessionId)).toEqual(["newest", "middle", "old"]);
    expect(result.older).toEqual([]);
  });

  test("puts sessions after the first eight in the older group", () => {
    const sessions = Array.from({ length: MAX_VISIBLE_SESSIONS + 2 }, (_, index) =>
      makeSession(`session-${index}`, new Date(2026, 7, 8, index).toISOString()),
    );

    const result = splitSessionList(sessions);

    expect(result.recent).toHaveLength(8);
    expect(result.older.map((item) => item.sessionId)).toEqual(["session-1", "session-0"]);
  });
});
