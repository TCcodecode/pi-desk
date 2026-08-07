import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { TimelineItem } from "../../shared/protocol";
import { Timeline } from "./Timeline";

describe("Timeline", () => {
  test("shows a file change summary below the edited turn", () => {
    const onReviewChanges = vi.fn();
    const items: TimelineItem[] = [
      { id: "assistant-1", kind: "assistant", content: "I fixed it.", status: "completed" },
      {
        id: "tool-1",
        kind: "tool",
        toolCallId: "tool-1",
        toolName: "edit",
        input: '{"path":"src/App.tsx"}',
        status: "completed",
        change: { path: "src/App.tsx", additions: 18, deletions: 4, diff: "@@\n-old\n+new" },
      },
      {
        id: "tool-2",
        kind: "tool",
        toolCallId: "tool-2",
        toolName: "write",
        input: '{"path":"src/App.test.tsx"}',
        status: "completed",
        change: { path: "src/App.test.tsx", additions: 12, deletions: 0, diff: "@@\n+test" },
      },
      {
        id: "tool-3",
        kind: "tool",
        toolCallId: "tool-3",
        toolName: "edit",
        input: '{"path":"src/components/One.tsx"}',
        status: "completed",
        change: { path: "src/components/One.tsx", additions: 1, deletions: 1, diff: "@@\n-old\n+new" },
      },
      {
        id: "tool-4",
        kind: "tool",
        toolCallId: "tool-4",
        toolName: "write",
        input: '{"path":"src/components/Two.tsx"}',
        status: "completed",
        change: { path: "src/components/Two.tsx", additions: 1, deletions: 0, diff: "@@\n+new" },
      },
    ];
    render(<Timeline items={items} onReviewChanges={onReviewChanges} />);

    const region = screen.getByRole("region", { name: "File changes" });
    expect(region).toHaveTextContent("Edited 4 files");
    expect(within(region).getByText("+32")).toBeInTheDocument();
    expect(within(region).getAllByText("-5")).toHaveLength(1);
    expect(within(region).getByText("src/App.tsx")).toBeInTheDocument();
    expect(within(region).getByText("src/App.test.tsx")).toBeInTheDocument();
    expect(within(region).getByText("src/components/One.tsx")).toBeInTheDocument();
    expect(within(region).queryByText("src/components/Two.tsx")).not.toBeInTheDocument();
    expect(screen.queryByRole("code")).not.toBeInTheDocument();
    fireEvent.click(within(region).getByRole("button", { name: "Review file changes" }));
    expect(onReviewChanges).toHaveBeenCalledWith("src/App.tsx");
    expect(screen.queryByRole("code")).not.toBeInTheDocument();
    fireEvent.click(within(region).getByRole("button", { name: "Show more files" }));
    expect(within(region).getByText("src/components/Two.tsx")).toBeInTheDocument();
  });

  test("merges repeated edits to the same file in one turn", () => {
    const items: TimelineItem[] = [
      { id: "tool-1", kind: "tool", toolCallId: "tool-1", toolName: "edit", input: "{}", status: "completed", change: { path: "src/App.tsx", additions: 2, deletions: 1, diff: "@@\n-old\n+new" } },
      { id: "tool-2", kind: "tool", toolCallId: "tool-2", toolName: "edit", input: "{}", status: "completed", change: { path: "src/App.tsx", additions: 3, deletions: 2, diff: "@@\n-old2\n+new2" } },
    ];
    render(<Timeline items={items} />);

    const region = screen.getByRole("region", { name: "File changes" });
    expect(region).toHaveTextContent("Edited 1 file");
    expect(within(region).getAllByText("+5")).toHaveLength(2);
    expect(within(region).getAllByText("-3")).toHaveLength(2);
    expect(within(region).getAllByText("src/App.tsx")).toHaveLength(1);
  });

  test("toggles the Review button and the selected file row", () => {
    const onReviewChanges = vi.fn();
    const onCloseReview = vi.fn();
    const items: TimelineItem[] = [
      {
        id: "tool-toggle",
        kind: "tool",
        toolCallId: "tool-toggle",
        toolName: "edit",
        input: "{}",
        status: "completed",
        change: { path: "src/App.tsx", additions: 1, deletions: 0, diff: "@@\n+new" },
      },
    ];

    const { rerender } = render(
      <Timeline items={items} onReviewChanges={onReviewChanges} reviewOpen selectedReviewPath="src/App.tsx" onCloseReview={onCloseReview} />,
    );
    const region = screen.getByRole("region", { name: "File changes" });
    fireEvent.click(within(region).getByRole("button", { name: "Review file changes" }));
    fireEvent.click(within(region).getByRole("button", { name: "Review src/App.tsx" }));
    expect(onCloseReview).toHaveBeenCalledTimes(2);

    rerender(<Timeline items={items} onReviewChanges={onReviewChanges} />);
    fireEvent.click(screen.getByRole("button", { name: "Review src/App.tsx" }));
    expect(onReviewChanges).toHaveBeenCalledWith("src/App.tsx");
  });

  test("shows Undo for a multi-file change summary", () => {
    const onUndoChanges = vi.fn();
    const items: TimelineItem[] = [
      { id: "tool-undo-1", kind: "tool", toolCallId: "tool-undo-1", toolName: "edit", input: "{}", status: "completed", change: { path: "src/App.tsx", additions: 1, deletions: 0, diff: "@@\n+new" } },
      { id: "tool-undo-2", kind: "tool", toolCallId: "tool-undo-2", toolName: "edit", input: "{}", status: "completed", change: { path: "src/styles.css", additions: 2, deletions: 1, diff: "@@\n-old\n+new" } },
    ];

    render(<Timeline items={items} onUndoChanges={onUndoChanges} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo file changes" }));
    expect(onUndoChanges).toHaveBeenCalledWith(["src/App.tsx", "src/styles.css"]);
  });

  test("uses a line icon for the empty state", () => {
    const { container } = render(<Timeline items={[]} />);

    expect(container.querySelector(".empty-glyph svg")).toBeInTheDocument();
    expect(container.textContent).not.toContain("π");
  });

  test("keeps agent actions in their original order instead of folding a whole turn", () => {
    const items: TimelineItem[] = [
      { id: "user-1", kind: "user", content: "Fix the test", status: "completed" },
      { id: "thinking-1", kind: "thinking", content: "I will inspect the failing test first.", status: "completed" },
      { id: "assistant-1", kind: "assistant", content: "I found the failing assertion.", status: "completed" },
      { id: "tool-1", kind: "tool", toolCallId: "tool-1", toolName: "read", input: '{"path":"src/App.test.tsx"}', status: "completed" },
      { id: "assistant-2", kind: "assistant", content: "I am correcting it now.", status: "completed" },
      { id: "tool-2", kind: "tool", toolCallId: "tool-2", toolName: "edit", input: '{"path":"src/App.test.tsx"}', status: "completed" },
    ];
    const { container } = render(<Timeline items={items} />);

    const text = container.querySelector(".turn")?.textContent ?? "";
    expect(text.indexOf("Fix the test")).toBeLessThan(text.indexOf("Thinking"));
    expect(text.indexOf("Thinking")).toBeLessThan(text.indexOf("I found the failing assertion."));
    expect(text.indexOf("I found the failing assertion.")).toBeLessThan(text.indexOf("Read"));
    expect(text.indexOf("Read")).toBeLessThan(text.indexOf("I am correcting it now."));
    expect(text.indexOf("I am correcting it now.")).toBeLessThan(text.indexOf("Edited"));
  });

  test("keeps every completed tool visible while its raw payload stays collapsed", () => {
    const items: TimelineItem[] = [
      { id: "tool-1", kind: "tool", toolCallId: "tool-1", toolName: "bash", input: "npm test -- --run", output: "20 tests passed", status: "completed" },
      { id: "tool-2", kind: "tool", toolCallId: "tool-2", toolName: "read", input: '{"path": "src/App.tsx"}', output: "long file contents", status: "completed" },
    ];
    render(<Timeline items={items} />);

    expect(screen.getByText("Ran")).toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("npm test -- --run")).toBeInTheDocument();
    expect(screen.getByText("20 tests passed")).toBeInTheDocument();
    expect(screen.queryByText("long file contents")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /expand ran \(bash\)/i }));
    expect(screen.getAllByText("20 tests passed")).toHaveLength(2);
  });

  test("uses action language and MCP targets instead of adapter tool names", () => {
    const items: TimelineItem[] = [
      { id: "tool-1", kind: "tool", toolCallId: "tool-1", toolName: "mcp", input: '{"action":"call","tool":"list_todos"}', status: "completed" },
      { id: "tool-2", kind: "tool", toolCallId: "tool-2", toolName: "read", input: '{"path": "src/App.tsx"}', status: "completed" },
      { id: "tool-3", kind: "tool", toolCallId: "tool-3", toolName: "mcp__github__get_issue", input: '{"repo":"pi"}', status: "completed" },
    ];
    render(<Timeline items={items} />);

    const tags = screen.getAllByText("via MCP");
    expect(tags).toHaveLength(2);
    expect(tags[0].closest(".tool-item")).toHaveTextContent("MCP");
    expect(tags[0].closest(".tool-item")).toHaveTextContent("list_todos");
    expect(tags[1].closest(".tool-item")).toHaveTextContent("github · get_issue");
    expect(screen.getByText("Read").closest(".tool-item")).not.toHaveTextContent("via MCP");
  });

  test("shows a compact thinking duration and on-demand body", () => {
    const items: TimelineItem[] = [
      {
        id: "thinking-1",
        kind: "thinking",
        content: "First I inspect the failing test.\nThen I update the assertion.",
        status: "completed",
        startedAt: "2026-08-12T00:00:00.000Z",
        completedAt: "2026-08-12T00:00:01.200Z",
      },
    ];
    render(<Timeline items={items} />);

    // Metadata-first: the duration is the headline, not the raw first line.
    expect(screen.getByText("Thinking · 1.2s")).toBeInTheDocument();
    expect(screen.queryByText("First I inspect the failing test.")).not.toBeInTheDocument();
    expect(screen.queryByText("Then I update the assertion.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /expand thinking/i }));
    expect(screen.getByText(/Then I update the assertion\./)).toBeInTheDocument();
    expect(screen.getByText(/First I inspect the failing test\./)).toBeInTheDocument();
  });

  test("shows a direct error state for a failed action", () => {
    const items: TimelineItem[] = [
      { id: "tool-1", kind: "tool", toolCallId: "tool-1", toolName: "bash", input: "npm test", output: "test failed", status: "error" },
    ];
    render(<Timeline items={items} />);

    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /expand ran \(bash\)/i })).toBeInTheDocument();
  });

  test("shows each running action rather than a synthetic live window", () => {
    const items: TimelineItem[] = [
      { id: "tool-1", kind: "tool", toolCallId: "tool-1", toolName: "bash", input: "npm test", status: "running" },
      { id: "tool-2", kind: "tool", toolCallId: "tool-2", toolName: "read", input: '{"path": "a.ts"}', status: "running" },
    ];
    render(<Timeline items={items} />);

    expect(screen.getByText("Running…")).toBeInTheDocument();
    expect(screen.getByText("Reading…")).toBeInTheDocument();
    expect(screen.getAllByText("running")).toHaveLength(2);
  });

  test("opens a trace payload from the keyboard", () => {
    const { container } = render(<Timeline items={[
      { id: "tool-1", kind: "tool", toolCallId: "tool-1", toolName: "bash", input: "npm test", output: "passed", status: "completed" },
    ]} />);

    const control = screen.getByRole("button", { name: /expand ran \(bash\)/i });
    fireEvent.keyDown(control, { key: " " });
    expect(container.querySelector(".tool-body pre")).toHaveTextContent("passed");
    expect(control).toHaveAttribute("aria-expanded", "true");
  });

  test("opens a new turn at each user message without mixing their actions", () => {
    const items: TimelineItem[] = [
      { id: "user-1", kind: "user", content: "First", status: "completed" },
      { id: "tool-1", kind: "tool", toolCallId: "tool-1", toolName: "read", input: '{"path": "a.ts"}', status: "completed" },
      { id: "user-2", kind: "user", content: "Second", status: "completed" },
      { id: "tool-2", kind: "tool", toolCallId: "tool-2", toolName: "grep", input: '{"pattern": "foo"}', status: "completed" },
    ];
    const { container } = render(<Timeline items={items} />);

    const turns = [...container.querySelectorAll(".turn")];
    expect(turns).toHaveLength(2);
    expect(turns[0]).toHaveTextContent("Read");
    expect(turns[0]).not.toHaveTextContent("Searched");
    expect(turns[1]).toHaveTextContent("Searched");
  });

  test("merges a persisted tool call and tool result into its first position", () => {
    const items: TimelineItem[] = [
      { id: "assistant-1", kind: "assistant", content: "I will list the files.", status: "completed" },
      { id: "call-1", kind: "tool", toolCallId: "call-1", toolName: "bash", input: '{"command": "ls -la"}', status: "completed", startedAt: "2026-08-12T00:00:00.000Z" },
      { id: "result-1", kind: "tool", toolCallId: "call-1", toolName: "bash", input: "", output: "total 4", status: "completed", completedAt: "2026-08-12T00:00:00.800Z" },
      { id: "assistant-2", kind: "assistant", content: "The directory is clean.", status: "completed" },
    ];
    const { container } = render(<Timeline items={items} />);

    expect(container.querySelectorAll(".tool-item")).toHaveLength(1);
    const text = container.querySelector(".turn")?.textContent ?? "";
    expect(text.indexOf("I will list the files.")).toBeLessThan(text.indexOf("ls -la"));
    expect(text.indexOf("ls -la")).toBeLessThan(text.indexOf("The directory is clean."));
    expect(screen.getByText("800ms")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /expand ran \(bash\)/i }));
    expect(screen.getAllByText("total 4")).toHaveLength(2);
  });

  test("assistant messages still render markdown", () => {
    render(<Timeline items={[{ id: "assistant-1", kind: "assistant", content: "# Title\n\nSome **bold** and `code` here.", status: "completed" }]} />);

    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
    expect(screen.getByText("bold")).toBeInTheDocument();
    expect(screen.getByText("code")).toBeInTheDocument();
  });

  test("shows copy and edit only for the specified interrupted user message", () => {
    const onCopyInterruptedMessage = vi.fn();
    const onEditInterruptedMessage = vi.fn();
    const items: TimelineItem[] = [
      { id: "user-1", kind: "user", content: "First request", status: "completed" },
      { id: "assistant-1", kind: "assistant", content: "Working on it.", status: "completed" },
      { id: "user-2", kind: "user", content: "Interrupted follow-up", status: "completed" },
    ];
    render(
      <Timeline
        items={items}
        interruptedUserMessageIds={["user-2"]}
        onCopyInterruptedMessage={onCopyInterruptedMessage}
        onEditInterruptedMessage={onEditInterruptedMessage}
      />,
    );

    const firstUserRow = screen.getByText("First request").closest(".timeline-item") as HTMLElement | null;
    const interruptedUserRow = screen.getByText("Interrupted follow-up").closest(".timeline-item") as HTMLElement | null;

    expect(firstUserRow).not.toBeNull();
    expect(interruptedUserRow).not.toBeNull();
    expect(within(firstUserRow!).queryByRole("button", { name: "Copy interrupted message" })).not.toBeInTheDocument();
    expect(within(firstUserRow!).queryByRole("button", { name: "Edit interrupted message" })).not.toBeInTheDocument();

    const copyButton = within(interruptedUserRow!).getByRole("button", { name: "Copy interrupted message" });
    const editButton = within(interruptedUserRow!).getByRole("button", { name: "Edit interrupted message" });
    const actions = within(interruptedUserRow!).getByLabelText("Interrupted message actions");

    expect(actions).toHaveClass("timeline-message-actions-below");
    expect(copyButton.textContent).toBe("");
    expect(editButton.textContent).toBe("");
    fireEvent.click(copyButton);
    fireEvent.click(editButton);

    expect(onCopyInterruptedMessage).toHaveBeenCalledWith(items[2]);
    expect(onEditInterruptedMessage).toHaveBeenCalledWith(items[2]);
  });

  test("renders an inline editor for the interrupted message and wires save and cancel", () => {
    const onInterruptedMessageTextChange = vi.fn();
    const onSaveInterruptedMessageEdit = vi.fn();
    const onCancelInterruptedMessageEdit = vi.fn();
    const items: TimelineItem[] = [
      { id: "user-1", kind: "user", content: "Retry this", status: "completed" },
    ];

    render(
      <Timeline
        items={items}
        interruptedUserMessageIds={["user-1"]}
        editingInterruptedMessage={{ messageId: "user-1", text: "Retry this with logs" }}
        onInterruptedMessageTextChange={onInterruptedMessageTextChange}
        onSaveInterruptedMessageEdit={onSaveInterruptedMessageEdit}
        onCancelInterruptedMessageEdit={onCancelInterruptedMessageEdit}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "Edit interrupted message" });
    expect(editor).toHaveValue("Retry this with logs");
    expect(screen.queryByRole("button", { name: "Copy interrupted message" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit interrupted message" })).not.toBeInTheDocument();

    fireEvent.change(editor, { target: { value: "Retry this cleanly" } });
    fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
    fireEvent.keyDown(editor, { key: "Escape" });

    expect(onInterruptedMessageTextChange).toHaveBeenCalledWith("Retry this cleanly");
    expect(onSaveInterruptedMessageEdit).toHaveBeenCalledTimes(1);
    expect(onCancelInterruptedMessageEdit).toHaveBeenCalledTimes(1);
  });
});

