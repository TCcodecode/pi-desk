import { request as httpRequest } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";

/**
 * Preview on the phone proxies the project's local Web dev server (Vite,
 * Next, etc.). We probe ports in a strict order and only accept a port that
 * actually answers HTTP with an HTML page, so unrelated local services
 * (APIs, other apps) and PI Desk's own servers never leak into the phone.
 */

/** Fallback candidates when nothing can be inferred from the project. */
export const PREVIEW_CANDIDATE_PORTS = [3000, 5173, 4173, 8080, 5174, 4321, 3001, 8000, 9000];

/** Ports PI Desk itself listens on — never proxy these. */
export const EXCLUDED_PORTS = new Set<number>([17890]);

/** Renderer dev-server port (electron-vite), excluded when it can be derived. */
export function excludedPorts(rendererOrigin?: string): Set<number> {
  const excluded = new Set(EXCLUDED_PORTS);
  if (rendererOrigin) {
    try {
      const port = Number(new URL(rendererOrigin).port);
      if (Number.isInteger(port) && port > 0) excluded.add(port);
    } catch {
      // ignore malformed origin
    }
  }
  return excluded;
}

/** Probe a TCP port without reading the response. */
export function probePort(host: string, port: number, timeoutMs = 200): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const finish = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

/** GET / and report whether it answered with an HTML document. */
export function probeHttp(host: string, port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpRequest(
      { hostname: host, port, path: "/", method: "GET", headers: { accept: "text/html" }, timeout: timeoutMs },
      (res) => {
        const type = String(res.headers["content-type"] ?? "");
        res.resume();
        resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 500 && type.includes("text/html"));
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/** Infer candidate dev-server ports from the project's own config files. */
export function inferProjectPorts(cwd: string | undefined): number[] {
  const ports: number[] = [];
  const add = (value: unknown) => {
    const port = typeof value === "string" ? Number(value) : Number.NaN;
    if (Number.isInteger(port) && port > 0 && port < 65536) ports.push(port);
  };

  if (!cwd) return ports;

  // package.json dev/start scripts often carry --port / -p / PORT=.
  try {
    const pkgPath = join(cwd, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        scripts?: Record<string, string>;
        devPort?: unknown;
      };
      for (const script of Object.values(pkg.scripts ?? {})) {
        if (typeof script !== "string") continue;
        const portMatch = script.match(/(?:--port|-p|PORT)\s*(?:[=:]\s*)?(\d+)/i);
        if (portMatch) add(portMatch[1]);
      }
      if (pkg.devPort !== undefined) add(pkg.devPort);
    }
  } catch {
    // ignore unreadable package.json
  }

  // vite.config.* server.port.
  for (const name of ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs", "vite.config.cjs"]) {
    try {
      const configPath = join(cwd, name);
      if (!existsSync(configPath)) continue;
      const text = readFileSync(configPath, "utf8");
      const portMatch = text.match(/\bport\s*[:=]\s*(\d{2,5})\b/);
      if (portMatch) add(portMatch[1]);
    } catch {
      // ignore
    }
  }

  // Deduplicate while keeping first-seen order.
  return [...new Set(ports)];
}

/**
 * Find the project's live frontend dev server. Ports inferred from the project
 * are probed first (they are the strongest signal), then well-known fallbacks.
 * A port only wins if it serves HTML.
 */
export async function findPreviewPort(options: {
  host?: string;
  cwd?: string;
  rendererOrigin?: string;
  timeoutMs?: number;
  /** Explicit candidate list; probed before inferred/fallback ports (tests). */
  candidates?: number[];
}): Promise<number | undefined> {
  const host = options.host ?? "127.0.0.1";
  const timeoutMs = options.timeoutMs ?? 300;
  const excluded = excludedPorts(options.rendererOrigin);
  const candidates = [
    ...(options.candidates ?? []),
    ...inferProjectPorts(options.cwd),
    // Explicit candidate lists are authoritative (tests); otherwise add fallbacks.
    ...(options.candidates && options.candidates.length > 0 ? [] : PREVIEW_CANDIDATE_PORTS),
  ].filter((port) => !excluded.has(port));

  for (const port of candidates) {
    if (await probeHttp(host, port, timeoutMs)) return port;
  }
  return undefined;
}
