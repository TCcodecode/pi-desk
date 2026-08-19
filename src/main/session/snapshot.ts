import { getActiveProjectId, listProjects } from "../workspace/projectCatalog.js";
import { createFileChangeSummaryFromPatch, filePathFromToolArgs } from "./fileChanges.js";
import { clipText, clipUnknown, messageText, modelName, resolveDisplayName } from "./display.js";
import type { PiRuntimeLike, PiSessionLike } from "./types.js";
import type {
  FileChangeSummary,
  ModelOption,
  PiSnapshot,
  ResourceSnapshot,
  SessionModeState,
  SessionTodoItem,
  ThinkingLevel,
  TimelineItem,
  ToolCallState,
  ToolOption,
} from "../../shared/protocol.js";

const DEFAULT_TAIL_TURNS = 30;

export function clipToolText(text: string): { text: string; truncated: boolean } {
  return clipText(text);
}

type RawMessage = {
  role?: string;
  id?: string;
  content?: unknown;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  details?: unknown;
  command?: string;
  output?: string;
  exitCode?: number;
};

function sessionMessages(session?: PiSessionLike): RawMessage[] {
  let messages = (session?.messages ?? []) as RawMessage[];
  if (messages.length === 0) {
    const manager = session?.sessionManager as { buildSessionContext?: () => { messages?: unknown[] } } | undefined;
    messages = (manager?.buildSessionContext?.().messages ?? []) as RawMessage[];
  }
  return messages;
}

function baseIdFor(message: RawMessage, index: number): string {
  return message.id ?? `hist-${index}`;
}

function isCountableUser(message: RawMessage): boolean {
  return (message.role ?? "") === "user" && Boolean(messageText(message).trim());
}

function findTailStartIndex(messages: RawMessage[], tailTurns: number, end = messages.length): number {
  if (!Number.isFinite(tailTurns)) return 0;
  if (tailTurns <= 0) return end;
  let found = 0;
  for (let i = end - 1; i >= 0; i -= 1) {
    if (!isCountableUser(messages[i]!)) continue;
    found += 1;
    if (found === tailTurns) return i;
  }
  return 0;
}

function hasUserBefore(messages: RawMessage[], start: number): boolean {
  for (let i = start - 1; i >= 0; i -= 1) {
    if (isCountableUser(messages[i]!)) return true;
  }
  return false;
}

function messageContainsId(message: RawMessage, index: number, id: string): boolean {
  const baseId = baseIdFor(message, index);
  if (baseId === id) return true;
  if ((message.role ?? "") !== "assistant" || !Array.isArray(message.content)) return false;
  for (const [partIndex, part] of message.content.entries()) {
    if (typeof part === "string") {
      if (`${baseId}-text-${partIndex}` === id) return true;
      continue;
    }
    if (typeof part !== "object" || part === null) continue;
    const record = part as { type?: string; id?: string; toolCallId?: string };
    if (record.type === "thinking") {
      if (`${baseId}-thinking-${partIndex}` === id) return true;
      continue;
    }
    if (record.type === "toolCall" || record.type === "tool_use" || record.type === "functionCall") {
      const toolId = record.id ?? record.toolCallId ?? `${baseId}-tool-${partIndex}`;
      if (toolId === id) return true;
      continue;
    }
    if (`${baseId}-text-${partIndex}` === id) return true;
  }
  return false;
}

function clipChange(change: FileChangeSummary | undefined): { change?: FileChangeSummary; truncated: boolean } {
  if (!change) return { truncated: false };
  const clipped = clipText(change.diff);
  return {
    change: clipped.truncated ? { ...change, diff: clipped.text } : change,
    truncated: clipped.truncated,
  };
}

function clipMessageBody(message: RawMessage): { text: string; truncated: boolean } {
  if (typeof message.content === "string") return clipText(message.content);
  if (message.content !== undefined) return clipUnknown(message.content);
  return clipText(messageText(message));
}

