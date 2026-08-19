import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  getAgentDir,
  sessionEntryToContextMessages,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { messageText } from "./display.js";
import { hydrateTimeline, loadOlderItems } from "./snapshot.js";
import type { SessionSummary, TimelineItem } from "../../shared/protocol.js";

export const SESSION_LIST_HEAD_BYTES = 64 * 1024;
export const SESSION_LIST_TAIL_BYTES = 64 * 1024;
export const SESSION_VIEW_CHUNK_BYTES = 256 * 1024;
export const SESSION_VIEW_MAX_BYTES = 8 * 1024 * 1024;
/** Skip JSONL rows larger than this. Tool results this big freeze the main process. */
export const SESSION_LINE_MAX = 64 * 1024;

export function defaultSessionDir(cwd: string): string {
  const resolvedCwd = resolve(cwd);
  const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(getAgentDir(), "sessions", safePath);
}

function readSlice(path: string, start: number, length: number): string {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytes = readSync(fd, buffer, 0, length, start);
    return buffer.subarray(0, bytes).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

type FileEntry = SessionEntry | {
  type: "session";
  id: string;
  cwd?: string;
  timestamp?: string;
};

function trimOversizePrefix(text: string): string {
  const newline = text.indexOf("\n");
  if (newline === -1) return text.length > SESSION_LINE_MAX ? "" : text;
  return newline > SESSION_LINE_MAX ? text.slice(newline + 1) : text;
}

function parseEntries(text: string, dropLeadingIncomplete: boolean): FileEntry[] {
  const entries: FileEntry[] = [];
  let start = 0;
  if (dropLeadingIncomplete) {
    const newline = text.indexOf("\n");
    if (newline === -1) return entries;
    start = newline + 1;
  }
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    const length = end - start;
    if (length > 0 && length <= SESSION_LINE_MAX) {
      const line = text.slice(start, end);
      if (line.trim()) {
        try {
          entries.push(JSON.parse(line) as FileEntry);
        } catch {
          // Mid-line slices and corrupt rows are skipped.
        }
      }
    }
    if (newline === -1) break;
    start = newline + 1;
  }
  return entries;
}

function displayName(name?: string, firstMessage?: string): string {
  const explicit = name?.trim();
  if (explicit) return explicit;
  const first = (firstMessage ?? "").trim();
  if (first && first !== "(no messages)") return first.slice(0, 64);
  return "Untitled session";
}

function firstUserText(messages: Array<Record<string, unknown>>): string {
  for (const message of messages) {
    if ((message.role ?? "") !== "user") continue;
    const text = messageText(message).trim();
    if (text) return text;
  }
  return "";
}

function applyLatestMeta(
  entries: FileEntry[],
  meta: { name?: string; model?: { provider?: string; id?: string }; thinkingLevel?: string },
): void {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]!;
    if (!meta.name && entry.type === "session_info") {
      const titled = (entry as { name?: string }).name?.trim();
      if (titled) meta.name = titled;
    }
    if (!meta.model && entry.type === "model_change") {
      const change = entry as { provider?: string; modelId?: string };
      meta.model = { provider: change.provider, id: change.modelId };
    }
    if (!meta.thinkingLevel && entry.type === "thinking_level_change") {
      meta.thinkingLevel = (entry as { thinkingLevel?: string }).thinkingLevel;
    }
    if (meta.name && meta.model && meta.thinkingLevel) return;
  }
}

function readLatestMeta(
  sessionPath: string,
  maxBytes = SESSION_VIEW_MAX_BYTES,
): { name?: string; model?: { provider?: string; id?: string }; thinkingLevel?: string } {
  const size = statSync(sessionPath).size;
  const meta: { name?: string; model?: { provider?: string; id?: string }; thinkingLevel?: string } = {};
  let scanned = 0;
  let raw = "";
  while (scanned < size && scanned < maxBytes) {
    const length = Math.min(SESSION_VIEW_CHUNK_BYTES, size - scanned);
    const start = size - scanned - length;
    raw = trimOversizePrefix(readSlice(sessionPath, start, length) + raw);
    scanned += length;
    applyLatestMeta(parseEntries(raw, start > 0), meta);
    if (meta.name && meta.model && meta.thinkingLevel) return meta;
    if (start === 0) break;
  }
  return meta;
}

function readFirstUserFromHead(sessionPath: string): string {
  const size = statSync(sessionPath).size;
  const head = readSlice(sessionPath, 0, Math.min(SESSION_LIST_HEAD_BYTES, size));
  return firstUserText(collectFromEntries(parseEntries(head, false)).messages);
}

function collectFromEntries(entries: FileEntry[]): {
  messages: Array<Record<string, unknown>>;
  name?: string;
  model?: { provider?: string; id?: string };
  thinkingLevel?: string;
} {
  const messages: Array<Record<string, unknown>> = [];
  let name: string | undefined;
  let model: { provider?: string; id?: string } | undefined;
  let thinkingLevel: string | undefined;
  for (const entry of entries) {
    if (entry.type === "session_info") {
      const titled = (entry as { name?: string }).name?.trim();
      if (titled) name = titled;
    }
    if (entry.type === "model_change") {
      const change = entry as { provider?: string; modelId?: string };
      model = { provider: change.provider, id: change.modelId };
    }
    if (entry.type === "thinking_level_change") {
      thinkingLevel = (entry as { thinkingLevel?: string }).thinkingLevel;
    }
    if (entry.type !== "message" && entry.type !== "custom_message") continue;
    for (const message of sessionEntryToContextMessages(entry)) {
      const record = message as unknown as Record<string, unknown>;
      if (typeof record.id !== "string" || !record.id) record.id = entry.id;
      messages.push(record);
    }
  }
  return { messages, name, model, thinkingLevel };
}

