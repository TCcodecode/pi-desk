import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import WebSocket from "ws";
import { mintCompanionToken } from "./pairing.js";
import { CompanionServer } from "./server.js";

function waitMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => resolve(String(data)));
    socket.once("error", reject);
  });
}

describe("companion server", () => {
  const servers: CompanionServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function listen(options: ConstructorParameters<typeof CompanionServer>[0]) {
    const server = new CompanionServer(options);
    servers.push(server);
    return server.listen();
  }

  test("rejects a websocket without the pairing token", async () => {
    const token = mintCompanionToken();
    const { port } = await listen({
      host: "127.0.0.1",
      port: 0,
      token,
      invoke: async () => undefined,
      subscribe: () => () => undefined,
    });
    await expect(
      new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        socket.once("open", () => {
          socket.close();
          resolve();
        });
        socket.once("unexpected-response", (_req, res) => {
          reject(new Error(`status ${res.statusCode}`));
        });
        socket.once("error", reject);
      }),
    ).rejects.toThrow(/status 401/);
  });

  test("hands a snapshot through an allowed method and blocks secret methods", async () => {
    const token = mintCompanionToken();
    const calls: string[] = [];
    const { port } = await listen({
      host: "127.0.0.1",
      port: 0,
      token,
      invoke: async (method, args) => {
        calls.push(method);
        if (method === "getSnapshot") return { workspaceId: "local", timeline: [], args };
        return { method };
      },
      subscribe: () => () => undefined,
    });

    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const hello = JSON.parse(await waitMessage(socket));
    expect(hello).toEqual({ type: "hello", protocol: 1 });

    socket.send(JSON.stringify({ type: "req", id: "a", method: "getSnapshot", args: [] }));
    expect(JSON.parse(await waitMessage(socket))).toMatchObject({
      type: "res",
      id: "a",
      ok: true,
      result: { workspaceId: "local" },
    });

    socket.send(JSON.stringify({ type: "req", id: "b", method: "loginWithApiKey", args: ["x", "sk"] }));
    expect(JSON.parse(await waitMessage(socket))).toEqual({
      type: "res",
      id: "b",
      ok: false,
      error: "method not allowed",
    });
    expect(calls).toEqual(["getSnapshot"]);
    socket.close();
  });

  test("forwards host events to the phone", async () => {
    const token = mintCompanionToken();
    let emit: ((event: unknown) => void) | undefined;
    const { port } = await listen({
      host: "127.0.0.1",
      port: 0,
      token,
      invoke: async () => undefined,
      subscribe: (listener) => {
        emit = listener;
        return () => {
          emit = undefined;
        };
      },
    });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    await waitMessage(socket);
    emit?.({ type: "session_completed", payload: { sessionName: "x" } });
    expect(JSON.parse(await waitMessage(socket))).toEqual({
      type: "event",
      event: { type: "session_completed", payload: { sessionName: "x" } },
    });
    socket.close();
  });

  test("serves the companion page from static files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-companion-"));
    writeFileSync(join(dir, "companion.html"), "<html>phone</html>");
    const token = mintCompanionToken();
    const { port } = await listen({
      host: "127.0.0.1",
      port: 0,
      token,
      staticRoot: dir,
      invoke: async () => undefined,
      subscribe: () => () => undefined,
    });
    const response = await fetch(`http://127.0.0.1:${port}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.text()).toContain("phone");
  });
});
