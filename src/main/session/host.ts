import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  getAgentDir,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type {
  LiveSessionSummary,
  ModelOption,
  PiCommand,
  PiEvent,
  PiSnapshot,
  ProjectSummary,
  ProviderAuthStatus,
  ProviderLoginEvent,
  ProviderLoginPrompt,
  ProviderUsageSnapshot,
  ResourceSnapshot,
  SessionCommandOptions,
  SessionKey,
  SessionStatus,
  SessionTodoItem,
  SessionTreeNode,
  ThinkingLevel,
  AgentMode,
  AgentProfile,
  PlanArtifactSummary,
  PlanStatus,
  SessionModeState,
  TimelineItem,
  ToolCallState,
  ToolOption,
  FileChangeSummary,
  McpConfigView,
  McpStatusSnapshotView,
} from "../../shared/protocol.js";
import type { IndexStatus } from "@pi-desk/code-index";
import {
  formatTodoListText,
  isTodoToolName,
  reconstructTodosFromMessages,
  SESSION_TODO_CUSTOM_TYPE,
  todosFromToolResult,
} from "@pi-desk/session-todo";
import {
  importCursorMcpConfig,
  projectMcpOverridePath,
  readMcpConfigs,
  setMcpServerDisabled,
} from "@pi-desk/mcp-bridge";
import type { McpStatusSnapshot } from "@pi-desk/mcp-bridge";
import { deleteSessionFile, getSessionContext, listSessions as loadSessionCatalog, resolveSessionDisplayName } from "./catalog.js";
import {
  addProject,
  getActiveProjectId,
  listProjects,
  removeProject as removeProjectFromCatalog,
  setActiveProject,
  touchProject,
} from "../workspace/projectCatalog.js";
import { mergePiCommands } from "./commands.js";
import {
  createDefaultUsageRegistry,
  type AccountUsage,
  type ProviderUsageRegistry,
} from "../provider/index.js";
import { createFileChangeSummary, filePathFromToolArgs } from "./fileChanges.js";
import { HttpWorkbenchStore } from "../http/store.js";
import { isPlanBlockedTool, PLAN_TOOL_NAMES, PlanModeStore, defaultModeState } from "./plan/store.js";
import { normalizeAuthEvent, normalizeAuthSource } from "./auth.js";
import { messageText as formatMessageText, modelName as formatModelName, resolveDisplayName as formatSessionName, resolvePathsEqual, stringify as formatUnknown } from "./display.js";
import { handleSessionEvent } from "./events.js";
import { createSdkRuntime as createSdkRuntimeSession } from "./runtime.js";
import { loadOlderFromFile, readSessionTail } from "./sessionFile.js";
import { buildSnapshot, loadOlderItems } from "./snapshot.js";
import type {
  AuthModelRuntimeFactory,
  PiEventListener,
  PiHostOptions,
  PiRuntimeFactory,
  PiRuntimeLike,
  PiSessionLike,
  RuntimeSlot,
} from "./types.js";

export type {
  AuthModelRuntimeFactory,
  PiEventListener,
  PiHostOptions,
  PiRuntimeFactory,
  PiRuntimeLike,
  PiSessionLike,
};

/** Fast/cheap model ids get a lower todo-nudge threshold (they drift more). */
const FAST_MODEL_PATTERN = /flash|mini|haiku|lite|nano|small/i;
const THINKING_LEVEL_ORDER: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const DEFAULT_MODEL_THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high"]);

export class PiHost {
  private readonly workspaceId: string;
  private readonly agentDir: string;
  private readonly listeners = new Set<PiEventListener>();
  private readonly runtimeFactory?: PiRuntimeFactory;
  private readonly authRuntimeFactory?: AuthModelRuntimeFactory;
  private readonly clipboardWriter?: (text: string) => void;
  private readonly openExternal?: (url: string) => void;
  private readonly usageRegistry: ProviderUsageRegistry;
  private readonly usageCacheTtlMs: number;
  private readonly todoNudgeThreshold: number;
  private readonly todoNudgeFastThreshold: number;
  private httpWorkbench?: HttpWorkbenchStore;
  /** Multi-session live slots. Foreground is `foregroundKey`. */
  private readonly slots = new Map<SessionKey, RuntimeSlot>();
  /** Mode lookup used by the per-runtime plan extension before a slot is bound. */
  private readonly planModes = new Map<string, AgentMode>();
  private foregroundKey?: SessionKey;
  private sequence = 0;
  private workspaceCwd: string | undefined;
  private pendingTrust?: { cwd: string; hasProjectResources: boolean };
  private availableModelsCache: ModelOption[] = [];
  /** In-flight OAuth logins per provider (AbortController + pending prompt resolvers). */
  private readonly oauthLogins = new Map<string, { controller: AbortController; resolvers: Map<string, { resolve: (value: string) => void; reject: (error: Error) => void }> }>();
  /** promptId → resolver lookup across all in-flight logins (for answerAuthPrompt). */
  private readonly promptResolvers = new Map<string, { resolve: (value: string) => void; reject: (error: Error) => void }>();
  private promptCounter = 0;
  /** Successful / short-lived failed account usage cache keyed by providerId. */
  private readonly accountUsageCache = new Map<string, { at: number; account: AccountUsage }>();
  /** Workspace-global merged MCP server status (last write per server wins). */
  private mcpStatus?: McpStatusSnapshotView;

  /** Foreground runtime (compat for single-session call sites). */
  private get runtime(): PiRuntimeLike | undefined {
    return this.getSlot()?.runtime;
  }

  private get sessionTodos(): SessionTodoItem[] {
    return this.getSlot()?.sessionTodos ?? [];
  }

  constructor(options: PiHostOptions = {}) {
    this.workspaceId = options.workspaceId ?? "local";
    this.agentDir = options.agentDir ?? getAgentDir();
    this.runtimeFactory = options.runtimeFactory;
    this.authRuntimeFactory = options.authRuntimeFactory;
    this.clipboardWriter = options.clipboardWriter;
    this.openExternal = options.openExternal;
    this.usageRegistry = options.usageRegistry ?? createDefaultUsageRegistry();
    this.usageCacheTtlMs = options.usageCacheTtlMs ?? 60_000;
    this.todoNudgeThreshold = options.todoNudgeThreshold ?? 8;
    this.todoNudgeFastThreshold = options.todoNudgeFastThreshold ?? 4;
    if (options.runtime) {
      const key = this.keyForRuntime(options.runtime);
      this.attachRuntime(key, options.runtime);
      this.foregroundKey = key;
    }
  }

  setHttpWorkbenchStore(store: HttpWorkbenchStore): void {
    this.httpWorkbench = store;
  }

  private getSlot(sessionKey?: SessionKey): RuntimeSlot | undefined {
    const key = sessionKey ?? this.foregroundKey;
    if (!key) return undefined;
    return this.slots.get(key);
  }

  private keyForRuntime(runtime: PiRuntimeLike): SessionKey {
    const file = runtime.session.sessionFile ?? runtime.session.sessionManager?.getSessionFile?.();
    if (file) return `file:${file}`;
    if (runtime.session.sessionId) return `id:${runtime.session.sessionId}`;
    return `tmp:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private findSlotBySessionFile(sessionPath: string): RuntimeSlot | undefined {
    for (const slot of this.slots.values()) {
      const file =
        slot.runtime.session.sessionFile ?? slot.runtime.session.sessionManager?.getSessionFile?.();
      if (file && resolvePathsEqual(file, sessionPath)) return slot;
    }
    return undefined;
  }

  subscribe(listener: PiEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(options: {
    cwd: string;
    sessionPath?: string;
    sessionKey?: SessionKey;
  }): Promise<PiSnapshot> {
    this.workspaceCwd = options.cwd;
    addProject(options.cwd);
    setActiveProject(options.cwd);

    // Reuse existing live slot for the same session file.
    if (options.sessionPath) {
      const byFile = this.findSlotBySessionFile(options.sessionPath);
      if (byFile) {
        this.foregroundKey = byFile.key;
        this.emitLiveSessionsChanged();
        await this.refreshAvailableModels();
        return this.snapshot();
      }
    }

    // Reuse existing slot by explicit key.
    if (options.sessionKey && this.slots.has(options.sessionKey)) {
      this.foregroundKey = options.sessionKey;
      this.emitLiveSessionsChanged();
      await this.refreshAvailableModels();
      return this.snapshot();
    }

    // Legacy callers (no sessionKey): single-runtime replace semantics.
    // Multi-session callers pass sessionKey and keep other slots alive.
    if (!options.sessionKey) {
      await this.disposeAllRuntimes();
    }

    const key =
      options.sessionKey ??
      (options.sessionPath
        ? `file:${options.sessionPath}`
        : `tmp:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

    const runtime = this.runtimeFactory
      ? await this.runtimeFactory(options)
      : await this.createSdkRuntime(options);
    this.attachRuntime(key, runtime);
    this.foregroundKey = key;
    const session = runtime.session;
    this.emit(
      "session_started",
      {
        sessionId: session.sessionId,
        cwd: runtime.cwd,
        sessionName: this.resolveDisplayName(session),
        model: this.modelName(session),
        thinkingLevel: session.thinkingLevel as ThinkingLevel,
      },
      undefined,
      key,
    );
    // Publish the hydrated state after the session reset event. This keeps the
    // renderer's checklist correct when opening a session with persisted todos.
    const slot = this.getSlot(key);
    if (slot && (slot.modeState.mode === "plan" || slot.modeState.executeProfile.modelKey !== this.modelName(session) || slot.modeState.executeProfile.thinkingLevel !== session.thinkingLevel)) {
      await this.applyModeRuntime(slot, { persist: false });
    }
    this.emit(
      "todos_updated",
      { todos: slot?.sessionTodos ?? [], revision: slot?.todoRevision ?? 0 },
      undefined,
      key,
    );
    if (slot) this.emitPlanArtifactChanged(slot);
    // Auto-trust project resources — no confirmation dialog in the desktop UI.
    this.emit("project_trust_resolved", { cwd: options.cwd, trusted: true }, undefined, key);
    this.emitLiveSessionsChanged();
    await this.refreshAvailableModels();
    return this.snapshot();
  }

  async focusSession(sessionKey: SessionKey, opts?: { includeTimeline?: boolean }): Promise<PiSnapshot> {
    const slot = this.slots.get(sessionKey);
    if (!slot) throw new Error(`Unknown sessionKey: ${sessionKey}`);
    this.foregroundKey = sessionKey;
    this.workspaceCwd = slot.runtime.cwd;
    addProject(slot.runtime.cwd);
    setActiveProject(slot.runtime.cwd);
    return this.snapshot({ includeTimeline: opts?.includeTimeline });
  }

  async previewSession(options: { cwd: string; sessionPath: string; tailTurns?: number }): Promise<PiSnapshot> {
    this.workspaceCwd = options.cwd;
    addProject(options.cwd);
    setActiveProject(options.cwd);
    // Previewing a historical session keeps the UI alive without starting a full
    // runtime, but the model picker must still reflect the configured providers.
    // Populate the cache from the dedicated auth runtime when it is empty (e.g.
    // right after boot, before any live session has resolved models).
    if (this.availableModelsCache.length === 0) {
      await this.refreshAvailableModelsFromAuth();
    }
    const tail = readSessionTail(options.sessionPath, options.tailTurns);
    const modelKey = tail.model?.provider && tail.model.id
      ? `${tail.model.provider}/${tail.model.id}`
      : "";
    const snap = buildSnapshot({
      workspaceId: this.workspaceId,
      workspaceCwd: options.cwd,
      sequence: this.sequence,
      sessionTodos: [],
      resources: this.getResources(),
      models: this.getModels(),
      tools: this.getTools(),
      runtime: {
        cwd: options.cwd,
        session: {
          sessionId: tail.sessionId,
          sessionFile: options.sessionPath,
          sessionName: tail.name,
          cwd: options.cwd,
          model: tail.model,
          thinkingLevel: tail.thinkingLevel ?? "medium",
          isStreaming: false,
          messages: tail.messages,
          getActiveToolNames: () => [],
          getAllTools: () => [],
          getSessionStats: () => undefined,
          subscribe: () => () => undefined,
          prompt: async () => undefined,
          steer: async () => undefined,
          followUp: async () => undefined,
          abort: async () => undefined,
          setThinkingLevel: () => undefined,
        },
      } as never,
      tailTurns: options.tailTurns,
    });
    return {
      ...snap,
      session: {
        ...snap.session,
        name: tail.name,
        model: modelKey || snap.session.model,
        thinkingLevel: (tail.thinkingLevel ?? snap.session.thinkingLevel) as typeof snap.session.thinkingLevel,
      },
      timelineHasMore: tail.hasMore || snap.timelineHasMore === true,
      preview: true,
    };
  }

