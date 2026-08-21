import type { PiEvent, PiSnapshot } from "../../shared/protocol";
import { companionSocketUrl } from "./socketUrl.js";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

// Some mobile WebViews (e.g. older Android WebView, WeChat) do not expose
// crypto.randomUUID. Fall back to a v4-compatible UUID so request ids still
// work there.
export function requestId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class CompanionClient {
  private socket: WebSocket | undefined;
  private pending = new Map<string, Pending>();
  onEvent?: (event: PiEvent) => void;
  onStatus?: (status: "connecting" | "open" | "closed") => void;

  connect(token: string): void {
    this.close();
    this.onStatus?.("connecting");
    const socket = new WebSocket(companionSocketUrl(window.location, token));
    this.socket = socket;
    socket.addEventListener("open", () => this.onStatus?.("open"));
    socket.addEventListener("close", () => this.onStatus?.("closed"));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        type: string;
        id?: string;
        ok?: boolean;
        result?: unknown;
        error?: string;
        event?: PiEvent;
      };
      if (message.type === "event" && message.event) this.onEvent?.(message.event);
      if (message.type === "res" && message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.ok) pending.resolve(message.result);
        else pending.reject(new Error(message.error || "request failed"));
      }
    });
  }

  request<T>(method: string, args: unknown[] = []): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("not connected"));
    }
    const id = requestId();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      socket.send(JSON.stringify({ type: "req", id, method, args }));
    });
  }

  close(): void {
    this.socket?.close();
    this.socket = undefined;
    for (const pending of this.pending.values()) pending.reject(new Error("disconnected"));
    this.pending.clear();
  }
}

export function snapshotAfter(result: unknown): result is PiSnapshot {
  return Boolean(result && typeof result === "object" && "session" in result);
}
