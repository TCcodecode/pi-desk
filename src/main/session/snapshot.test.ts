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

  test("tail item ids stay stable when messages have no explicit ids", () => {
    const messages: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 40; i += 1) {
      messages.push({ role: "user", content: `q${i}` });
      messages.push({ role: "assistant", content: `ans${i}` });
    }
    const tail = hydrateTimeline({ messages } as PiSessionLike);
    expect(tail[0]?.id).toBe("hist-20");
    const page = loadOlderItems({ messages } as PiSessionLike, tail[0]!.id, 30);
    expect(page.items[0]?.id).toBe("hist-0");
    expect(page.items.filter((item) => item.kind === "user")).toHaveLength(10);
  });
});

function proxyMessage(message: Record<string, unknown>, reads: { tools: Set<string> }): Record<string, unknown> {
  return new Proxy(message, {
    get(target, prop, receiver) {
      if (
        (target.role === "toolResult" || target.role === "tool" || target.role === "bashExecution")
        && (prop === "content" || prop === "details" || prop === "output")
      ) {
        reads.tools.add(String(target.id ?? ""));
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function sessionWithHeavyPrefix(turns: number): { session: PiSessionLike; reads: { tools: Set<string> } } {
  const reads = { tools: new Set<string>() };
  const messages: Array<Record<string, unknown>> = [];
  for (let i = 0; i < turns; i += 1) {
    messages.push({ role: "user", id: `u${i}`, content: `q${i}` });
    messages.push(proxyMessage({
      role: "toolResult",
      id: `t${i}`,
      toolCallId: `t${i}`,
      toolName: "read",
      content: `body-${i}`,
      details: { patch: `patch-${i}` },
    }, reads));
    messages.push({ role: "assistant", id: `a${i}`, content: `ans${i}` });
  }
  return { session: { messages } as PiSessionLike, reads };
}

describe("hydrate windowing", () => {
  test("hydrateTimeline does not read tool bodies dropped from the tail", () => {
    const { session, reads } = sessionWithHeavyPrefix(40);
    const items = hydrateTimeline(session);
    expect(items.filter((item) => item.kind === "user")).toHaveLength(30);
    expect(items.some((item) => item.id === "t0")).toBe(false);
    expect(items.some((item) => item.id === "t10")).toBe(true);
    expect([...reads.tools].sort()).toEqual(Array.from({ length: 30 }, (_, i) => `t${i + 10}`));
  });

  test("loadOlder does not read tool bodies outside the requested page", () => {
    const { session, reads } = sessionWithHeavyPrefix(40);
    const tail = hydrateTimeline(session);
    reads.tools.clear();
    const page = loadOlderItems(session, tail[0]!.id, 30);
    expect(page.items.filter((item) => item.kind === "user")).toHaveLength(10);
    expect(page.items.some((item) => item.id === "t0")).toBe(true);
    expect(page.items.some((item) => item.id === "t10")).toBe(false);
    expect([...reads.tools].sort()).toEqual(Array.from({ length: 10 }, (_, i) => `t${i}`));
  });

  test("hydrate clips huge tool payloads and file diffs", () => {
    const huge = "x".repeat(50_000);
    const items = hydrateTimeline({
      messages: [
        { role: "user", id: "u0", content: "q" },
        {
          role: "assistant",
          id: "a0",
          content: [{ type: "toolCall", id: "c1", name: "write", arguments: { path: "/tmp/a.ts", contents: huge } }],
        },
        {
          role: "toolResult",
          id: "t0",
          toolCallId: "c1",
          toolName: "write",
          content: huge,
          details: { patch: `--- a\n+++ b\n@@\n-${huge}\n+y\n` },
        },
      ],
    } as PiSessionLike);
    const call = items.find((item) => item.id === "c1");
    const result = items.find((item) => item.id === "t0");
    expect(call?.kind).toBe("tool");
    expect(result?.kind).toBe("tool");
    if (call?.kind !== "tool" || result?.kind !== "tool") return;
    expect(call.input.length).toBeLessThanOrEqual(8 * 1024);
    expect(result.output?.length).toBeLessThanOrEqual(8 * 1024);
    expect(result.change?.path).toBe("/tmp/a.ts");
    expect(result.change?.diff.length).toBeLessThanOrEqual(8 * 1024);
    expect(call.truncated || result.truncated).toBe(true);
  });

  test("tool-argument stringify stops walking after the clip limit", () => {
    let visited = 0;
    const args: Record<string, string> = {};
    for (let i = 0; i < 4000; i += 1) {
      Object.defineProperty(args, `k${i}`, {
        enumerable: true,
        get() {
          visited += 1;
          return "x".repeat(80);
        },
      });
    }
    const items = hydrateTimeline({
      messages: [
        { role: "user", id: "u0", content: "q" },
        {
          role: "assistant",
          id: "a0",
          content: [{ type: "toolCall", id: "c1", name: "read", arguments: args }],
        },
      ],
    } as PiSessionLike);
    const tool = items.find((item) => item.kind === "tool");
    expect(tool?.input.length).toBeLessThanOrEqual(8 * 1024);
    expect(visited).toBeLessThan(200);
  });
});
