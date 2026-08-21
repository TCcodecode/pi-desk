import { describe, expect, test, vi } from "vitest";
import { createCompanionInvoker } from "./invoker.js";

describe("companion invoker", () => {
  test("getSnapshot includes sessions from the host", async () => {
    const invoke = createCompanionInvoker({
      snapshot: () => ({ workspaceId: "local", timeline: [] }),
      listSessions: async () => [{ sessionId: "s1" }],
      prompt: async () => undefined,
    });
    await expect(invoke("getSnapshot", [])).resolves.toMatchObject({
      workspaceId: "local",
      timeline: [],
      sessions: [{ sessionId: "s1" }],
    });
  });

  test("prompt forwards text and options", async () => {
    const calls: unknown[] = [];
    const invoke = createCompanionInvoker({
      snapshot: () => ({}),
      listSessions: async () => [],
      prompt: async (text, opts) => {
        calls.push([text, opts]);
      },
    });
    await invoke("prompt", ["ship it", { sessionKey: "file:/tmp/a" }]);
    expect(calls).toEqual([["ship it", { sessionKey: "file:/tmp/a" }]]);
  });

  test("selectProject includes the selected project's session catalog", async () => {
    const listSessions = vi.fn(async (cwd?: string) => [{ sessionId: cwd ?? "missing" }]);
    const invoke = createCompanionInvoker({
      snapshot: () => ({}),
      listSessions,
      selectProject: async () => ({ session: { cwd: "/tmp/cowinx" }, projects: [], activeProjectId: "/tmp/cowinx" }),
      prompt: async () => undefined,
    });

    await expect(invoke("selectProject", ["/tmp/cowinx"])).resolves.toMatchObject({
      sessions: [{ sessionId: "/tmp/cowinx" }],
    });
    expect(listSessions).toHaveBeenCalledWith("/tmp/cowinx");
  });

});
