import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { App } from "./App";
import { useAppStore } from "../session/store";

vi.mock("./piApi", () => ({
  getPiApi: () => undefined,
}));

describe("PI Desk shell", () => {
  test("renders the PI Desk workspace shell", () => {
    const { container } = render(<App />);

    expect(screen.getAllByText("PI Desk").length).toBeGreaterThan(0);
    expect(screen.getByRole("textbox", { name: /message/i })).toBeInTheDocument();
    expect(container.querySelector(".welcome-orb svg")).toBeInTheDocument();
  });

  test("renders real sessions from the store", () => {
    useAppStore.setState({
      session: {
        ...useAppStore.getState().session,
        cwd: "/tmp/x",
        sessionId: "s1",
        name: "Real session",
      },
      projects: [{ id: "/tmp/x", name: "x", path: "/tmp/x", updatedAt: new Date().toISOString() }],
      activeProjectId: "/tmp/x",
      sessions: [{ sessionId: "s1", cwd: "/tmp/x", name: "Real session", status: "idle", model: "", thinkingLevel: "medium", messageCount: 3, updatedAt: new Date().toISOString() }],
    });
    render(<App />);
    expect(screen.getAllByText("Real session").length).toBeGreaterThan(0);
    expect(screen.queryByText("Release audit")).not.toBeInTheDocument();
  });
});
