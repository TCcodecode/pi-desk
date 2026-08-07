import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PlanModeStore } from "./store.js";
import { registerPlanModeTools } from "./extension.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("plan mode extension", () => {
  test("blocks mutating tools, allows inspection, and saves a plan", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-plan-extension-"));
    roots.push(root);
    let mode: "plan" | "execute" = "plan";
    const onPlansChanged = vi.fn();
    const tools = new Map<string, { execute: (id: string, params: any) => Promise<any> }>();
    const pi = {
      registerTool: vi.fn((definition: { name: string; execute: (id: string, params: any) => Promise<any> }) => tools.set(definition.name, definition)),
      on: vi.fn(),
    };
    registerPlanModeTools(pi as never, {
      store: new PlanModeStore(root),
      sessionId: "session-test",
      getMode: () => mode,
      onPlansChanged,
    });

    const toolCall = pi.on.mock.calls.find(([event]) => event === "tool_call")?.[1] as (event: { toolName: string }) => Promise<{ block?: boolean } | undefined>;
    expect(await toolCall({ toolName: "write" })).toMatchObject({ block: true });
    expect(await toolCall({ toolName: "bash" })).toMatchObject({ block: true });
    expect(await toolCall({ toolName: "read" })).toBeUndefined();
    expect(await toolCall({ toolName: "mcp_search" })).toBeUndefined();

    const saved = await tools.get("plan_save")!.execute("call-1", {
      title: "Test plan",
      content: "# Test plan\n\n## Execution handoff\nRun the tests.",
      status: "ready",
    });
    expect(saved.content[0].text).toContain("Saved plan");
    expect(new PlanModeStore(root).listPlans()[0]?.status).toBe("ready");
    expect(onPlansChanged).toHaveBeenCalledWith(expect.objectContaining({
      title: "Test plan",
      sourceSession: "session-test",
    }));
    new PlanModeStore(root).savePlan({ title: "Other session", content: "# Other session", sourceSession: "session-other" });
    const listed = await tools.get("plan_list")!.execute("call-list", {});
    expect(listed.content[0].text).toContain("Test plan");
    expect(listed.content[0].text).not.toContain("Other session");
    const hidden = await tools.get("plan_read")!.execute("call-read", { planId: "plan_missing" });
    expect(hidden).toMatchObject({ isError: true });

    mode = "execute";
    expect(await tools.get("plan_save")!.execute("call-2", { title: "Nope", content: "# Nope" })).toMatchObject({ isError: true });
  });
});
