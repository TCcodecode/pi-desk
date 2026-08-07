import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "./App";
import { createInitialState, useAppStore } from "../session/store";
import { useWorkspaceStore } from "../workspace/workspaceStore";

vi.mock("./piApi", () => ({
  getPiApi: () => undefined,
}));

function makeProject(id: string) {
  return { id, name: id.split("/").pop() ?? id, path: id, updatedAt: new Date().toISOString() };
}

function renderApp(partial: Partial<ReturnType<typeof createInitialState>> = {}) {
  useAppStore.setState({ ...createInitialState(), ...partial });
  return render(<App />);
}

describe("App shell", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState(createInitialState());
  });

  test("welcome screen without a project", () => {
    renderApp();
    expect(screen.getByRole("heading", { name: "Open a project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open project" })).toBeInTheDocument();
  });

  test("welcome screen with a project but no session", () => {
    renderApp({ projects: [makeProject("/tmp/x")], activeProjectId: "/tmp/x" });
    expect(screen.getByRole("heading", { name: "No session open" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New task" })).toBeInTheDocument();
  });

  test("welcome screen with an open session", () => {
    renderApp({
      projects: [makeProject("/tmp/x")],
      activeProjectId: "/tmp/x",
      session: { ...createInitialState().session, cwd: "/tmp/x", sessionId: "s1", name: "S" },
    });
    expect(screen.getByRole("heading", { name: "What are we building?" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New task" })).not.toBeInTheDocument();
  });

  test("help dialog opens from the topbar and closes on Escape", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(screen.getByRole("dialog", { name: "Help and diagnostics" })).toBeInTheDocument();
    expect(screen.getByText("Open command palette")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Help and diagnostics" })).not.toBeInTheDocument();
  });

  test("command palette opens with mod+K and closes on Escape", () => {
    renderApp();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
  });

  test("inspector toggle shows and hides the right panel", () => {
    renderApp();
    expect(screen.queryByRole("button", { name: /hide right panel/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show right panel/i }));
    expect(screen.getByRole("button", { name: /hide right panel/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /hide right panel/i }));
    expect(screen.queryByRole("button", { name: /hide right panel/i })).not.toBeInTheDocument();
  });

  test("tab switch shows a loading state instead of flashing the welcome page", () => {
    // Session switching: active tab changed, snapshot not applied yet —
    // timeline is empty (cleared by session_started) and sessionLoading is on.
    useWorkspaceStore.setState({ sessionLoading: true, activeTabId: "tabB" });
    renderApp({ session: { ...createInitialState().session, sessionId: "sB" } });

    expect(screen.getByText("Loading session…")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Open a project" })).not.toBeInTheDocument();

    // Snapshot lands: loading off → normal welcome (empty session) or content.
    act(() => {
      useWorkspaceStore.setState({ sessionLoading: false });
    });
    expect(screen.queryByText("Loading session…")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Open a project" })).toBeInTheDocument();
  });
});
