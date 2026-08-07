import { create } from "zustand";
import type { IndexStatus } from "@pi-desk/code-index";
import type {
  PiEvent,
  PiSnapshot,
  ProviderLoginState,
  ResourceSnapshot,
  RuntimeDiagnostics,
  SessionState,
  TimelineItem,
  ToolCallState,
} from "../../shared/protocol";

export type { PiEvent } from "../../shared/protocol";

const emptyResources: ResourceSnapshot = {
  contextFiles: [],
  skills: [],
  promptTemplates: [],
  themes: [],
  extensions: [],
  packages: [],
};

const emptyDiagnostics: RuntimeDiagnostics = {
  piVersion: "unknown",
  sequence: 0,
  messages: [],
  errors: [],
};

const emptySession: SessionState = {
  sessionId: "",
  cwd: "",
  name: "Untitled session",
  status: "idle",
  model: "",
  provider: "",
  thinkingLevel: "medium",
  contextTokens: 0,
  contextWindow: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cost: 0,
  todos: [],
  todosRevision: 0,
  modeState: {
    mode: "execute",
    planProfile: { thinkingLevel: "medium" },
    executeProfile: { thinkingLevel: "medium" },
  },
};

export type AppState = PiSnapshot & {
  providerLogins: Record<string, ProviderLoginState>;
  indexStatus: IndexStatus | null;
  /** Id of the todo currently in_progress; trace rows are grouped under it. */
  activeTaskId?: string;
};

export function createInitialState(): AppState {
  return {
    workspaceId: "local",
    session: { ...emptySession },
    sessions: [],
    projects: [],
    activeProjectId: undefined,
    timeline: [],
    toolCalls: {},
    queue: { steering: [], followUp: [] },
    resources: emptyResources,
    diagnostics: emptyDiagnostics,
    models: [],
    tools: [],
    providerLogins: {},
    indexStatus: null,
    activeTaskId: undefined,
  };
}

function updateTimelineItem(timeline: TimelineItem[], id: string, update: (item: TimelineItem) => TimelineItem): TimelineItem[] {
  return timeline.map((item) => (item.id === id ? update(item) : item));
}

/**
 * Update the last timeline divider carrying `fromLabel` in place. Used to
 * promote a started (compacting/retrying) divider to its completed state.
 */
type DividerItem = Extract<TimelineItem, { kind: "divider" }>;
type DividerLabel = DividerItem["label"];

/**
 * Update the last timeline divider carrying `fromLabel` in place. Used to
 * promote a started (compacting/retrying) divider to its completed state.
 */
function updateLastDivider(
  timeline: TimelineItem[],
  fromLabel: DividerLabel,
  update: (item: DividerItem) => DividerItem,
): TimelineItem[] {
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const item = timeline[i]!;
    if (item.kind === "divider" && item.label === fromLabel) {
      const next = [...timeline];
      next[i] = update(item);
      return next;
    }
  }
  return timeline;
}

