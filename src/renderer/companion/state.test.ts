import { describe, expect, test } from "vitest";
import { applySnapshot, compactCompanionSnapshot } from "./state.js";
import { createInitialState } from "../session/reduce";

describe("companion snapshot", () => {
  test("keeps a usable session when the payload is sparse", () => {
    const state = applySnapshot({ workspaceId: "local" } as ReturnType<typeof createInitialState>);
    expect(state.session.name).toBe("Untitled session");
    expect(state.timeline).toEqual([]);
    expect(state.sessions).toEqual([]);
  });

  test("clips huge tool output so a phone apply cannot blow the tab", () => {
    const huge = "x".repeat(50_000);
    const next = compactCompanionSnapshot({
      ...createInitialState(),
      timeline: [
        {
          id: "t1",
          kind: "tool",
          toolCallId: "t1",
          toolName: "read",
          input: huge,
          output: huge,
          status: "completed",
        },
      ],
    });
    const row = next.timeline[0];
    expect(row?.kind).toBe("tool");
    if (row?.kind === "tool") {
      expect(row.input.length).toBeLessThan(500);
      expect((row.output ?? "").length).toBeLessThan(500);
    }
  });
});
