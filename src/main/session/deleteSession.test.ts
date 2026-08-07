import { describe, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiHost, type PiRuntimeLike } from "./host.js";

vi.mock("./catalog.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./catalog.js")>();
  return {
    ...actual,
    deleteSessionFile: vi.fn(async (path: string) => {
      rmSync(path, { force: true });
    }),
  };
});

function createRuntimeWithFile(sessionFile: string): PiRuntimeLike {
  const session = {
    sessionId: "session-active",
    sessionFile,
    sessionName: "Active",
    cwd: "/tmp/project",
    model: { provider: "deepseek", id: "deepseek-v4-flash" },
    thinkingLevel: "medium",
    get isStreaming() { return false; },
    get messages() { return []; },
    sessionManager: { getSessionFile: () => sessionFile, getTree: () => [], getSessionName: () => "Active" },
    getActiveToolNames: () => [],
    getAllTools: () => [],
    getSessionStats: () => ({ tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 }),
    getContextUsage: () => undefined,
    subscribe: () => () => {},
    prompt: async () => {},
    steer: async () => {},
    followUp: async () => {},
    abort: async () => {},
    setThinkingLevel: () => {},
    getAvailableThinkingLevels: () => [],
    setActiveToolsByName: () => {},
    compact: async () => ({}),
    reload: async () => {},
    setModel: async () => {},
    setSessionName: () => {},
    navigateTree: async () => ({}),
    exportToHtml: async () => "",
    exportToJsonl: () => "",
    modelRuntime: { getModels: () => [], getModel: () => undefined },
  };
  return {
    session,
    cwd: "/tmp/project",
    switchSession: async () => ({ cancelled: false }),
    newSession: async () => ({ cancelled: false }),
    fork: async () => ({ cancelled: false }),
    importFromJsonl: async () => ({ cancelled: false }),
    dispose: async () => {},
  };
}

describe("PiHost.deleteSession", () => {
  test("deletes the active session by disposing runtime (empty main state)", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-delete-"));
    const file = join(root, "session.jsonl");
    writeFileSync(file, "{}", "utf8");
    const runtime = createRuntimeWithFile(file);
    const dispose = vi.fn(async () => {});
    runtime.dispose = dispose;
    const newSession = vi.fn(async () => ({ cancelled: false }));
    runtime.newSession = newSession;
    const host = new PiHost({ workspaceId: "w", runtime });

    const result = await host.deleteSession(file);
    expect(result).toEqual({ sessionPath: file });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(newSession).not.toHaveBeenCalled();
    expect(existsSync(file)).toBe(false);
    expect(host.snapshot().session.sessionId).toBe("");

    rmSync(root, { recursive: true, force: true });
  });

  test("deletes a non-active session file", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-delete-"));
    mkdirSync(root, { recursive: true });
    const active = join(root, "active.jsonl");
    const victim = join(root, "victim.jsonl");
    writeFileSync(active, "{}", "utf8");
    writeFileSync(victim, "{}", "utf8");
    const host = new PiHost({ workspaceId: "w", runtime: createRuntimeWithFile(active) });

    const result = await host.deleteSession(victim);
    expect(result).toEqual({ sessionPath: victim });
    expect(existsSync(victim)).toBe(false);
    expect(existsSync(active)).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });
});
