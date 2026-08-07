import { resolve } from "node:path";
import { resolveSessionDisplayName } from "./catalog.js";
import type { PiSessionLike } from "./types.js";

export function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export function messageText(message: { role?: string; id?: string; content?: unknown }): string {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part !== "object" || part === null) return "";
        const record = part as { type?: string; text?: unknown; thinking?: unknown; content?: unknown };
        if (record.type === "thinking") return "";
        if (record.type === "toolCall" || record.type === "tool_use" || record.type === "functionCall") return "";
        if (record.type === "text" || "text" in record) return String(record.text ?? "");
        if (typeof record.content === "string") return record.content;
        return "";
      })
      .join("");
  }
  if (message.content && typeof message.content === "object") {
    return stringify(message.content);
  }
  return "";
}

export function modelName(session: PiSessionLike): string {
  if (!session.model) return "";
  if (session.model.provider) return `${session.model.provider}/${session.model.id ?? "unknown"}`;
  return session.model.id ?? "";
}

/** Match sidebar catalog naming: explicit name → first user message → Untitled. */
export function resolveDisplayName(session?: PiSessionLike): string {
  if (!session) return "Untitled session";
  const explicit =
    session.sessionName?.trim() ||
    session.sessionManager?.getSessionName?.()?.trim() ||
    "";
  let firstMessage = "";
  for (const message of session.messages ?? []) {
    const msg = message as { role?: string; content?: unknown };
    if (msg.role !== "user") continue;
    const text = messageText(msg).trim();
    if (text) {
      firstMessage = text;
      break;
    }
  }
  return resolveSessionDisplayName({ name: explicit || undefined, firstMessage });
}

export function resolvePathsEqual(left: string, right: string): boolean {
  try {
    return resolve(left) === resolve(right);
  } catch {
    return left === right;
  }
}
