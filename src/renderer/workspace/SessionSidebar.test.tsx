import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AppUpdateState, ProjectSummary, SessionSummary } from "../../shared/protocol";
import { SessionSidebar } from "./SessionSidebar";
import * as workspaceActions from "./workspaceActions";

const project: ProjectSummary = {
  id: "/tmp/p",
  name: "p",
  path: "/tmp/p",
  updatedAt: "2026-08-08T00:00:00.000Z",
};
const otherProject: ProjectSummary = {
  id: "/tmp/other",
  name: "other",
  path: "/tmp/other",
  updatedAt: "2026-08-08T00:00:00.000Z",
};
const session: SessionSummary = {
  sessionId: "ses-123",
  cwd: "/tmp/p",
  name: "My session",
  status: "idle",
  model: "deepseek-v4",
  thinkingLevel: "medium",
  sessionFile: "/tmp/p/ses-123.jsonl",
  messageCount: 5,
  updatedAt: "2026-08-08T11:00:00.000Z",
};

function renderSidebar(overrides: Record<string, unknown> = {}) {
  return render(
    <SessionSidebar
      workspaceMode="pi"
      onWorkspaceModeChange={vi.fn()}
      projects={[project]}
      activeProjectId="/tmp/p"
      sessions={[session]}
      activeSessionId="ses-123"
      model="deepseek/deepseek-v4"
      thinkingLevel="medium"
      onAddProject={vi.fn()}
      onRequestNewSession={vi.fn()}
      onSelectProject={vi.fn()}
      onRemoveProject={vi.fn()}
      onRevealInFolder={vi.fn()}
      loadSessions={vi.fn(async () => [session])}
      onOpenSettings={vi.fn()}
      {...overrides}
    />,
  );
}