  async loadOlder(options: {
    sessionKey: SessionKey;
    beforeId: string;
    limit?: number;
    sessionPath?: string;
  }): Promise<{ items: TimelineItem[]; hasMore: boolean }> {
    const slot = this.slots.get(options.sessionKey);
    if (slot) return loadOlderItems(slot.runtime.session, options.beforeId, options.limit);
    if (options.sessionPath) return loadOlderFromFile(options.sessionPath, options.beforeId, options.limit);
    throw new Error(`Unknown sessionKey: ${options.sessionKey}`);
  }

  isForegroundSession(sessionKey?: SessionKey): boolean {
    return Boolean(sessionKey && sessionKey === this.foregroundKey);
  }

  /** Explicit dispose of one live slot (not used on tab close). */
  async disposeSession(sessionKey: SessionKey): Promise<void> {
    await this.disposeSlot(sessionKey);
    this.emitLiveSessionsChanged();
  }

  listLiveSessions(): LiveSessionSummary[] {
    return [...this.slots.values()].map((slot) => {
      const session = slot.runtime.session;
      const file = session.sessionFile ?? session.sessionManager?.getSessionFile?.();
      const status: SessionStatus = session.isStreaming
        ? "running"
        : slot.status === "running"
          ? "running"
          : slot.status;
      return {
        sessionKey: slot.key,
        sessionId: session.sessionId,
        sessionFile: file,
        cwd: slot.runtime.cwd,
        projectId: slot.runtime.cwd,
        name: this.resolveDisplayName(session),
        status,
      };
    });
  }

  /** UI detach only — keep the agent alive. */
  detachSession(_sessionKey: SessionKey): void {
    // Intentionally no-op on host life.
  }

  listProjects(): ProjectSummary[] {
    return listProjects();
  }

  addProjectFromPath(projectPath: string): ProjectSummary {
    const project = addProject(projectPath);
    this.workspaceCwd = project.path;
    return project;
  }

  /**
   * Remove a project from the desktop catalog only (does not delete session files).
   * If the removed project was active / current cwd, dispose runtime so the UI can go empty.
   */
  async removeProject(projectId: string): Promise<{ projects: ProjectSummary[]; activeProjectId?: string }> {
    const id = projectId.replace(/\/+$/, "") || projectId;
    const runtimeCwd = this.runtime?.cwd?.replace(/\/+$/, "") || "";
    const wasActive =
      getActiveProjectId() === id || this.workspaceCwd === id || runtimeCwd === id;

    removeProjectFromCatalog(id);

    // Dispose any live slots whose cwd matches the removed project.
    for (const slot of [...this.slots.values()]) {
      const cwd = slot.runtime.cwd?.replace(/\/+$/, "") || "";
      if (cwd === id) await this.disposeSlot(slot.key);
    }

    if (wasActive) {
      this.workspaceCwd = getActiveProjectId();
    }
    this.emitLiveSessionsChanged();

    return {
      projects: listProjects(),
      activeProjectId: getActiveProjectId(),
    };
  }

  async selectProject(projectId: string): Promise<PiSnapshot> {
    const project = setActiveProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    return this.start({ cwd: project.path });
  }

  /** Catalog-only: set which project New session / defaults target. Does not touch runtime. */
  setActiveProjectOnly(projectId: string): { projects: ProjectSummary[]; activeProjectId?: string } {
    const project = setActiveProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    return {
      projects: listProjects(),
      activeProjectId: getActiveProjectId(),
    };
  }

  async prompt(text: string, opts?: SessionCommandOptions): Promise<void> {
    const slot = this.requireSlot(opts?.sessionKey);
    const session = slot.runtime.session;
    if (slot.modeState.mode === "plan" && /^\/[A-Za-z0-9_-]+(?:\s|$)/.test(text.trim())) {
      throw new Error("Commands are unavailable in Plan mode; use the plan editor or switch to Execute");
    }
    // Apply any mode/model/effort change recorded while a previous turn was
    // still streaming so this turn starts with the newly selected profile.
    await this.applyPendingMode(slot);
    // Resolve as soon as the message is accepted (preflight passes, turn starts)
    // instead of waiting for the whole agent turn, so the composer can clear the
    // input immediately. Turn errors after acceptance surface as session_error.
    await new Promise<void>((resolve, reject) => {
      let accepted = false;
      void session
        .prompt(text, {
          preflightResult: (ok: boolean) => {
            if (ok && !accepted) {
              accepted = true;
              touchProject(this.workspaceCwd ?? slot.runtime.cwd ?? "");
              resolve();
            }
          },
        } as never)
        .then(
          () => {
            if (!accepted) resolve();
          },
          (error: unknown) => {
            if (accepted) {
              this.emit(
                "session_error",
                { message: error instanceof Error ? error.message : String(error) },
                undefined,
                slot.key,
              );
            } else {
              reject(error);
            }
          },
        );
    });
  }

  async steer(text: string, opts?: SessionCommandOptions): Promise<void> {
    const slot = this.requireSlot(opts?.sessionKey);
    touchProject(this.workspaceCwd ?? slot.runtime.cwd ?? "");
    await slot.runtime.session.steer(text);
  }

  async followUp(text: string, opts?: SessionCommandOptions): Promise<void> {
    const slot = this.requireSlot(opts?.sessionKey);
    touchProject(this.workspaceCwd ?? slot.runtime.cwd ?? "");
    await slot.runtime.session.followUp(text);
  }