export function reducePiEvent(state: AppState, event: PiEvent): AppState {
  switch (event.type) {
    case "session_started":
      return {
        ...state,
        workspaceId: event.workspaceId,
        session: {
          ...emptySession,
          sessionId: event.payload.sessionId,
          cwd: event.payload.cwd,
          name: event.payload.sessionName ?? "Untitled session",
          model: event.payload.model ?? "",
          thinkingLevel: event.payload.thinkingLevel ?? "medium",
          status: "idle",
        },
        timeline: [],
        toolCalls: {},
        queue: { steering: [], followUp: [] },
        lastError: undefined,
        activeTaskId: undefined,
      };
    case "user_message_created": {
      // Mirror sidebar naming: until an explicit name exists, use first user text as title.
      const content = (event.payload.content ?? "").trim();
      const currentName = (state.session.name ?? "").trim();
      const isGenericTitle =
        !currentName ||
        currentName === "Untitled" ||
        currentName === "Untitled session" ||
        currentName === "undefined" ||
        currentName === "New session";
      const nextName =
        isGenericTitle && content ? content.slice(0, 64) : state.session.name;
      return {
        ...state,
        session: { ...state.session, status: "running", name: nextName },
        timeline: [
          ...state.timeline,
          {
            id: event.payload.messageId,
            kind: "user",
            content: event.payload.content,
            status: "completed",
            startedAt: event.timestamp,
            completedAt: event.timestamp,
          },
        ],
      };
    }
    case "assistant_message_started":
      return {
        ...state,
        session: { ...state.session, status: "running" },
        timeline: [
          ...state.timeline,
          { id: event.payload.messageId, kind: "assistant", content: "", status: "streaming", startedAt: event.timestamp },
        ],
      };
    case "assistant_message_delta":
      return {
        ...state,
        timeline: updateTimelineItem(state.timeline, event.payload.messageId, (item) => item.kind === "assistant" ? { ...item, content: item.content + event.payload.delta } : item),
      };
    case "assistant_message_completed":
      return {
        ...state,
        timeline: updateTimelineItem(state.timeline, event.payload.messageId, (item) => item.kind === "assistant"
          ? { ...item, status: "completed", completedAt: event.timestamp }
          : item),
      };
    case "thinking_started":
      return {
        ...state,
        timeline: [
          ...state.timeline,
          { id: event.payload.messageId, kind: "thinking", content: "", status: "streaming", startedAt: event.timestamp, ...(state.activeTaskId ? { taskId: state.activeTaskId } : {}) },
        ],
      };
    case "thinking_delta":
      return { ...state, timeline: updateTimelineItem(state.timeline, event.payload.messageId, (item) => item.kind === "thinking" ? { ...item, content: item.content + event.payload.delta } : item) };
    case "thinking_completed":
      return {
        ...state,
        timeline: updateTimelineItem(state.timeline, event.payload.messageId, (item) => item.kind === "thinking"
          ? { ...item, status: "completed", completedAt: event.timestamp }
          : item),
      };
    case "tool_call_started": {
      const tool: ToolCallState = { id: event.payload.toolCallId, toolName: event.payload.toolName, input: event.payload.input, status: "running" };
      return {
        ...state,
        toolCalls: { ...state.toolCalls, [tool.id]: tool },
        session: { ...state.session, status: "running" },
        timeline: [
          ...state.timeline,
          {
            id: tool.id,
            kind: "tool",
            toolCallId: tool.id,
            toolName: tool.toolName,
            input: tool.input,
            status: tool.status,
            startedAt: event.timestamp,
            ...(state.activeTaskId ? { taskId: state.activeTaskId } : {}),
          },
        ],
      };
    }
    case "tool_call_delta": {
      const current = state.toolCalls[event.payload.toolCallId];
      if (!current) return state;
      const output = (current.output ?? "") + event.payload.delta;
      return {
        ...state,
        toolCalls: { ...state.toolCalls, [current.id]: { ...current, output } },
        timeline: updateTimelineItem(state.timeline, current.id, (item) => item.kind === "tool" ? { ...item, output } : item),
      };
    }
    case "tool_call_completed": {
      const current = state.toolCalls[event.payload.toolCallId];
      if (!current) return state;
      const status = event.payload.isError ? "error" : "completed";
      return {
        ...state,
        toolCalls: { ...state.toolCalls, [current.id]: { ...current, output: event.payload.result, status, change: event.payload.change } },
        timeline: updateTimelineItem(state.timeline, current.id, (item) => item.kind === "tool"
          ? { ...item, output: event.payload.result, status, change: event.payload.change, completedAt: event.timestamp }
          : item),
      };
    }
    case "file_change_undone": {
      const path = event.payload.path;
      const timeline = state.timeline.map((item) => item.kind === "tool" && item.change?.path === path
        ? { ...item, change: undefined }
        : item);
      const toolCalls = Object.fromEntries(
        Object.entries(state.toolCalls).map(([id, tool]) => [id, tool.change?.path === path ? { ...tool, change: undefined } : tool]),
      );
      return { ...state, timeline, toolCalls };
    }
    case "queue_updated":
      return { ...state, queue: event.payload };
    case "model_changed":
      return { ...state, session: { ...state.session, model: event.payload.model, provider: event.payload.provider } };
    case "thinking_level_changed":
      return { ...state, session: { ...state.session, thinkingLevel: event.payload.level } };
    case "mode_changed":
      return {
        ...state,
        session: {
          ...state.session,
          modeState: event.payload,
          model: event.payload.mode === "plan"
            ? event.payload.planProfile.modelKey ?? state.session.model
            : event.payload.executeProfile.modelKey ?? state.session.model,
          thinkingLevel: event.payload.mode === "plan"
            ? event.payload.planProfile.thinkingLevel
            : event.payload.executeProfile.thinkingLevel,
        },
      };
    case "plan_artifact_changed":
      return {
        ...state,
        session: state.session.modeState
          ? { ...state.session, modeState: { ...state.session.modeState, activePlan: event.payload.plan } }
          : state.session,
      };
    case "resource_snapshot":
      return { ...state, resources: event.payload };
    case "diagnostics_updated":
      return { ...state, diagnostics: event.payload };
    case "notification_created":
      return {
        ...state,
        timeline: [
          ...state.timeline,
          {
            id: event.eventId,
            kind: "notification",
            content: event.payload.message,
            status: "completed",
            startedAt: event.timestamp,
            completedAt: event.timestamp,
          },
        ],
      };
    case "agent_started":
    case "turn_started":
      return { ...state, session: { ...state.session, status: "running" } };
    case "compaction_started":
      return {
        ...state,
        session: { ...state.session, status: "running" },
        timeline: [
          ...state.timeline,
          {
            id: event.eventId,
            kind: "divider",
            label: "compacting",
            status: "running",
            startedAt: event.timestamp,
          },
        ],
      };
    case "auto_retry_started":
      return {
        ...state,
        session: { ...state.session, status: "running" },
        timeline: [
          ...state.timeline,
          {
            id: event.eventId,
            kind: "divider",
            label: "retrying",
            status: "running",
            startedAt: event.timestamp,
          },
        ],
      };
    case "turn_completed":
      return { ...state, session: { ...state.session, status: "completed" } };
    // Compaction and retry are sub-steps of an active agent run. Their end
    // promotes the divider to its finished state but must not make the global
    // run indicator appear finished before agent_end.
    case "compaction_completed":
      return {
        ...state,
        timeline: updateLastDivider(state.timeline, "compacting", (item) => ({
          ...item,
          label: "compacted",
          status: "completed",
          completedAt: event.timestamp,
          ...(event.payload.summary ? { detail: event.payload.summary } : {}),
        })),
      };
    case "auto_retry_completed":
      return {
        ...state,
        timeline: updateLastDivider(state.timeline, "retrying", (item) => ({
          ...item,
          label: "retried",
          status: "completed",
          completedAt: event.timestamp,
        })),
      };
    case "model_select":
      return { ...state, session: { ...state.session, model: event.payload.model ?? state.session.model, provider: event.payload.provider ?? state.session.provider } };
    case "session_completed":
      return { ...state, session: { ...state.session, status: "completed" } };
    case "session_error":
      return {
        ...state,
        session: { ...state.session, status: "error" },
        lastError: event.payload.message,
        timeline: [
          ...state.timeline,
          {
            id: event.eventId,
            kind: "error",
            content: event.payload.message,
            status: "error",
            startedAt: event.timestamp,
            completedAt: event.timestamp,
          },
        ],
      };
    case "session_name_changed": {
      const { name, sessionId, sessionFile } = event.payload;
      const isActive =
        (sessionId && sessionId === state.session.sessionId) ||
        (sessionFile && sessionFile === state.session.sessionFile) ||
        (!sessionId && !sessionFile);
      return {
        ...state,
        session: isActive ? { ...state.session, name } : state.session,
        sessions: state.sessions.map((item) => {
          const match =
            (sessionId && item.sessionId === sessionId) ||
            (sessionFile && item.sessionFile === sessionFile);
          return match ? { ...item, name } : item;
        }),
      };
    }
    case "provider_login_event": {
      const { providerId, event: loginEvent } = event.payload;
      const current = state.providerLogins[providerId];
      const events = current ? [...current.events, loginEvent] : [loginEvent];
      let next: ProviderLoginState;
      if (loginEvent.type === "done") {
        next = { status: "done", events };
      } else if (loginEvent.type === "error") {
        next = { status: "error", events };
      } else {
        // prompt / auth_url / device_code / info / progress keep it running.
        next = { status: "running", events };
      }
      return { ...state, providerLogins: { ...state.providerLogins, [providerId]: next } };
    }
    case "index_status_changed":
      return { ...state, indexStatus: event.payload.status };
    case "todos_updated": {
      const currentRevision = state.session.todosRevision ?? 0;
      const incomingRevision = event.payload.revision ?? currentRevision;
      if (incomingRevision < currentRevision) return state;
      const activeTaskId = event.payload.todos.find((todo) => todo.status === "in_progress")?.id;
      return {
        ...state,
        activeTaskId,
        session: {
          ...state.session,
          todos: event.payload.todos,
          todosRevision: incomingRevision,
        },
      };
    }
    case "mcp_status_updated":
      return { ...state, resources: { ...state.resources, mcp: event.payload } };
    default:
      return state;
  }
}

