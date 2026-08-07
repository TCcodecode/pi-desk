import { describe, expect, test, vi } from "vitest";
import { registerHttpWorkbenchTools } from "./extension.js";

describe("HTTP Workbench Agent extension", () => {
  test("registers project-scoped tools and guidance without Scratch semantics", () => {
    const pi = { registerTool: vi.fn(), on: vi.fn() };
    registerHttpWorkbenchTools(pi as never, {} as never);

    const names = pi.registerTool.mock.calls.map(([definition]) => (definition as { name: string }).name);
    expect(names).toEqual([
      "http_workspace_info",
      "http_create_folder",
      "http_create_test",
      "http_read_test",
      "http_update_test",
      "http_run_test",
      "http_list_run_history",
    ]);
    const guidance = pi.on.mock.calls.find(([event]) => event === "before_agent_start")?.[1] as (event: { systemPrompt?: string }) => { systemPrompt: string };
    expect(guidance({ systemPrompt: "base" }).systemPrompt).toContain("application-owned assets");
    expect(guidance({ systemPrompt: "base" }).systemPrompt).toContain("Never write .http files into the project repository");
  });
});
