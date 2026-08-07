import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { PlanModeStore, defaultModeState } from "./store.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("PlanModeStore", () => {
  test("saves, lists, reads, and updates a plan with a revision", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-plan-"));
    roots.push(root);
    const store = new PlanModeStore(root);
    const saved = store.savePlan({
      title: "Auth refactor",
      content: "# Auth refactor\n\n## Goal\nReplace the token flow.\n\n## Execution handoff\nUpdate auth and test it.",
      status: "draft",
      sourceSession: "session-1",
    });

    expect(saved.summary.title).toBe("Auth refactor");
    expect(saved.summary.status).toBe("draft");
    expect(saved.summary.sourceSession).toBe("session-1");
    const other = store.savePlan({
      title: "Other session",
      content: "# Other session",
      sourceSession: "session-2",
    });
    expect(store.listPlans()).toHaveLength(2);
    expect(store.listPlans("session-1").map((plan) => plan.id)).toEqual([saved.summary.id]);
    expect(store.listPlans("session-2").map((plan) => plan.id)).toEqual([other.summary.id]);
    expect(() => store.readPlan(other.summary.id, "session-1")).toThrow(/Plan not found/);
    expect(store.readPlan(saved.summary.id).content).toContain("Execution handoff");

    const updated = store.updatePlan(
      saved.summary.id,
      saved.content.replace("draft", "ready").replace("Replace", "Validate"),
      saved.summary.revision,
    );
    expect(updated.status).toBe("ready");
    expect(store.readPlan(saved.summary.id).content).toContain("Validate");
  });

  test("rejects traversal and non-Markdown plan paths through the public save path", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-plan-"));
    roots.push(root);
    const store = new PlanModeStore(root);
    expect(() => store.savePlan({
      title: "../escape",
      content: "# Escape",
      planId: "../outside.txt",
      sourceSession: "session-1",
    })).toThrow(/Plan not found/);
  });

  test("mode profiles default to the active execute configuration", () => {
    expect(defaultModeState("openai/gpt-5", "high")).toEqual({
      mode: "execute",
      planProfile: { modelKey: "openai/gpt-5", thinkingLevel: "high" },
      executeProfile: { modelKey: "openai/gpt-5", thinkingLevel: "high" },
    });
  });

  test("migrates a legacy temporary tab mode through the plan owner session id", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-plan-mode-"));
    roots.push(root);
    const store = new PlanModeStore(root);
    store.setMode("tmp:legacy-tab", {
      ...defaultModeState("openai/gpt-5", "high"),
      mode: "plan",
      activePlan: {
        id: "plan-1",
        path: join(root, ".pai/plan/plan.md"),
        title: "Owned plan",
        status: "draft",
        updatedAt: "2026-08-12T00:00:00.000Z",
        revision: "revision",
        sourceSession: "session-1",
      },
    });

    expect(store.getModeForSession("session-1", defaultModeState(undefined, "medium"))).toMatchObject({
      mode: "plan",
      activePlan: { id: "plan-1", sourceSession: "session-1" },
      planProfile: { modelKey: "openai/gpt-5", thinkingLevel: "high" },
    });
  });
});
