import { createReadStream, existsSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { request as httpRequest } from "node:http";
import { extname, join, relative, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  COMPANION_PROTOCOL,
  isCompanionMethodAllowed,
  parseCompanionClientMessage,
  type CompanionServerMessage,
} from "../../shared/companion.js";
import { tokenFromRequestUrl, tokensEqual } from "./pairing.js";
import { findPreviewPort } from "./preview.js";

export interface CompanionServerOptions {
  host: string;
  port: number;
  token: string;
  staticRoot?: string;
  devProxyOrigin?: string;
  previewHost?: string;
  /** Resolve the current workspace cwd for preview port inference. */
  previewCwd?: () => string | undefined;
  invoke: (method: string, args: unknown[]) => Promise<unknown>;
  subscribe: (listener: (event: unknown) => void) => () => void;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".ico": "image/x-icon",
};

function send(socket: WebSocket, message: CompanionServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

export class CompanionServer {
  private http: HttpServer;
  private sockets = new Set<WebSocket>();
  private unsubscribers = new Map<WebSocket, () => void>();
  private token: string;
  private listeningPort?: number;

  constructor(private readonly options: CompanionServerOptions) {
    this.token = options.token;
    this.http = createServer((req, res) => {
      void this.handleHttp(req, res);
    });
    const wss = new WebSocketServer({ noServer: true });
    this.http.on("upgrade", (req, socket, head) => {
      const url = req.url ?? "";
      const path = url.split("?")[0] ?? "";
      if (path !== "/ws") {
        socket.destroy();
        return;
      }
      const offered = tokenFromRequestUrl(url);
      if (!offered || !tokensEqual(offered, this.token)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.acceptSocket(ws));
    });
  }

  setToken(token: string): void {
    this.token = token;
    for (const socket of this.sockets) socket.close(4001, "token rotated");
  }

  async listen(): Promise<{ port: number }> {
    await new Promise<void>((resolve, reject) => {
      this.http.once("error", reject);
      this.http.listen(this.options.port, this.options.host, () => {
        this.http.off("error", reject);
        resolve();
      });
    });
    const address = this.http.address();
    const port = typeof address === "object" && address ? address.port : this.options.port;
    this.listeningPort = port;
    return { port };
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.close();
    this.sockets.clear();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  get port(): number | undefined {
    return this.listeningPort;
  }

  private acceptSocket(socket: WebSocket): void {
    this.sockets.add(socket);
    send(socket, { type: "hello", protocol: COMPANION_PROTOCOL });
    const unsubscribe = this.options.subscribe((event) => {
      send(socket, { type: "event", event });
    });
    this.unsubscribers.set(socket, unsubscribe);
    socket.on("message", (data) => {
      void this.handleSocketMessage(socket, String(data));
    });
    socket.on("close", () => {
      unsubscribe();
      this.unsubscribers.delete(socket);
      this.sockets.delete(socket);
    });
  }

  private async handleSocketMessage(socket: WebSocket, raw: string): Promise<void> {
    const parsed = parseCompanionClientMessage(raw);
    if ("error" in parsed) {
      send(socket, { type: "res", id: "", ok: false, error: parsed.error });
      return;
    }
    if (!isCompanionMethodAllowed(parsed.method)) {
      send(socket, { type: "res", id: parsed.id, ok: false, error: "method not allowed" });
      return;
    }
    try {
      const result = await this.options.invoke(parsed.method, parsed.args);
      send(socket, { type: "res", id: parsed.id, ok: true, result });
    } catch (error) {
      send(socket, {
        type: "res",
        id: parsed.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "/";
    const path = url.split("?")[0] ?? "/";
    if (path === "/preview" || path.startsWith("/preview/")) {
      await this.proxyPreview(req, res, path);
      return;
    }
    if (path === "/companion-manifest.json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        name: "PI Desk",
        short_name: "PI Desk",
        display: "standalone",
        start_url: "/",
        background_color: "#ffffff",
        theme_color: "#202020",
      }));
      return;
    }
    if (this.options.staticRoot && this.tryStatic(path, res)) return;
    if (this.options.devProxyOrigin) {
      this.proxyDev(req, res);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  }

  private tryStatic(path: string, res: ServerResponse): boolean {
    const root = this.options.staticRoot;
    if (!root) return false;
    const relativePath = path === "/" ? "companion.html" : path.replace(/^\//, "");
    const target = resolve(root, relativePath);
    const rel = relative(resolve(root), target);
    if (rel.startsWith("..")) {
      res.writeHead(403);
      res.end("forbidden");
      return true;
    }
    if (!existsSync(target) || !statSync(target).isFile()) return false;
    res.writeHead(200, {
      "content-type": MIME[extname(target)] ?? "application/octet-stream",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
    });
    createReadStream(target).pipe(res);
    return true;
  }

  private proxyDev(req: IncomingMessage, res: ServerResponse): void {
    const origin = this.options.devProxyOrigin;
    if (!origin) return;
    const incoming = new URL(req.url ?? "/", origin);
    if (incoming.pathname === "/") incoming.pathname = "/companion.html";
    const target = new URL(origin);
    const proxy = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: incoming.pathname + incoming.search,
        method: req.method,
        headers: { ...req.headers, host: target.host },
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxy.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end("companion ui unavailable");
    });
    req.pipe(proxy);
  }

  private async proxyPreview(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const host = this.options.previewHost ?? "127.0.0.1";
    const port = await findPreviewPort({
      host,
      cwd: this.options.previewCwd?.(),
      rendererOrigin: this.options.devProxyOrigin,
    });
    if (port === undefined) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      res.end("No local Web dev server is running in this project. Start Vite or Next, then reopen Preview.");
      return;
    }
    const rest = path === "/preview" || path === "/preview/" ? "/" : path.slice("/preview".length);
    const proxy = httpRequest(
      {
        hostname: host,
        port,
        path: rest + (req.url?.includes("?") ? `?${req.url.split("?")[1]}` : ""),
        method: req.method,
        headers: { ...req.headers, host: `${host}:${port}` },
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxy.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end("preview upstream error");
    });
    req.pipe(proxy);
  }
}

export function companionStaticRoot(mainDirname: string): string {
  return join(mainDirname, "../renderer");
}
