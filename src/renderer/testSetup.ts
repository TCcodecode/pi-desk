import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { resetWorkspaceRuntime, useWorkspaceStore } from "./workspace/workspaceStore";

afterEach(() => {
  cleanup();
  resetWorkspaceRuntime();
  useWorkspaceStore.setState({
    tabs: [],
    activeTabId: undefined,
    liveSessions: [],
  });
});
