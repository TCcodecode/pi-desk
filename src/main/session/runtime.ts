import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  SessionManager,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { sessionTodoExtension } from "@pi-desk/session-todo";
import { createMcpBridgeFactory } from "@pi-desk/mcp-bridge";
import type { McpStatusSnapshot } from "@pi-desk/mcp-bridge";
import type { AgentMode, PlanArtifactSummary, SessionKey, SessionTodoItem } from "../../shared/protocol.js";
import { HttpWorkbenchStore } from "../http/store.js";
import { registerHttpWorkbenchTools } from "../http/extension.js";
import { PlanModeStore } from "./plan/store.js";
import { registerPlanModeTools } from "./plan/extension.js";
import { openSessionManagerAsync } from "./sessionOpen.js";
import type { PiRuntimeLike, RuntimeSlot } from "./types.js";

export interface CreateSdkRuntimeOptions {
  cwd: string;
  sessionPath?: string;
  agentDir: string;
  httpWorkbench?: HttpWorkbenchStore;
  planModes: Map<string, AgentMode>;
  slots: Map<SessionKey, RuntimeSlot>;
  applyTodosFromBranch: (todos: SessionTodoItem[], sessionManager: unknown) => void;
  emitPlanArtifactChanged: (slot: RuntimeSlot) => void;
  applyMcpStatus: (snapshot: McpStatusSnapshot) => void;
  modeStorageKey: (slot: RuntimeSlot) => string;
}

export async function createSdkRuntime(options: CreateSdkRuntimeOptions): Promise<PiRuntimeLike> {
  const sessionManager = options.sessionPath
    ? await openSessionManagerAsync(options.sessionPath, options.cwd)
    : SessionManager.create(options.cwd);
  const createRuntime = async ({ cwd, agentDir, sessionManager: manager, sessionStartEvent }: { cwd: string; agentDir: string; sessionManager: SessionManager; sessionStartEvent?: unknown }) => {
    let boundSessionId = "";
    const planStore = new PlanModeStore(cwd);
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      resourceLoaderOptions: {
        extensionFactories: [
          {
            name: "session-todo",
            factory: (pi) =>
              sessionTodoExtension(pi, (todos, sessionManager) =>
                options.applyTodosFromBranch(todos, sessionManager),
              ),
          },
          {
            name: "plan-mode",
            factory: (pi) => registerPlanModeTools(pi, {
              store: planStore,
              sessionId: boundSessionId || "pending",
              getSessionId: () => boundSessionId || "pending",
              getMode: () => options.planModes.get(boundSessionId) ?? "execute",
              onPlansChanged: (savedPlan: PlanArtifactSummary | undefined) => {
                const slot = [...options.slots.values()].find((candidate) => candidate.runtime.session.sessionId === boundSessionId);
                if (!slot) return;
                if (savedPlan?.sourceSession === slot.runtime.session.sessionId) {
                  slot.modeState = { ...slot.modeState, activePlan: savedPlan };
                  slot.planStore.setMode(options.modeStorageKey(slot), slot.modeState);
                }
                options.emitPlanArtifactChanged(slot);
              },
            }),
          },
          { name: "mcp", factory: createMcpBridgeFactory((snapshot) => options.applyMcpStatus(snapshot)) },
          ...(options.httpWorkbench
            ? [{ name: "http-workbench", factory: (pi: ExtensionAPI) => registerHttpWorkbenchTools(pi, options.httpWorkbench!) }]
            : []),
        ],
      },
    });
    const result = await createAgentSessionFromServices({
      services,
      sessionManager: manager,
      sessionStartEvent: sessionStartEvent as never,
    });
    boundSessionId = result.session.sessionId;
    result.session.setActiveToolsByName(result.session.getAllTools().map((tool) => tool.name));
    return { ...result, services, diagnostics: services.diagnostics };
  };
  return createAgentSessionRuntime(createRuntime, {
    cwd: options.cwd,
    agentDir: options.agentDir,
    sessionManager,
  }) as unknown as Promise<PiRuntimeLike>;
}
