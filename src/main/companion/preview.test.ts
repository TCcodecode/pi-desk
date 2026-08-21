import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  EXCLUDED_PORTS,
  excludedPorts,
  findPreviewPort,
  inferProjectPorts,
} from "./preview.js";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected tcp address");
  return address.port;
}

function htmlServer(body = "<html><body>hi</body></html>"): Server {
  return createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  });
}

describe("companion preview probe", () => {
  test("excludes PI Desk ports and a derived renderer port", () => {
    expect(EXCLUDED_PORTS.has(17890)).toBe(true);
    expect(excludedPorts("http://localhost:5173").has(5173)).toBe(true);
    expect(excludedPorts("http://localhost:5173").has(3000)).toBe(false);
    expect(excludedPorts(undefined).has(5173)).toBe(false);
  });

  test("infers ports from package.json scripts and vite.config", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-preview-infer-"));
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({
        scripts: { dev: "vite --port 4321" },
      }));
      writeFileSync(join(dir, "vite.config.ts"), "export default { server: { port: 4173 } };");
      const ports = inferProjectPorts(dir);
      expect(ports).toContain(4321);
      expect(ports).toContain(4173);
      expect(new Set(ports).size).toBe(ports.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ignores unreadable/missing project dirs", () => {
    expect(inferProjectPorts(undefined)).toEqual([]);
    expect(inferProjectPorts("/nonexistent-path-xyz")).toEqual([]);
  });

  test("picks the first port that serves HTML", async () => {
    const html = htmlServer();
    const json = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    const htmlPort = await listen(html);
    const jsonPort = await listen(json);
    try {
      // Put the JSON-only port first: it must be skipped because it is not HTML.
      const found = await findPreviewPort({ host: "127.0.0.1", cwd: undefined, timeoutMs: 400, candidates: [jsonPort, htmlPort] });
      expect(found).toBe(htmlPort);
    } finally {
      html.close();
      json.close();
    }
  });

  test("returns undefined when nothing serves HTML", async () => {
    const json = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    const jsonPort = await listen(json);
    try {
      const found = await findPreviewPort({ host: "127.0.0.1", cwd: undefined, timeoutMs: 200, candidates: [jsonPort] });
      expect(found).toBeUndefined();
    } finally {
      json.close();
    }
  });
});
