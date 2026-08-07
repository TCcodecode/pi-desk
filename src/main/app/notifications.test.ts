import { describe, expect, test } from "vitest";
import type { PiEvent } from "../../shared/protocol.js";
import { sessionCompletionNotification, shouldNotifySessionCompleted } from "./notifications.js";

function completedEvent(sessionName?: string): PiEvent {
  return {
    eventId: "session_completed-1",
    workspaceId: "local",
    sessionId: "session-1",
    sessionKey: "id:session-1",
    timestamp: "2026-08-09T00:00:00.000Z",
    sequence: 1,
    type: "session_completed",
    payload: { sessionId: "session-1", sessionName },
  };
}

describe("session completion notifications", () => {
  test("uses the completed session name", () => {
    expect(sessionCompletionNotification(completedEvent("Fix auth flow"))).toEqual({
      title: "Session completed",
      body: "Fix auth flow",
    });
  });

  test("falls back when a session has no name", () => {
    expect(sessionCompletionNotification(completedEvent("  "))?.body).toBe("Untitled session");
  });

  test("notifies background sessions or sessions completed while the window is hidden", () => {
    const event = completedEvent("Build the app");
    expect(shouldNotifySessionCompleted(event, { windowFocused: true, foregroundSession: false })).toBe(true);
    expect(shouldNotifySessionCompleted(event, { windowFocused: false, foregroundSession: true })).toBe(true);
    expect(shouldNotifySessionCompleted(event, { windowFocused: true, foregroundSession: true })).toBe(false);
  });
});
