import type { PiEvent } from "../../shared/protocol.js";

export interface SessionCompletionNotification {
  title: string;
  body: string;
}

export function sessionCompletionNotification(event: PiEvent): SessionCompletionNotification | undefined {
  if (event.type !== "session_completed") return undefined;
  const sessionName = event.payload.sessionName?.trim() || "Untitled session";
  return {
    title: "Session completed",
    body: sessionName,
  };
}

export function shouldNotifySessionCompleted(
  event: PiEvent,
  options: { windowFocused: boolean; foregroundSession: boolean },
): boolean {
  return event.type === "session_completed" && (!options.windowFocused || !options.foregroundSession);
}