interface AppStore extends AppState {
  applyEvent: (event: PiEvent) => void;
  replaceSnapshot: (snapshot: PiSnapshot) => void;
  clearProviderLogin: (providerId: string) => void;
}

/**
 * Streaming deltas arrive at token rate from the provider (dozens per second
 * for fast models with high thinking). Applying each one as its own state
 * update forces a full React re-render of the timeline on every token, which
 * is what froze the UI on long sessions. Coalesce these three event types so
 * consecutive deltas for the same message collapse into one update per flush
 * interval. The reducer appends `delta` to the existing content, so
 * concatenating deltas produces identical final state.
 */
const COALESCED_DELTA_TYPES = new Set<PiEvent["type"]>([
  "assistant_message_delta",
  "thinking_delta",
  "tool_call_delta",
]);

/** Upper bound between a delta arriving and its coalesced flush. */
const DELTA_FLUSH_INTERVAL_MS = 50;

type DeltaEvent = Extract<
  PiEvent,
  { type: "assistant_message_delta" | "thinking_delta" | "tool_call_delta" }
>;

function deltaBufferKey(event: DeltaEvent): string {
  if (event.type === "tool_call_delta") return `${event.type}:${event.payload.toolCallId}`;
  return `${event.type}:${event.payload.messageId}`;
}

