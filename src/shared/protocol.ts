import type { IndexStats, IndexStatus, SymbolHit, UsageHit } from "@pi-desk/code-index";
import type { AppUpdateState, ComposerImageAttachmentFile, ComposerImageAttachmentInput } from "./app.js";
import type { HttpApi } from "./http.js";
import type { ProviderAuthStatus, ProviderLoginEvent, ProviderUsageSnapshot } from "./provider.js";
import type {
  AgentMode,
  AgentProfile,
  FileChangeSummary,
  LiveSessionSummary,
  McpConfigView,
  McpStatusSnapshotView,
  ModelOption,
  PiCommand,
  PlanArtifactSummary,
  PlanStatus,
  ResourceSnapshot,
  RuntimeDiagnostics,
  SessionCommandOptions,
  SessionKey,
  SessionModeState,
  SessionStartedPayload,
  SessionState,
  SessionSummary,
  SessionTodoItem,
  SessionTreeNode,
  ThinkingLevel,
  TimelineItem,
  ToolCallState,
  ToolOption,
} from "./session.js";
import type { ProjectFileEntry, ProjectSummary } from "./workspace.js";

export * from "./app.js";
export * from "./http.js";
export * from "./provider.js";
export * from "./session.js";
export * from "./workspace.js";

export interface PiEventBase<TType extends string, TPayload> {
  eventId: string;
  workspaceId: string;
  sessionId?: string;
  /** Routes session-scoped events to the correct tab/view. */
  sessionKey?: SessionKey;
  timestamp: string;
  sequence: number;
  type: TType;
  payload: TPayload;
  raw?: unknown;
}

export type PiEvent =
  | PiEventBase<"session_started", SessionStartedPayload>
  | PiEventBase<"session_completed", { sessionId?: string; sessionName?: string }>
  | PiEventBase<"session_error", { message: string }>
  | PiEventBase<"user_message_created", { messageId: string; content: string }>
  | PiEventBase<"assistant_message_started", { messageId: string }>
  | PiEventBase<"assistant_message_delta", { messageId: string; delta: string }>
  | PiEventBase<"assistant_message_completed", { messageId: string }>
  | PiEventBase<"thinking_started", { messageId: string }>
  | PiEventBase<"thinking_delta", { messageId: string; delta: string }>
  | PiEventBase<"thinking_completed", { messageId: string }>
  | PiEventBase<"tool_call_started", { toolCallId: string; toolName: string; input: string }>
  | PiEventBase<"tool_call_delta", { toolCallId: string; delta: string }>
  | PiEventBase<"tool_call_completed", { toolCallId: string; result: string; isError: boolean; change?: FileChangeSummary }>
  | PiEventBase<"file_change_undone", { path: string }>
  | PiEventBase<"queue_updated", { steering: string[]; followUp: string[] }>
  | PiEventBase<"model_changed", { model: string; provider: string }>
  | PiEventBase<"thinking_level_changed", { level: ThinkingLevel }>
  | PiEventBase<"mode_changed", SessionModeState>
  | PiEventBase<"plan_artifact_changed", { plan?: PlanArtifactSummary; plans: PlanArtifactSummary[] }>
  | PiEventBase<"resource_snapshot", ResourceSnapshot>
  | PiEventBase<"diagnostics_updated", RuntimeDiagnostics>
  | PiEventBase<"notification_created", { message: string; kind?: "info" | "error" }>
  | PiEventBase<"agent_started", Record<string, never>>
  | PiEventBase<"turn_started", Record<string, never>>
  | PiEventBase<"turn_completed", Record<string, never>>
  | PiEventBase<"compaction_started", Record<string, never>>
  | PiEventBase<"compaction_completed", { summary?: string }>
  | PiEventBase<"auto_retry_started", Record<string, never>>
  | PiEventBase<"auto_retry_completed", Record<string, never>>
  | PiEventBase<"model_select", { model?: string; provider?: string }>
  | PiEventBase<"project_trust_requested", { cwd: string; hasProjectResources: boolean }>
  | PiEventBase<"project_trust_resolved", { cwd: string; trusted: boolean }>
  | PiEventBase<"session_name_changed", { name: string; sessionId?: string; sessionFile?: string }>
  | PiEventBase<"provider_login_event", { providerId: string; event: ProviderLoginEvent }>
  | PiEventBase<"index_status_changed", { status: IndexStatus; cwd: string }>
  | PiEventBase<"todos_updated", { todos: SessionTodoItem[]; revision?: number }>
  | PiEventBase<"mcp_status_updated", McpStatusSnapshotView>
  | PiEventBase<"session_key_remapped", { from: SessionKey; to: SessionKey }>
  | PiEventBase<"live_sessions_changed", { sessions: LiveSessionSummary[] }>;