describe("SessionSidebar", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("right-clicking a session offers copy session ID", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderSidebar();
    const sessionRow = await screen.findByText("My session");
    fireEvent.contextMenu(sessionRow);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy session ID" }));
    expect(writeText).toHaveBeenCalledWith("ses-123");
  });

  test("shows relative time beside the session name", async () => {
    renderSidebar();
    const name = await screen.findByText("My session");
    const rowText = name.closest(".session-item-text");

    expect(rowText).not.toBeNull();
    expect(rowText?.querySelector(".session-meta")?.textContent).toBeTruthy();
  });

  test("passes the session id when selecting a session", async () => {
    const openSession = vi.spyOn(workspaceActions, "openWorkspaceSession").mockResolvedValue();
    renderSidebar();

    fireEvent.click(await screen.findByText("My session"));
    expect(openSession).toHaveBeenCalledWith(
      "/tmp/p/ses-123.jsonl",
      "/tmp/p",
      "ses-123",
    );
  });

  test("collapses sessions after the eight most recently updated", async () => {
    const manySessions = Array.from({ length: 10 }, (_, index) => ({
      ...session,
      sessionId: `session-${index}`,
      name: `Session ${index}`,
      sessionFile: `/tmp/p/session-${index}.jsonl`,
      updatedAt: new Date(2026, 7, 8, index).toISOString(),
    }));
    renderSidebar({
      sessions: manySessions,
      loadSessions: vi.fn(async () => [...manySessions].reverse()),
    });

    expect(await screen.findByText("Session 9")).toBeInTheDocument();
    expect(screen.queryByText("Session 1")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "还有 2 个较早会话" });
    fireEvent.click(toggle);
    expect(screen.getByText("Session 1")).toBeInTheDocument();
    expect(screen.getByText("Session 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起较早会话" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "收起较早会话" }));
    expect(screen.queryByText("Session 1")).not.toBeInTheDocument();
  });

  test("search shows matching older sessions without the collapse toggle", async () => {
    const manySessions = Array.from({ length: 10 }, (_, index) => ({
      ...session,
      sessionId: `session-${index}`,
      name: index === 0 ? "Older matching session" : `Session ${index}`,
      sessionFile: `/tmp/p/session-${index}.jsonl`,
      updatedAt: new Date(2026, 7, 8, index).toISOString(),
    }));
    renderSidebar({
      sessions: manySessions,
      loadSessions: vi.fn(async () => manySessions),
    });

    const search = screen.getByRole("searchbox", { name: /search sessions/i });
    fireEvent.change(search, { target: { value: "older matching" } });

    expect(await screen.findByText("Older matching session")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /较早会话/ })).not.toBeInTheDocument();
  });

  test("clear search resets the query", async () => {
    renderSidebar();
    await screen.findByText("My session");
    const input = screen.getByRole("searchbox", { name: /search sessions/i });
    fireEvent.change(input, { target: { value: "zzz-no-match" } });
    expect(await screen.findByText("No matches")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /clear search/i }));
    expect(input).toHaveValue("");
    expect(await screen.findByText("My session")).toBeInTheDocument();
  });

  test("delete opens confirm and Cancel does not call onDeleteSession", async () => {
    const deleteSession = vi.spyOn(workspaceActions, "deleteWorkspaceSession").mockResolvedValue();
    renderSidebar();
    fireEvent.contextMenu(await screen.findByText("My session"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(deleteSession).not.toHaveBeenCalled();
  });

  test("clicking the session row delete button opens confirm", async () => {
    const deleteSession = vi.spyOn(workspaceActions, "deleteWorkspaceSession").mockResolvedValue();
    renderSidebar();

    fireEvent.click(await screen.findByRole("button", { name: "Delete session My session" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
    expect(deleteSession).not.toHaveBeenCalled();
  });

  test("delete confirm calls onDeleteSession", async () => {
    const deleteSession = vi.spyOn(workspaceActions, "deleteWorkspaceSession").mockResolvedValue();
    renderSidebar();
    fireEvent.contextMenu(await screen.findByText("My session"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(dialog.querySelector(".ui-alert-dialog-action") ?? screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(deleteSession).toHaveBeenCalledWith("/tmp/p/ses-123.jsonl", "/tmp/p");
    });
  });

  test("defaults non-active projects to collapsed", async () => {
    const otherSession: SessionSummary = {
      ...session,
      sessionId: "ses-other",
      cwd: "/tmp/other",
      name: "Other session",
      sessionFile: "/tmp/other/ses.jsonl",
    };
    renderSidebar({
      projects: [project, otherProject],
      activeProjectId: "/tmp/p",
      loadSessions: vi.fn(async (cwd: string) => (cwd === "/tmp/p" ? [session] : [otherSession])),
    });
    await screen.findByText("My session");
    expect(screen.queryByText("Other session")).not.toBeInTheDocument();
  });

  test("New task button requests project pick (does not create yet)", async () => {
    const requestNew = vi.spyOn(workspaceActions, "requestNewSession");
    const startNew = vi.spyOn(workspaceActions, "startNewSession").mockResolvedValue();
    const { container } = renderSidebar();
    fireEvent.click(container.querySelector(".sidebar-new-session")!);
    expect(requestNew).toHaveBeenCalledTimes(1);
    expect(startNew).not.toHaveBeenCalled();
    expect(container.querySelector(".sidebar-nav-shortcut")?.textContent).toMatch(/N/);
    expect(container.querySelector(".sidebar-new-session")).toHaveClass("sidebar-leading-control");
    expect(screen.getByRole("button", { name: "Select project p" })).toHaveClass("sidebar-leading-control");
  });

  test("clicking a project name sets it active without new session", async () => {
    const onSelectProject = vi.fn();
    const startNew = vi.spyOn(workspaceActions, "startNewSession").mockResolvedValue();
    renderSidebar({
      projects: [project, otherProject],
      activeProjectId: "/tmp/p",
      onSelectProject,
      loadSessions: vi.fn(async () => []),
    });
    fireEvent.click(screen.getByRole("button", { name: "Select project other" }));
    expect(onSelectProject).toHaveBeenCalledWith("/tmp/other");
    expect(startNew).not.toHaveBeenCalled();
  });

  test("project row toggles sessions without a leading expand button", async () => {
    const onSelectProject = vi.fn();
    renderSidebar({ onSelectProject });
    await screen.findByText("My session");

    const projectButton = screen.getByRole("button", { name: "Select project p" });
    expect(screen.queryByRole("button", { name: "Collapse p" })).not.toBeInTheDocument();
    expect(projectButton.querySelector(".project-folder-icon")).toBeInTheDocument();
    expect(projectButton).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(projectButton);
    expect(onSelectProject).toHaveBeenCalledWith("/tmp/p");
    expect(projectButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("My session")).not.toBeInTheDocument();

    fireEvent.click(projectButton);
    expect(projectButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("My session")).toBeInTheDocument();
  });

  test("settings footer shows a compact settings label", async () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.queryByText("deepseek-v4")).not.toBeInTheDocument();
    expect(screen.queryByText("medium")).not.toBeInTheDocument();
  });

  test("shows an optional update action only when a release is available", async () => {
    const onUpdateAction = vi.fn();
    const updateState: AppUpdateState = {
      status: "available",
      currentVersion: "0.1.0",
      version: "0.1.1",
    };
    renderSidebar({ updateState, onUpdateAction });

    fireEvent.click(screen.getByRole("button", { name: "Update to 0.1.1" }));
    expect(onUpdateAction).toHaveBeenCalledOnce();
  });

  test("project context menu can remove from list", async () => {
    const onRemoveProject = vi.fn();
    renderSidebar({ onRemoveProject });
    fireEvent.contextMenu(await screen.findByText("p"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove from list" }));
    expect(onRemoveProject).toHaveBeenCalledWith("/tmp/p");
  });

  test("hide removes session from main list until Show hidden", async () => {
    renderSidebar();
    fireEvent.contextMenu(await screen.findByText("My session"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Hide from list" }));
    await waitFor(() => {
      expect(screen.queryByText("My session")).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /show 1 hidden/i }));
    expect(await screen.findByText("My session")).toBeInTheDocument();
  });

  test("duplicate is offered for non-active sessions", async () => {
    const cloneSession = vi.spyOn(workspaceActions, "cloneWorkspaceSession").mockResolvedValue();
    const other: SessionSummary = {
      ...session,
      sessionId: "ses-other",
      name: "Other session",
      sessionFile: "/tmp/p/other.jsonl",
    };
    renderSidebar({
      activeSessionId: "ses-123",
      loadSessions: vi.fn(async () => [session, other]),
    });
    fireEvent.contextMenu(await screen.findByText("Other session"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Duplicate session" }));
    expect(cloneSession).toHaveBeenCalledWith(other, "/tmp/p");
  });
});
