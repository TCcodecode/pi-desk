import { create } from "zustand";
import type { PiEvent, PiSnapshot } from "../../shared/protocol";
import { useWorkspaceStore } from "../workspace/workspaceStore";
import {
  applyEventToView,
  applySnapshotToView,
  createView,
  remapViewKey,
  type SessionView,
} from "./views";
import {
  createInitialState as createBaseState,
  reducePiEvent,
  type AppState as BaseAppState,
} from "./reduce";

export type { PiEvent } from "../../shared/protocol";
export { reducePiEvent } from "./reduce";
export type { SessionView } from "./views";

export type AppState = BaseAppState & {
  views: Record<string, SessionView>;
};

export function createInitialState(): AppState {
  return { ...createBaseState(), views: {} };
}

const GLOBAL_EVENT_TYPES = new Set<PiEvent["type"]>([
  "provider_login_event",
  "index_status_changed",
  "mcp_status_updated",
  "diagnostics_updated",
  "resource_snapshot",
]);

function foregroundKey(): string | undefined {
  return useWorkspaceStore.getState().activeTabId;
}

function mirrorForeground(state: AppState, key: string | undefined): AppState {
  const view = key ? state.views[key] : undefined;
  if (!view) {
    const empty = createBaseState();
    return {
      ...state,
      session: empty.session,
      timeline: [],
      toolCalls: {},
      queue: { steering: [], followUp: [] },
      lastError: undefined,
      activeTaskId: undefined,
    };
  }
  return {
    ...state,
    session: view.session,
    timeline: view.timeline,
    toolCalls: view.toolCalls,
    queue: view.queue,
    lastError: view.lastError,
    activeTaskId: view.activeTaskId,
  };
}

function applySessionEvent(state: AppState, event: PiEvent): AppState {
  const key = event.sessionKey ?? foregroundKey();
  if (!key) {
    return { ...reducePiEvent(state, event), views: state.views };
  }
  const current = state.views[key];
  if (!current) {
    return { ...reducePiEvent(state, event), views: state.views };
  }
  const nextView = applyEventToView(current, event);
  if (!nextView) return state;
  const views = { ...state.views, [key]: nextView };
  let next: AppState = { ...state, views };
  if (event.type === "session_name_changed") {
    const reduced = reducePiEvent(next, event);
    next = { ...reduced, views };
  }
  if (key === foregroundKey()) next = mirrorForeground(next, key);
  return next;
}

function mergeWorkspace(state: AppState, snapshot: PiSnapshot): AppState {
  const incoming = snapshot.projects;
  const existing = state.projects ?? [];
  const nextProjects =
    incoming && incoming.length > 0
      ? incoming
      : existing.length > 0
        ? existing
        : incoming ?? existing;
  return {
    ...state,
    workspaceId: snapshot.workspaceId ?? state.workspaceId,
    projects: nextProjects,
    activeProjectId: snapshot.activeProjectId ?? state.activeProjectId ?? nextProjects[0]?.id,
    resources: snapshot.resources ?? state.resources,
    models: snapshot.models ?? state.models,
    tools: snapshot.tools ?? state.tools,
    diagnostics: snapshot.diagnostics ?? state.diagnostics,
    sessions: snapshot.sessions?.length ? snapshot.sessions : state.sessions,
  };
}

function dispatchEvent(state: AppState, event: PiEvent): AppState {
  if (event.type === "session_key_remapped") {
    const views = remapViewKey(state.views, event.payload.from, event.payload.to);
    const active = foregroundKey();
    const next = { ...state, views };
    return active === event.payload.from || active === event.payload.to
      ? mirrorForeground(next, event.payload.to)
      : next;
  }
  if (GLOBAL_EVENT_TYPES.has(event.type)) {
    if (event.type === "index_status_changed" || event.type === "resource_snapshot") {
      const cwd = event.type === "index_status_changed"
        ? event.payload.cwd
        : undefined;
      const activeCwd = state.session.cwd;
      if (cwd && activeCwd && cwd !== activeCwd) return state;
    }
    return { ...reducePiEvent(state, event), views: state.views };
  }
  return applySessionEvent(state, event);
}

