import type { PiSnapshot } from "../../shared/protocol";
import { compactCompanionSnapshot } from "../../shared/companion";
import { createInitialState, reducePiEvent, type AppState } from "../session/reduce";

export { compactCompanionSnapshot };

export function applySnapshot(snapshot: PiSnapshot): AppState {
  const base = createInitialState();
  return {
    ...base,
    ...snapshot,
    session: { ...base.session, ...(snapshot.session ?? {}) },
    timeline: Array.isArray(snapshot.timeline) ? snapshot.timeline : base.timeline,
    toolCalls: snapshot.toolCalls && typeof snapshot.toolCalls === "object" ? snapshot.toolCalls : {},
    sessions: Array.isArray(snapshot.sessions) ? snapshot.sessions : [],
    projects: Array.isArray(snapshot.projects) ? snapshot.projects : [],
    models: Array.isArray(snapshot.models) ? snapshot.models : [],
    queue: snapshot.queue ?? base.queue,
    resources: snapshot.resources ?? base.resources,
    diagnostics: snapshot.diagnostics ?? base.diagnostics,
    providerLogins: {},
    indexStatus: null,
  };
}

export function reduceCompanionEvent(state: AppState, event: Parameters<typeof reducePiEvent>[1]): AppState {
  try {
    const next = reducePiEvent(state, event);
    return next ?? state;
  } catch {
    return state;
  }
}
