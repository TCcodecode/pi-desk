import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Composer } from "./Composer";
import type { PiApi } from "../../shared/protocol";

const originalPi = window.pi;

function installPiApi(overrides: Partial<PiApi> = {}) {
  Object.defineProperty(window, "pi", {
    configurable: true,
    value: {
      chooseAttachmentFiles: vi.fn(async () => []),
      persistImageAttachment: vi.fn(async (input) => ({ path: `/tmp/${input.name}`, name: input.name })),
      loadImagePreview: vi.fn(async (path: string) => `data:image/png;base64,preview-${btoa(path)}`),
      ...overrides,
    },
  });
}

function renderComposer(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  const props = {
    onSubmit: vi.fn(async () => true),
    onAbort: vi.fn(),
    onPickFile: vi.fn(async () => "/tmp/file.ts"),
    isRunning: false,
    queue: { steering: [], followUp: [] },
    sessions: [],
    ...overrides,
  };
  return { ...render(<Composer {...props} />), props };
}

beforeEach(() => {
  installPiApi();
});

afterEach(() => {
  Object.defineProperty(window, "pi", {
    configurable: true,
    value: originalPi,
  });
});

describe("Composer", () => {
  test("submits a message without exposing delivery modes", async () => {
    const { props } = renderComposer();

    fireEvent.change(screen.getByRole("textbox", { name: /message/i }), { target: { value: "inspect the tests" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith({ text: "inspect the tests", attachments: [] }));
    expect(screen.queryByRole("button", { name: /delivery mode/i })).not.toBeInTheDocument();
  });

  test("uses the same composer action to queue while the agent is running", async () => {
    const { props } = renderComposer({ isRunning: true });

    fireEvent.change(screen.getByRole("textbox", { name: /message/i }), { target: { value: "follow up after this" } });
    fireEvent.click(screen.getByRole("button", { name: /queue follow-up/i }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith({ text: "follow up after this", attachments: [] }));
  });

  test("shows queue state and lets a running agent be aborted", () => {
    const onAbort = vi.fn();
    renderComposer({ isRunning: true, queue: { steering: ["focus"], followUp: ["summarize"] }, onAbort, onEditFollowUp: vi.fn(), onSendFollowUpNow: vi.fn() });

    expect(screen.getByText("Queue")).toBeInTheDocument();
    expect(screen.getByText("summarize")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  test("edits a queued message before sending it", async () => {
    const onEditFollowUp = vi.fn(async () => true);
    const onSendFollowUpNow = vi.fn(async () => true);
    renderComposer({
      isRunning: true,
      queue: { steering: [], followUp: ["old instruction"] },
      onEditFollowUp,
      onSendFollowUpNow,
    });

    fireEvent.click(screen.getByRole("button", { name: /edit queued message 1/i }));
    const editor = screen.getByRole("textbox", { name: /edit queued message 1/i });
    fireEvent.change(editor, { target: { value: "updated instruction" } });
    fireEvent.click(screen.getByRole("button", { name: /save queued message 1/i }));

    await waitFor(() => expect(onEditFollowUp).toHaveBeenCalledWith(0, "updated instruction"));
    expect(onSendFollowUpNow).not.toHaveBeenCalled();
  });

  test("sends a queued message now without a mode picker", async () => {
    const onEditFollowUp = vi.fn(async () => true);
    const onSendFollowUpNow = vi.fn(async () => true);
    renderComposer({
      isRunning: true,
      queue: { steering: [], followUp: ["send this now"] },
      onEditFollowUp,
      onSendFollowUpNow,
    });

    fireEvent.click(screen.getByRole("button", { name: /send queued message 1 now/i }));

    await waitFor(() => expect(onSendFollowUpNow).toHaveBeenCalledWith(0));
    expect(screen.queryByRole("button", { name: /delivery mode/i })).not.toBeInTheDocument();
  });

  test("inserts an attached file path and opens slash commands from the input", async () => {
    const { props } = renderComposer({
      commands: [{ id: "compact", name: "/compact", description: "Summarize context", source: "builtin" }],
    });

    fireEvent.click(screen.getByRole("button", { name: /attach file/i }));
    expect(props.onPickFile).toHaveBeenCalledTimes(1);
    await waitFor(() => expect((screen.getByRole("textbox", { name: /message/i }) as HTMLTextAreaElement).value).toContain("/tmp/file.ts"));

    const input = screen.getByRole("textbox", { name: /message/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "/co" } });
    fireEvent.click(screen.getByRole("option", { name: /compact/i }));
    expect(input.value).toBe("/compact ");
  });

  test("shows pasted images in an attachment tray instead of writing file paths into the textarea", async () => {
    const persistImageAttachment = vi.fn(async () => ({ path: "/tmp/pasted-1.png", name: "pasted-1.png" }));
    const loadImagePreview = vi.fn(async () => "data:image/png;base64,pasted-preview");
    installPiApi({ persistImageAttachment, loadImagePreview });

    renderComposer();
    const input = screen.getByRole("textbox", { name: /message/i });
    const file = new File([new Uint8Array([1, 2, 3])], "paste.png", { type: "image/png" });
    fireEvent.paste(input, {
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
      },
    });

    expect(await screen.findByLabelText(/attachment preview pasted-1\.png/i)).toBeInTheDocument();
    expect((input as HTMLTextAreaElement).value).toBe("");
    expect(persistImageAttachment).toHaveBeenCalledTimes(1);
    expect(loadImagePreview).toHaveBeenCalledWith("/tmp/pasted-1.png");
    expect(screen.getByRole("img", { name: "pasted-1.png" })).toHaveAttribute("src", "data:image/png;base64,pasted-preview");
  });

  test("adds selected image files to the attachment tray and lets the user remove one", async () => {
    const onPickFile = vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValueOnce("/tmp/a.png")
      .mockResolvedValueOnce("/tmp/b.jpg");
    renderComposer({ onPickFile });

    fireEvent.click(screen.getByRole("button", { name: /attach file/i }));
    expect(await screen.findByLabelText(/attachment preview a\.png/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /attach file/i }));
    expect(await screen.findByLabelText(/attachment preview b\.jpg/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /remove attachment a\.png/i }));
    expect(screen.queryByLabelText(/attachment preview a\.png/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/attachment preview b\.jpg/i)).toBeInTheDocument();
  });

  test("uses the preview loader for picked images", async () => {
    const loadImagePreview = vi
      .fn<(path: string) => Promise<string | undefined>>()
      .mockResolvedValueOnce("data:image/png;base64,preview-a")
      .mockResolvedValueOnce("data:image/jpeg;base64,preview-b");
    installPiApi({ loadImagePreview });
    const onPickFile = vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValueOnce("/tmp/a.png")
      .mockResolvedValueOnce("/tmp/b.jpg");

    renderComposer({ onPickFile });

    fireEvent.click(screen.getByRole("button", { name: /attach file/i }));
    expect(await screen.findByRole("img", { name: "a.png" })).toHaveAttribute("src", "data:image/png;base64,preview-a");

    fireEvent.click(screen.getByRole("button", { name: /attach file/i }));
    expect(await screen.findByRole("img", { name: "b.jpg" })).toHaveAttribute("src", "data:image/jpeg;base64,preview-b");
    expect(loadImagePreview).toHaveBeenNthCalledWith(1, "/tmp/a.png");
    expect(loadImagePreview).toHaveBeenNthCalledWith(2, "/tmp/b.jpg");
  });

  test("submits image attachments as structured payload", async () => {
    const onPickFile = vi.fn(async () => "/tmp/shot-a.png");
    const { props } = renderComposer({ onPickFile });

    fireEvent.click(screen.getByRole("button", { name: /attach file/i }));
    expect(await screen.findByLabelText(/attachment preview shot-a\.png/i)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: /message/i }), { target: { value: "describe this" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() =>
      expect(props.onSubmit).toHaveBeenCalledWith({
        text: "describe this",
        attachments: [{ name: "shot-a.png", path: "/tmp/shot-a.png" }],
      }),
    );
  });

  test("keeps the typed text when the send is rejected", async () => {
    const { props } = renderComposer({ onSubmit: vi.fn(async () => false) });

    fireEvent.change(screen.getByRole("textbox", { name: /message/i }), { target: { value: "keep me" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledTimes(1));

    await waitFor(() => expect((screen.getByRole("textbox", { name: /message/i }) as HTMLTextAreaElement).value).toBe("keep me"));
  });

  test("clears the text immediately when the send is accepted", async () => {
    const { props } = renderComposer({ onSubmit: vi.fn(async () => true) });

    fireEvent.change(screen.getByRole("textbox", { name: /message/i }), { target: { value: "fire and forget" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect((screen.getByRole("textbox", { name: /message/i }) as HTMLTextAreaElement).value).toBe(""));
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith({ text: "fire and forget", attachments: [] }));
  });

  test("does not send when Enter is used to confirm an IME candidate", () => {
    const { props } = renderComposer();
    const input = screen.getByRole("textbox", { name: /message/i });
    fireEvent.change(input, { target: { value: "zhong" } });

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });

    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  test("still sends on Enter after IME composition ends", async () => {
    const { props } = renderComposer();
    const input = screen.getByRole("textbox", { name: /message/i });
    fireEvent.change(input, { target: { value: "已确认" } });

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith({ text: "已确认", attachments: [] }));
  });

  test("navigates the active conversation history with the arrow keys", () => {
    renderComposer({ history: ["first prompt", "second prompt"] });

    const input = screen.getByRole("textbox", { name: /message/i }) as HTMLTextAreaElement;
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("second prompt");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("first prompt");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("second prompt");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("");
  });

  test("composer project control switches project or opens a folder", () => {
    const onProjectChange = vi.fn();
    const onOpenProject = vi.fn();
    renderComposer({
      projects: [
        { id: "/tmp/a", name: "alpha", path: "/tmp/a", updatedAt: "2026-08-08T00:00:00.000Z" },
        { id: "/tmp/b", name: "beta", path: "/tmp/b", updatedAt: "2026-08-08T00:00:00.000Z" },
      ],
      projectId: "/tmp/a",
      onProjectChange,
      onOpenProject,
    });

    const trigger = screen.getByRole("button", { name: /^project$/i });
    expect(trigger).toHaveTextContent("alpha");
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox", { name: /project options/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "beta" }));
    expect(onProjectChange).toHaveBeenCalledWith("/tmp/b");

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: /open project/i }));
    expect(onOpenProject).toHaveBeenCalledTimes(1);
  });

  test("inserts a session reference marker after picking a session", async () => {
    const session = {
      sessionId: "s1",
      cwd: "/tmp/x",
      name: "exit",
      status: "idle" as const,
      model: "auto",
      thinkingLevel: "medium" as const,
      sessionFile: "/tmp/x/s.jsonl",
      messageCount: 3,
      updatedAt: new Date().toISOString(),
    };
    renderComposer({ sessions: [session] });

    const textbox = screen.getByRole("textbox", { name: /message/i }) as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: "check @" } });
    screen.getByRole("listbox", { name: /reference picker/i });
    fireEvent.click(screen.getByRole("button", { name: /exit/i }));
    expect(textbox.value).toContain("@session:/tmp/x/s.jsonl");
  });

  test("navigates the reference picker from the textarea", () => {
    const sessions = [
      { sessionId: "s1", cwd: "/tmp/x", name: "alpha", status: "idle" as const, model: "auto", thinkingLevel: "medium" as const, sessionFile: "/tmp/x/a.jsonl", messageCount: 1, updatedAt: new Date().toISOString() },
      { sessionId: "s2", cwd: "/tmp/x", name: "beta", status: "idle" as const, model: "auto", thinkingLevel: "medium" as const, sessionFile: "/tmp/x/b.jsonl", messageCount: 1, updatedAt: new Date().toISOString() },
    ];
    renderComposer({ sessions });

    const textbox = screen.getByRole("textbox", { name: /message/i }) as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: "check @" } });
    expect(textbox).toHaveAttribute("aria-controls", "composer-reference-picker");
    fireEvent.keyDown(textbox, { key: "ArrowDown" });
    expect(textbox).toHaveAttribute("aria-activedescendant", "composer-reference-picker-option-1");
    fireEvent.keyDown(textbox, { key: "Enter" });
    expect(textbox.value).toContain("@session:/tmp/x/b.jsonl");
  });

  test("accepts image files dropped on the composer", async () => {
    renderComposer();
    const file = new File([new Uint8Array([1, 2, 3])], "dropped.png", { type: "image/png" });
    Object.defineProperty(file, "path", { value: "/tmp/dropped.png" });
    const card = document.querySelector(".composer-card")!;

    fireEvent.dragOver(card, { dataTransfer: { types: ["Files"] } });
    expect(card).toHaveClass("is-dragging");
    fireEvent.drop(card, { dataTransfer: { files: [file] } });

    expect(await screen.findByRole("img", { name: "dropped.png" })).toBeInTheDocument();
    expect(card).not.toHaveClass("is-dragging");
  });

  test("exposes model, thinking, workspace, and branch next to send", () => {
    const onModelSelect = vi.fn();
    const onThinkingLevel = vi.fn();
    renderComposer({
      models: [
        { id: "openai/gpt-5", provider: "openai", label: "GPT-5", available: true, thinkingLevels: ["low", "medium", "high"] },
        { id: "local/offline", provider: "local", label: "Offline", available: false, thinkingLevels: ["off"] },
      ],
      model: "openai/gpt-5",
      thinkingLevel: "medium",
      onModelSelect,
      onThinkingLevel,
      workspaceName: "pi-workspace",
      workspacePath: "/Users/tc/work/pi-workspace",
      branchName: "main",
    });

    expect(screen.getByLabelText(/workspace context/i)).toHaveTextContent("pi-workspace");
    expect(screen.getByLabelText(/workspace context/i)).toHaveTextContent("main");

    const model = screen.getByRole("button", { name: /model/i });
    const thinking = screen.getByRole("button", { name: /thinking level/i });
    fireEvent.click(thinking);
    fireEvent.click(screen.getByRole("option", { name: "high" }));
    expect(onThinkingLevel).toHaveBeenCalledWith("high");
    expect(model).toBeInTheDocument();
  });

  test("groups composer controls by primary tools, context, and actions", () => {
    renderComposer({
      projects: [{ id: "/tmp/a", name: "alpha", path: "/tmp/a", updatedAt: "2026-08-08T00:00:00.000Z" }],
      projectId: "/tmp/a",
      onProjectChange: vi.fn(),
      models: [{ id: "openai/gpt-5", provider: "openai", label: "GPT-5", available: true, thinkingLevels: ["medium"] }],
      model: "openai/gpt-5",
      onModelSelect: vi.fn(),
      onThinkingLevel: vi.fn(),
      branchName: "main",
    });

    const attach = screen.getByRole("button", { name: /attach file/i });
    const project = screen.getByRole("button", { name: /^project$/i });
    const model = screen.getByRole("button", { name: /^model$/i });
    const send = screen.getByRole("button", { name: /send/i });
    const context = document.querySelector(".composer-context-control");

    expect(document.querySelector(".composer-primary-tools")?.contains(attach)).toBe(true);
    expect(screen.queryByRole("button", { name: /command palette/i })).not.toBeInTheDocument();
    expect(context?.contains(project)).toBe(true);
    expect(context?.querySelector(".composer-context-branch")?.textContent).toBe("main");
    expect(document.querySelector(".composer-context-tools")?.contains(model)).toBe(true);
    expect(document.querySelector(".composer-action-tools")?.contains(send)).toBe(true);
  });

  test("selects a slash command with the keyboard", () => {
    renderComposer({
      commands: [
        { id: "compact", name: "/compact", description: "Summarize context", source: "builtin" },
        { id: "reload", name: "/reload", description: "Reload runtime", source: "builtin" },
      ],
    });

    const input = screen.getByRole("textbox", { name: /message/i }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "/" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(input.value).toBe("/reload ");
  });

  test("uses anchored menus for model and thinking", () => {
    const onModelSelect = vi.fn();
    const onThinkingLevel = vi.fn();
    renderComposer({
      models: [
        { id: "openai/gpt-5", provider: "openai", label: "GPT-5", available: true, thinkingLevels: ["medium", "high"] },
        { id: "local/offline", provider: "local", label: "Offline", available: true, thinkingLevels: ["off"] },
      ],
      model: "openai/gpt-5",
      thinkingLevel: "medium",
      onModelSelect,
      onThinkingLevel,
    });

    fireEvent.click(screen.getByRole("button", { name: /^model$/i }));
    expect(document.querySelector(".composer-menu-popover")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Offline" }));
    expect(onModelSelect).toHaveBeenCalledWith("local/offline");

    fireEvent.click(screen.getByRole("button", { name: /^thinking level$/i }));
    expect(document.querySelector(".composer-menu-popover")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "high" }));
    expect(onThinkingLevel).toHaveBeenCalledWith("high");
  });
});