function countUsers(messages: Array<Record<string, unknown>>): number {
  let count = 0;
  for (const message of messages) {
    if ((message.role ?? "") === "user" && messageText(message).trim()) count += 1;
  }
  return count;
}

function readHeader(sessionPath: string): { id: string; cwd: string; timestamp?: string } {
  const head = readSlice(sessionPath, 0, SESSION_LIST_HEAD_BYTES);
  for (const entry of parseEntries(head, false)) {
    if (entry.type === "session" && typeof (entry as { id?: string }).id === "string") {
      const header = entry as { id: string; cwd?: string; timestamp?: string };
      return { id: header.id, cwd: typeof header.cwd === "string" ? header.cwd : "", timestamp: header.timestamp };
    }
  }
  throw new Error(`Session file is not a valid pi session: ${sessionPath}`);
}

export function listSessionFiles(dir: string): SessionSummary[] {
  if (!existsSync(dir)) return [];
  const summaries: SessionSummary[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const sessionFile = join(dir, name);
    try {
      const stats = statSync(sessionFile);
      const head = readSlice(sessionFile, 0, Math.min(SESSION_LIST_HEAD_BYTES, stats.size));
      const tailStart = Math.max(0, stats.size - SESSION_LIST_TAIL_BYTES);
      const tail = tailStart > 0 ? readSlice(sessionFile, tailStart, stats.size - tailStart) : "";
      const headEntries = parseEntries(head, false);
      const tailEntries = tailStart > 0 ? parseEntries(tail, true) : [];
      const header = headEntries.find((entry) => entry.type === "session") as { id?: string; cwd?: string } | undefined;
      if (!header?.id) continue;
      const meta: { name?: string; model?: { provider?: string; id?: string }; thinkingLevel?: string } = {};
      applyLatestMeta(tailEntries, meta);
      applyLatestMeta(headEntries, meta);
      summaries.push({
        sessionId: header.id,
        cwd: typeof header.cwd === "string" ? header.cwd : "",
        name: displayName(meta.name, firstUserText(collectFromEntries(headEntries).messages)),
        status: "idle",
        model: meta.model?.provider && meta.model.id
          ? `${meta.model.provider}/${meta.model.id}`
          : "",
        thinkingLevel: (meta.thinkingLevel ?? "medium") as SessionSummary["thinkingLevel"],
        sessionFile,
        messageCount: 0,
        updatedAt: stats.mtime.toISOString(),
      });
    } catch {
      // Skip unreadable or corrupt files.
    }
  }
  return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function listSessionsFromCwd(cwd: string): SessionSummary[] {
  return listSessionFiles(defaultSessionDir(cwd));
}

export function readSessionTail(sessionPath: string, tailTurns = 30): {
  sessionId: string;
  cwd: string;
  name: string;
  messages: Array<Record<string, unknown>>;
  hasMore: boolean;
  model?: { provider?: string; id?: string };
  thinkingLevel?: string;
} {
  const header = readHeader(sessionPath);
  const size = statSync(sessionPath).size;
  let scanned = 0;
  let raw = "";
  let start = size;
  let collected = collectFromEntries([]);
  while (scanned < size && scanned < SESSION_VIEW_MAX_BYTES) {
    const length = Math.min(SESSION_VIEW_CHUNK_BYTES, size - scanned);
    start = size - scanned - length;
    raw = trimOversizePrefix(readSlice(sessionPath, start, length) + raw);
    scanned += length;
    collected = collectFromEntries(parseEntries(raw, start > 0));
    if (countUsers(collected.messages) > tailTurns || start === 0) break;
  }
  const meta = readLatestMeta(sessionPath);
  return {
    sessionId: header.id,
    cwd: header.cwd,
    name: displayName(meta.name, readFirstUserFromHead(sessionPath)),
    messages: collected.messages,
    hasMore: start > 0 || countUsers(collected.messages) > tailTurns,
    model: meta.model,
    thinkingLevel: meta.thinkingLevel,
  };
}

export function loadOlderFromFile(
  sessionPath: string,
  beforeId: string,
  limit = 30,
): { items: TimelineItem[]; hasMore: boolean } {
  const size = statSync(sessionPath).size;
  let scanned = 0;
  let raw = "";
  let start = size;
  let messages: Array<Record<string, unknown>> = [];
  const maxBytes = SESSION_VIEW_MAX_BYTES * 4;
  while (scanned < size && scanned < maxBytes) {
    const length = Math.min(SESSION_VIEW_CHUNK_BYTES, size - scanned);
    start = size - scanned - length;
    raw = trimOversizePrefix(readSlice(sessionPath, start, length) + raw);
    scanned += length;
    messages = collectFromEntries(parseEntries(raw, start > 0)).messages;
    if (messages.some((message) => message.id === beforeId) && countUsers(messages) > limit) break;
    if (start === 0) break;
  }
  const page = loadOlderItems({ messages } as never, beforeId, limit);
  if (page.items.length > 0) return page;
  return { items: [], hasMore: start > 0 };
}

export function timelineFromSessionFile(
  sessionPath: string,
  tailTurns = 30,
): { items: TimelineItem[]; hasMore: boolean; tail: ReturnType<typeof readSessionTail> } {
  const tail = readSessionTail(sessionPath, tailTurns);
  return {
    items: hydrateTimeline({ messages: tail.messages } as never, { tailTurns }),
    hasMore: tail.hasMore,
    tail,
  };
}
