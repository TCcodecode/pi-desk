import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SessionTabBar } from "./SessionTabBar";
import type { SessionTab } from "./sessionTabs";
import { createInitialState, useAppStore } from "../session/store";
import { resetWorkspaceRuntime, useWorkspaceStore } from "./workspaceStore";
import * as workspaceActions from "./workspaceActions";

const tabs: SessionTab[] = [
  { id: "t1", sessionId: "s1", sessionFile: "/a.jsonl", projectId: "/tmp/alpha", title: "First", pinned: true },
  { id: "t2", sessionId: "s2", sessionFile: "/b.jsonl", projectId: "/tmp/beta", title: "Second" },
];

const projects = [
  { id: "/tmp/alpha", name: "alpha-app", path: "/tmp/alpha", updatedAt: "2026-08-08T00:00:00.000Z" },
  { id: "/tmp/beta", name: "beta-app", path: "/tmp/beta", updatedAt: "2026-08-08T00:00:00.000Z" },
];

describe("SessionTabBar", () => {
  beforeEach(() => {
    resetWorkspaceRuntime();
    useAppStore.setState({ ...createInitialState(), projects });
    useWorkspaceStore.setState({
      tabs,
      activeTabId: "t1",
      liveSessions: [],
    });
  });

  test("removes the segmented capsule when only one tab is open", () => {
    useWorkspaceStore.setState({ tabs: [tabs[0]!], activeTabId: "t1" });
    render(<SessionTabBar />);

    expect(document.querySelector(".session-tab-scroll")).toHaveClass("is-single");
    expect(document.querySelector(".session-tab-pin-control")).not.toHaveClass("shortcut-action-container");
    expect(screen.getByRole("button", { name: /Unpin .First./i })).toBeInTheDocument();
    expect(screen.getByText(/^(⌘1|Ctrl\+1)$/)).toBeInTheDocument();
    expect(screen.getByText(/^(⌘P|Ctrl\+P)$/)).toBeInTheDocument();
  });

  test("can collapse both shortcut hints without changing the tab structure", () => {
    useWorkspaceStore.setState({ tabs: [tabs[0]!, tabs[1]!], activeTabId: "t1" });
    render(<SessionTabBar hideShortcuts />);

    expect(document.querySelectorAll(".session-tab-pin-kbd")).toHaveLength(0);
    expect(document.querySelectorAll(".session-tab-kbd")).toHaveLength(0);
    expect(document.querySelectorAll(".session-tab-pin-control")).toHaveLength(2);
    expect(document.querySelectorAll(".session-tab-pin-control.is-icon-only")).toHaveLength(2);
  });

  test("treats pin and its shortcut as one control only for a lone tab", () => {
    useWorkspaceStore.setState({ tabs: [tabs[0]!], activeTabId: "t1" });
    const { rerender } = render(<SessionTabBar />);

    const singlePin = screen.getByRole("button", { name: /Unpin .First. · Shortcut/i });
    expect(singlePin).toContainElement(document.querySelector(".session-tab-pin-kbd"));
    expect(singlePin).not.toHaveClass("is-icon-only");

    useWorkspaceStore.setState({ tabs, activeTabId: "t1" });
    rerender(<SessionTabBar />);

    expect(document.querySelectorAll(".session-tab-pin-kbd")).toHaveLength(0);
    expect(document.querySelectorAll(".session-tab-pin-control.is-icon-only")).toHaveLength(2);
  });

  test("shows project suffix, ⌘N shortcuts and pin controls", () => {
    const onActivate = vi.spyOn(workspaceActions, "activateTab").mockResolvedValue();
    const onClose = vi.spyOn(workspaceActions, "closeWorkspaceTab").mockResolvedValue();
    const onTogglePin = vi.spyOn(workspaceActions, "toggleWorkspacePin");
    render(<SessionTabBar />);

    expect(screen.getByText("alpha-app")).toBeInTheDocument();
    expect(screen.getByText("beta-app")).toBeInTheDocument();
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();

    // macOS → ⌘1, other platforms → Ctrl+1
    expect(screen.getByText(/^(⌘1|Ctrl\+1)$/)).toBeInTheDocument();
    expect(screen.getByText(/^(⌘2|Ctrl\+2)$/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Second"));
    expect(onActivate).toHaveBeenCalledWith("t2");

    fireEvent.click(screen.getByRole("button", { name: /Unpin .First./i }));
    expect(onTogglePin).toHaveBeenCalledWith("t1");

    fireEvent.click(screen.getByRole("button", { name: /Pin .Second./i }));
    expect(onTogglePin).toHaveBeenCalledWith("t2");

    fireEvent.click(screen.getByRole("button", { name: "Close First" }));
    expect(onClose).toHaveBeenCalledWith("t1");
  });

  test("assigns unique shortcuts with the pinned tab first even when input order is mixed", () => {
    useWorkspaceStore.setState({ tabs: [tabs[1]!, tabs[0]!], activeTabId: "t1" });
    render(<SessionTabBar />);

    const tabRows = screen.getAllByRole("tab");
    const shortcuts = Array.from(document.querySelectorAll(".session-tab-kbd"));
    expect(tabRows[0]).toHaveClass("is-pinned");
    expect(shortcuts[0]?.textContent).toMatch(/^(⌘1|Ctrl\+1)$/);
    expect(shortcuts[1]?.textContent).toMatch(/^(⌘2|Ctrl\+2)$/);
  });

  test("opens tab actions from the context menu", () => {
    const onCloseOthers = vi.spyOn(workspaceActions, "closeOtherTabs").mockResolvedValue();
    const onCloseToRight = vi.spyOn(workspaceActions, "closeTabsToRight").mockResolvedValue();
    render(<SessionTabBar />);

    const firstTab = screen.getAllByRole("tab")[0]!;
    fireEvent.contextMenu(firstTab);
    fireEvent.click(screen.getByRole("menuitem", { name: "Close other tabs" }));
    expect(onCloseOthers).toHaveBeenCalledWith("t1");

    fireEvent.contextMenu(firstTab);
    fireEvent.click(screen.getByRole("menuitem", { name: "Close tabs to the right" }));
    expect(onCloseToRight).toHaveBeenCalledWith("t1");
  });
});

function mockTabLayout(): () => void {
  const orig = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    if (this.classList?.contains("session-tab")) {
      const host = this.parentElement as HTMLElement;
      const idx = Array.prototype.indexOf.call(host.querySelectorAll(".session-tab"), this);
      return {
        left: 100 + idx * 160, right: 260 + idx * 160, top: 0, bottom: 30,
        width: 160, height: 30, x: 100 + idx * 160, y: 0, toJSON: () => ({}),
      } as DOMRect;
    }
    if (this.classList?.contains("session-tab-scroll")) {
      return {
        left: 100, right: 700, top: 0, bottom: 30, width: 600, height: 30,
        x: 100, y: 0, toJSON: () => ({}),
      } as DOMRect;
    }
    return orig.call(this);
  };
  return () => {
    Element.prototype.getBoundingClientRect = orig;
  };
}

describe("SessionTabBar slider", () => {
  beforeEach(() => {
    resetWorkspaceRuntime();
    useAppStore.setState({ ...createInitialState(), projects });
    useWorkspaceStore.setState({ tabs, activeTabId: "t1", liveSessions: [] });
  });

  test("renders a sliding capsule aligned with the active tab", () => {
    const restore = mockTabLayout();
    try {
      render(<SessionTabBar />);
      const slider = document.querySelector(".session-tab-slider") as HTMLElement | null;
      expect(slider).not.toBeNull();
      // t1 is pinned → sorted first → offset 0, width 160
      expect(slider!.style.transform).toBe("translateX(0px)");
      expect(slider!.style.width).toBe("160px");

      act(() => {
        useWorkspaceStore.setState({ activeTabId: "t2" });
      });
      // t2 is unpinned → second slot → offset 160
      expect(slider!.style.transform).toBe("translateX(160px)");
    } finally {
      restore();
    }
  });

  test("hides the slider when only one tab is open", () => {
    useWorkspaceStore.setState({ tabs: [tabs[0]!], activeTabId: "t1" });
    const restore = mockTabLayout();
    try {
      render(<SessionTabBar />);
      expect(document.querySelector(".session-tab-slider")).toBeNull();
    } finally {
      restore();
    }
  });
});
