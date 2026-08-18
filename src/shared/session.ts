export type SessionStatus = "idle" | "running" | "awaiting_approval" | "completed" | "error" | "archived";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type AgentMode = "plan" | "execute";
export type PlanStatus = "draft" | "ready" | "executing" | "superseded" | "completed";

export interface AgentProfile {
  modelKey?: string;
  thinkingLevel: ThinkingLevel;
}

export interface PlanArtifactSummary {
  id: string;
  path: string;
  title: string;
  status: PlanStatus;
  updatedAt: string;
  revision: string;
  /** Session identity that owns this plan artifact. */
  sourceSession?: string;
}

export interface SessionModeState {
  mode: AgentMode;
  planProfile: AgentProfile;
  executeProfile: AgentProfile;
  /**
   * The user's normal runtime tool selection. Plan mode derives a temporary
   * safe set from this instead of overwriting the preference.
   */
  executeToolNames?: string[];
  activePlan?: PlanArtifactSummary;
}

export interface SessionStartedPayload {
  sessionId: string;
  cwd: string;
  sessionName?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
}

export interface SessionSummary {
  sessionId: string;
  cwd: string;
  name: string;
  status: SessionStatus;
  model: string;
  thinkingLevel: ThinkingLevel;
  sessionFile?: string;
  messageCount: number;
  updatedAt: string;
  modeState?: SessionModeState;
}

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type TodoPriority = "high" | "medium" | "low";

/** OpenCode-style session checklist item (mirrored from todowrite/todoread). */
export interface SessionTodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
}

export interface SessionState {
  sessionId: string;
  cwd: string;
  name: string;
  status: SessionStatus;
  model: string;
  provider: string;
  thinkingLevel: ThinkingLevel;
  contextTokens: number;
  contextWindow: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  sessionFile?: string;
  /** Agent-maintained multi-step checklist for the active session. */
  todos?: SessionTodoItem[];
  /** Monotonic within-session revision used to reject stale snapshots. */
  todosRevision?: number;
  /** Optional for backwards-compatible snapshots from older Pi Desk runtimes. */
  modeState?: SessionModeState;
}

export type TimelineItem =
  | {
      id: string;
      kind: "user" | "assistant" | "thinking" | "notification" | "error";
      content: string;
      status: "streaming" | "completed" | "error";
      /** Id of the in-progress todo this row belongs to, if any. */
      taskId?: string;
      /** Event time from the host; absent for older persisted sessions. */
      startedAt?: string;
      completedAt?: string;
    }
  | {
      id: string;
      kind: "tool";
      toolCallId: string;
      toolName: string;
      input: string;
      output?: string;
      status: "running" | "completed" | "error";
      change?: FileChangeSummary;
      /** UI snapshot clipped the input/output text. Never set on `change`. */
      truncated?: boolean;
      /** Id of the in-progress todo this trace row belongs to, if any. */
      taskId?: string;
      /** Event time from the host; absent for older persisted sessions. */
      startedAt?: string;
      completedAt?: string;
    }
  | {
      id: string;
      kind: "divider";
      /** Why the stream is split: context compaction or an auto retry. */
      label: "compacting" | "compacted" | "retrying" | "retried";
      /** Compaction summary, when available. */
      detail?: string;
      status: "running" | "completed";
      /** Id of the in-progress todo this row belongs to, if any. */
      taskId?: string;
      startedAt?: string;
      completedAt?: string;
    };

export interface FileChangeSummary {
  path: string;
  additions: number;
  deletions: number;
  diff: string;
}

export interface ToolCallState {
  id: string;
  toolName: string;
  input: string;
  output?: string;
  status: "running" | "completed" | "error";
  change?: FileChangeSummary;
}

export interface PackageResourceCounts {
  extensions: number;
  skills: number;
  prompts: number;
  themes: number;
}

export interface ResourceSnapshot {
  contextFiles: Array<{ path: string; source: "global" | "parent" | "project" | "package"; loaded: boolean; error?: string }>;
  skills: Array<{ name: string; path: string; loaded: boolean; group?: string; source?: string; enabled?: boolean }>;
  promptTemplates: Array<{ name: string; path: string }>;
  themes: Array<{ name: string; path: string; active: boolean }>;
  extensions: Array<{ name: string; source: string; loaded: boolean; error?: string; pkgSource?: string }>;
  packages: Array<{
    name: string;
    source: string;
    enabled: boolean;
    /** Resources this package contributed (counts; full lists are in the top-level arrays). */
    resources?: PackageResourceCounts;
  }>;
  /** Live MCP server status (pi-mcp-adapter view). Absent when no session has reported yet. */
  mcp?: McpStatusSnapshotView;
}

/** Runtime status of a single MCP server (mirrors pi-mcp-adapter statuses). */
export type McpServerRuntimeStatus =
  | "connected"
  | "cached"
  | "failed"
  | "needs-auth"
  | "not-connected"
  | "disabled";

export interface McpServerStatusView {
  name: string;
  status: McpServerRuntimeStatus;
  toolCount: number;
  failedAgoSeconds?: number;
  disabled: boolean;
}

/** Renderer-safe MCP status snapshot; never contains secrets or command details. */
export interface McpStatusSnapshotView {
  version: number;
  servers: McpServerStatusView[];
  totalTools: number;
  connectedCount: number;
  disabledCount: number;
}

/** One standard mcp.json source file the desktop can read/write. */
export interface McpConfigSourceView {
  path: string;
  exists: boolean;
  serverCount: number;
}

/** Merged view of one configured MCP server (values stripped, no secrets). */
export interface McpServerConfigView {
  name: string;
  disabled: boolean;
  /** Highest-precedence source file that defines this server (empty if none). */
  source: string;
}

/** Merged MCP config for a workspace (file-merge mode, adapter precedence). */
export interface McpConfigView {
  cwd: string;
  sources: McpConfigSourceView[];
  servers: McpServerConfigView[];
}

export interface SessionTreeNode {
  id: string;
  label: string;
  kind: string;
  children: SessionTreeNode[];
}

export interface RuntimeDiagnostics {
  piVersion: string;
  sdkSessionId?: string;
  sessionFile?: string;
  sequence: number;
  messages: string[];
  errors: string[];
}

export interface PiCommand {
  id: string;
  name: string;
  description: string;
  source: "builtin" | "extension" | "prompt" | "skill";
  args?: string;
}

export interface ModelOption {
  id: string;
  provider: string;
  label: string;
  available: boolean;
  thinkingLevels: ThinkingLevel[];
}

export interface ToolOption {
  name: string;
  description: string;
  active: boolean;
  source: string;
}

/**
 * Stable key for a live runtime slot; equals SessionTab.id in the renderer.
 * Conventions: `file:${absPath}` | `tmp:${uuid}` | `id:${sessionId}`
 */
export type SessionKey = string;

/** Live agent slot summary for sidebar merge (may exist without a working-set tab). */
export interface LiveSessionSummary {
  sessionKey: SessionKey;
  sessionId: string;
  sessionFile?: string;
  cwd: string;
  projectId: string;
  name: string;
  status: SessionStatus;
}

export interface SessionCommandOptions {
  sessionKey?: SessionKey;
}