function appendHydratedMessage(
  message: RawMessage,
  index: number,
  items: TimelineItem[],
  toolPaths: Map<string, string>,
): void {
  const baseId = baseIdFor(message, index);
  const role = message.role ?? "";

  if (role === "user") {
    const content = messageText(message);
    if (content.trim()) items.push({ id: baseId, kind: "user", content, status: "completed" });
    return;
  }

  if (role === "assistant") {
    const parts = Array.isArray(message.content) ? message.content : undefined;
    if (!parts) {
      const content = messageText(message);
      if (content.trim()) items.push({ id: baseId, kind: "assistant", content, status: "completed" });
      return;
    }
    for (const [partIndex, part] of parts.entries()) {
      if (typeof part === "string") {
        if (part.trim()) items.push({ id: `${baseId}-text-${partIndex}`, kind: "assistant", content: part, status: "completed" });
        continue;
      }
      if (typeof part !== "object" || part === null) continue;
      const record = part as {
        type?: string;
        id?: string;
        toolCallId?: string;
        name?: string;
        toolName?: string;
        arguments?: unknown;
        input?: unknown;
        args?: unknown;
        thinking?: unknown;
        text?: unknown;
        content?: unknown;
      };
      if (record.type === "thinking") {
        const content = String(record.thinking ?? record.text ?? "");
        if (content.trim()) items.push({ id: `${baseId}-thinking-${partIndex}`, kind: "thinking", content, status: "completed" });
        continue;
      }
      if (record.type === "toolCall" || record.type === "tool_use" || record.type === "functionCall") {
        const toolId = record.id ?? record.toolCallId ?? `${baseId}-tool-${partIndex}`;
        const toolName = record.name ?? record.toolName ?? "tool";
        const args = record.arguments ?? record.input ?? record.args ?? {};
        const path = filePathFromToolArgs(toolName, args);
        const clipped = clipUnknown(args);
        items.push({
          id: toolId,
          kind: "tool",
          toolCallId: toolId,
          toolName,
          input: clipped.text,
          status: "completed",
          ...(clipped.truncated ? { truncated: true } : {}),
        });
        if (path) toolPaths.set(toolId, path);
        continue;
      }
      const content = record.type === "text" || "text" in record
        ? String(record.text ?? "")
        : typeof record.content === "string"
          ? record.content
          : "";
      if (content.trim()) items.push({ id: `${baseId}-text-${partIndex}`, kind: "assistant", content, status: "completed" });
    }
    return;
  }

  if (role === "toolResult" || role === "tool") {
    const path = toolPaths.get(message.toolCallId ?? baseId);
    const details = message.details as { patch?: unknown } | undefined;
    const { change, truncated: changeTruncated } = clipChange(
      path && typeof details?.patch === "string"
        ? createFileChangeSummaryFromPatch(path, details.patch)
        : undefined,
    );
    const output = clipMessageBody(message);
    items.push({
      id: baseId,
      kind: "tool",
      toolCallId: message.toolCallId ?? baseId,
      toolName: message.toolName ?? "tool",
      input: "",
      output: output.text,
      status: message.isError ? "error" : "completed",
      ...(change ? { change } : {}),
      ...(output.truncated || changeTruncated ? { truncated: true } : {}),
    });
    return;
  }

  if (role === "bashExecution") {
    const input = clipText(String(message.command ?? ""));
    const output = clipText(String(message.output ?? ""));
    items.push({
      id: baseId,
      kind: "tool",
      toolCallId: baseId,
      toolName: "bash",
      input: input.text,
      output: output.text,
      status: message.exitCode && message.exitCode !== 0 ? "error" : "completed",
      ...(input.truncated || output.truncated ? { truncated: true } : {}),
    });
  }
}

function hydrateRange(messages: RawMessage[], start: number, end: number): TimelineItem[] {
  const items: TimelineItem[] = [];
  const toolPaths = new Map<string, string>();
  for (let index = start; index < end; index += 1) {
    appendHydratedMessage(messages[index]!, index, items, toolPaths);
  }
  return items;
}

export function hydrateAllTurns(session?: PiSessionLike): TimelineItem[] {
  const messages = sessionMessages(session);
  return hydrateRange(messages, 0, messages.length);
}

export function countUserTurns(session?: PiSessionLike): number {
  let count = 0;
  for (const message of sessionMessages(session)) {
    if (isCountableUser(message)) count += 1;
  }
  return count;
}

export function hydrateTimeline(
  session?: PiSessionLike,
  opts?: { tailTurns?: number },
): TimelineItem[] {
  const messages = sessionMessages(session);
  const start = findTailStartIndex(messages, opts?.tailTurns ?? DEFAULT_TAIL_TURNS);
  return hydrateRange(messages, start, messages.length);
}

export function timelineHasMore(session?: PiSessionLike, opts?: { tailTurns?: number }): boolean {
  const tailTurns = opts?.tailTurns ?? DEFAULT_TAIL_TURNS;
  if (!Number.isFinite(tailTurns)) return false;
  const messages = sessionMessages(session);
  let found = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (!isCountableUser(messages[i]!)) continue;
    found += 1;
    if (found > tailTurns) return true;
  }
  return false;
}

