export const COMPANION_PORT = 17890;
export const COMPANION_PROTOCOL = 1;

export const COMPANION_ALLOWED_METHODS = [
  "getSnapshot",
  "prompt",
  "steer",
  "followUp",
  "abort",
  "setModel",
  "setThinkingLevel",
  "selectProject",
  "setActiveProject",
  "listProjects",
  "listSessions",
  "startSession",
  "focusSession",
  "newSession",
  "undoFileChange",
  "loadOlder",
  "getModels",
  "listLiveSessions",
] as const;

export type CompanionAllowedMethod = (typeof COMPANION_ALLOWED_METHODS)[number];

export function isCompanionMethodAllowed(method: string): method is CompanionAllowedMethod {
  return (COMPANION_ALLOWED_METHODS as readonly string[]).includes(method);
}

export interface CompanionListenUrl {
  kind: "lan" | "tailscale";
  origin: string;
  label: string;
}

export interface CompanionState {
  enabled: boolean;
  listening: boolean;
  port: number;
  token: string;
  urls: CompanionListenUrl[];
  qrDataUrl?: string;
  error?: string;
}

export interface CompanionClientRequest {
  type: "req";
  id: string;
  method: string;
  args: unknown[];
}

export type CompanionServerMessage =
  | { type: "hello"; protocol: number }
  | { type: "res"; id: string; ok: true; result: unknown }
  | { type: "res"; id: string; ok: false; error: string }
  | { type: "event"; event: unknown };

const CONTENT_LIMIT = 8000;
const TOOL_LIMIT = 400;

function clip(text: string | undefined, limit: number): string | undefined {
  if (text === undefined) return undefined;
  return text.length > limit ? `${text.slice(0, limit)}\n…` : text;
}

/** Shrink a snapshot before sending it over the phone WebSocket. */
export function compactCompanionSnapshot<T extends object>(snapshot: T): T {
  const source = snapshot as T & { timeline?: Array<Record<string, unknown>> };
  const timeline = (source.timeline ?? []).slice(-80).map((item) => {
    if (item.kind === "tool") {
      const change = item.change && typeof item.change === "object"
        ? { ...(item.change as Record<string, unknown>), diff: clip(String((item.change as { diff?: string }).diff ?? ""), 2000) }
        : undefined;
      return {
        ...item,
        input: clip(typeof item.input === "string" ? item.input : undefined, TOOL_LIMIT) ?? "",
        output: clip(typeof item.output === "string" ? item.output : undefined, TOOL_LIMIT),
        change,
      };
    }
    if (item.kind === "user" || item.kind === "assistant" || item.kind === "thinking") {
      return { ...item, content: clip(typeof item.content === "string" ? item.content : undefined, CONTENT_LIMIT) ?? "" };
    }
    return item;
  });
  return {
    ...snapshot,
    timeline,
    resources: {
      contextFiles: [],
      skills: [],
      promptTemplates: [],
      themes: [],
      extensions: [],
      packages: [],
    },
  } as T;
}

export function parseCompanionClientMessage(raw: string): CompanionClientRequest | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "invalid json" };
  }
  if (!parsed || typeof parsed !== "object") return { error: "invalid request" };
  const record = parsed as Record<string, unknown>;
  if (record.type !== "req" || typeof record.id !== "string" || typeof record.method !== "string") {
    return { error: "invalid request" };
  }
  const args = Array.isArray(record.args) ? record.args : [];
  return { type: "req", id: record.id, method: record.method, args };
}
