import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { listSessionFiles, loadOlderFromFile, readSessionTail } from "./sessionFile.js";
import { hydrateTimeline } from "./snapshot.js";

function writeJsonl(path: string, entries: Array<Record<string, unknown>>): void {
  writeFileSync(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
}

function sessionFile(dir: string, name: string, turns: number, extras?: {
  title?: string;
  prefixBytes?: number;
}): string {
  const path = join(dir, name);
  const entries: Array<Record<string, unknown>> = [
    { type: "session", version: 3, id: name.replace(".jsonl", ""), timestamp: "2026-01-01T00:00:00.000Z", cwd: "/tmp/project" },
  ];
  if (extras?.title) {
    entries.push({ type: "session_info", id: "info-1", parentId: null, timestamp: "2026-01-01T00:00:00.000Z", name: extras.title });
  }
  if (extras?.prefixBytes) {
    entries.push({
      type: "message",
      id: "pad",
      parentId: null,
      timestamp: "2026-01-01T00:00:01.000Z",
      message: { role: "assistant", content: "p".repeat(extras.prefixBytes) },
    });
  }
  let parent: string | null = extras?.title ? "info-1" : null;
  for (let i = 0; i < turns; i += 1) {
    const userId = `u${i}`;
    const asstId = `a${i}`;
    entries.push({
      type: "message",
      id: userId,
      parentId: parent,
      timestamp: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
      message: { role: "user", content: `q${i}`, id: userId },
    });
    entries.push({
      type: "message",
      id: asstId,
      parentId: userId,
      timestamp: `2026-01-01T00:01:${String(i).padStart(2, "0")}.000Z`,
      message: { role: "assistant", content: `ans${i}`, id: asstId },
    });
    parent = asstId;
  }
  writeJsonl(path, entries);
  return path;
}

describe("session file tail", () => {
  test("readSessionTail keeps the last 30 user turns without needing earlier messages", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-session-file-"));
    const path = sessionFile(dir, "long.jsonl", 40);
    const tail = readSessionTail(path, 30);
    const items = hydrateTimeline({ messages: tail.messages } as never);
    expect(items.filter((item) => item.kind === "user")).toHaveLength(30);
    expect(items.some((item) => item.id === "u10")).toBe(true);
    expect(items.some((item) => item.id === "u0")).toBe(false);
    expect(tail.hasMore).toBe(true);
    expect(tail.sessionId).toBe("long");
  });

  test("loadOlderFromFile returns the prefix page without reading the whole prefix as display text", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-session-file-"));
    const path = sessionFile(dir, "long.jsonl", 40);
    const tail = readSessionTail(path, 30);
    const items = hydrateTimeline({ messages: tail.messages } as never);
    const page = loadOlderFromFile(path, items[0]!.id, 30);
    expect(page.items.filter((item) => item.kind === "user")).toHaveLength(10);
    expect(page.items.some((item) => item.id === "u0")).toBe(true);
    expect(page.hasMore).toBe(false);
  });

  test("listSessionFiles reads header/name and ignores a huge middle payload", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-session-list-"));
    sessionFile(dir, "heavy.jsonl", 2, { title: "Release audit", prefixBytes: 2_000_000 });
    const listed = listSessionFiles(dir);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.sessionId).toBe("heavy");
    expect(listed[0]?.name).toBe("Release audit");
    expect(listed[0]?.sessionFile).toContain("heavy.jsonl");
  });

  test("unnamed preview uses the first user in the file, not the first user in the tail", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-session-name-"));
    const path = join(dir, "named-from-head.jsonl");
    writeJsonl(path, [
      { type: "session", version: 3, id: "named-from-head", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/tmp/project" },
      { type: "message", id: "first", parentId: null, timestamp: "2026-01-01T00:00:00.000Z", message: { role: "user", content: "hello-first", id: "first" } },
      { type: "message", id: "pad", parentId: "first", timestamp: "2026-01-01T00:00:01.000Z", message: { role: "assistant", content: "p".repeat(300_000) } },
      ...Array.from({ length: 40 }, (_, i) => [
        { type: "message", id: `u${i}`, parentId: i === 0 ? "pad" : `a${i - 1}`, timestamp: "2026-01-01T00:01:00.000Z", message: { role: "user", content: `q${i}`, id: `u${i}` } },
        { type: "message", id: `a${i}`, parentId: `u${i}`, timestamp: "2026-01-01T00:01:01.000Z", message: { role: "assistant", content: `ans${i}`, id: `a${i}` } },
      ]).flat(),
    ]);
    const tail = readSessionTail(path, 30);
    expect(tail.name).toBe("hello-first");
    expect(listSessionFiles(dir)[0]?.name).toBe("hello-first");
  });

  test("preview keeps the last model, thinking level, and rename even when they sit before the tail", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-session-meta-"));
    const path = join(dir, "meta.jsonl");
    writeJsonl(path, [
      { type: "session", version: 3, id: "meta", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/tmp/project" },
      { type: "session_info", id: "info-old", parentId: null, timestamp: "2026-01-01T00:00:00.000Z", name: "Old title" },
      { type: "model_change", id: "m1", parentId: "info-old", timestamp: "2026-01-01T00:00:01.000Z", provider: "deepseek", modelId: "old" },
      { type: "thinking_level_change", id: "t1", parentId: "m1", timestamp: "2026-01-01T00:00:02.000Z", thinkingLevel: "high" },
      { type: "session_info", id: "info-new", parentId: "t1", timestamp: "2026-01-01T00:00:03.000Z", name: "Current title" },
      { type: "model_change", id: "m2", parentId: "info-new", timestamp: "2026-01-01T00:00:04.000Z", provider: "deepseek", modelId: "v4" },
      { type: "thinking_level_change", id: "t2", parentId: "m2", timestamp: "2026-01-01T00:00:05.000Z", thinkingLevel: "low" },
      { type: "message", id: "pad", parentId: "t2", timestamp: "2026-01-01T00:00:06.000Z", message: { role: "assistant", content: "p".repeat(300_000) } },
      ...Array.from({ length: 40 }, (_, i) => [
        { type: "message", id: `u${i}`, parentId: i === 0 ? "pad" : `a${i - 1}`, timestamp: "2026-01-01T00:01:00.000Z", message: { role: "user", content: `q${i}`, id: `u${i}` } },
        { type: "message", id: `a${i}`, parentId: `u${i}`, timestamp: "2026-01-01T00:01:01.000Z", message: { role: "assistant", content: `ans${i}`, id: `a${i}` } },
      ]).flat(),
    ]);
    const tail = readSessionTail(path, 30);
    expect(tail.name).toBe("Current title");
    expect(tail.model).toEqual({ provider: "deepseek", id: "v4" });
    expect(tail.thinkingLevel).toBe("low");
    expect(listSessionFiles(dir)[0]?.name).toBe("Current title");
    expect(listSessionFiles(dir)[0]?.model).toBe("deepseek/v4");
    expect(listSessionFiles(dir)[0]?.thinkingLevel).toBe("low");
  });

  test("readSessionTail throws a clear error when the file is gone", () => {
    expect(() => readSessionTail("/tmp/pi-missing-session.jsonl")).toThrow(/no longer exists/);
  });

  test("listing and tail preview never JSON.parse oversized tool lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-session-skip-"));
    const path = join(dir, "skip.jsonl");
    writeJsonl(path, [
      { type: "session", version: 3, id: "skip", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/tmp/project" },
      { type: "session_info", id: "info", parentId: null, timestamp: "2026-01-01T00:00:00.000Z", name: "Skip huge" },
      { type: "message", id: "u0", parentId: "info", timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: "q0", id: "u0" } },
      { type: "message", id: "huge", parentId: "u0", timestamp: "2026-01-01T00:00:02.000Z", message: { role: "toolResult", content: "H".repeat(2_000_000), id: "huge" } },
      { type: "message", id: "a0", parentId: "huge", timestamp: "2026-01-01T00:00:03.000Z", message: { role: "assistant", content: "done", id: "a0" } },
    ]);
    const parsed = vi.spyOn(JSON, "parse");
    const listed = listSessionFiles(dir);
    const tail = readSessionTail(path, 30);
    const longest = Math.max(0, ...parsed.mock.calls.map((call) => String(call[0] ?? "").length));
    parsed.mockRestore();
    expect(listed[0]?.name).toBe("Skip huge");
    expect(tail.messages.some((message) => message.id === "u0")).toBe(true);
    expect(tail.messages.some((message) => message.id === "huge")).toBe(false);
    expect(longest).toBeLessThan(100_000);
  });
});
