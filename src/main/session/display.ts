import { resolve } from "node:path";
import { resolveSessionDisplayName } from "./catalog.js";
import type { PiSessionLike } from "./types.js";

export const DISPLAY_TEXT_LIMIT = 8 * 1024;

export function clipText(text: string, limit = DISPLAY_TEXT_LIMIT): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

/** Serialize `value` and stop once `limit` characters are produced. */
export function clipUnknown(value: unknown, limit = DISPLAY_TEXT_LIMIT): { text: string; truncated: boolean } {
  if (typeof value === "string") return clipText(value, limit);
  if (value === undefined) return { text: "", truncated: false };
  const parts: string[] = [];
  let size = 0;
  let truncated = false;

  const write = (chunk: string): boolean => {
    if (truncated) return false;
    const remaining = limit - size;
    if (chunk.length > remaining) {
      parts.push(chunk.slice(0, remaining));
      size = limit;
      truncated = true;
      return false;
    }
    parts.push(chunk);
    size += chunk.length;
    return true;
  };

  const walk = (node: unknown): boolean => {
    if (node === null) return write("null");
    const type = typeof node;
    if (type === "string") {
      const original = node as string;
      const clipped = original.length > limit ? original.slice(0, limit) : original;
      if (!write(JSON.stringify(clipped))) return false;
      if (original.length > limit) {
        truncated = true;
        return false;
      }
      return true;
    }
    if (type === "number" || type === "boolean") return write(String(node));
    if (type !== "object") return write("null");
    if (Array.isArray(node)) {
      if (!write("[")) return false;
      for (let i = 0; i < node.length; i += 1) {
        if (i > 0 && !write(",")) return false;
        if (!walk(node[i])) return false;
      }
      return write("]");
    }
    if (!write("{")) return false;
    let first = true;
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!first && !write(",")) return false;
      first = false;
      if (!write(JSON.stringify(key)) || !write(":") || !walk(record[key])) return false;
    }
    return write("}");
  };

  try {
    walk(value);
  } catch {
    write(String(value));
  }
  return { text: parts.join(""), truncated };
}

export function stringify(value: unknown): string {
  return clipUnknown(value).text;
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
