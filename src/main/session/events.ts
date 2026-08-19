import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { isTodoToolName } from "@pi-desk/session-todo";
import type { FileChangeSummary, PiEvent, SessionKey, ThinkingLevel } from "../../shared/protocol.js";
import { createFileChangeSummary, filePathFromToolArgs } from "./fileChanges.js";
import { clipText, clipUnknown, messageText, resolveDisplayName } from "./display.js";
import type { RuntimeSlot } from "./types.js";

export interface SessionEventBridge {
  nextId(prefix: string): string;
  emit(
    type: PiEvent["type"],
    payload: PiEvent["payload"],
    raw?: unknown,
    sessionKey?: SessionKey,
  ): void;
  emitLiveSessionsChanged(): void;
  invalidateAccountUsageCache(providerId?: string): void;
  hydrateSessionTodos(slot: RuntimeSlot): void;
  applyTodosFromToolResult(slot: RuntimeSlot, toolName: string | undefined, result: unknown, isError: boolean): void;
  maybeNudgeForTodos(slot: RuntimeSlot): void;
  reconcileTodosAfterTurn(slot: RuntimeSlot): void;
}

function readTextFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

export function trackFileMutationStart(
  slot: RuntimeSlot,
  toolCallId: string | undefined,
  toolName: string | undefined,
  args: unknown,
): void {
  if (!toolCallId || !toolName) return;
  const rawPath = filePathFromToolArgs(toolName, args);
  if (!rawPath) return;
  const absolutePath = resolve(slot.runtime.cwd, rawPath);
  slot.pendingFileMutations.set(toolCallId, {
    path: relative(slot.runtime.cwd, absolutePath).replace(/\\/g, "/") || rawPath,
    absolutePath,
    before: readTextFile(absolutePath),
  });
}

export function finishFileMutation(
  slot: RuntimeSlot,
  toolCallId: string | undefined,
  isError: boolean,
): FileChangeSummary | undefined {
  if (!toolCallId) return undefined;
  const mutation = slot.pendingFileMutations.get(toolCallId);
  slot.pendingFileMutations.delete(toolCallId);
  if (!mutation || isError) return undefined;
  const after = readTextFile(mutation.absolutePath);
  const change = createFileChangeSummary(mutation.path, mutation.before, after);
  if (change) {
    const previous = slot.completedFileMutations.get(mutation.path);
    slot.completedFileMutations.set(mutation.path, {
      path: mutation.path,
      absolutePath: mutation.absolutePath,
      before: previous?.before ?? mutation.before,
      after,
    });
    const clipped = clipText(change.diff);
    return clipped.truncated ? { ...change, diff: clipped.text } : change;
  }
  return change;
}

