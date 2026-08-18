import type {
  PiEvent,
  PiSnapshot,
  SessionState,
  TimelineItem,
  ToolCallState,
} from "../../shared/protocol";
import { createInitialState, reducePiEvent, type AppState } from "./reduce";

export type ViewHydrate = "loading" | "ready" | "error";

export interface SessionView {
  key: string;
  hydrate: ViewHydrate;
  session: SessionState;
  timeline: TimelineItem[];
  toolCalls: Record<string, ToolCallState>;
  queue: { steering: string[]; followUp: string[] };
  lastError?: string;
  activeTaskId?: string;
  hasMore: boolean;
  oldestId?: string;
  loadingOlder?: boolean;
  errorMessage?: string;
}

export function createView(
  key: string,
  opts?: { hydrate?: ViewHydrate; title?: string; session?: Partial<SessionState> },
): SessionView {
  const base = createInitialState();
  return {
    key,
    hydrate: opts?.hydrate ?? "loading",
    session: {
      ...base.session,
      ...opts?.session,
      name: opts?.title ?? opts?.session?.name ?? base.session.name,
    },
    timeline: [],
    toolCalls: {},
    queue: { steering: [], followUp: [] },
    hasMore: false,
    oldestId: undefined,
  };
}

export function oldestIdFrom(timeline: TimelineItem[]): string | undefined {
  return timeline[0]?.id;
}

export function applySnapshotToView(view: SessionView, snap: PiSnapshot): SessionView {
  return {
    ...view,
    hydrate: "ready",
    session: { ...view.session, ...snap.session },
    timeline: snap.timeline ?? [],
    toolCalls: snap.toolCalls ?? {},
    queue: snap.queue ?? view.queue,
    lastError: snap.lastError,
    activeTaskId: snap.session.todos?.find((todo) => todo.status === "in_progress")?.id,
    hasMore: snap.timelineHasMore === true,
    oldestId: oldestIdFrom(snap.timeline ?? []),
    errorMessage: undefined,
  };
}

export function applyEventToView(view: SessionView | undefined, event: PiEvent): SessionView | undefined {
  if (!view) return undefined;
  if (event.type === "session_started") {
    const head = {
      ...view.session,
      sessionId: event.payload.sessionId,
      cwd: event.payload.cwd,
      name: event.payload.sessionName ?? view.session.name,
      model: event.payload.model ?? view.session.model,
      thinkingLevel: event.payload.thinkingLevel ?? view.session.thinkingLevel,
    };
    if (view.hydrate === "loading") {
      return { ...view, session: head };
    }
    if (view.hydrate === "ready" && view.timeline.length === 0) {
      return { ...view, session: head };
    }
    if (view.hydrate === "ready") {
      return {
        ...createView(view.key, { hydrate: "ready", session: head }),
        session: head,
      };
    }
    return view;
  }
  const slice: AppState = {
    ...createInitialState(),
    session: view.session,
    timeline: view.timeline,
    toolCalls: view.toolCalls,
    queue: view.queue,
    lastError: view.lastError,
    activeTaskId: view.activeTaskId,
  };
  const next = reducePiEvent(slice, event);
  return {
    ...view,
    session: next.session,
    timeline: next.timeline,
    toolCalls: next.toolCalls,
    queue: next.queue,
    lastError: next.lastError,
    activeTaskId: next.activeTaskId,
  };
}

export function remapViewKey(
  views: Record<string, SessionView>,
  from: string,
  to: string,
): Record<string, SessionView> {
  const current = views[from];
  if (!current) return views;
  const { [from]: _, ...rest } = views;
  return { ...rest, [to]: { ...current, key: to } };
}

export function prependOlder(
  view: SessionView,
  items: TimelineItem[],
  hasMore: boolean,
): SessionView {
  const seen = new Set(view.timeline.map((item) => item.id));
  const extra = items.filter((item) => !seen.has(item.id));
  const timeline = [...extra, ...view.timeline];
  return { ...view, timeline, hasMore, oldestId: oldestIdFrom(timeline), loadingOlder: false };
}
