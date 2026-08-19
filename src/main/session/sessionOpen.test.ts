import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { loadEntriesFromFileAsync, openSessionManagerAsync } from "./sessionOpen.js";

function writeSession(dir: string, name: string, turns: number): string {
  const path = join(dir, name);
  const entries: Array<Record<string, unknown>> = [
    { type: "session", version: 3, id: name.replace(".jsonl", ""), timestamp: "2026-01-01T00:00:00.000Z", cwd: "/tmp/project" },
  ];
  let parent: string | null = null;
  for (let i = 0; i < turns; i += 1) {
    const userId = `u${i}`;
    const asstId = `a${i}`;
    entries.push({
      type: "message",
      id: userId,
      parentId: parent,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: { role: "user", content: `q${i}`, id: userId },
    });
    entries.push({
      type: "message",
      id: asstId,
      parentId: userId,
      timestamp: "2026-01-01T00:00:01.000Z",
      message: { role: "assistant", content: `ans${i}`, id: asstId },
    });
    parent = asstId;
  }
  writeFileSync(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  return path;
}

describe("session open", () => {
  test("loadEntriesFromFileAsync yields while reading a long transcript", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-session-open-"));
    const path = writeSession(dir, "long.jsonl", 40);
    const immediate = vi.spyOn(global, "setImmediate");
    const entries = await loadEntriesFromFileAsync(path);
    const yields = immediate.mock.calls.length;
    immediate.mockRestore();
    expect(entries.some((entry) => entry.type === "session")).toBe(true);
    expect(entries.filter((entry) => entry.type === "message")).toHaveLength(80);
    expect(yields).toBeGreaterThan(0);
  });

  test("openSessionManagerAsync resumes the file without SessionManager.open", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-session-mgr-"));
    const path = writeSession(dir, "sid.jsonl", 2);
    const manager = await openSessionManagerAsync(path, "/tmp/project");
    expect(manager.getSessionId()).toBe("sid");
    expect(manager.getSessionFile()).toBe(path);
    expect(manager.getEntries().some((entry) => entry.type === "message")).toBe(true);
  });
});
