import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { PiApi, PlanArtifactSummary } from "../../shared/protocol";
import { PlanInspector } from "./PlanInspector";

const plan: PlanArtifactSummary = {
  id: "plan-1",
  path: "/tmp/project/.pai/plan/plan.md",
  title: "Ship plan review",
  status: "ready",
  updatedAt: "2026-08-12T00:00:00.000Z",
  revision: "revision-1",
};

function renderPlanInspector(overrides: Partial<React.ComponentProps<typeof PlanInspector>> = {}) {
  return render(
    <PlanInspector
      sessionId="session-1"
      activePlan={plan}
      editable
      onOpenInspector={vi.fn()}
      onOpenChanges={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

describe("PlanInspector", () => {
  test("reviews an active plan without mounting a Markdown editor", async () => {
    const api = {
      listPlans: vi.fn(async () => [plan]),
      readPlan: vi.fn(async () => ({ summary: plan, content: "# Ship plan review\n\n## Goal\n\nKeep chat visible." })),
    } as unknown as PiApi;

    renderPlanInspector({ api });

    await waitFor(() => expect(screen.getByText("Keep chat visible.")).toBeInTheDocument());
    expect(screen.queryByRole("textbox", { name: /implementation plan markdown/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  test("uses the editable right pane as the unsaved plan surface", () => {
    renderPlanInspector({ activePlan: undefined });

    expect(screen.getByRole("region", { name: "Plan preview" })).toHaveTextContent("Implementation plan");
    expect(screen.queryByRole("button", { name: /open full plan|create plan/i })).not.toBeInTheDocument();
  });
});