describe("Timeline tool grouping", () => {
  const bash = (id: string, command: string): TimelineItem => ({
    id,
    kind: "tool",
    toolCallId: id,
    toolName: "bash",
    input: JSON.stringify({ command }),
    status: "completed",
  });

  test("collapses consecutive bash calls into one expandable row", () => {
    render(<Timeline items={[bash("bash-1", "ls -la"), bash("bash-2", "pwd"), bash("bash-3", "cd /tmp")]} />);

    expect(screen.getByText("Ran 3 commands")).toBeInTheDocument();
    expect(screen.queryByText("Ran")).not.toBeInTheDocument();
    expect(screen.queryByRole("code")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /expand ran 3 commands/i }));
    expect(screen.getAllByText("Ran")).toHaveLength(3);
    // Nested rows stay collapsed until opened individually.
    expect(screen.queryByRole("code")).not.toBeInTheDocument();
  });

  test("groups read calls but keeps distinct categories separate", () => {
    const items: TimelineItem[] = [
      { id: "read-1", kind: "tool", toolCallId: "read-1", toolName: "read", input: '{"path":"a.ts"}', status: "completed" },
      { id: "read-2", kind: "tool", toolCallId: "read-2", toolName: "read", input: '{"path":"b.ts"}', status: "completed" },
      bash("bash-1", "pwd"),
    ];
    render(<Timeline items={items} />);

    expect(screen.getByText("Read 2 files")).toBeInTheDocument();
    expect(screen.getByText("Ran")).toBeInTheDocument();
  });

  test("does not group tools separated by an assistant message", () => {
    const items: TimelineItem[] = [
      bash("bash-1", "a"),
      { id: "assistant-1", kind: "assistant", content: "checking", status: "completed" },
      bash("bash-2", "b"),
    ];
    render(<Timeline items={items} />);

    expect(screen.getAllByText("Ran")).toHaveLength(2);
    expect(screen.queryByText("Ran 2 commands")).not.toBeInTheDocument();
  });

  test("keeps failed tools out of a group", () => {
    const items: TimelineItem[] = [
      bash("bash-1", "a"),
      { id: "bash-2", kind: "tool", toolCallId: "bash-2", toolName: "bash", input: '{"command":"b"}', output: "boom", status: "error" },
      bash("bash-3", "c"),
    ];
    render(<Timeline items={items} />);

    expect(screen.queryByText("Ran 3 commands")).not.toBeInTheDocument();
    expect(screen.getAllByText("Ran")).toHaveLength(3);
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  test("keeps file edits individual so their diffs stay visible", () => {
    const items: TimelineItem[] = [
      { id: "edit-1", kind: "tool", toolCallId: "edit-1", toolName: "edit", input: '{"path":"a.ts"}', status: "completed", change: { path: "a.ts", additions: 1, deletions: 0, diff: "" } },
      { id: "write-1", kind: "tool", toolCallId: "write-1", toolName: "write", input: '{"path":"b.ts"}', status: "completed", change: { path: "b.ts", additions: 2, deletions: 0, diff: "" } },
    ];
    render(<Timeline items={items} />);

    expect(screen.getByText("Edited")).toBeInTheDocument();
    expect(screen.getByText("Wrote")).toBeInTheDocument();
  });

  test("shows the aggregate duration on a group", () => {
    const items: TimelineItem[] = [
      { ...bash("bash-1", "a"), startedAt: "2026-08-12T00:00:00.000Z", completedAt: "2026-08-12T00:00:00.300Z" },
      { ...bash("bash-2", "b"), startedAt: "2026-08-12T00:00:00.300Z", completedAt: "2026-08-12T00:00:01.100Z" },
    ];
    render(<Timeline items={items} />);

    expect(screen.getByText("Ran 2 commands")).toBeInTheDocument();
    expect(screen.getByText("1.1s")).toBeInTheDocument();
  });

  test("absorbs thinking between grouped tools and reveals it when expanded", () => {
    const items: TimelineItem[] = [
      { id: "bash-1", kind: "tool", toolCallId: "bash-1", toolName: "bash", input: '{"command":"a"}', status: "completed" },
      { id: "think-1", kind: "thinking", content: "Between the commands I decide on the next step.", status: "completed" },
      { id: "bash-2", kind: "tool", toolCallId: "bash-2", toolName: "bash", input: '{"command":"b"}', status: "completed" },
    ];
    render(<Timeline items={items} />);

    // No standalone thinking row; the group is the single visual unit.
    expect(screen.getByText("Ran 2 commands")).toBeInTheDocument();
    expect(screen.queryByText("Thinking")).not.toBeInTheDocument();
    expect(screen.queryByText(/Between the commands/)).not.toBeInTheDocument();

    // Expanding the group reveals the absorbed thinking as a nested row.
    fireEvent.click(screen.getByRole("button", { name: /expand ran 2 commands/i }));
    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.queryByText(/Between the commands/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /expand thinking/i }));
    expect(screen.getByText(/Between the commands I decide/)).toBeInTheDocument();
  });

  test("keeps standalone thinking visible when it is not next to grouped tools", () => {
    const items: TimelineItem[] = [
      { id: "think-1", kind: "thinking", content: "A standalone thought.", status: "completed" },
      { id: "bash-1", kind: "tool", toolCallId: "bash-1", toolName: "bash", input: '{"command":"a"}', status: "completed" },
    ];
    render(<Timeline items={items} />);

    // thinking before the run stays visible; a single bash stays individual.
    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.getByText("Ran")).toBeInTheDocument();
  });
});