  async undoFileChange(path: string, opts?: SessionCommandOptions): Promise<void> {
    const slot = this.requireSlot(opts?.sessionKey);
    const absolutePath = resolve(slot.runtime.cwd, path);
    const normalizedPath = relative(slot.runtime.cwd, absolutePath).replace(/\\/g, "/") || path;
    const mutation = slot.completedFileMutations.get(normalizedPath);
    if (!mutation) throw new Error(`This file change is no longer undoable: ${path}`);

    const current = this.readTextFile(mutation.absolutePath);
    if (current !== mutation.after) {
      throw new Error(`Cannot undo ${mutation.path}: the file changed after the session edit`);
    }

    if (mutation.before === undefined) {
      try {
        unlinkSync(mutation.absolutePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    } else {
      writeFileSync(mutation.absolutePath, mutation.before, "utf8");
    }
    slot.completedFileMutations.delete(normalizedPath);
    this.emit("file_change_undone", { path: mutation.path }, undefined, slot.key);
  }

  async editFollowUp(index: number, text: string, opts?: SessionCommandOptions, expectedText?: string): Promise<void> {
    const slot = this.requireSlot(opts?.sessionKey);
    const queue = this.readQueueForEditing(slot);
    const nextText = text.trim();
    if (!nextText) throw new Error("Queued message cannot be empty");
    if (!Number.isInteger(index) || index < 0 || index >= queue.followUp.length) {
      throw new Error("Queued message is no longer available");
    }
    if (expectedText !== undefined && queue.followUp[index] !== expectedText) {
      throw new Error("Queued message changed before it could be edited");
    }
    queue.followUp[index] = nextText;
    await this.replaceQueue(slot, queue.steering, queue.followUp);
    touchProject(this.workspaceCwd ?? slot.runtime.cwd ?? "");
  }

  async sendFollowUpNow(index: number, opts?: SessionCommandOptions, expectedText?: string): Promise<void> {
    const slot = this.requireSlot(opts?.sessionKey);
    const queue = this.readQueueForEditing(slot);
    if (!Number.isInteger(index) || index < 0 || index >= queue.followUp.length) {
      throw new Error("Queued message is no longer available");
    }
    if (expectedText !== undefined && queue.followUp[index] !== expectedText) {
      throw new Error("Queued message changed before it could be sent");
    }
    const [message] = queue.followUp.splice(index, 1);
    if (!message) throw new Error("Queued message is no longer available");

    // While the agent is running this is Pi's steering delivery path. If a
    // queue item survives until idle, send it as a normal prompt instead.
    if (slot.runtime.session.isStreaming) {
      queue.steering.push(message);
      await this.replaceQueue(slot, queue.steering, queue.followUp);
    } else {
      await this.replaceQueue(slot, queue.steering, queue.followUp);
      await this.prompt(message, opts);
    }
    touchProject(this.workspaceCwd ?? slot.runtime.cwd ?? "");
  }

  private readQueueForEditing(slot: RuntimeSlot): { steering: string[]; followUp: string[] } {
    const session = slot.runtime.session;
    if (!session.clearQueue || !session.getSteeringMessages || !session.getFollowUpMessages) {
      throw new Error("Queue editing is unavailable for this session");
    }
    return {
      steering: [...session.getSteeringMessages()],
      followUp: [...session.getFollowUpMessages()],
    };
  }

  private async replaceQueue(slot: RuntimeSlot, steering: string[], followUp: string[]): Promise<void> {
    const session = slot.runtime.session;
    if (!session.clearQueue) throw new Error("Queue editing is unavailable for this session");
    session.clearQueue();
    await Promise.all([
      ...steering.map((message) => session.steer(message)),
      ...followUp.map((message) => session.followUp(message)),
    ]);
  }

  async abort(opts?: SessionCommandOptions): Promise<void> {
    await this.requireSlot(opts?.sessionKey).runtime.session.abort();
  }

  setThinkingLevel(level: ThinkingLevel): void {
    this.requireSession().setThinkingLevel(level);
  }

  private modeProfile(slot: RuntimeSlot, mode = slot.modeState.mode): AgentProfile {
    return mode === "plan" ? slot.modeState.planProfile : slot.modeState.executeProfile;
  }

  /** Persist mode state with Pi's durable session identity, not a UI tab key. */
  private modeStorageKey(slot: RuntimeSlot, session: PiSessionLike = slot.runtime.session): string {
    return session.sessionId || slot.key;
  }

  private allToolNames(session: PiSessionLike): string[] {
    return typeof session.getAllTools === "function"
      ? (session.getAllTools() as Array<{ name?: string }>).map((tool) => tool.name).filter((name): name is string => Boolean(name))
      : [];
  }

  private executeToolNames(slot: RuntimeSlot, allTools = this.allToolNames(slot.runtime.session)): string[] {
    const known = new Set(allTools);
    const saved = slot.modeState.executeToolNames ?? slot.runtime.session.getActiveToolNames();
    return [...new Set(saved)].filter((name) => known.has(name));
  }

  /**
   * Plan mode is a temporary local-workspace safety layer.  It must not erase
   * the user's normal tool choices or blanket-disable MCP/extension tools.
   */
  private applyToolPolicy(slot: RuntimeSlot): void {
    const session = slot.runtime.session;
    const allTools = this.allToolNames(session);
    if (allTools.length === 0 || typeof session.setActiveToolsByName !== "function") return;
    const executeToolNames = this.executeToolNames(slot, allTools);
    if (!slot.modeState.executeToolNames) {
      slot.modeState = { ...slot.modeState, executeToolNames };
    }
    const activeTools = slot.modeState.mode === "plan"
      ? [...new Set([...executeToolNames.filter((name) => !isPlanBlockedTool(name)), ...PLAN_TOOL_NAMES])]
      : executeToolNames;
    session.setActiveToolsByName(activeTools.filter((name) => allTools.includes(name)));
  }

  private async applyModeRuntime(slot: RuntimeSlot, options: { persist: boolean }): Promise<void> {
    const session = slot.runtime.session;
    const profile = this.modeProfile(slot);
    if (profile.modelKey && typeof session.setModel === "function") {
      const [provider, ...idParts] = profile.modelKey.split("/");
      const model = session.modelRuntime?.getModel(provider!, idParts.join("/"));
      if (model) await session.setModel(model);
    }
    if (typeof session.setThinkingLevel === "function") session.setThinkingLevel(profile.thinkingLevel);
    this.applyToolPolicy(slot);
    this.planModes.set(session.sessionId, slot.modeState.mode);
    if (options.persist) slot.planStore.setMode(this.modeStorageKey(slot), slot.modeState);
  }

  private emitPlanArtifactChanged(slot: RuntimeSlot): void {
    let plans: PlanArtifactSummary[] = [];
    try { plans = slot.planStore.listPlans(slot.runtime.session.sessionId); } catch { /* broken plan directory is surfaced on demand */ }
    if (slot.modeState.activePlan && !plans.some((plan) => plan.id === slot.modeState.activePlan?.id)) {
      slot.modeState = { ...slot.modeState, activePlan: undefined };
      slot.planStore.setMode(this.modeStorageKey(slot), slot.modeState);
    }
    // Backfill sessions created before extension-backed plan_save started
    // persisting activePlan.  Filtering above is already by session identity,
    // so adopting the sole matching artifact cannot attach another session's
    // plan.  Multiple plans remain deliberately unselected until the user or
    // agent saves/chooses one explicitly.
    if (!slot.modeState.activePlan && plans.length === 1) {
      slot.modeState = { ...slot.modeState, activePlan: plans[0] };
      slot.planStore.setMode(this.modeStorageKey(slot), slot.modeState);
    }
    this.emit("plan_artifact_changed", { plan: slot.modeState.activePlan, plans }, undefined, slot.key);
  }

  async setMode(mode: AgentMode, opts?: SessionCommandOptions): Promise<SessionModeState> {
    const slot = this.requireSlot(opts?.sessionKey);
    // Capture the currently enabled tools immediately before entering Plan.
    // They are restored exactly when returning to Execute.
    const executeToolNames = mode === "plan" && slot.modeState.mode !== "plan"
      ? this.executeToolNames(slot)
      : slot.modeState.executeToolNames;
    slot.modeState = { ...slot.modeState, mode, executeToolNames };
    if (slot.runtime.session.isStreaming) {
      // Record the switch but let the running turn finish untouched. The new
      // mode (tool policy included) takes effect on the next turn.
      slot.pendingModeApply = true;
      slot.planStore.setMode(this.modeStorageKey(slot), slot.modeState);
    } else {
      await this.applyModeRuntime(slot, { persist: true });
      slot.pendingModeApply = false;
    }
    this.emit("mode_changed", slot.modeState, undefined, slot.key);
    this.emitPlanArtifactChanged(slot);
    return slot.modeState;
  }

  async setModeProfile(mode: AgentMode, profile: AgentProfile, opts?: SessionCommandOptions): Promise<SessionModeState> {
    const slot = this.getSlot(opts?.sessionKey);
    if (!slot) {
      return defaultModeState(profile.modelKey, profile.thinkingLevel);
    }
    const model = profile.modelKey
      ? this.resolveModel(slot.runtime.session, profile.modelKey)
      : undefined;
    const allowed = this.supportedThinkingLevels(slot.runtime.session, model);
    if (!allowed.includes(profile.thinkingLevel)) throw new Error(`Thinking level is not supported: ${profile.thinkingLevel}`);
    if (profile.modelKey && !model) {
      throw new Error(`Model not found: ${profile.modelKey}`);
    }
    slot.modeState = {
      ...slot.modeState,
      [mode === "plan" ? "planProfile" : "executeProfile"]: { ...profile },
    };
    if (mode === slot.modeState.mode) {
      if (slot.runtime.session.isStreaming) {
        // Record the new model/effort but leave the running turn untouched.
        // It is applied when the turn ends (next turn uses the new profile).
        slot.pendingModeApply = true;
        slot.planStore.setMode(this.modeStorageKey(slot), slot.modeState);
      } else {
        await this.applyModeRuntime(slot, { persist: true });
        slot.pendingModeApply = false;
      }
    } else {
      slot.planStore.setMode(this.modeStorageKey(slot), slot.modeState);
    }
    this.emit("mode_changed", slot.modeState, undefined, slot.key);
    return slot.modeState;
  }

  listPlans(opts?: SessionCommandOptions): PlanArtifactSummary[] {
    // A renderer may survive a development-time main-process restart. Until a
    // session is restored, there is no session identity to scope plan files to.
    // Treat that transitional state as an empty plan list rather than an IPC
    // failure.
    const slot = this.getSlot(opts?.sessionKey);
    if (!slot) return [];
    return slot.planStore.listPlans(slot.runtime.session.sessionId);
  }

  readPlan(planId: string, opts?: SessionCommandOptions): { summary: PlanArtifactSummary; content: string } {
    const slot = this.requireSlot(opts?.sessionKey);
    return slot.planStore.readPlan(planId, slot.runtime.session.sessionId);
  }

  updatePlan(planId: string, content: string, revision?: string, opts?: SessionCommandOptions): PlanArtifactSummary {
    const slot = this.requireSlot(opts?.sessionKey);
    const sessionId = slot.runtime.session.sessionId;
    const saved = slot.planStore.updatePlan(planId, content, revision ?? slot.planStore.readPlan(planId, sessionId).summary.revision, sessionId);
    if (slot.modeState.activePlan?.id === saved.id) slot.modeState = { ...slot.modeState, activePlan: saved };
    slot.planStore.setMode(this.modeStorageKey(slot), slot.modeState);
    this.emitPlanArtifactChanged(slot);
    return saved;
  }

  savePlan(title: string, content: string, status: PlanStatus = "draft", planId?: string, opts?: SessionCommandOptions): { summary: PlanArtifactSummary; content: string } {
    const slot = this.requireSlot(opts?.sessionKey);
    const saved = slot.planStore.savePlan({ title, content, status, planId, sourceSession: slot.runtime.session.sessionId });
    slot.modeState = { ...slot.modeState, activePlan: saved.summary };
    slot.planStore.setMode(this.modeStorageKey(slot), slot.modeState);
    this.emitPlanArtifactChanged(slot);
    return saved;
  }

  async startExecution(planId?: string, opts?: SessionCommandOptions): Promise<SessionModeState> {
    const slot = this.requireSlot(opts?.sessionKey);
    if (slot.runtime.session.isStreaming) throw new Error("Stop the current turn before starting execution");
    const id = planId ?? slot.modeState.activePlan?.id;
    if (!id) throw new Error("Select a saved plan before starting execution");
    const sessionId = slot.runtime.session.sessionId;
    const plan = slot.planStore.readPlan(id, sessionId);
    if (plan.summary.status !== "ready" && plan.summary.status !== "executing") {
      throw new Error("Mark the plan ready before starting execution");
    }
    const executing = slot.planStore.setPlanStatus(id, "executing", sessionId);
    slot.modeState = { ...slot.modeState, mode: "execute", activePlan: executing };
    await this.applyModeRuntime(slot, { persist: true });
    this.emit("mode_changed", slot.modeState, undefined, slot.key);
    this.emitPlanArtifactChanged(slot);
    const body = plan.content.match(/##\s+Execution handoff\s*([\s\S]*)/i)?.[1]?.trim() || plan.content;
    const handoff = `Begin execution from the approved plan at ${executing.path}.\n\nExecution handoff:\n${body.slice(0, 6000)}`;
    await this.prompt(handoff, { sessionKey: slot.key });
    return slot.modeState;
  }

  setTools(tools: string[], opts?: SessionCommandOptions): void {
    const slot = this.requireSlot(opts?.sessionKey);
    const allTools = this.allToolNames(slot.runtime.session);
    const known = new Set(allTools);
    const requested = [...new Set(tools)].filter((name) => known.has(name));
    const previous = this.executeToolNames(slot, allTools);
    // While Plan is active, local write tools stay locked. Keep their Execute
    // preference untouched while allowing the user to tune MCP/extensions.
    const executeToolNames = slot.modeState.mode === "plan"
      ? [...new Set([...requested.filter((name) => !isPlanBlockedTool(name)), ...previous.filter(isPlanBlockedTool)])]
      : requested;
    slot.modeState = { ...slot.modeState, executeToolNames };
    this.applyToolPolicy(slot);
    slot.planStore.setMode(this.modeStorageKey(slot), slot.modeState);
    this.emit("mode_changed", slot.modeState, undefined, slot.key);
  }

  async setSkills(patterns: string[]): Promise<void> {
    const settingsPath = join(this.agentDir, "settings.json");
    const settings = this.readSettingsFile() ?? {};
    const skills = patterns.filter((pattern) => typeof pattern === "string" && pattern.trim());
    if (skills.length === 0) delete settings.skills;
    else settings.skills = skills;
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    await this.reload();
  }

  async warmupTools(): Promise<void> {
    // Pre-download rg/fd on first launch so the grep/find tools work offline later.
    // Load via createRequire (not import) so Vite's exports-map validation doesn't
    // block the deep path into pi-coding-agent's internal tools-manager.
    try {
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      const { ensureTool } = require("@earendil-works/pi-coding-agent/dist/utils/tools-manager.js");
      await ensureTool("rg", true);
      await ensureTool("fd", true);
    } catch {
      // warmup is best-effort; tools will try again on first use
    }
  }

  async compact(instructions?: string): Promise<unknown> {
    return this.requireSession().compact(instructions);
  }

  async reload(): Promise<void> {
    await this.requireSession().reload();
  }

  async setModel(modelKey: string): Promise<void> {
    const session = this.requireSession();
    const [provider, ...idParts] = modelKey.split("/");
    const id = idParts.join("/");
    const model = session.modelRuntime?.getModel(provider, id);
    if (!model || !session.setModel) throw new Error(`Model not found: ${modelKey}`);
    await session.setModel(model);
    this.emit("model_changed", { model: modelKey, provider });
  }

  async executeCommand(name: string, args = ""): Promise<void> {
    const command = name.replace(/^\//, "");
    switch (command) {
      case "new":
        await this.newSession();
        return;
      case "clone":
        await this.cloneSession();
        return;
      case "compact":
        await this.compact(args || undefined);
        return;
      case "reload":
        await this.reload();
        return;
      case "name":
        {
          const session = this.requireSession();
          if (!args.trim() || !session.setSessionName) throw new Error("/name requires a session name");
          session.setSessionName(args.trim());
        }
        return;
      case "model":
        if (!args.trim()) throw new Error("/model requires provider/model");
        {
          const slot = this.requireSlot();
          if (slot.modeState.mode === "plan") {
            await this.setModeProfile("plan", { ...slot.modeState.planProfile, modelKey: args.trim() });
          } else {
            await this.setModel(args.trim());
          }
        }
        return;
      case "import":
        if (!args.trim()) throw new Error("/import requires a JSONL path");
        await this.importSession(args.trim());
        return;
      case "export": {
        const session = this.requireSession();
        const out = args.trim();
        const jsonlSession = session as PiSessionLike & { exportToJsonl?: (outputPath?: string) => string };
        if (out.endsWith(".jsonl") && jsonlSession.exportToJsonl) {
          jsonlSession.exportToJsonl(out);
        } else {
          await session.exportToHtml?.(out || undefined);
        }
        return;
      }
      case "copy": {
        const session = this.requireSession() as PiSessionLike & { getLastAssistantText?: () => string };
        const text = session.getLastAssistantText?.() ?? "";
        if (text) await this.copyToClipboard(text);
        return;
      }
      case "session": {
        const session = this.requireSession();
        const stats = session.getSessionStats();
        this.emit("notification_created", { message: `Session ${session.sessionId} — tokens: ${stats.tokens.total}, cost: $${stats.cost.toFixed(4)}` });
        return;
      }
      case "tree": {
        const session = this.requireSession() as PiSessionLike & { navigateTree?: (targetId: string, options?: unknown) => Promise<unknown> };
        if (!args.trim() || !session.navigateTree) throw new Error("/tree requires a session tree entry id");
        await session.navigateTree(args.trim());
        return;
      }
      default:
        throw new Error(`Command ${name} needs a desktop UI flow`);
    }
  }

  getCommands(): PiCommand[] {
    const loader = this.runtime?.session.resourceLoader;
    const extensionCommands = this.runtime?.session.extensionRunner?.getRegisteredCommands() ?? [];
    // Skill commands (/skill:<name>) and prompt templates (/<template>) are
    // expanded by AgentSession.prompt itself — see _expandSkillCommand and
    // expandPromptTemplate in pi-coding-agent — so listing them here is enough
    // for the slash picker; the renderer sends them through api.prompt().
    const skillCommands = (loader?.getSkills().skills ?? [])
      .filter((skill) => skill.name)
      .map((skill) => ({ name: `skill:${skill.name}`, description: skill.description, source: "skill" as const }));
    const promptCommands = (loader?.getPrompts().prompts ?? [])
      .filter((prompt) => prompt.name)
      .map((prompt) => ({ name: prompt.name!, description: prompt.description, source: "prompt" as const }));
    return mergePiCommands([
      ...extensionCommands.map((command) => ({ name: command.invocationName ?? command.name, description: command.description, source: "extension" as const })),
      ...skillCommands,
      ...promptCommands,
    ]);
  }

  getModels(): ModelOption[] {
    return this.availableModelsCache;
  }

  /**
   * Refresh models shown in the UI.
   * Only keep providers the user intentionally chose for Pi
   * (settings.defaultProvider + non-empty auth.json entries).
   * Ambient env tokens from other tools (e.g. ANTHROPIC_AUTH_TOKEN) must not flood the list.
   * The session's current model is always kept as a single option when missing.
   */
  async refreshAvailableModels(): Promise<ModelOption[]> {
    const session = this.runtime?.session;
    const modelRuntime = session?.modelRuntime;
    if (!modelRuntime) {
      // No live slot yet (e.g. right after boot). Resolve models from the
      // dedicated auth runtime so the picker still shows configured providers
      // before the first session has been started.
      await this.refreshAvailableModelsFromAuth();
      return this.availableModelsCache;
    }

    const thinkingLevels = (session?.getAvailableThinkingLevels?.() ?? [
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]) as ThinkingLevel[];

    type RawModel = { provider?: string; id?: string; name?: string };
    let raw: RawModel[] = [];

    try {
      if (modelRuntime.getAvailable) {
        raw = [...(await modelRuntime.getAvailable())];
      }
    } catch {
      raw = [];
    }

    if (raw.length === 0) {
      raw = [...(modelRuntime.getAvailableSnapshot?.() ?? [])];
    }

    if (raw.length === 0) {
      raw = [...(modelRuntime.getModels() ?? [])].filter((model) => {
        const provider = model.provider ?? "";
        return provider !== "" && Boolean(modelRuntime.hasConfiguredAuth?.(provider));
      });
    }

    // The live session runtime can serve a stale/empty availability snapshot (e.g. it was
    // resumed without re-running availability, or the system env changed since it started).
    // Refresh the live runtime's availability before giving up so the model list matches
    // configured providers (auth.json / env) without creating a dedicated auth runtime.
    if (raw.length === 0 && modelRuntime.refresh && this.runtime?.session) {
      try {
        await modelRuntime.refresh({ allowNetwork: false });
        if (modelRuntime.getAvailable) {
          raw = [...(await modelRuntime.getAvailable())];
        }
      } catch {
        // Availability refresh is best-effort; keep the empty list rather than fail.
      }
    }

    // Restrict to intentional Pi providers only (settings + auth.json). Never expand
    // just because the current session model happens to be from another provider.
    const intentional = this.intentionalProviders(session);
    if (intentional.size > 0) {
      raw = raw.filter((model) => intentional.has(model.provider ?? ""));
    }

    // Apply enabledModels patterns from settings when present.
    const enabledPatterns =
      session?.settingsManager?.getEnabledModels?.() ?? this.readSettingsEnabledModels();
    if (enabledPatterns && enabledPatterns.length > 0) {
      const matched = raw.filter((model) => this.matchesEnabledModel(model, enabledPatterns));
      if (matched.length > 0) raw = matched;
    }

    // Always include the session's current model as a single entry if present.
    const current = session?.model;
    if (current?.provider && current.id) {
      const key = `${current.provider}/${current.id}`;
      if (!raw.some((model) => `${model.provider ?? ""}/${model.id ?? ""}` === key)) {
        const found = modelRuntime.getModel?.(current.provider, current.id) as RawModel | undefined;
        raw.unshift(found ?? { provider: current.provider, id: current.id, name: current.id });
      }
    }

    const seen = new Set<string>();
    const unique = raw.filter((model) => {
      const key = `${model.provider ?? "unknown"}/${model.id ?? "unknown"}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    this.availableModelsCache = unique.map((model) => ({
      id: `${model.provider ?? "unknown"}/${model.id ?? "unknown"}`,
      provider: model.provider ?? "unknown",
      label: model.name ?? model.id ?? "unknown",
      available: true,
      thinkingLevels,
    }));

    return this.availableModelsCache;
  }

  /**
   * Populate the available-model cache from the dedicated auth runtime, used when no
   * live session runtime is present (e.g. previewing a historical session before any
   * session has resolved models). Mirrors the filtering in refreshAvailableModels and the
   * dedicated runtime used by Settings → Providers, so the model picker reflects the
   * same configured providers (auth.json / env) the Providers tab shows.
   */
  private async refreshAvailableModelsFromAuth(): Promise<void> {
    try {
      const runtime = await this.createAuthModelRuntime();
      const raw = [...(await runtime.getAvailable())];
      const intentional = this.intentionalProviders();
      const filtered =
        intentional.size > 0
          ? raw.filter((model) => intentional.has(model.provider ?? ""))
          : raw;
      const enabledPatterns = this.readSettingsEnabledModels();
      const matched =
        enabledPatterns && enabledPatterns.length > 0
          ? filtered.filter((model) => this.matchesEnabledModel(model, enabledPatterns))
          : filtered;
      const seen = new Set<string>();
      this.availableModelsCache = matched
        .filter((model) => {
          const key = `${model.provider ?? "unknown"}/${model.id ?? "unknown"}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((model) => ({
          id: `${model.provider ?? "unknown"}/${model.id ?? "unknown"}`,
          provider: model.provider ?? "unknown",
          label: model.name ?? model.id ?? "unknown",
          available: true,
          thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
        }));
    } catch {
      // The dedicated auth runtime is best-effort; keep the existing cache on failure.
    }
  }

  /**
   * Providers the user explicitly configured for Pi.
   * Sources: settings.defaultProvider (settingsManager or settings.json) + auth.json.
   * Does NOT include ambient env-key providers or the current session model provider
   * (session model is injected separately as one option).
   */
  private intentionalProviders(session?: PiSessionLike): Set<string> {
    const providers = new Set<string>();

    const defaultProvider =
      session?.settingsManager?.getDefaultProvider?.() ?? this.readSettingsDefaultProvider();
    if (defaultProvider) providers.add(defaultProvider);

    try {
      const authPath = join(this.agentDir, "auth.json");
      if (existsSync(authPath)) {
        const auth = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
        for (const [providerId, entry] of Object.entries(auth)) {
          if (entry && typeof entry === "object" && Object.keys(entry as object).length > 0) {
            providers.add(providerId);
          }
        }
      }
    } catch {
      // ignore auth read errors
    }

    return providers;
  }

  private readSettingsFile(): Record<string, unknown> | undefined {
    try {
      const settingsPath = join(this.agentDir, "settings.json");
      if (!existsSync(settingsPath)) return undefined;
      return JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  private readSettingsDefaultProvider(): string | undefined {
    const settings = this.readSettingsFile();
    const value = settings?.defaultProvider;
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private writeSettingsFile(next: Record<string, unknown>): void {
    const settingsPath = join(this.agentDir, "settings.json");
    writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }

  private persistDefaultModelSelection(modelKey: string): void {
    const [provider, ...idParts] = modelKey.split("/");
    const id = idParts.join("/");
    if (!provider || !id) return;
    const settings = this.readSettingsFile() ?? {};
    settings.defaultProvider = provider;
    settings.defaultModel = id;
    this.writeSettingsFile(settings);
  }

  private readSettingsEnabledModels(): string[] | undefined {
    const settings = this.readSettingsFile();
    const value = settings?.enabledModels;
    if (!Array.isArray(value)) return undefined;
    const patterns = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    return patterns.length > 0 ? patterns : undefined;
  }

  private matchesEnabledModel(
    model: { provider?: string; id?: string },
    patterns: string[],
  ): boolean {
    const provider = model.provider ?? "";
    const id = model.id ?? "";
    const full = `${provider}/${id}`.toLowerCase();
    return patterns.some((pattern) => {
      const p = pattern.toLowerCase();
      if (p.includes("*")) {
        const re = new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
        return re.test(full) || re.test(id.toLowerCase());
      }
      return full === p || id.toLowerCase() === p || full.includes(p);
    });
  }

  getTools(): ToolOption[] {
    const session = this.runtime?.session;
    const active = new Set(session?.getActiveToolNames() ?? []);
    return (session?.getAllTools() as Array<{ name?: string; description?: string; sourceInfo?: { path?: string } }> ?? []).map((tool) => ({ name: tool.name ?? "unknown", description: tool.description ?? "", active: active.has(tool.name ?? ""), source: tool.sourceInfo?.path ?? "builtin" }));
  }

  getResources(): ResourceSnapshot {
    const loader = this.runtime?.session.resourceLoader;
    if (!loader) return { contextFiles: [], skills: [], promptTemplates: [], themes: [], extensions: [], packages: [], mcp: this.mcpStatus };
    const extensions = loader.getExtensions();
    const configuredPackages = this.runtime?.session.settingsManager?.getPackages() ?? [];
    const extList = extensions.extensions.map((ext) => ({
      name: ext.name ?? (ext.path ? basename(ext.path) : undefined) ?? "extension",
      source: ext.path ?? "",
      loaded: true,
      pkgSource: ext.sourceInfo?.origin === "package" ? ext.sourceInfo?.source : undefined,
    })).concat(extensions.errors.map((error) => ({ name: error.path, source: error.path, loaded: false, error: error.error, pkgSource: undefined })));
    const skillsList = this.listSkills();
    const promptsList = loader.getPrompts().prompts.map((prompt) => ({ name: prompt.name ?? prompt.filePath ?? "prompt", path: prompt.filePath ?? prompt.path ?? "" }));
    const themesList = loader.getThemes().themes.map((theme) => ({ name: theme.name ?? theme.filePath ?? "theme", path: theme.filePath ?? theme.path ?? "", active: false }));

    const extWithSource = extensions.extensions;
    const skillItems = loader.getSkills().skills;
    const promptItems = loader.getPrompts().prompts;
    const themeItems = loader.getThemes().themes;

    function pkgSource(pkg: string | { source: string }): string {
      return typeof pkg === "string" ? pkg : pkg.source;
    }

    const packages = configuredPackages.map((pkg) => {
      const src = pkgSource(pkg);
      const isStr = typeof pkg === "string";
      const enabled = isStr
        ? true
        : (() => {
            const obj = pkg as Record<string, unknown>;
            const filterKeys = ["extensions", "skills", "prompts", "themes"];
            const hasFilters = filterKeys.some((k) => k in obj);
            if (!hasFilters) return true;
            return filterKeys.some((k) => {
              const v = obj[k];
              return Array.isArray(v) && v.length > 0;
            });
          })();
      const counts = {
        extensions: extWithSource.filter((e) => e.sourceInfo?.origin === "package" && e.sourceInfo?.source === src).length,
        skills: skillItems.filter((s) => s.sourceInfo?.origin === "package" && s.sourceInfo?.source === src).length,
        prompts: promptItems.filter((p) => p.sourceInfo?.origin === "package" && p.sourceInfo?.source === src).length,
        themes: themeItems.filter((t) => t.sourceInfo?.origin === "package" && t.sourceInfo?.source === src).length,
      };
      return { name: src, source: src, enabled, resources: counts };
    });

    return {
      contextFiles: loader.getAgentsFiles().agentsFiles.map((file) => ({ path: file.path, source: file.path.startsWith(this.agentDir) ? "global" : "project", loaded: true })),
      skills: skillsList,
      promptTemplates: promptsList,
      themes: themesList,
      extensions: extList,
      packages,
      mcp: this.mcpStatus,
    };
  }

  private isDir(path: string): boolean {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  }

  private collectSkillFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const files: string[] = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const full = join(dir, entry.name);
        if (this.isDir(full)) {
          files.push(...this.collectSkillFiles(full));
        } else if (entry.isFile() && entry.name === "SKILL.md") {
          files.push(full);
        }
      }
    } catch {
      // unreadable dir → skip
    }
    return files;
  }

  private isSkillExcluded(parentRel: string, parentName: string, patterns: string[]): boolean {
    const excludes = patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1).replace(/\/$/, ""));
    return excludes.some((pattern) => {
      // Exact parentRel match, e.g. !skills/superpowers/brainstorming (what the GUI writes).
      if (parentRel === pattern) return true;
      // Group globs, e.g. !skills/superpowers/** or !**/superpowers/** (pi-native form).
      const groupGlob = /^(?:\*\*\/|skills\/)([^/*]+)\/\*\*$/.exec(pattern);
      if (groupGlob) {
        const base = `skills/${groupGlob[1]}`;
        return parentRel === base || parentRel.startsWith(`${base}/`);
      }
      // Bare skill name, e.g. !brainstorming — pi matches parentName this way.
      if (parentName === pattern) return true;
      return false;
    });
  }

  listSkills(): ResourceSnapshot["skills"] {
    const patterns = (this.readSettingsFile()?.skills as string[] | undefined) ?? [];
    const roots: Array<{ root: string; source: string }> = [
      { root: join(homedir(), ".agents", "skills"), source: "agents" },
      { root: join(this.agentDir, "skills"), source: "pi" },
    ];
    const skills: ResourceSnapshot["skills"] = [];
    for (const { root, source } of roots) {
      if (!existsSync(root)) continue;
      let groups: string[];
      try {
        groups = readdirSync(root, { withFileTypes: true }).filter((entry) => this.isDir(join(root, entry.name)) && !entry.name.startsWith(".")).map((entry) => entry.name);
      } catch {
        continue;
      }
      for (const group of groups) {
        const groupDir = join(root, group);
        const skillFiles = this.collectSkillFiles(groupDir);
        for (const skillPath of skillFiles) {
          const parentRel = join("skills", group, relative(groupDir, dirname(skillPath))).replace(/\\/g, "/");
          const skillName = basename(dirname(skillPath));
          skills.push({
            name: skillName,
            path: skillPath,
            loaded: true,
            group,
            source,
            enabled: !this.isSkillExcluded(parentRel, skillName, patterns),
          });
        }
      }
    }
    return skills.sort((a, b) => (a.group ?? "").localeCompare(b.group ?? ""));
  }

  getSessionTree(): SessionTreeNode[] {
    const nodes = this.runtime?.session.sessionManager?.getTree() ?? [];
    const mapNode = (node: { entry: { id: string; type: string; message?: { role?: string; content?: unknown }; summary?: string }; children: unknown[] }): SessionTreeNode => ({
      id: node.entry.id,
      kind: node.entry.message?.role ?? node.entry.type,
      label: node.entry.message ? this.messageText(node.entry.message) || node.entry.type : node.entry.summary ?? node.entry.type,
      children: (node.children as Array<{ entry: { id: string; type: string; message?: { role?: string; content?: unknown }; summary?: string }; children: unknown[] }>).map(mapNode),
    });
    return nodes.map(mapNode);
  }

  async newSession(opts?: SessionCommandOptions): Promise<{ cancelled: boolean }> {
    return this.requireSlot(opts?.sessionKey).runtime.newSession();
  }

  async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
    const slot = this.requireSlot();
    const result = await slot.runtime.switchSession(sessionPath);
    // Runtime may rebind session; ensure we subscribe to the active session after switch.
    if (slot.runtime.session) {
      slot.unsubscribe?.();
      const generation = ++slot.sessionGeneration;
      slot.unsubscribe = slot.runtime.session.subscribe((event) => {
        if (slot.sessionGeneration !== generation) return;
        this.handleSessionEvent(slot, event);
      });
      slot.todoRevision = 0;
      this.hydrateSessionTodos(slot, slot.runtime.session);
      this.emit(
        "todos_updated",
        { todos: slot.sessionTodos, revision: slot.todoRevision },
        undefined,
        slot.key,
      );
    }
    await this.refreshAvailableModels();
    return result;
  }

  async forkSession(entryId: string): Promise<{ cancelled: boolean }> {
    return this.requireRuntime().fork(entryId);
  }

  async cloneSession(): Promise<{ cancelled: boolean }> {
    const leafId = this.runtime?.session.sessionManager?.getLeafId?.();
    if (!leafId) throw new Error("Nothing to clone yet");
    return this.requireRuntime().fork(leafId, { position: "at" });
  }

  async importSession(path: string, cwdOverride?: string): Promise<{ cancelled: boolean }> {
    return this.requireRuntime().importFromJsonl(path, cwdOverride);
  }

  snapshot(opts?: { includeTimeline?: boolean; tailTurns?: number }): PiSnapshot {
    return buildSnapshot({
      workspaceId: this.workspaceId,
      workspaceCwd: this.workspaceCwd,
      sequence: this.sequence,
      runtime: this.runtime,
      sessionTodos: this.sessionTodos,
      modeState: this.getSlot()?.modeState,
      resources: this.getResources(),
      models: this.getModels(),
      tools: this.getTools(),
      includeTimeline: opts?.includeTimeline,
      tailTurns: opts?.tailTurns,
    });
  }

  resolveTrust(trusted: boolean): void {
    if (!this.pendingTrust) return;
    this.emit("project_trust_resolved", { cwd: this.pendingTrust.cwd, trusted });
    this.pendingTrust = undefined;
  }

  async listSessions(cwd = this.workspaceCwd) {
    if (!cwd) return [];
    return loadSessionCatalog(cwd);
  }

  async listProjectFiles(cwd = this.workspaceCwd): Promise<Array<{ path: string; isDir: boolean }>> {
    if (!cwd) return [];
    const root = resolve(cwd);
    const results: Array<{ path: string; isDir: boolean }> = [];
    const IGNORED = new Set([".git", "node_modules", ".next", "dist", "build", "out", ".cache", ".venv", "venv", "target"]);

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 5 || results.length >= 800) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= 800) return;
        if (IGNORED.has(entry.name)) continue;
        if (entry.name.startsWith(".") && entry.name !== ".env" && entry.name !== ".env.local") continue;
        const full = join(dir, entry.name);
        const rel = full.slice(root.length + 1);
        if (entry.isDirectory()) {
          results.push({ path: rel, isDir: true });
          await walk(full, depth + 1);
        } else {
          results.push({ path: rel, isDir: false });
        }
      }
    };

    await walk(root, 0);
    return results;
  }

  /** Drop cached account balance for a provider (or all if omitted). */
  invalidateAccountUsageCache(providerId?: string): void {
    if (!providerId) {
      this.accountUsageCache.clear();
      return;
    }
    this.accountUsageCache.delete(providerId);
  }

  /**
   * Session usage (local stats) + optional account balance/quota via pluggable adapters.
   * Account fetches are cached per provider; pass `{ force: true }` to bypass.
   */
  async getProviderUsage(options?: { force?: boolean }): Promise<ProviderUsageSnapshot> {
    const session = this.runtime?.session;
    const stats = session?.getSessionStats();
    const usage = session?.getContextUsage?.();
    const providerId = session?.model?.provider ?? "";

    const sessionDetail = {
      inputTokens: stats?.tokens.input ?? 0,
      outputTokens: stats?.tokens.output ?? 0,
      cacheReadTokens: stats?.tokens.cacheRead ?? 0,
      cacheWriteTokens: stats?.tokens.cacheWrite ?? 0,
      cost: stats?.cost ?? 0,
      contextTokens: usage?.tokens ?? 0,
      contextWindow: usage?.contextWindow ?? 0,
    };

    if (!providerId) {
      return {
        providerId: "",
        session: sessionDetail,
        account: { mode: "unsupported", providerId: "", reason: "no_adapter" },
      };
    }

    const account = await this.resolveAccountUsage(providerId, Boolean(options?.force));
    return { providerId, session: sessionDetail, account };
  }

  private async resolveAccountUsage(providerId: string, force: boolean): Promise<AccountUsage> {
    const now = Date.now();
    if (!force) {
      const hit = this.accountUsageCache.get(providerId);
      if (hit) {
        const ttl =
          hit.account.mode === "unsupported" && hit.account.reason === "fetch_failed"
            ? 10_000
            : this.usageCacheTtlMs;
        if (now - hit.at < ttl) return hit.account;
      }
    }

    const adapter = this.usageRegistry.get(providerId);
    if (!adapter) {
      const account: AccountUsage = { mode: "unsupported", providerId, reason: "no_adapter" };
      this.accountUsageCache.set(providerId, { at: now, account });
      return account;
    }

    let credentialType: "api_key" | "oauth" | undefined;
    try {
      const runtime = await this.createAuthModelRuntime();
      const creds = await runtime.listCredentials();
      credentialType = creds.find((c) => c.providerId === providerId)?.type;
      // Env-only keys may not appear in listCredentials; still allow adapters.
      if (!credentialType) {
        const status = runtime.getProviderAuthStatus(providerId);
        if (status.configured) credentialType = "api_key";
      }
    } catch {
      // leave undefined
    }

    const ctx = {
      providerId,
      credentialType,
      getApiKey: async () => this.resolveProviderApiKey(providerId),
    };

    if (!adapter.supports(ctx)) {
      const account: AccountUsage = {
        mode: "unsupported",
        providerId,
        reason: credentialType === "oauth" ? "oauth" : "skipped",
      };
      this.accountUsageCache.set(providerId, { at: now, account });
      return account;
    }

    const account = await adapter.fetchAccountUsage(ctx);
    this.accountUsageCache.set(providerId, { at: Date.now(), account });
    return account;
  }

  /** Resolve API key for a provider (auth.json / env / runtime). Never exposed to renderer. */
  private async resolveProviderApiKey(providerId: string): Promise<string | undefined> {
    try {
      const runtime = await this.createAuthModelRuntime();
      const auth = await runtime.getAuth(providerId);
      const key = auth?.auth?.apiKey?.trim();
      if (key) return key;
    } catch {
      // fall through
    }
    // Last-resort: common env var for DeepSeek (and any future env-only paths).
    if (providerId === "deepseek") {
      const envKey = process.env.DEEPSEEK_API_KEY?.trim();
      if (envKey) return envKey;
    }
    return undefined;
  }

  /**
   * List providers with login/logout capability and current auth status.
   * Always uses a dedicated ModelRuntime against the agent dir so the list
   * works even when no chat session is open / session runtime is incomplete.
   */
  async listProviders(): Promise<ProviderAuthStatus[]> {
    const runtime = await this.createAuthModelRuntime();
    try {
      await runtime.getAvailable();
    } catch {
      // availability refresh is best-effort for status UI
    }

    const stored = new Map<string, "api_key" | "oauth">();
    try {
      for (const entry of await runtime.listCredentials()) {
        stored.set(entry.providerId, entry.type);
      }
    } catch {
      // ignore
    }

    const providers = [...runtime.getProviders()];
    const rows: ProviderAuthStatus[] = providers.map((provider) => {
      const status = runtime.getProviderAuthStatus(provider.id);
      const sourceRaw = status.source ?? (status.configured ? "environment" : "none");
      const source = normalizeAuthSource(sourceRaw);
      const credentialType = stored.get(provider.id);
      const apiKeyAuth = provider.auth?.apiKey as { login?: unknown } | undefined;
      return {
        id: provider.id,
        name: provider.name,
        configured: Boolean(status.configured),
        source,
        sourceLabel:
          status.label ??
          (source === "stored" ? "auth.json" : source === "environment" ? status.label : undefined),
        hasApiKeyLogin: Boolean(apiKeyAuth && typeof apiKeyAuth.login === "function"),
        hasOAuthLogin: Boolean(provider.auth?.oauth),
        canLogout: stored.has(provider.id),
        credentialType,
      };
    });

    return rows.sort((left, right) => {
      // Connected first, then name.
      if (left.configured !== right.configured) return left.configured ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  }

  /**
   * Persist an API key via Pi ModelRuntime.login (same path as /login).
   * After success, refreshes available models for the active session.
   */
  async loginWithApiKey(providerId: string, apiKey: string): Promise<{ name: string }> {
    const key = apiKey.trim();
    if (!providerId.trim()) throw new Error("Provider is required");
    if (!key) throw new Error("API key is required");

    // Use the live runtime whenever possible. Its credential store is cached,
    // so mutating a second runtime leaves the current session unaware of the
    // new auth.json entry until the app is restarted.
    const runtime = this.liveAuthRuntime() ?? await this.createAuthModelRuntime();
    const provider = runtime.getProvider(providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    const apiKeyAuth = provider.auth?.apiKey as { login?: unknown } | undefined;
    if (!apiKeyAuth || typeof apiKeyAuth.login !== "function") {
      throw new Error(`${provider.name} does not support API key login in Pi`);
    }

    let secretUses = 0;
    await runtime.login(providerId, "api_key", {
      prompt: async (prompt) => {
        if (prompt.type === "secret" || prompt.type === "text" || prompt.type === "manual_code") {
          secretUses += 1;
          if (secretUses === 1) return key;
          throw new Error(
            `${provider.name} needs additional interactive steps not yet supported in desktop. Use the Pi CLI: /login ${providerId}`,
          );
        }
        if (prompt.type === "select" && prompt.options?.[0]) {
          // Prefer first option for multi-choice ambient setups (desktop simplification).
          return prompt.options[0].id;
        }
        throw new Error(`Unsupported login prompt for ${provider.name}`);
      },
      notify: () => {
        // API-key login is silent in desktop UI.
      },
    });

    await this.syncModelsAfterAuthChange({ selectProviderId: providerId });
    return { name: provider.name };
  }

  /** Remove a stored auth.json credential (same as /logout). Env vars are left alone. */
  async logoutProvider(providerId: string): Promise<void> {
    if (!providerId.trim()) throw new Error("Provider is required");
    const currentProvider = this.activeModelProvider();
    const runtime = this.liveAuthRuntime() ?? await this.createAuthModelRuntime();
    await runtime.logout(providerId);
    await this.syncModelsAfterAuthChange({ selectFallback: currentProvider === providerId });
  }

  /**
   * Start an account (OAuth) login via Pi ModelRuntime.login (same as /login).
   * Progress and interactive prompts are streamed to the renderer as
   * `provider_login_event` events; the renderer answers prompts with
   * answerAuthPrompt and may cancel with cancelProviderLogin.
   */
  async loginWithOAuth(providerId: string): Promise<{ name: string }> {
    if (!providerId.trim()) throw new Error("Provider is required");

    // Replace any in-flight login for the same provider.
    this.abortOAuthLogin(providerId);

    const controller = new AbortController();
    const record = { controller, resolvers: new Map<string, { resolve: (value: string) => void; reject: (error: Error) => void }>() };
    this.oauthLogins.set(providerId, record);

    try {
      const runtime = this.liveAuthRuntime() ?? await this.createAuthModelRuntime();
      const provider = runtime.getProvider(providerId);
      if (!provider) throw new Error(`Unknown provider: ${providerId}`);
      const oauth = provider.auth?.oauth as { login?: (interaction: unknown) => Promise<unknown> } | undefined;
      if (!oauth || typeof oauth.login !== "function") {
        throw new Error(`${provider.name} does not support account login in Pi`);
      }

      const credential = await runtime.login(providerId, "oauth", {
        signal: controller.signal,
        prompt: (prompt) => this.handleOAuthPrompt(providerId, record, prompt),
        notify: (event) => this.handleOAuthNotify(providerId, event),
      });
      const name =
        typeof credential === "object" && credential !== null && "name" in credential
          ? String((credential as unknown as { name: unknown }).name)
          : provider.name;
      this.emit("provider_login_event", { providerId, event: { type: "done", name } });
      await this.syncModelsAfterAuthChange({ selectProviderId: providerId });
      return { name };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Skip the error event when cancelled from a newer login replacing this one.
      if (this.oauthLogins.get(providerId) === record) {
        this.emit("provider_login_event", { providerId, event: { type: "error", message } });
      }
      throw error;
    } finally {
      this.finishOAuthLogin(providerId, record);
    }
  }

  /** Answer a pending interactive prompt surfaced during an account login. */
  async answerAuthPrompt(promptId: string, answer: string): Promise<void> {
    const resolver = this.promptResolvers.get(promptId);
    if (!resolver) throw new Error(`Unknown auth prompt: ${promptId}`);
    resolver.resolve(answer);
  }

  /** Cancel an in-flight account login for a provider. */
  async cancelProviderLogin(providerId: string): Promise<void> {
    if (!providerId.trim()) return;
    this.abortOAuthLogin(providerId);
  }

  /** Abort a login's controller; pending prompts reject with "Login cancelled". */
  private abortOAuthLogin(providerId: string): void {
    const record = this.oauthLogins.get(providerId);
    if (!record) return;
    record.controller.abort();
    for (const { reject } of record.resolvers.values()) {
      reject(new Error("Login cancelled"));
    }
    record.resolvers.clear();
    // Let loginWithOAuth's finally/finishOAuthLogin remove the record.
  }

  /** Terminal cleanup: reject leftovers, drop the record from the maps. */
  private finishOAuthLogin(
    providerId: string,
    record: { controller: AbortController; resolvers: Map<string, { resolve: (value: string) => void; reject: (error: Error) => void }> },
  ): void {
    for (const { reject } of record.resolvers.values()) {
      reject(new Error("Login cancelled"));
    }
    record.resolvers.clear();
    if (this.oauthLogins.get(providerId) === record) {
      this.oauthLogins.delete(providerId);
    }
  }

  /**
   * Surface a login prompt to the renderer and wait for the answer.
   * Races the answer against the login's cancel signal and the prompt's own
   * signal (used by Pi for out-of-band completion, e.g. a manual_code prompt
   * raced against a local callback server).
   */
  private async handleOAuthPrompt(
    providerId: string,
    record: { controller: AbortController; resolvers: Map<string, { resolve: (value: string) => void; reject: (error: Error) => void }> },
    prompt: { type: string; message?: string; placeholder?: string; options?: ReadonlyArray<{ id: string; label: string; description?: string }>; signal?: AbortSignal },
  ): Promise<string> {
    this.promptCounter += 1;
    const promptId = `login-${this.promptCounter}`;
    let resolve!: (value: string) => void;
    let reject!: (error: Error) => void;
    const answer = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
    const resolver = { resolve, reject };
    record.resolvers.set(promptId, resolver);
    this.promptResolvers.set(promptId, resolver);

    const outgoing: ProviderLoginPrompt = {
      promptId,
      type: prompt.type as ProviderLoginPrompt["type"],
      message: prompt.message ?? "",
      ...(prompt.placeholder !== undefined ? { placeholder: prompt.placeholder } : {}),
      ...(prompt.options && prompt.options.length > 0 ? { options: prompt.options.map((option) => ({ id: option.id, label: option.label, ...(option.description !== undefined ? { description: option.description } : {}) })) } : {}),
    };
    this.emit("provider_login_event", { providerId, event: { type: "prompt", prompt: outgoing } });

    const onAbort = () => reject(new Error("Login cancelled"));
    record.controller.signal.addEventListener("abort", onAbort, { once: true });
    prompt.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await answer;
    } finally {
      record.controller.signal.removeEventListener("abort", onAbort);
      prompt.signal?.removeEventListener("abort", onAbort);
      record.resolvers.delete(promptId);
      this.promptResolvers.delete(promptId);
    }
  }

  /** Stream auth progress to the renderer; auto-open browser for URLs. */
  private handleOAuthNotify(providerId: string, event: unknown): void {
    const normalized = normalizeAuthEvent(event);
    if (!normalized) return;
    if (normalized.type === "auth_url") {
      this.openExternal?.(normalized.url);
    } else if (normalized.type === "device_code") {
      this.openExternal?.(normalized.verificationUri);
    }
    this.emit("provider_login_event", { providerId, event: normalized });
  }

  /**
   * Rename a session file. Works for the active session and for other listed sessions.
   * Mirrors Pi CLI's renameSession (append session_info entry).
   */
  async renameSession(sessionPath: string, name: string): Promise<{ name: string }> {
    const next = name.replace(/[\r\n]+/g, " ").trim();
    if (!next) throw new Error("Session name is required");

    const activePath = this.runtime?.session.sessionFile ?? this.runtime?.session.sessionManager?.getSessionFile?.();
    const isActive =
      Boolean(activePath) &&
      Boolean(sessionPath) &&
      resolvePathsEqual(activePath!, sessionPath);

    if (isActive && this.runtime?.session.setSessionName) {
      this.runtime.session.setSessionName(next);
      const resolved = this.resolveDisplayName(this.runtime.session);
      this.emit("session_name_changed", {
        name: resolved,
        sessionId: this.runtime.session.sessionId,
        sessionFile: activePath,
      });
      return { name: resolved };
    }

    const manager = SessionManager.open(sessionPath);
    manager.appendSessionInfo(next);
    const resolved = manager.getSessionName() ?? next;
    this.emit("session_name_changed", {
      name: resolved,
      sessionId: manager.getSessionId?.() ?? "",
      sessionFile: sessionPath,
    });
    return { name: resolved };
  }

  async deleteSession(sessionPath: string): Promise<{ sessionPath: string }> {
    const matching = this.findSlotBySessionFile(sessionPath);
    if (matching) {
      await this.disposeSlot(matching.key);
    }
    await deleteSessionFile(sessionPath);
    this.emitLiveSessionsChanged();
    return { sessionPath };
  }

  getSessionContext(sessionPath: string): { name: string; context: string } {
    return getSessionContext(sessionPath);
  }

  async dispose(): Promise<void> {
    await this.disposeAllRuntimes();
    this.listeners.clear();
  }

  emitIndexStatus(status: IndexStatus, cwd: string): void {
    this.emit("index_status_changed", { status, cwd });
  }

  private attachRuntime(key: SessionKey, runtime: PiRuntimeLike): void {
    // Replace same key if present
    const existing = this.slots.get(key);
    if (existing) {
      existing.unsubscribe?.();
      void existing.runtime.dispose();
      this.slots.delete(key);
    }

    const planStore = new PlanModeStore(runtime.cwd);
    const fallbackMode = defaultModeState(
      this.modelName(runtime.session) || undefined,
      (runtime.session.thinkingLevel || "medium") as ThinkingLevel,
    );
    const slot: RuntimeSlot = {
      key,
      runtime,
      sessionTodos: [],
      todoRevision: 0,
      turnToolCount: 0,
      turnNudged: false,
      runToolCount: 0,
      sessionGeneration: 0,
      status: "idle",
      pendingFileMutations: new Map(),
      completedFileMutations: new Map(),
      modeState: planStore.getModeForSession(runtime.session.sessionId || key, fallbackMode),
      planStore,
    };

    const bindSession = (session: PiSessionLike, announce = true): void => {
      slot.unsubscribe?.();
      const generation = ++slot.sessionGeneration;
      slot.unsubscribe = session.subscribe((event) => {
        if (slot.sessionGeneration !== generation) return;
        this.handleSessionEvent(slot, event);
      });
      slot.assistantMessageId = undefined;
      slot.thinkingMessageId = undefined;
      slot.pendingFileMutations.clear();
      slot.completedFileMutations.clear();
      slot.todoRevision = 0;
      slot.turnToolCount = 0;
      slot.turnNudged = false;
      slot.runToolCount = 0;
      const fallback = defaultModeState(
        this.modelName(session) || undefined,
        (session.thinkingLevel || "medium") as ThinkingLevel,
      );
      const storageKey = this.modeStorageKey(slot, session);
      slot.modeState = slot.planStore.getModeForSession(storageKey, slot.modeState ?? fallback);
      // Migrate any legacy tmp:<tab> record once this runtime knows the stable
      // session identity.  Future opens use this key regardless of tab layout.
      if (!slot.planStore.hasMode(storageKey) && slot.planStore.hasLegacyModeForSession(storageKey)) {
        slot.planStore.setMode(storageKey, slot.modeState);
      }
      this.planModes.set(session.sessionId, slot.modeState.mode);
      if (slot.modeState.mode === "plan" || slot.modeState.executeProfile.modelKey !== this.modelName(session) || slot.modeState.executeProfile.thinkingLevel !== session.thinkingLevel) {
        void this.applyModeRuntime(slot, { persist: false }).catch(() => undefined);
      }
      this.hydrateSessionTodos(slot, session);
      if (!announce) return;
      this.emit(
        "session_started",
        {
          sessionId: session.sessionId,
          cwd: slot.runtime.cwd ?? this.workspaceCwd ?? "",
          sessionName: this.resolveDisplayName(session),
          model: this.modelName(session),
          thinkingLevel: session.thinkingLevel as ThinkingLevel,
        },
        undefined,
        slot.key,
      );
      if (slot.sessionTodos.length > 0) {
        this.emit(
          "todos_updated",
          { todos: slot.sessionTodos, revision: slot.todoRevision },
          undefined,
          slot.key,
        );
      }
      this.emit("mode_changed", slot.modeState, undefined, slot.key);
      this.emitPlanArtifactChanged(slot);
    };

    // The public start() event is the single initial session_started event.
    // Re-emitting it here used to reset restored todos back to an empty list.
    bindSession(runtime.session, false);
    this.slots.set(key, slot);
    const runtimeWithRebind = runtime as PiRuntimeLike & {
      setRebindSession?: (callback: (session: PiSessionLike) => Promise<void>) => void;
    };
    runtimeWithRebind.setRebindSession?.(async (session) => bindSession(session));
  }

  private async createSdkRuntime(options: { cwd: string; sessionPath?: string }): Promise<PiRuntimeLike> {
    return createSdkRuntimeSession({
      cwd: options.cwd,
      sessionPath: options.sessionPath,
      agentDir: this.agentDir,
      httpWorkbench: this.httpWorkbench,
      planModes: this.planModes,
      slots: this.slots,
      applyTodosFromBranch: (todos, sessionManager) => this.applyTodosFromBranch(todos, sessionManager),
      emitPlanArtifactChanged: (slot) => this.emitPlanArtifactChanged(slot),
      applyMcpStatus: (snapshot) => this.applyMcpStatus(snapshot),
      modeStorageKey: (slot) => this.modeStorageKey(slot),
    });
  }

  /**
   * Merge a pi-mcp-adapter status snapshot into the workspace-global view and
   * broadcast it to the renderer. Called from the `mcp` extension factory
   * (possibly before a runtime slot attaches), so the view is intentionally
   * workspace-scoped rather than per-slot.
   */
  private applyMcpStatus(snapshot: McpStatusSnapshot): void {
    const view: McpStatusSnapshotView = {
      version: snapshot.version,
      servers: snapshot.servers.map((server) => ({
        name: server.name,
        status: server.status,
        toolCount: server.toolCount,
        ...(server.failedAgoSeconds !== undefined ? { failedAgoSeconds: server.failedAgoSeconds } : {}),
        disabled: server.disabled,
      })),
      totalTools: snapshot.totalTools,
      connectedCount: snapshot.connectedCount,
      disabledCount: snapshot.disabledCount,
    };
    this.mcpStatus = view;
    this.emit("mcp_status_updated", view);
  }

  /** Workspace root for config operations: last started/opened folder wins. */
  private mcpConfigCwd(cwd?: string): string | undefined {
    return cwd ?? this.workspaceCwd ?? this.runtime?.session.cwd;
  }

  async getMcpConfig(cwd?: string): Promise<McpConfigView> {
    const dir = this.mcpConfigCwd(cwd);
    if (!dir) return { cwd: "", sources: [], servers: [] };
    const { sources, mergedServers } = readMcpConfigs(dir);
    return {
      cwd: dir,
      sources: sources.map((source) => ({
        path: source.path,
        exists: source.exists,
        serverCount: Object.keys(source.servers).length,
      })),
      servers: Object.entries(mergedServers).map(([name, entry]) => {
        const definers = sources.filter((source) => source.servers[name] !== undefined);
        const source = definers.length > 0 ? definers[definers.length - 1].path : "";
        return { name, disabled: entry.disabled === true, source };
      }),
    };
  }

  async setMcpServerEnabled(name: string, enabled: boolean): Promise<{ changed: boolean; path: string }> {
    const dir = this.mcpConfigCwd();
    if (!dir) throw new Error("No workspace open");
    const result = setMcpServerDisabled(dir, name, enabled);
    if (result.changed && this.runtime) {
      // Rebuild the runtime so pi-mcp-adapter re-reads the merged config.
      await this.reload();
    }
    return result;
  }

  async importCursorMcp(): Promise<{ imported: string[]; skipped: string[] }> {
    const dir = this.mcpConfigCwd();
    if (!dir) throw new Error("No workspace open");
    const result = importCursorMcpConfig(dir);
    if (result.imported.length > 0 && this.runtime) {
      await this.reload();
    }
    return result;
  }

  async openMcpConfigFile(cwd?: string): Promise<string | undefined> {
    const dir = this.mcpConfigCwd(cwd);
    if (!dir) return undefined;
    return projectMcpOverridePath(dir);
  }

  /** Rebuild mirrored todos from live messages or session manager context. */
  private hydrateSessionTodos(slot: RuntimeSlot, session?: PiSessionLike): void {
    let messages = (session?.messages ?? []) as unknown[];
    if (messages.length === 0) {
      messages = (session?.sessionManager?.buildSessionContext?.().messages ?? []) as unknown[];
    }
    slot.sessionTodos = reconstructTodosFromMessages(messages);
    this.reconcileSettledSession(slot, messages);
  }

  /**
   * Close stale in_progress todos on sessions whose last turn already settled
   * with a final answer. The turn-end reconcile only runs while the agent is
   * live, so a session that finished before this feature existed (or that was
   * reopened from disk) would otherwise keep showing a stale in_progress item
   * forever. Same rules as the turn-end reconcile: only when the run really
   * settled (last assistant message stopReason "stop") and did real tool work.
   */
  private reconcileSettledSession(slot: RuntimeSlot, messages: unknown[]): void {
    if (slot.sessionTodos.length === 0) return;
    const active = slot.sessionTodos.find((todo) => todo.status === "in_progress");
    if (!active) return;
    // The very last conversational message must be a settled assistant answer.
    // A trailing user message means the user has a pending request for this
    // in_progress task — do not close it behind their back.
    let lastMeaningful: Record<string, unknown> | undefined;
    for (const raw of messages) {
      if (!raw || typeof raw !== "object") continue;
      const message = raw as Record<string, unknown>;
      if (message.role === "user" || message.role === "assistant") lastMeaningful = message;
    }
    if (!lastMeaningful || lastMeaningful.role !== "assistant" || lastMeaningful.stopReason !== "stop") return;
    // Require real tool work after the last todo state write (todoread does
    // not change state, so it does not count as a write).
    let lastTodoWriteIndex = -1;
    for (let index = 0; index < messages.length; index += 1) {
      const raw = messages[index] as Record<string, unknown> | undefined;
      const toolName = typeof raw?.toolName === "string" ? raw.toolName : undefined;
      if (toolName && isTodoToolName(toolName) && toolName !== "todoread" && !raw?.isError) {
        lastTodoWriteIndex = index;
      }
    }
    // A todoread-only history has no attributable write; leave it untouched.
    if (lastTodoWriteIndex < 0) return;
    const didWork = messages.some((raw, index) => {
      if (index <= lastTodoWriteIndex) return false;
      const message = raw as Record<string, unknown> | undefined;
      const toolName = typeof message?.toolName === "string" ? message.toolName : undefined;
      return Boolean(toolName && !isTodoToolName(toolName) && !message?.isError);
    });
    if (!didWork) return;
    if (!this.markActiveTodosCompleted(slot)) return;
    this.persistTodosToSession(slot, slot.sessionTodos);
  }

  /** Mark every in_progress todo completed. Returns true when anything changed. */
  private markActiveTodosCompleted(slot: RuntimeSlot): boolean {
    if (slot.sessionTodos.length === 0) return false;
    if (!slot.sessionTodos.some((todo) => todo.status === "in_progress")) return false;
    slot.sessionTodos = slot.sessionTodos.map((todo) =>
      todo.status === "in_progress" ? { ...todo, status: "completed" } : todo,
    );
    slot.todoRevision += 1;
    return true;
  }

  /**
   * Write the reconciled checklist into the session trace as a hidden custom
   * message entry, so the panel and the extension's replay reconstruct the
   * same state after a reload. The entry projects into the model's context as
   * a non-interactive note (role "custom"), keeping the model's view aligned
   * with the panel without fabricating a fake tool result.
   */
  private persistTodosToSession(slot: RuntimeSlot, todos: SessionTodoItem[]): void {
    const manager = slot.runtime.session.sessionManager as
      | { appendCustomMessageEntry?: (customType: string, content: string, display: boolean, details?: unknown) => string }
      | undefined;
    try {
      manager?.appendCustomMessageEntry?.(
        SESSION_TODO_CUSTOM_TYPE,
        `Todo list reconciled after the turn ended:\n${formatTodoListText(todos)}`,
        false,
        { todos, updatedAt: new Date().toISOString() },
      );
    } catch {
      // Persistence is best-effort; never break the live panel update.
    }
  }

  private applyTodosFromBranch(todos: SessionTodoItem[], sessionManager: unknown): void {
    const slot = [...this.slots.values()].find(
      (candidate) => candidate.runtime.session.sessionManager === sessionManager,
    );
    if (!slot) return;
    slot.sessionTodos = todos;
    slot.todoRevision += 1;
    this.emit(
      "todos_updated",
      { todos: slot.sessionTodos, revision: slot.todoRevision },
      undefined,
      slot.key,
    );
  }

  private applyTodosFromToolResult(
    slot: RuntimeSlot,
    toolName: string | undefined,
    result: unknown,
    isError: boolean,
  ): void {
    if (!toolName || !isTodoToolName(toolName) || isError) return;
    const todos = todosFromToolResult(result);
    if (!todos) return;
    slot.sessionTodos = todos;
    slot.todoRevision += 1;
    this.emit(
      "todos_updated",
      { todos: slot.sessionTodos, revision: slot.todoRevision },
      undefined,
      slot.key,
    );
  }

  /**
   * The static system guidance tells the model to use todowrite, but weak
   * models ignore it. When a turn racks up tool calls without ever writing a
   * todo list, inject one gentle steer to structure the remaining work.
   */
  private maybeNudgeForTodos(slot: RuntimeSlot): void {
    if (slot.turnNudged || slot.sessionTodos.length > 0) return;
    const modelId = slot.runtime.session.model?.id ?? "";
    const threshold = FAST_MODEL_PATTERN.test(modelId) ? this.todoNudgeFastThreshold : this.todoNudgeThreshold;
    if (slot.turnToolCount < threshold) return;
    slot.turnNudged = true;
    const message = [
      "Reminder: this turn has made several tool calls without a todo list.",
      "Call todowrite to break the remaining work into a checklist",
      "(pending / in_progress / completed), then continue one task at a time.",
    ].join(" ");
    void slot.runtime.session.steer(message).catch(() => undefined);
  }

  /**
   * Apply a mode/model/effort change that was recorded while a turn was
   * streaming. Runs once the turn ends so the running turn is never mutated
   * and the next turn uses the newly selected profile.
   */
  private async applyPendingMode(slot: RuntimeSlot): Promise<void> {
    if (!slot.pendingModeApply || slot.runtime.session.isStreaming) return;
    slot.pendingModeApply = false;
    try {
      await this.applyModeRuntime(slot, { persist: true });
    } catch (error) {
      this.emit(
        "session_error",
        { message: error instanceof Error ? error.message : String(error) },
        undefined,
        slot.key,
      );
    }
  }

  /**
   * A turn that finishes normally should leave the checklist consistent. The
   * model often plans tasks with todowrite but forgets to close its
   * in_progress item, so the panel would keep showing stale "0/N done". Close
   * it in the mirrored view immediately, persist the reconciled list into the
   * session trace (so reloads and the model's next-turn context see the same
   * state), and steer the model to update its own copy via todoupdate.
   * Failed/retried runs skip this on purpose — an unfinished turn must keep
   * its marker.
   */
  private reconcileTodosAfterTurn(slot: RuntimeSlot): void {
    if (slot.sessionTodos.length === 0 || slot.runToolCount === 0) return;
    const active = slot.sessionTodos.find((todo) => todo.status === "in_progress");
    if (!active) return;
    if (!this.markActiveTodosCompleted(slot)) return;
    this.emit(
      "todos_updated",
      { todos: slot.sessionTodos, revision: slot.todoRevision },
      undefined,
      slot.key,
    );
    this.persistTodosToSession(slot, slot.sessionTodos);
    const message = [
      `Task "${active.content}" was left marked in_progress when the turn ended and has been marked completed.`,
      "Call todoupdate to confirm this is correct, or restore it to in_progress if the work is genuinely unfinished.",
    ].join(" ");
    void slot.runtime.session.steer(message).catch(() => undefined);
  }

  private handleSessionEvent(slot: RuntimeSlot, raw: unknown): void {
    handleSessionEvent(slot, raw, {
      nextId: (prefix) => this.nextId(prefix),
      emit: (type, payload, rawEvent, sessionKey) => this.emit(type as never, payload as never, rawEvent, sessionKey),
      emitLiveSessionsChanged: () => this.emitLiveSessionsChanged(),
      invalidateAccountUsageCache: (providerId) => this.invalidateAccountUsageCache(providerId),
      hydrateSessionTodos: (nextSlot) => this.hydrateSessionTodos(nextSlot),
      applyTodosFromToolResult: (nextSlot, toolName, result, isError) => this.applyTodosFromToolResult(nextSlot, toolName, result, isError),
      maybeNudgeForTodos: (nextSlot) => this.maybeNudgeForTodos(nextSlot),
      reconcileTodosAfterTurn: (nextSlot) => this.reconcileTodosAfterTurn(nextSlot),
      applyPendingMode: (nextSlot) => void this.applyPendingMode(nextSlot),
    });
  }

  private readTextFile(path: string): string | undefined {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  }

  private emit<T extends PiEvent["type"]>(
    type: T,
    payload: Extract<PiEvent, { type: T }>["payload"],
    _raw?: unknown,
    sessionKey?: SessionKey,
  ): void {
    const key = sessionKey ?? this.foregroundKey;
    const slot = key ? this.slots.get(key) : this.getSlot();
    const event = {
      eventId: this.nextId(type),
      workspaceId: this.workspaceId,
      sessionId: slot?.runtime.session.sessionId ?? this.runtime?.session.sessionId,
      sessionKey: key ?? slot?.key,
      timestamp: new Date().toISOString(),
      sequence: this.sequence,
      type,
      payload,
    } as PiEvent;
    this.listeners.forEach((listener) => listener(event));
  }

  private emitLiveSessionsChanged(): void {
    this.emit("live_sessions_changed", { sessions: this.listLiveSessions() });
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  private requireSlot(sessionKey?: SessionKey): RuntimeSlot {
    const slot = this.getSlot(sessionKey);
    if (!slot) throw new Error("Pi runtime has not been started");
    return slot;
  }

  private requireRuntime(): PiRuntimeLike {
    return this.requireSlot().runtime;
  }

  private requireSession(): PiSessionLike {
    return this.requireRuntime().session;
  }

  private async disposeSlot(key: SessionKey): Promise<void> {
    const slot = this.slots.get(key);
    if (!slot) return;
    slot.unsubscribe?.();
    try {
      await slot.runtime.session.abort();
    } catch {
      // ignore
    }
    try {
      await slot.runtime.dispose();
    } catch {
      // ignore
    }
    this.planModes.delete(slot.runtime.session.sessionId);
    this.slots.delete(key);
    if (this.foregroundKey === key) {
      this.foregroundKey = this.slots.keys().next().value;
    }
  }

  private async disposeAllRuntimes(): Promise<void> {
    const keys = [...this.slots.keys()];
    for (const key of keys) {
      await this.disposeSlot(key);
    }
    this.foregroundKey = undefined;
  }

  /** @deprecated use disposeAllRuntimes / disposeSlot */
  private async disposeRuntime(): Promise<void> {
    await this.disposeAllRuntimes();
  }

  /**
   * Dedicated ModelRuntime for Settings → Providers (/login /logout).
   * Always reads the same agent auth.json as the CLI, independent of whether
   * a chat session is currently running.
   */
  private async createAuthModelRuntime(): Promise<ModelRuntime> {
    if (this.authRuntimeFactory) return this.authRuntimeFactory();
    return ModelRuntime.create({
      authPath: join(this.agentDir, "auth.json"),
      // null → skip custom models.json overlays; still loads built-in providers.
      modelsPath: null,
      allowModelNetwork: false,
    });
  }

  /** The session runtime owns the credential cache used for model availability. */
  private liveAuthRuntime(): ModelRuntime | undefined {
    const runtime = this.runtime?.session.modelRuntime;
    if (!runtime?.getProvider || !runtime.login || !runtime.logout) return undefined;
    return runtime as unknown as ModelRuntime;
  }

  private activeModelProvider(): string | undefined {
    const slot = this.getSlot();
    const modelKey = slot ? this.modeProfile(slot).modelKey : undefined;
    return this.runtime?.session.model?.provider || modelKey?.split("/")[0];
  }

  private async selectAvailableModel(providerId?: string): Promise<void> {
    const slot = this.getSlot();
    const session = slot?.runtime.session;
    const modelRuntime = session?.modelRuntime;
    if (!slot || !session || !modelRuntime?.getAvailable) return;

    let models: ReadonlyArray<{ provider?: string; id?: string }>;
    try {
      models = await modelRuntime.getAvailable(providerId);
    } catch {
      return;
    }

    const selected = models[0];
    if (!selected?.provider || !selected.id) return;
    const modelKey = `${selected.provider}/${selected.id}`;
    const selectedModel = session.modelRuntime?.getModel(selected.provider, selected.id);
    const thinkingLevel = this.normalizeThinkingLevel(
      this.modeProfile(slot).thinkingLevel,
      this.supportedThinkingLevels(session, selectedModel),
    );
    if (this.modeProfile(slot).modelKey === modelKey && this.modelName(session) === modelKey) {
      this.persistDefaultModelSelection(modelKey);
      return;
    }
    await this.setModeProfile(
      slot.modeState.mode,
      { ...this.modeProfile(slot), modelKey, thinkingLevel },
      { sessionKey: slot.key },
    );
    this.persistDefaultModelSelection(modelKey);
  }

  private async syncModelsAfterAuthChange(options: { selectProviderId?: string; selectFallback?: boolean } = {}): Promise<void> {
    const live = this.runtime?.session.modelRuntime;
    if (live) {
      if (live.refresh) {
        try {
          await live.refresh({ allowNetwork: false });
        } catch {
          // ignore refresh errors; getAvailable below still runs
        }
      } else if (live.getAvailable) {
        try {
          await live.getAvailable();
        } catch {
          // ignore
        }
      }
      await this.refreshAvailableModels();
      if (options.selectProviderId) await this.selectAvailableModel(options.selectProviderId);
      else if (options.selectFallback) await this.selectAvailableModel();
      return;
    }

    const runtime = await this.createAuthModelRuntime();
    try {
      const preferredProvider = options.selectProviderId
        ?? (options.selectFallback ? this.readSettingsDefaultProvider() : undefined);
      const chosen = await this.pickAvailableModel(runtime, preferredProvider)
        ?? (options.selectFallback ? await this.pickAvailableModel(runtime) : undefined);
      if (chosen) this.persistDefaultModelSelection(`${chosen.provider}/${chosen.id}`);
    } catch {
      // keep existing settings if the detached auth runtime cannot resolve a model
    }
  }

  private async pickAvailableModel(
    runtime: ModelRuntime,
    providerId?: string,
  ): Promise<{ provider: string; id: string } | undefined> {
    let models: ReadonlyArray<{ provider?: string; id?: string }>;
    try {
      models = await runtime.getAvailable(providerId);
    } catch {
      return undefined;
    }
    const selected = models.find((model) => model.provider && model.id);
    if (!selected?.provider || !selected.id) return undefined;
    return { provider: selected.provider, id: selected.id };
  }

  private resolveModel(session: PiSessionLike, modelKey: string): unknown {
    const [provider, ...idParts] = modelKey.split("/");
    if (!provider || idParts.length === 0) return undefined;
    return session.modelRuntime?.getModel(provider, idParts.join("/"));
  }

  private supportedThinkingLevels(session: PiSessionLike, model?: unknown): ThinkingLevel[] {
    const fallback = (session.getAvailableThinkingLevels?.() ?? THINKING_LEVEL_ORDER)
      .filter((level): level is ThinkingLevel => THINKING_LEVEL_ORDER.includes(level as ThinkingLevel));
    const map = (model && typeof model === "object" && "thinkingLevelMap" in model)
      ? (model as { thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>> }).thinkingLevelMap
      : undefined;
    if (!map) return fallback;
    const allowed = THINKING_LEVEL_ORDER.filter((level) => {
      const value = map[level];
      if (value === null) return false;
      if (typeof value === "string") return true;
      return DEFAULT_MODEL_THINKING_LEVELS.has(level);
    });
    return allowed.length > 0 ? allowed : fallback;
  }

  private normalizeThinkingLevel(requested: ThinkingLevel, allowed: ThinkingLevel[]): ThinkingLevel {
    if (allowed.includes(requested)) return requested;
    const requestedIndex = THINKING_LEVEL_ORDER.indexOf(requested);
    const allowedIndices = allowed
      .map((level) => THINKING_LEVEL_ORDER.indexOf(level))
      .filter((index) => index >= 0)
      .sort((left, right) => left - right);
    const lower = [...allowedIndices].reverse().find((index) => index < requestedIndex);
    if (lower !== undefined) return THINKING_LEVEL_ORDER[lower]!;
    const higher = allowedIndices.find((index) => index > requestedIndex);
    if (higher !== undefined) return THINKING_LEVEL_ORDER[higher]!;
    return allowed[0] ?? "off";
  }

  private modelName(session: PiSessionLike): string {
    return formatModelName(session);
  }

  private resolveDisplayName(session?: PiSessionLike): string {
    return formatSessionName(session);
  }

  private messageText(message: { role?: string; id?: string; content?: unknown }): string {
    return formatMessageText(message);
  }

  private stringify(value: unknown): string {
    return formatUnknown(value);
  }


  private async copyToClipboard(text: string): Promise<void> {
    if (this.clipboardWriter) {
      this.clipboardWriter(text);
      return;
    }
    try {
      const { clipboard } = await import("electron");
      clipboard.writeText(text);
    } catch {
      // Non-Electron test environment: no-op
    }
  }
}

