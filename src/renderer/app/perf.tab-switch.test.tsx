import { Profiler, act, type ProfilerOnRenderCallback } from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "./App";
import { createInitialState, useAppStore } from "../session/store";
import { useWorkspaceStore } from "../workspace/workspaceStore";
import type { SessionTab } from "../workspace/sessionTabs";
import type { PiSnapshot, TimelineItem } from "../../shared/protocol";

vi.mock("./piApi", () => ({
  getPiApi: () => undefined,
}));

const LONG_MARKDOWN = [
  "# Analysis report",
  "",
  "## What changed",
  "- Refactored the dialog family into a shared `Dialog` primitive.",
  "- Extracted `toolPresentation.ts` with all pure logic.",
  "- Unified the token system with `color-mix()`.",
  "",
  "### Details",
  "```tsx",
  "export function Dialog({ open, onClose, label }) {",
  "  if (!open) return null;",
  "  return <div role=\"dialog\" aria-label={label}>{children}</div>;",
  "}",
  "```",
  "",
  "The table below summarizes every file touched in this pass:",
  "",
  "| File | Lines | Notes |",
  "| --- | --- | --- |",
  "| App.tsx | 1155 | composer props deduped |",
  "| Timeline.tsx | 770 | toolPresentation extracted |",
  "| styles.css | 8000+ | token unification |",
  "",
  "## Next steps",
  "1. Add ESLint to CI.",
  "2. Split SessionSidebar further.",
  "3. Write more component tests.",
  "",
  "> A blockquote with a `code span` and [a link](https://example.com).",
  "",
].join("\n");

const LONG_OUTPUT = [
  "Test Files  54 passed (54)",
  "     Tests  520 passed (520)",
  "",
  "Start at  20:20:50",
  "Duration  16.57s (transform 2.36s, setup 5.08s, collect 22.08s, tests 28.72s, environment 30.72s, prepare 3.99s)",
  "",
  "✓ src/renderer/App.test.tsx (6 tests)",
  "✓ src/renderer/components/Timeline.test.tsx (42 tests)",
  "✓ electron/piHost.test.ts (48 tests)",
  "✓ packages/code-index/test/resilience.test.ts (2 tests)",
  "",
].join("\n");

/** ~30 turns with realistic markdown / tool payloads. */
function buildTimeline(prefix: string): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (let i = 0; i < 30; i += 1) {
    const base = `${prefix}-${i}`;
    items.push({
      id: `${base}-user`,
      kind: "user",
      content: `Please continue with step ${i}: review the current state, run the relevant tests, and report back with a full summary including the markdown table.`,
      status: "completed",
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(1000).toISOString(),
    });
    items.push({
      id: `${base}-thinking`,
      kind: "thinking",
      content: `I need to consider the tradeoffs here. Option A keeps things simple but duplicates logic; option B extracts a shared module. Let me think through the implications of each for maintainability and testability before deciding.`,
      status: "completed",
    });
    items.push({
      id: `${base}-tool-read`,
      kind: "tool",
      toolCallId: `${base}-tc1`,
      toolName: "read",
      input: JSON.stringify({ path: "src/renderer/App.tsx" }),
      output: LONG_OUTPUT,
      status: "completed",
    });
    items.push({
      id: `${base}-tool-bash`,
      kind: "tool",
      toolCallId: `${base}-tc2`,
      toolName: "bash",
      input: JSON.stringify({ command: "npm test -- --run 2>&1 | tail -30" }),
      output: LONG_OUTPUT,
      status: "completed",
    });
    items.push({
      id: `${base}-tool-edit`,
      kind: "tool",
      toolCallId: `${base}-tc3`,
      toolName: "edit",
      input: JSON.stringify({ path: "src/renderer/components/Timeline.tsx" }),
      change: {
        path: "src/renderer/components/Timeline.tsx",
        additions: 30,
        deletions: 220,
        diff: [
          "--- a/src/renderer/components/Timeline.tsx",
          "+++ b/src/renderer/components/Timeline.tsx",
          "@@ -473,7 +473,7 @@",
          "-const TOOL_PREVIEW_KEYS = [...]",
          "+export const TOOL_PREVIEW_KEYS = [...]",
          "",
          " // Tool categories",
          "@@ -600,7 +600,7 @@",
          "-function describeTool(item) {",
          "+export function describeTool(item) {",
          "",
          " // Dangerous tools",
        ].join("\n"),
      },
      status: "completed",
    });
    items.push({
      id: `${base}-assistant`,
      kind: "assistant",
      content: LONG_MARKDOWN,
      status: "completed",
    });
  }
  return items;
}

function makeSnapshot(sessionId: string, name: string, timeline: TimelineItem[]): PiSnapshot {
  return {
    workspaceId: "local",
    session: { ...createInitialState().session, sessionId, name, cwd: "/tmp/project", status: "idle" },
    sessions: [{ sessionId, cwd: "/tmp/project", name, status: "idle", model: "", thinkingLevel: "medium", messageCount: 30, updatedAt: new Date().toISOString() }],
    projects: [{ id: "/tmp/project", name: "project", path: "/tmp/project", updatedAt: new Date().toISOString() }],
    activeProjectId: "/tmp/project",
    timeline,
    toolCalls: {},
    queue: { steering: [], followUp: [] },
    resources: { contextFiles: [], skills: [], promptTemplates: [], themes: [], extensions: [], packages: [] },
    diagnostics: { piVersion: "test", sequence: 0, messages: [], errors: [] },
    models: [],
    tools: [],
  };
}

function makeTab(id: string, sessionId: string): SessionTab {
  return { id, sessionId, projectId: "/tmp/project", title: sessionId, lastFocusedAt: Date.now() };
}

describe("tab-switch render cost with realistic payloads", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState(createInitialState());
    useWorkspaceStore.setState({ tabs: [], activeTabId: undefined });
  });

  test("measures per-subtree commit cost", () => {
    useAppStore.setState(makeSnapshot("sA", "Session A", buildTimeline("A")));
    useWorkspaceStore.setState({ tabs: [makeTab("tabA", "sA"), makeTab("tabB", "sB")], activeTabId: "tabA" });

    const commits: Record<string, number[]> = {};
    const onRender: ProfilerOnRenderCallback = (id, _phase, actualDuration) => {
      (commits[id] ??= []).push(actualDuration);
    };

    render(
      <Profiler id="app" onRender={onRender}>
        <App />
      </Profiler>,
    );
    commits.app.length = 0;

    act(() => {
      useWorkspaceStore.setState({ activeTabId: "tabB" });
    });
    act(() => {
      useAppStore.setState(makeSnapshot("sB", "Session B", buildTimeline("B")));
      useWorkspaceStore.setState({ tabs: [makeTab("tabA", "sA"), makeTab("tabB", "sB")], activeTabId: "tabB" });
    });

    const summarize = (arr: number[]): string => arr.map((n) => n.toFixed(1)).join(", ");
    // eslint-disable-next-line no-console
    console.log(`[perf] app commits (${commits.app.length}): ${summarize(commits.app)} | total ${commits.app.reduce((a, b) => a + b, 0).toFixed(1)}ms`);
    // Guard against accidental render loops on tab switch: one workspace
    // commit, one snapshot commit, plus at most a couple of follow-up
    // effect commits. A loop (store-update → effect → store-update) blows
    // well past this bound.
    expect(commits.app.length).toBeLessThanOrEqual(8);
  });
});
