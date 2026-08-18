import { getActiveProjectId, listProjects } from "../workspace/projectCatalog.js";
import { createFileChangeSummaryFromPatch, filePathFromToolInput } from "./fileChanges.js";
import { messageText, modelName, resolveDisplayName, stringify } from "./display.js";
import type { PiRuntimeLike, PiSessionLike } from "./types.js";
import type {
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
const TOOL_TEXT_LIMIT = 8 * 1024;

export function clipToolText(text: string): { text: string; truncated: boolean } {
  if (text.length <= TOOL_TEXT_LIMIT) return { text, truncated: false };
  return { text: text.slice(0, TOOL_TEXT_LIMIT), truncated: true };
}

function takeTailTurns(items: TimelineItem[], tailTurns: number): TimelineItem[] {
  if (!Number.isFinite(tailTurns)) return items;
  if (tailTurns <= 0) return [];
  const userIndexes = items.flatMap((item, index) => item.kind === "user" ? [index] : []);
  if (userIndexes.length <= tailTurns) return items;
  return items.slice(userIndexes[userIndexes.length - tailTurns]!);
}

export function hydrateAllTurns(session?: PiSessionLike): TimelineItem[] {
  let messages = (session?.messages ?? []) as Array<Record<string, unknown>>;
  if (messages.length === 0) {
    const manager = session?.sessionManager as { buildSessionContext?: () => { messages?: unknown[] } } | undefined;
    messages = (manager?.buildSessionContext?.().messages ?? []) as Array<Record<string, unknown>>;
  }

  const items: TimelineItem[] = [];
  const toolPaths = new Map<string, string>();
  for (const [index, raw] of messages.entries()) {
    const message = raw as {
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
    const baseId = message.id ?? `hist-${index}`;
    const role = message.role ?? "";

    if (role === "user") {
      const content = messageText(message);
      if (content.trim()) items.push({ id: baseId, kind: "user", content, status: "completed" });
      continue;
    }

    if (role === "assistant") {
      const parts = Array.isArray(message.content) ? message.content : undefined;
      if (!parts) {
        const content = messageText(message);
        if (content.trim()) items.push({ id: baseId, kind: "assistant", content, status: "completed" });
        continue;
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
          const clipped = clipToolText(stringify(record.arguments ?? record.input ?? record.args ?? {}));
          items.push({
            id: toolId,
            kind: "tool",
            toolCallId: toolId,
            toolName,
            input: clipped.text,
            status: "completed",
            ...(clipped.truncated ? { truncated: true } : {}),
          });
          const path = filePathFromToolInput(toolName, clipped.text);
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
      continue;
    }

    if (role === "toolResult" || role === "tool") {
      const path = toolPaths.get(message.toolCallId ?? baseId);
      const details = message.details as { patch?: unknown } | undefined;
      const change = path && typeof details?.patch === "string"
        ? createFileChangeSummaryFromPatch(path, details.patch)
        : undefined;
      const output = clipToolText(messageText(message) || stringify(message.content));
      items.push({
        id: baseId,
        kind: "tool",
        toolCallId: message.toolCallId ?? baseId,
        toolName: message.toolName ?? "tool",
        input: "",
        output: output.text,
        status: message.isError ? "error" : "completed",
        ...(change ? { change } : {}),
        ...(output.truncated ? { truncated: true } : {}),
      });
      continue;
    }

    if (role === "bashExecution") {
      const input = clipToolText(String(message.command ?? ""));
      const output = clipToolText(String(message.output ?? ""));
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

  return items;
}

function sessionMessages(session?: PiSessionLike): Array<Record<string, unknown>> {
  let messages = (session?.messages ?? []) as Array<Record<string, unknown>>;
  if (messages.length === 0) {
    const manager = session?.sessionManager as { buildSessionContext?: () => { messages?: unknown[] } } | undefined;
    messages = (manager?.buildSessionContext?.().messages ?? []) as Array<Record<string, unknown>>;
  }
  return messages;
}

export function countUserTurns(session?: PiSessionLike): number {
  let count = 0;
  for (const raw of sessionMessages(session)) {
    const role = (raw as { role?: string }).role ?? "";
    if (role !== "user") continue;
    if (messageText(raw).trim()) count += 1;
  }
  return count;
}

export function hydrateTimeline(
  session?: PiSessionLike,
  opts?: { tailTurns?: number },
): TimelineItem[] {
  return takeTailTurns(hydrateAllTurns(session), opts?.tailTurns ?? DEFAULT_TAIL_TURNS);
}

export function timelineHasMore(session?: PiSessionLike, opts?: { tailTurns?: number }): boolean {
  const tailTurns = opts?.tailTurns ?? DEFAULT_TAIL_TURNS;
  if (!Number.isFinite(tailTurns)) return false;
  return countUserTurns(session) > tailTurns;
}

export function loadOlderItems(
  session: PiSessionLike | undefined,
  beforeId: string,
  limit = DEFAULT_TAIL_TURNS,
): { items: TimelineItem[]; hasMore: boolean } {
  const all = hydrateAllTurns(session);
  const beforeIndex = all.findIndex((item) => item.id === beforeId);
  if (beforeIndex <= 0) return { items: [], hasMore: false };
  const prior = all.slice(0, beforeIndex);
  const userIndexes = prior.flatMap((item, index) => item.kind === "user" ? [index] : []);
  const cut = userIndexes.length > limit ? userIndexes[userIndexes.length - limit]! : 0;
  return { items: prior.slice(cut), hasMore: cut > 0 };
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