export function handleSessionEvent(slot: RuntimeSlot, raw: unknown, host: SessionEventBridge): void {
  type SessionEventMessage = {
    role?: string;
    id?: string;
    content?: unknown;
    stopReason?: string;
    errorMessage?: string;
  };
  const event = raw as {
    type?: string;
    message?: SessionEventMessage;
    messages?: SessionEventMessage[];
    willRetry?: boolean;
    assistantMessageEvent?: { type?: string; delta?: string };
    toolCallId?: string;
    toolName?: string;
    args?: unknown;
    partialResult?: unknown;
    result?: unknown;
    isError?: boolean;
    steering?: readonly string[];
    followUp?: readonly string[];
    level?: ThinkingLevel;
    name?: string;
    provider?: unknown;
    summary?: unknown;
  };
  const key = slot.key;
  switch (event.type) {
    case "message_start": {
      const messageId = event.message?.id ?? host.nextId("assistant");
      if (event.message?.role === "assistant") {
        slot.assistantMessageId = messageId;
        host.emit("assistant_message_started", { messageId }, raw, key);
      } else if (event.message?.role === "user") {
        host.emit(
          "user_message_created",
          { messageId, content: messageText(event.message) },
          raw,
          key,
        );
      }
      break;
    }
    case "message_update": {
      const update = event.assistantMessageEvent;
      if (!update) break;
      if (update.type === "text_delta" && update.delta) {
        host.emit(
          "assistant_message_delta",
          { messageId: slot.assistantMessageId ?? host.nextId("assistant"), delta: update.delta },
          raw,
          key,
        );
      }
      if (update.type === "thinking_start") {
        slot.thinkingMessageId = host.nextId("thinking");
        host.emit("thinking_started", { messageId: slot.thinkingMessageId }, raw, key);
      }
      if (update.type === "thinking_delta" && update.delta) {
        host.emit(
          "thinking_delta",
          { messageId: slot.thinkingMessageId ?? host.nextId("thinking"), delta: update.delta },
          raw,
          key,
        );
      }
      if (update.type === "thinking_end" && slot.thinkingMessageId) {
        host.emit("thinking_completed", { messageId: slot.thinkingMessageId }, raw, key);
      }
      break;
    }
    case "message_end":
      if (event.message?.role === "assistant" && slot.assistantMessageId) {
        host.emit("assistant_message_completed", { messageId: slot.assistantMessageId }, raw, key);
      }
      break;
    case "tool_execution_start":
      trackFileMutationStart(slot, event.toolCallId, event.toolName, event.args);
      host.emit(
        "tool_call_started",
        {
          toolCallId: event.toolCallId ?? host.nextId("tool"),
          toolName: event.toolName ?? "tool",
          input: clipUnknown(event.args).text,
        },
        undefined,
        key,
      );
      break;
    case "tool_execution_update":
      if (event.toolCallId) {
        host.emit(
          "tool_call_delta",
          { toolCallId: event.toolCallId, delta: clipUnknown(event.partialResult).text },
          undefined,
          key,
        );
      }
      break;
    case "tool_execution_end": {
      const change = finishFileMutation(slot, event.toolCallId, Boolean(event.isError));
      if (event.toolCallId) {
        host.emit(
          "tool_call_completed",
          {
            toolCallId: event.toolCallId,
            result: clipUnknown(event.result).text,
            isError: Boolean(event.isError),
            ...(change ? { change } : {}),
          },
          undefined,
          key,
        );
      }
      host.applyTodosFromToolResult(slot, event.toolName, event.result, Boolean(event.isError));
      if (!event.toolName || !isTodoToolName(event.toolName)) {
        slot.turnToolCount += 1;
        slot.runToolCount += 1;
        host.maybeNudgeForTodos(slot);
      }
      break;
    }
    case "session_tree":
      host.hydrateSessionTodos(slot);
      slot.todoRevision += 1;
      host.emit(
        "todos_updated",
        { todos: slot.sessionTodos, revision: slot.todoRevision },
        undefined,
        key,
      );
      break;
    case "queue_update":
      host.emit(
        "queue_updated",
        { steering: [...(event.steering ?? [])], followUp: [...(event.followUp ?? [])] },
        raw,
        key,
      );
      break;
    case "thinking_level_changed":
      if (event.level) host.emit("thinking_level_changed", { level: event.level }, raw, key);
      break;
    case "agent_end": {
      if (event.willRetry) {
        slot.status = "running";
        host.emitLiveSessionsChanged();
        break;
      }
      const failedAssistant = [...(event.messages ?? [])]
        .reverse()
        .find((message) => message.role === "assistant" && message.stopReason === "error");
      if (failedAssistant) {
        slot.status = "error";
        host.invalidateAccountUsageCache(slot.runtime.session.model?.provider);
        host.emit(
          "session_error",
          {
            message: failedAssistant.errorMessage?.trim() || "The model request failed without a detailed error.",
          },
          raw,
          key,
        );
        host.emitLiveSessionsChanged();
        break;
      }
      slot.status = "completed";
      host.invalidateAccountUsageCache(slot.runtime.session.model?.provider);
      host.reconcileTodosAfterTurn(slot);
      host.emit(
        "session_completed",
        {
          sessionId: slot.runtime.session.sessionId,
          sessionName: resolveDisplayName(slot.runtime.session),
        },
        raw,
        key,
      );
      host.emitLiveSessionsChanged();
      break;
    }
    case "session_info_changed": {
      const session = slot.runtime.session;
      const name =
        (event.name ?? session?.sessionName ?? "").trim() || resolveDisplayName(session);
      host.emit(
        "session_name_changed",
        {
          name,
          sessionId: session?.sessionId ?? "",
          sessionFile: session?.sessionFile,
        },
        raw,
        key,
      );
      break;
    }
    case "agent_start":
      slot.status = "running";
      slot.runToolCount = 0;
      host.emit("agent_started", {}, raw, key);
      host.emitLiveSessionsChanged();
      break;
    case "turn_start":
      slot.status = "running";
      slot.turnToolCount = 0;
      slot.turnNudged = false;
      host.emit("turn_started", {}, raw, key);
      host.emitLiveSessionsChanged();
      break;
    case "turn_end":
      slot.status = "idle";
      host.invalidateAccountUsageCache(slot.runtime.session.model?.provider);
      host.emit("turn_completed", {}, raw, key);
      host.emitLiveSessionsChanged();
      break;
    case "compaction_start":
      host.emit("compaction_started", {}, raw, key);
      break;
    case "compaction_end":
      host.emit(
        "compaction_completed",
        {
          summary:
            event.result && typeof event.result === "object" && "summary" in event.result
              ? String((event.result as { summary?: unknown }).summary ?? "") || undefined
              : undefined,
        },
        raw,
        key,
      );
      break;
    case "auto_retry_start":
      host.emit("auto_retry_started", {}, raw, key);
      break;
    case "auto_retry_end":
      host.emit("auto_retry_completed", {}, raw, key);
      break;
    case "model_select":
      if (event.name) {
        host.emit(
          "model_select",
          { model: event.name, provider: event.provider ? String(event.provider) : undefined },
          raw,
          key,
        );
      }
      break;
    default:
      break;
  }
}