export const useAppStore = create<AppStore>((set) => {
  const pendingDeltas = new Map<string, { first: DeltaEvent; delta: string }>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flushPendingDeltas = (): void => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (pendingDeltas.size === 0) return;
    // Each buffered entry carries a delta payload whose `delta` field we have
    // accumulated; the resulting object is a valid PiEvent for its type.
    const events = [...pendingDeltas.values()].map(
      ({ first, delta }) => ({
        ...first,
        payload: { ...first.payload, delta },
      }) as PiEvent,
    );
    pendingDeltas.clear();
    // Fold every coalesced delta into one `set` so React renders once.
    set((state) => {
      let next: AppState = state;
      for (const event of events) next = reducePiEvent(next, event);
      return next;
    });
  };

  return {
    ...createInitialState(),
    applyEvent: (event) => {
      if (COALESCED_DELTA_TYPES.has(event.type)) {
        const deltaEvent = event as DeltaEvent;
        const key = deltaBufferKey(deltaEvent);
        const pending = pendingDeltas.get(key);
        if (pending) pending.delta += deltaEvent.payload.delta;
        else pendingDeltas.set(key, { first: deltaEvent, delta: deltaEvent.payload.delta });
        if (flushTimer === null) {
          flushTimer = setTimeout(flushPendingDeltas, DELTA_FLUSH_INTERVAL_MS);
        }
        return;
      }
      // Any non-delta event must observe the coalesced deltas that precede it.
      flushPendingDeltas();
      set((state) => reducePiEvent(state, event));
    },
    clearProviderLogin: (providerId) =>
      set((state) => {
        if (!(providerId in state.providerLogins)) return state;
        const providerLogins = { ...state.providerLogins };
        delete providerLogins[providerId];
        return { ...state, providerLogins };
      }),
    replaceSnapshot: (snapshot) => {
      // A snapshot rewrites the timeline wholesale; never drop unflushed deltas.
      flushPendingDeltas();
      set((state) => {
        // Prefer non-empty project lists from either side; never wipe known projects with [].
        const incoming = snapshot.projects;
        const existing = state.projects ?? [];
        const nextProjects =
          incoming && incoming.length > 0
            ? incoming
            : existing.length > 0
              ? existing
              : incoming ?? existing;
        const nextActive =
          snapshot.activeProjectId ??
          state.activeProjectId ??
          nextProjects[0]?.id;
        const nextSession = {
          ...state.session,
          ...snapshot.session,
          cwd: snapshot.session?.cwd || state.session.cwd,
        };
        const sameSession =
          Boolean(state.session.sessionId) &&
          state.session.sessionId === snapshot.session.sessionId;
        if (
          sameSession &&
          (state.session.todosRevision ?? 0) > (snapshot.session.todosRevision ?? 0)
        ) {
          nextSession.todos = state.session.todos;
          nextSession.todosRevision = state.session.todosRevision;
        }
        return {
          ...state,
          ...snapshot,
          projects: nextProjects,
          activeProjectId: nextActive,
          // Always take timeline/toolCalls from the snapshot after resume/start.
          timeline: snapshot.timeline ?? [],
          toolCalls: snapshot.toolCalls ?? {},
          session: nextSession,
          activeTaskId: nextSession.todos?.find((todo) => todo.status === "in_progress")?.id,
        };
      });
    },
  };
});