interface AppStore extends AppState {
  applyEvent: (event: PiEvent) => void;
  replaceSnapshot: (snapshot: PiSnapshot) => void;
  applyWorkspaceSnapshot: (snapshot: PiSnapshot) => void;
  bindForeground: (key: string | undefined) => void;
  putView: (view: SessionView) => void;
  dropView: (key: string) => void;
  getView: (key: string) => SessionView | undefined;
  clearProviderLogin: (providerId: string) => void;
}

const COALESCED_DELTA_TYPES = new Set<PiEvent["type"]>([
  "assistant_message_delta",
  "thinking_delta",
  "tool_call_delta",
]);

const DELTA_FLUSH_INTERVAL_MS = 50;

type DeltaEvent = Extract<
  PiEvent,
  { type: "assistant_message_delta" | "thinking_delta" | "tool_call_delta" }
>;

function deltaBufferKey(event: DeltaEvent): string {
  const session = event.sessionKey ?? "fg";
  if (event.type === "tool_call_delta") return `${session}:${event.type}:${event.payload.toolCallId}`;
  return `${session}:${event.type}:${event.payload.messageId}`;
}

export const useAppStore = create<AppStore>((set, get) => {
  const pendingDeltas = new Map<string, { first: DeltaEvent; delta: string }>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flushPendingDeltas = (): void => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (pendingDeltas.size === 0) return;
    const events = [...pendingDeltas.values()].map(
      ({ first, delta }) => ({
        ...first,
        payload: { ...first.payload, delta },
      }) as PiEvent,
    );
    pendingDeltas.clear();
    set((state) => {
      let next: AppState = state;
      for (const event of events) next = dispatchEvent(next, event);
      return next as typeof state;
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
      flushPendingDeltas();
      set((state) => dispatchEvent(state, event) as typeof state);
    },
    bindForeground: (key) => {
      set((state) => mirrorForeground(state, key));
    },
    putView: (view) => {
      set((state) => {
        const views = { ...state.views, [view.key]: view };
        const next = { ...state, views };
        return foregroundKey() === view.key ? mirrorForeground(next, view.key) : next;
      });
    },
    dropView: (key) => {
      set((state) => {
        const { [key]: _, ...views } = state.views;
        const next = { ...state, views };
        return foregroundKey() === key ? mirrorForeground(next, undefined) : next;
      });
    },
    getView: (key) => get().views[key],
    applyWorkspaceSnapshot: (snapshot) => {
      set((state) => mergeWorkspace(state, snapshot));
    },
    clearProviderLogin: (providerId) =>
      set((state) => {
        if (!(providerId in state.providerLogins)) return state;
        const providerLogins = { ...state.providerLogins };
        delete providerLogins[providerId];
        return { ...state, providerLogins };
      }),
    replaceSnapshot: (snapshot) => {
      flushPendingDeltas();
      set((state) => {
        const key = foregroundKey();
        let next = mergeWorkspace(state, snapshot);
        if (key) {
          const current = next.views[key] ?? createView(key, { hydrate: "ready" });
          let view = applySnapshotToView(current, snapshot);
          if ((current.session.todosRevision ?? 0) > (snapshot.session.todosRevision ?? 0)) {
            view = {
              ...view,
              session: {
                ...view.session,
                todos: current.session.todos,
                todosRevision: current.session.todosRevision,
              },
              activeTaskId: current.activeTaskId,
            };
          }
          next = { ...next, views: { ...next.views, [key]: view } };
          next = mirrorForeground(next, key);
        } else {
          const nextSession = {
            ...next.session,
            ...snapshot.session,
            cwd: snapshot.session?.cwd || next.session.cwd,
          };
          if (
            Boolean(state.session.sessionId) &&
            state.session.sessionId === snapshot.session.sessionId &&
            (state.session.todosRevision ?? 0) > (snapshot.session.todosRevision ?? 0)
          ) {
            nextSession.todos = state.session.todos;
            nextSession.todosRevision = state.session.todosRevision;
          }
          next = {
            ...next,
            session: nextSession,
            timeline: snapshot.timeline ?? [],
            toolCalls: snapshot.toolCalls ?? {},
            queue: snapshot.queue ?? next.queue,
            lastError: snapshot.lastError,
            activeTaskId: nextSession.todos?.find((todo) => todo.status === "in_progress")?.id,
          };
        }
        return next;
      });
    },
  };
});