export function loadOlderItems(
  session: PiSessionLike | undefined,
  beforeId: string,
  limit = DEFAULT_TAIL_TURNS,
): { items: TimelineItem[]; hasMore: boolean } {
  const messages = sessionMessages(session);
  let beforeIndex = -1;
  for (let i = 0; i < messages.length; i += 1) {
    if (messageContainsId(messages[i]!, i, beforeId)) {
      beforeIndex = i;
      break;
    }
  }
  if (beforeIndex <= 0) return { items: [], hasMore: false };
  const start = findTailStartIndex(messages, limit, beforeIndex);
  return { items: hydrateRange(messages, start, beforeIndex), hasMore: hasUserBefore(messages, start) };
}

export function hydrateToolCallsFromItems(items: TimelineItem[]): Record<string, ToolCallState> {
  const toolCalls: Record<string, ToolCallState> = {};
  for (const item of items) {
    if (item.kind !== "tool") continue;
    toolCalls[item.toolCallId] = {
      id: item.toolCallId,
      toolName: item.toolName,
      input: item.input,
      output: item.output,
      status: item.status === "error" ? "error" : "completed",
    };
  }
  return toolCalls;
}

export function hydrateToolCalls(session?: PiSessionLike): Record<string, ToolCallState> {
  return hydrateToolCallsFromItems(hydrateTimeline(session));
}

export function buildSnapshot(input: {
  workspaceId: string;
  workspaceCwd?: string;
  sequence: number;
  runtime?: PiRuntimeLike;
  sessionTodos: SessionTodoItem[];
  modeState?: SessionModeState;
  resources: ResourceSnapshot;
  models?: ModelOption[];
  tools?: ToolOption[];
  includeTimeline?: boolean;
  tailTurns?: number;
}): PiSnapshot {
  const session = input.runtime?.session;
  const includeTimeline = input.includeTimeline !== false;
  const tailOpts = { tailTurns: input.tailTurns ?? DEFAULT_TAIL_TURNS };
  const timeline = includeTimeline ? hydrateTimeline(session, tailOpts) : [];
  const stats = session?.getSessionStats();
  const usage = session?.getContextUsage?.();
  const queue = {
    steering: session?.getSteeringMessages ? [...session.getSteeringMessages()] : [],
    followUp: session?.getFollowUpMessages ? [...session.getFollowUpMessages()] : [],
  };
  const projects = listProjects();
  const activeProjectId = getActiveProjectId() ?? (input.workspaceCwd ? input.workspaceCwd : undefined);
  return {
    workspaceId: input.workspaceId,
    session: {
      sessionId: session?.sessionId ?? "",
      cwd: input.runtime?.cwd ?? input.workspaceCwd ?? "",
      name: session ? resolveDisplayName(session) : "Untitled session",
      status: session?.isStreaming ? "running" : "idle",
      model: session ? modelName(session) : "",
      provider: session?.model?.provider ?? "",
      thinkingLevel: (session?.thinkingLevel ?? "medium") as ThinkingLevel,
      contextTokens: usage?.tokens ?? 0,
      contextWindow: usage?.contextWindow ?? 0,
      inputTokens: stats?.tokens.input ?? 0,
      outputTokens: stats?.tokens.output ?? 0,
      cacheReadTokens: stats?.tokens.cacheRead ?? 0,
      cacheWriteTokens: stats?.tokens.cacheWrite ?? 0,
      cost: stats?.cost ?? 0,
      sessionFile: session?.sessionFile,
      todos: input.sessionTodos,
      modeState: input.runtime ? input.modeState : undefined,
    },
    sessions: [],
    projects,
    activeProjectId,
    timeline,
    toolCalls: hydrateToolCallsFromItems(timeline),
    timelineHasMore: includeTimeline ? timelineHasMore(session, tailOpts) : false,
    queue,
    resources: input.resources,
    models: input.models,
    tools: input.tools,
    diagnostics: {
      piVersion: "0.83.0",
      sdkSessionId: session?.sessionId,
      sessionFile: session?.sessionFile,
      sequence: input.sequence,
      messages: input.runtime?.diagnostics?.map((d) => d.message ?? "") ?? [],
      errors: input.runtime?.diagnostics?.filter((d) => d.type === "error").map((d) => d.message ?? "") ?? [],
    },
  };
}