export interface PiSnapshot {
  workspaceId: string;
  session: SessionState;
  sessions: SessionSummary[];
  projects?: ProjectSummary[];
  activeProjectId?: string;
  timeline: TimelineItem[];
  toolCalls: Record<string, ToolCallState>;
  queue: { steering: string[]; followUp: string[] };
  resources: ResourceSnapshot;
  diagnostics: RuntimeDiagnostics;
  models?: ModelOption[];
  tools?: ToolOption[];
  lastError?: string;
  /** True when hydrateTimeline dropped earlier turns. Absent/false = full history. */
  timelineHasMore?: boolean;
  /** True when this snapshot came from a file tail and has no live runtime. */
  preview?: boolean;
}

export interface PiApi {
  getSnapshot(): Promise<PiSnapshot>;
  chooseWorkspace(): Promise<string | undefined>;
  chooseFile(): Promise<string | undefined>;
  chooseAttachmentFiles(): Promise<string[]>;
  persistImageAttachment(input: ComposerImageAttachmentInput): Promise<ComposerImageAttachmentFile>;
  loadImagePreview(path: string): Promise<string | undefined>;
  listProjectFiles(cwd?: string): Promise<ProjectFileEntry[]>;
  startSession(options: {
    cwd: string;
    sessionPath?: string;
    /** When set, open/reuse a live slot without disposing other sessions. */
    sessionKey?: SessionKey;
  }): Promise<PiSnapshot>;
  /** File-tail snapshot. Does not start a Pi runtime. */
  previewSession(options: {
    cwd: string;
    sessionPath: string;
    tailTurns?: number;
  }): Promise<PiSnapshot>;
  /** Focus an existing live session without aborting others. */
  focusSession(sessionKey: SessionKey, opts?: { includeTimeline?: boolean }): Promise<PiSnapshot>;
  /** Explicitly release a runtime (delete file / shutdown). Not used on tab close. */
  disposeSession(sessionKey: SessionKey): Promise<void>;
  /** Earlier turns before `beforeId`. Uses the live slot or the session file. */
  loadOlder(options: {
    sessionKey: SessionKey;
    beforeId: string;
    limit?: number;
    sessionPath?: string;
  }): Promise<{ items: TimelineItem[]; hasMore: boolean }>;
  /** All live agent slots (including those without a working-set tab). */
  listLiveSessions(): Promise<LiveSessionSummary[]>;
  prompt(text: string, opts?: SessionCommandOptions): Promise<void>;
  steer(text: string, opts?: SessionCommandOptions): Promise<void>;
  followUp(text: string, opts?: SessionCommandOptions): Promise<void>;
  /** Restore a file to its content before the current session first changed it. */
  undoFileChange(path: string, opts?: SessionCommandOptions): Promise<void>;
  editFollowUp(index: number, text: string, opts?: SessionCommandOptions, expectedText?: string): Promise<void>;
  sendFollowUpNow(index: number, opts?: SessionCommandOptions, expectedText?: string): Promise<void>;
  abort(opts?: SessionCommandOptions): Promise<void>;
  newSession(opts?: SessionCommandOptions): Promise<void>;
  resumeSession(sessionPath: string): Promise<PiSnapshot | void>;
  forkSession(entryId: string): Promise<void>;
  /** Duplicate the current session into a new session file (mirrors Pi /clone). */
  cloneSession(): Promise<void>;
  importSession(path: string, cwdOverride?: string): Promise<void>;
  compact(instructions?: string): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): Promise<void>;
  setMode?(mode: AgentMode, opts?: SessionCommandOptions): Promise<SessionModeState>;
  setModeProfile?(mode: AgentMode, profile: AgentProfile, opts?: SessionCommandOptions): Promise<SessionModeState>;
  listPlans?(opts?: SessionCommandOptions): Promise<PlanArtifactSummary[]>;
  readPlan?(planId: string, opts?: SessionCommandOptions): Promise<{ summary: PlanArtifactSummary; content: string }>;
  updatePlan?(planId: string, content: string, revision?: string, opts?: SessionCommandOptions): Promise<PlanArtifactSummary>;
  savePlan?(title: string, content: string, status?: PlanStatus, planId?: string, opts?: SessionCommandOptions): Promise<{ summary: PlanArtifactSummary; content: string }>;
  startExecution?(planId?: string, opts?: SessionCommandOptions): Promise<SessionModeState>;
  setTools(tools: string[], opts?: SessionCommandOptions): Promise<void>;
  /** Persist skill enable/disable patterns (e.g. ["!superpowers"]) to settings.json and reload. */
  setSkills(patterns: string[]): Promise<void>;
  reload(): Promise<void>;
  executeCommand(name: string, args?: string): Promise<void>;
  setModel(model: string): Promise<void>;
  getCommands(): Promise<PiCommand[]>;
  getModels(): Promise<ModelOption[]>;
  getTools(): Promise<ToolOption[]>;
  getResources(): Promise<ResourceSnapshot>;
  getSessionTree(): Promise<SessionTreeNode[]>;
  resolveTrust(trusted: boolean): Promise<void>;
  getGitBranch(cwd?: string): Promise<string | undefined>;
  listProjects(): Promise<ProjectSummary[]>;
  /** Opens a folder (if path omitted), registers it as a project, starts a session, returns full snapshot. */
  addProject(path?: string): Promise<PiSnapshot | undefined>;
  selectProject(projectId: string): Promise<PiSnapshot>;
  /**
   * Mark a project as the active target for New session / defaults.
   * Does not start or switch the Pi runtime session.
   */
  setActiveProject(projectId: string): Promise<{ projects: ProjectSummary[]; activeProjectId?: string }>;
  /** Remove project from the desktop list only (does not delete session JSONL files). */
  removeProject(projectId: string): Promise<{ projects: ProjectSummary[]; activeProjectId?: string }>;
  /** Reveal a file or folder in the OS file manager. */
  revealInFolder(path: string): Promise<void>;
  /** Open a project file in VS Code, or let the user choose an application. */
  openFile(path: string): Promise<void>;
  listSessions(cwd?: string): Promise<SessionSummary[]>;
  /** Rename a session (by session file path). Returns the resolved display name. */
  renameSession(sessionPath: string, name: string): Promise<{ name: string }>;
  /** Delete a session file permanently. Returns the deleted session's file path. */
  deleteSession(sessionPath: string): Promise<{ sessionPath: string }>;
  /** Extract the question/answer text from a session file (tool calls and thinking filtered out). */
  getSessionContext(sessionPath: string): Promise<{ name: string; context: string }>;
  /** List providers + auth status (for Settings → Providers). */
  listProviders(): Promise<ProviderAuthStatus[]>;
  /**
   * Session token/cost + optional account balance/quota from a provider adapter.
   * `force` bypasses the balance cache (e.g. click-to-refresh).
   */
  getProviderUsage(options?: { force?: boolean }): Promise<ProviderUsageSnapshot>;
  /** Save an API key via Pi modelRuntime.login (same as /login). */
  loginWithApiKey(providerId: string, apiKey: string): Promise<{ name: string }>;
  /** Remove stored credential via Pi modelRuntime.logout (same as /logout). */
  logoutProvider(providerId: string): Promise<void>;
  /**
   * Start an account (OAuth) login via Pi modelRuntime.login (same as /login).
   * Progress and interactive prompts arrive as provider_login_event events;
   * answer prompts with answerAuthPrompt and cancel with cancelProviderLogin.
   */
  loginWithOAuth(providerId: string): Promise<{ name: string }>;
  /** Answer a pending interactive prompt surfaced during an account login. */
  answerAuthPrompt(promptId: string, answer: string): Promise<void>;
  /** Cancel an in-flight account login for a provider. */
  cancelProviderLogin(providerId: string): Promise<void>;
  /** Open a URL in the user's default browser (OAuth authorization links). */
  openExternal(url: string): Promise<void>;
  /** Get the current code-index status for a workspace. */
  indexStatus(cwd: string): Promise<IndexStatus>;
  /** Incrementally re-scan and re-index changed files, then report status. */
  indexRefresh(cwd: string): Promise<IndexStats>;
  /** Search symbols in the code-index. */
  indexSearch(cwd: string, query: string, opts?: { limit?: number }): Promise<SymbolHit[]>;
  /** Find usages of a symbol in the code-index. */
  indexFindUsages(cwd: string, qualified: string, opts?: { kind?: string }): Promise<UsageHit[]>;
  /** Read the merged MCP config for the current workspace (server values stripped). */
  getMcpConfig(cwd?: string): Promise<McpConfigView>;
  /** Enable/disable an MCP server by writing the project override and reloading the runtime. */
  setMcpServerEnabled(name: string, enabled: boolean): Promise<{ changed: boolean; path: string }>;
  /** Copy servers from Cursor's ~/.cursor/mcp.json into the project override and reload. */
  importCursorMcp(): Promise<{ imported: string[]; skipped: string[] }>;
  /** Open the project MCP override file (.pi/mcp.json) in the default editor. */
  openMcpConfigFile(cwd?: string): Promise<void>;
  getUpdateState(): Promise<AppUpdateState>;
  checkForUpdate(): Promise<void>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdateState(listener: (state: AppUpdateState) => void): () => void;
  http?: HttpApi;
  onEvent(listener: (event: PiEvent) => void): () => void;
}

declare global {
  interface Window {
    pi: PiApi;
  }
}
