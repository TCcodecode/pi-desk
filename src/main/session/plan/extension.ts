import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AgentMode, PlanArtifactSummary, PlanStatus } from "../../../shared/protocol.js";
import { isPlanBlockedTool, PlanModeStore } from "./store.js";

const statusSchema = Type.Optional(Type.Union([
  Type.Literal("draft"),
  Type.Literal("ready"),
  Type.Literal("executing"),
  Type.Literal("superseded"),
  Type.Literal("completed"),
]));

export interface PlanModeExtensionOptions {
  store: PlanModeStore;
  sessionId: string;
  getSessionId?: () => string;
  getMode: () => AgentMode;
  /**
   * A save made through the agent's narrow plan capability needs to become the
   * active plan for the current session too.  Without the summary, the host
   * can refresh the list but cannot know which plan the agent just authored.
   */
  onPlansChanged?: (savedPlan?: PlanArtifactSummary) => void;
}

function result(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    details: {} as const,
    ...(isError ? { isError: true } : {}),
  };
}

const PLAN_GUIDANCE = `
# Plan mode
You are in Plan mode. Inspect and reason about the project, ask clarifying questions, and maintain an implementation plan.
Project files are read-only in this mode. Do not use bash, edit, or write. Connected MCP and other extension tools remain available and keep their own permissions, so use them only when their operation is appropriate for planning.
Use plan_save to create or update the Markdown plan under .pai/plan. Mark it ready only when the user can review and execute it.
The plan should include goal, current understanding, decisions, implementation steps, verification, risks/open questions, and an execution handoff.
`.trim();

export function registerPlanModeTools(pi: ExtensionAPI, options: PlanModeExtensionOptions): void {
  pi.on("before_agent_start", (event) => {
    if (options.getMode() !== "plan") return;
    return { systemPrompt: event.systemPrompt ? `${event.systemPrompt}\n\n${PLAN_GUIDANCE}` : PLAN_GUIDANCE };
  });

  pi.on("tool_call", async (event) => {
    if (options.getMode() !== "plan") return;
    if (!isPlanBlockedTool(event.toolName)) return;
    return {
      block: true,
      reason: "Plan mode is read-only; bash, edit, and write are unavailable until you switch to Execute.",
    };
  });

  pi.registerTool({
    name: "plan_save",
    label: "Save Plan",
    description: "Create or update the implementation plan in .pai/plan. Use this after researching the project and when the plan needs to be visible to the user.",
    parameters: Type.Object({
      title: Type.String({ description: "Short human-readable plan title" }),
      content: Type.String({ description: "Complete Markdown plan body" }),
      status: statusSchema,
      planId: Type.Optional(Type.String({ description: "Existing plan id to update" })),
    }),
    async execute(_toolCallId, params) {
      if (options.getMode() !== "plan") return result("plan_save is only available in Plan mode", true);
      try {
        const saved = options.store.savePlan({
          title: params.title,
          content: params.content,
          status: params.status as PlanStatus | undefined,
          planId: params.planId,
          sourceSession: options.getSessionId?.() || options.sessionId,
        });
        options.onPlansChanged?.(saved.summary);
        return result(`Saved plan ${saved.summary.id} (${saved.summary.status}) at ${saved.summary.path}\n\n${saved.content}`);
      } catch (error) {
        return result(error instanceof Error ? error.message : String(error), true);
      }
    },
  });

  pi.registerTool({
    name: "plan_list",
    label: "List Plans",
    description: "List implementation plans owned by the current session in .pai/plan.",
    parameters: Type.Object({}),
    async execute() {
      try {
        const plans = options.store.listPlans(options.getSessionId?.() || options.sessionId);
        return result(plans.length ? plans.map((plan) => `${plan.id} [${plan.status}] ${plan.title} — ${plan.path}`).join("\n") : "No saved plans");
      } catch (error) {
        return result(error instanceof Error ? error.message : String(error), true);
      }
    },
  });

  pi.registerTool({
    name: "plan_read",
    label: "Read Plan",
    description: "Read a plan owned by the current session from .pai/plan.",
    parameters: Type.Object({ planId: Type.String({ description: "Plan id" }) }),
    async execute(_toolCallId, params) {
      try {
        const plan = options.store.readPlan(params.planId, options.getSessionId?.() || options.sessionId);
        return result(`${plan.summary.title} [${plan.summary.status}]\n\n${plan.content}`);
      } catch (error) {
        return result(error instanceof Error ? error.message : String(error), true);
      }
    },
  });
}
