import { unlink } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";
import type { SessionSummary } from "../../shared/protocol.js";

export function sortSessionInfos<T extends Pick<SessionInfo, "modified">>(infos: T[]): T[] {
  return [...infos].sort((left, right) => right.modified.getTime() - left.modified.getTime());
}

/** Same display-name rules for sidebar list and topbar breadcrumb. */
export function resolveSessionDisplayName(options: {
  name?: string | null;
  firstMessage?: string | null;
  fallback?: string;
}): string {
  const explicit = options.name?.trim();
  if (explicit) return explicit;
  const first = (options.firstMessage ?? "").trim();
  if (first && first !== "(no messages)") return first.slice(0, 64);
  return options.fallback ?? "Untitled session";
}

export function toSessionSummary(info: SessionInfo): SessionSummary {
  return {
    sessionId: info.id,
    cwd: info.cwd,
    name: resolveSessionDisplayName({ name: info.name, firstMessage: info.firstMessage }),
    status: "idle",
    model: "",
    thinkingLevel: "medium",
    sessionFile: info.path,
    messageCount: info.messageCount,
    updatedAt: info.modified.toISOString(),
  };
}

export async function listSessions(cwd: string): Promise<SessionSummary[]> {
  const infos = await SessionManager.list(cwd);
  return sortSessionInfos(infos).map(toSessionSummary);
}

export async function deleteSessionFile(sessionPath: string): Promise<void> {
  await unlink(sessionPath);
}

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; text?: string; thinking?: string } =>
      typeof part === "object" && part !== null && "type" in part && part.type === "text",
    )
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

export function getSessionContext(sessionPath: string): { name: string; context: string } {
  const raw = readFileSync(sessionPath, "utf8");
  const entries: Array<{ role?: string; content?: unknown; name?: string }> = raw
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try { return JSON.parse(line) as { type?: string; message?: { role?: string; content?: unknown }; name?: string }; }
      catch { return {}; }
    });

  const explicitName = entries.find((entry) => entry.name)?.name;
  const lines: string[] = [];
  for (const entry of entries) {
    const message = (entry as { message?: { role?: string; content?: unknown } }).message;
    if (!message || typeof message.role !== "string") continue;
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = textOfContent(message.content);
    if (!text) continue;
    lines.push(`${message.role === "user" ? "Q" : "A"}: ${text}`);
  }

  const fallback = entries.find((entry) => (entry as { name?: string }).name)?.name ?? "referenced session";
  return { name: explicitName ?? fallback, context: lines.join("\n") };
}
