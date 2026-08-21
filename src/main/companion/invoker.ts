import { compactCompanionSnapshot } from "../../shared/companion.js";
import type { SessionCommandOptions, SessionKey, ThinkingLevel } from "../../shared/protocol.js";

export interface CompanionHostFacade {
  snapshot: (opts?: { includeTimeline?: boolean; tailTurns?: number }) => object;
  listSessions: (cwd?: string) => Promise<unknown> | unknown;
  prompt: (text: string, opts?: SessionCommandOptions) => Promise<unknown>;
  steer?: (text: string, opts?: SessionCommandOptions) => Promise<unknown>;
  followUp?: (text: string, opts?: SessionCommandOptions) => Promise<unknown>;
  abort?: (opts?: SessionCommandOptions) => Promise<unknown>;
  setModel?: (model: string) => Promise<unknown>;
  setThinkingLevel?: (level: ThinkingLevel) => unknown;
  selectProject?: (projectId: string) => Promise<unknown>;
  setActiveProjectOnly?: (projectId: string) => unknown;
  listProjects?: () => unknown;
  start?: (options: { cwd: string; sessionPath?: string; sessionKey?: SessionKey }) => Promise<unknown>;
  focusSession?: (sessionKey: SessionKey, opts?: { includeTimeline?: boolean }) => Promise<unknown>;
  newSession?: (opts?: SessionCommandOptions) => Promise<unknown>;
  undoFileChange?: (path: string, opts?: SessionCommandOptions) => Promise<unknown>;
  loadOlder?: (options: { sessionKey: SessionKey; beforeId: string; limit?: number; sessionPath?: string }) => Promise<unknown>;
  refreshAvailableModels?: () => Promise<unknown>;
  listLiveSessions?: () => unknown;
}

function asOpts(value: unknown): SessionCommandOptions | undefined {
  return value && typeof value === "object" ? (value as SessionCommandOptions) : undefined;
}

export function createCompanionInvoker(host: CompanionHostFacade) {
  const handlers: Record<string, (args: unknown[]) => Promise<unknown>> = {
    getSnapshot: async () => {
      const snapshot = host.snapshot({ tailTurns: 8 });
      const sessions = await host.listSessions();
      return compactCompanionSnapshot({ ...snapshot, sessions });
    },
    prompt: async (args) => {
      await host.prompt(String(args[0] ?? ""), asOpts(args[1]));
      return null;
    },
    steer: async (args) => {
      await host.steer?.(String(args[0] ?? ""), asOpts(args[1]));
      return null;
    },
    followUp: async (args) => {
      await host.followUp?.(String(args[0] ?? ""), asOpts(args[1]));
      return null;
    },
    abort: async (args) => {
      await host.abort?.(asOpts(args[0]));
      return null;
    },
    setModel: async (args) => {
      await host.setModel?.(String(args[0] ?? ""));
      return null;
    },
    setThinkingLevel: async (args) => {
      host.setThinkingLevel?.(args[0] as ThinkingLevel);
      return null;
    },
    selectProject: async (args) => {
      const snapshot = await host.selectProject?.(String(args[0] ?? ""));
      if (!snapshot || typeof snapshot !== "object") return snapshot;
      const cwd = typeof (snapshot as { session?: { cwd?: unknown } }).session?.cwd === "string"
        ? (snapshot as { session: { cwd: string } }).session.cwd
        : undefined;
      const sessions = await host.listSessions(cwd);
      return { ...(snapshot as object), sessions };
    },
    setActiveProject: async (args) => host.setActiveProjectOnly?.(String(args[0] ?? "")),
    listProjects: async () => host.listProjects?.() ?? [],
    startSession: async (args) => host.start?.(args[0] as { cwd: string; sessionPath?: string; sessionKey?: SessionKey }),
    focusSession: async (args) => host.focusSession?.(String(args[0] ?? "") as SessionKey, args[1] as { includeTimeline?: boolean }),
    newSession: async (args) => host.newSession?.(asOpts(args[0])),
    undoFileChange: async (args) => {
      await host.undoFileChange?.(String(args[0] ?? ""), asOpts(args[1]));
      return null;
    },
    loadOlder: async (args) =>
      host.loadOlder?.(args[0] as { sessionKey: SessionKey; beforeId: string; limit?: number; sessionPath?: string }),
    getModels: async () => (await host.refreshAvailableModels?.()) ?? [],
    listSessions: async (args) => host.listSessions(args[0] === undefined ? undefined : String(args[0])),
    listLiveSessions: async () => host.listLiveSessions?.() ?? [],
  };

  return async (method: string, args: unknown[]): Promise<unknown> => {
    const handler = handlers[method];
    if (!handler) throw new Error(`unsupported ${method}`);
    return handler(args);
  };
}