describe("Timeline dividers", () => {
  test("renders a compaction divider with its summary", () => {
    render(<Timeline items={[
      { id: "d1", kind: "divider", label: "compacted", detail: "kept key decisions", status: "completed" },
    ]} />);

    expect(screen.getByText("Context compacted")).toBeInTheDocument();
    expect(screen.getByText("kept key decisions")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  test("renders a live compaction state while it is running", () => {
    render(<Timeline items={[
      { id: "d1", kind: "divider", label: "compacting", status: "running" },
    ]} />);

    expect(screen.getByText("Compacting context…")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveClass("running");
  });

  test("renders an auto-retry divider", () => {
    render(<Timeline items={[
      { id: "d1", kind: "divider", label: "retried", status: "completed" },
    ]} />);

    expect(screen.getByText("Auto-retried")).toBeInTheDocument();
  });
});

describe("Timeline tool grouping", () => {
  const bash = (id: string, command: string, taskId?: string): TimelineItem => ({
    id,
    kind: "tool",
    toolCallId: id,
    toolName: "bash",
    input: JSON.stringify({ command }),
    status: "completed",
    ...(taskId ? { taskId } : {}),
  });

  test("collapses consecutive commands without task labels", () => {
    render(<Timeline items={[bash("bash-1", "a", "task-1"), bash("bash-2", "b", "task-1")]} />);

    expect(screen.getByText("Ran 2 commands")).toBeInTheDocument();
    // Task names and statuses belong to the Todos panel, not the trace.
    expect(screen.queryByText("Explore the repo")).not.toBeInTheDocument();
    expect(screen.queryByText("in_progress")).not.toBeInTheDocument();
    expect(screen.queryByText("completed")).not.toBeInTheDocument();
    expect(document.querySelector(".timeline-task")).toBeNull();
  });

  test("keeps loose tool rows ungrouped and label-free", () => {
    render(<Timeline items={[bash("bash-1", "a")]} />);

    expect(screen.queryByText("in_progress")).not.toBeInTheDocument();
    expect(screen.queryByText("completed")).not.toBeInTheDocument();
    expect(screen.getByText("Ran")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  test("merges consecutive same-category tools across task boundaries", () => {
    render(<Timeline items={[bash("bash-1", "a", "task-1"), bash("bash-2", "b", "task-2")]} />);

    // No task headers exist anymore, so different taskIds no longer split a run.
    expect(screen.getByText("Ran 2 commands")).toBeInTheDocument();
  });
});

describe("Timeline virtualization", () => {
  const longItems = (turns: number): TimelineItem[] => {
    const items: TimelineItem[] = [];
    for (let i = 0; i < turns; i += 1) {
      items.push({ id: `user-${i}`, kind: "user", content: `Q${i}`, status: "completed" });
      items.push({ id: `tool-${i}`, kind: "tool", toolCallId: `tool-${i}`, toolName: "bash", input: `{"command":"echo ${i}"}`, status: "completed" });
    }
    return items;
  };

  /** jsdom reports zero for layout; give the virtualizer a real viewport. */
  const mockScrollElement = () => {
    const el = document.createElement("div");
    Object.defineProperty(el, "offsetWidth", { value: 760, configurable: true });
    Object.defineProperty(el, "offsetHeight", { value: 600, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 600 });
    Object.defineProperty(el, "scrollHeight", { value: 20000 });
    return { current: el };
  };

  test("virtualizes long timelines when a scroll container is provided", async () => {
    const scrollRef = mockScrollElement();
    const { container } = render(<Timeline items={longItems(22)} scrollElementRef={scrollRef} />);

    await waitFor(() => {
      const vc = container.querySelector(".timeline.is-virtualized");
      expect(vc).not.toBeNull();
      const rendered = vc!.querySelectorAll(".turn").length;
      expect(rendered).toBeGreaterThan(0);
      expect(rendered).toBeLessThan(22);
    });
  });

  test("stays flat without a scroll container even for long timelines", () => {
    const { container } = render(<Timeline items={longItems(22)} />);

    expect(container.querySelector(".timeline.is-virtualized")).toBeNull();
    expect(container.querySelectorAll(".turn")).toHaveLength(22);
  });
});

describe("Timeline dangerous tools", () => {
  test("marks delete and destructive bash commands as dangerous", () => {
    render(<Timeline items={[
      { id: "del-1", kind: "tool", toolCallId: "del-1", toolName: "delete_file", input: '{"path":"a.ts"}', status: "completed" },
      { id: "rm-1", kind: "tool", toolCallId: "rm-1", toolName: "bash", input: '{"command":"rm -rf node_modules"}', status: "completed" },
      { id: "read-1", kind: "tool", toolCallId: "read-1", toolName: "read", input: '{"path":"a.ts"}', status: "completed" },
    ]} />);

    expect(screen.getByText("Deleted").closest(".tool-item")).toHaveClass("is-dangerous");
    expect(screen.getByText("Ran").closest(".tool-item")).toHaveClass("is-dangerous"); // rm -rf
    expect(screen.getByText("Read").closest(".tool-item")).not.toHaveClass("is-dangerous");
  });
});

describe("Timeline running labels", () => {
  test("shows a present-tense label while a tool runs, then the result verb", () => {
    const { rerender } = render(<Timeline items={[
      { id: "r1", kind: "tool", toolCallId: "r1", toolName: "read", input: '{"path":"a.ts"}', status: "running" },
    ]} />);

    expect(screen.getByText("Reading…")).toBeInTheDocument();
    expect(screen.queryByText("Read")).not.toBeInTheDocument();

    rerender(<Timeline items={[
      { id: "r1", kind: "tool", toolCallId: "r1", toolName: "read", input: '{"path":"a.ts"}', status: "completed" },
    ]} />);

    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.queryByText("Reading…")).not.toBeInTheDocument();
  });
});

describe("Timeline inline diff", () => {
  test("shows a capped inline diff with stats when a tool changed a file", () => {
    const { container } = render(<Timeline items={[
      {
        id: "edit-1",
        kind: "tool",
        toolCallId: "edit-1",
        toolName: "edit",
        input: '{"path":"src/App.tsx"}',
        status: "completed",
        change: { path: "src/App.tsx", additions: 2, deletions: 1, diff: "--- a/src/App.tsx\n+++ b/src/App.tsx\n@@ -1,3 +1,4 @@\n-old line\n+new line\n+another new line\n context" },
      },
    ]} />);

    // Collapsed: the inline diff body is not rendered.
    expect(container.querySelector(".tool-diff")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /expand edited \(edit\)/i }));
    const diffEl = container.querySelector(".tool-diff");
    expect(diffEl).not.toBeNull();
    expect(diffEl!.querySelector(".tool-diff-path")).toHaveTextContent("src/App.tsx");
    expect(diffEl!.querySelector(".tool-diff-stats")).toHaveTextContent("+2");
    expect(diffEl!.querySelector(".tool-diff-stats")).toHaveTextContent("−1");
    expect(diffEl!.querySelector(".tool-diff-line.added")).toHaveTextContent("+new line");
    expect(diffEl!.querySelector(".tool-diff-line.removed")).toHaveTextContent("-old line");
  });
});

describe("Timeline copy button", () => {
  test("copies tool input and output via the copy button", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });

    render(<Timeline items={[
      { id: "bash-1", kind: "tool", toolCallId: "bash-1", toolName: "bash", input: '{"command":"ls -la"}', output: "total 4", status: "completed" },
    ]} />);

    fireEvent.click(screen.getByRole("button", { name: /expand ran \(bash\)/i }));

    const copyButtons = screen.getAllByRole("button", { name: /^copy /i });
    expect(copyButtons).toHaveLength(2); // input + output

    fireEvent.click(copyButtons[0]!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('{"command":"ls -la"}'));

    fireEvent.click(copyButtons[1]!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("total 4"));
  });
});

describe("Timeline change summary timing", () => {
  const edit = (status: "running" | "completed"): TimelineItem => ({
    id: "edit-1",
    kind: "tool",
    toolCallId: "edit-1",
    toolName: "edit",
    input: '{"path":"a.ts"}',
    status,
    change: { path: "a.ts", additions: 1, deletions: 0, diff: "@@\n+new" },
  });

  test("hides the summary on the active turn while the session is running", () => {
    // All rows are completed here — exactly the gap between tool executions
    // where a per-row status check would flash the card open and closed.
    const items: TimelineItem[] = [
      { id: "user-1", kind: "user", content: "Fix it", status: "completed" },
      edit("completed"),
    ];
    const { rerender } = render(<Timeline items={items} sessionStatus="running" />);
    expect(screen.queryByRole("region", { name: "File changes" })).not.toBeInTheDocument();

    rerender(<Timeline items={items} sessionStatus="completed" />);
    expect(screen.getByRole("region", { name: "File changes" })).toBeInTheDocument();
  });

  test("only suppresses the last turn while running, not finished history turns", () => {
    const items: TimelineItem[] = [
      { id: "user-1", kind: "user", content: "First", status: "completed" },
      { id: "edit-1", kind: "tool", toolCallId: "edit-1", toolName: "edit", input: '{"path":"a.ts"}', status: "completed", change: { path: "a.ts", additions: 1, deletions: 0, diff: "@@\n+new" } },
      { id: "user-2", kind: "user", content: "Second", status: "completed" },
      edit("completed"),
    ];
    render(<Timeline items={items} sessionStatus="running" />);

    // The finished first turn keeps its summary; the active second turn hides it.
    const regions = screen.getAllByRole("region", { name: "File changes" });
    expect(regions).toHaveLength(1);
  });

  test("shows the summary for a finished turn when the session is idle", () => {
    render(<Timeline items={[
      { id: "user-1", kind: "user", content: "Fix it", status: "completed" },
      edit("completed"),
    ]} sessionStatus="completed" />);
    expect(screen.getByRole("region", { name: "File changes" })).toBeInTheDocument();
  });
});

describe("Timeline todo tool rows", () => {
  test("does not render todo-list tool rows in the trace", () => {
    render(<Timeline items={[
      {
        id: "tw-1",
        kind: "tool",
        toolCallId: "tw-1",
        toolName: "todowrite",
        input: JSON.stringify({ todos: [
          { id: "t1", content: "Alpha", status: "completed", priority: "high" },
          { id: "t2", content: "Beta", status: "in_progress", priority: "medium" },
        ] }),
        status: "completed",
      },
    ]} />);

    // The checklist lives in the Todos panel; plan updates are meta noise here.
    expect(screen.queryByText("Updated plan")).not.toBeInTheDocument();
    expect(screen.queryByText("1/2 done")).not.toBeInTheDocument();
    expect(document.querySelector(".tool-item")).toBeNull();
  });

  test("todo updates vanish without splitting the surrounding tool run", () => {
    render(<Timeline
      items={[
        { id: "bash-1", kind: "tool", toolCallId: "bash-1", toolName: "bash", input: '{"command":"a"}', status: "completed", taskId: "task-1" },
        {
          id: "tw-1",
          kind: "tool",
          toolCallId: "tw-1",
          toolName: "todoupdate",
          input: '{"id":"task-1","status":"completed"}',
          status: "completed",
          taskId: "task-1",
        },
        { id: "bash-2", kind: "tool", toolCallId: "bash-2", toolName: "bash", input: '{"command":"b"}', status: "completed", taskId: "task-1" },
      ]}
    />);

    expect(screen.queryByText("Updated plan")).not.toBeInTheDocument();
    expect(screen.getByText("Ran 2 commands")).toBeInTheDocument();
  });
});
