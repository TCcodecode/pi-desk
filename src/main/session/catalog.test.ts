import { describe, expect, test } from "vitest";
import { resolveSessionDisplayName, sortSessionInfos, toSessionSummary } from "./catalog.js";

describe("session catalog", () => {
  test("sorts sessions by most recently modified and maps display metadata", () => {
    const older = { path: "/tmp/older.jsonl", id: "older", cwd: "/tmp/project", created: new Date("2026-01-01"), modified: new Date("2026-01-01"), messageCount: 1, firstMessage: "old", allMessagesText: "old" };
    const newer = { path: "/tmp/newer.jsonl", id: "newer", cwd: "/tmp/project", name: "Release audit", created: new Date("2026-01-02"), modified: new Date("2026-01-03"), messageCount: 4, firstMessage: "release", allMessagesText: "release" };

    expect(sortSessionInfos([older, newer]).map((info) => info.id)).toEqual(["newer", "older"]);
    expect(toSessionSummary(newer)).toEqual(expect.objectContaining({ sessionId: "newer", name: "Release audit", messageCount: 4 }));
    expect(toSessionSummary(older)).toEqual(expect.objectContaining({ name: "old" }));
  });

  test("resolveSessionDisplayName prefers explicit name then first message", () => {
    expect(resolveSessionDisplayName({ name: "Named", firstMessage: "hello" })).toBe("Named");
    expect(resolveSessionDisplayName({ firstMessage: "hello from user" })).toBe("hello from user");
    expect(resolveSessionDisplayName({ firstMessage: "(no messages)" })).toBe("Untitled session");
    expect(resolveSessionDisplayName({})).toBe("Untitled session");
  });
});
