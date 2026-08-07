import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
  AgentMode,
  PiEvent,
  SessionKey,
  SessionModeState,
  SessionStatus,
  SessionTodoItem,
  ThinkingLevel,
} from "../../shared/protocol.js";
import type { ProviderUsageRegistry } from "../provider/index.js";
import type { PlanModeStore } from "./plan/store.js";

export interface PiSessionLike {
  sessionId: string;
  sessionFile?: string;
  sessionName?: string;
  cwd: string;
  model?: { provider?: string; id?: string };
  thinkingLevel: string;
  readonly isStreaming: boolean;
  readonly messages: unknown[];
  getActiveToolNames(): string[];
  getAllTools(): unknown[];
  sessionManager?: {
    getTree(): Array<{ entry: { id: string; type: string; message?: { role?: string; content?: unknown }; summary?: string }; children: unknown[] }>;
    buildSessionContext?: () => { messages?: unknown[] };
    getSessionName?(): string | undefined;
    appendSessionInfo?(name: string): string;
    appendCustomMessageEntry?(customType: string, content: string, display: boolean, details?: unknown): string;
    getSessionFile?(): string | undefined;
    getLeafId?(): string | null;
  };
  settingsManager?: {
    getPackages(): Array<string | { source: string }>;
    getDefaultProvider?(): string | undefined;
    getDefaultModel?(): string | undefined;
    getEnabledModels?(): string[] | undefined;
  };
  getSessionStats(): {
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    cost: number;
  };
  getContextUsage?(): { tokens: number; contextWindow: number } | undefined;
  subscribe(listener: (event: unknown) => void): () => void;
  prompt(text: string, options?: unknown): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  clearQueue?(): { steering: string[]; followUp: string[] };
  getSteeringMessages?(): readonly string[];
  getFollowUpMessages?(): readonly string[];
  abort(): Promise<void>;
  setThinkingLevel(level: string): void;
  getAvailableThinkingLevels?(): string[];
  setActiveToolsByName(tools: string[]): void;
  compact(instructions?: string): Promise<unknown>;
  reload(options?: unknown): Promise<void>;
  setModel?(model: unknown): Promise<void>;
  setSessionName?(name: string): void;
  navigateTree?(targetId: string, options?: unknown): Promise<unknown>;
  exportToHtml?(outputPath?: string): Promise<string>;
  exportToJsonl?(outputPath?: string): string;
  modelRuntime?: {
    getModels(): ReadonlyArray<{ provider?: string; id?: string; name?: string }>;
    getModel(provider: string, id: string): unknown;
    getAvailable?(providerId?: string): Promise<ReadonlyArray<{ provider?: string; id?: string; name?: string }>>;
    getAvailableSnapshot?(): ReadonlyArray<{ provider?: string; id?: string; name?: string }>;
    hasConfiguredAuth?(providerId: string): boolean;
    getProviders?(): ReadonlyArray<{
      id: string;
      name: string;
      auth?: { apiKey?: { login?: unknown }; oauth?: unknown };
    }>;
    getProvider?(providerId: string): { id: string; name: string; auth?: { apiKey?: { login?: unknown }; oauth?: unknown } } | undefined;
    getProviderAuthStatus?(providerId: string): { configured: boolean; source?: string; label?: string };
    listCredentials?(): Promise<ReadonlyArray<{ providerId: string; type: "api_key" | "oauth" }>>;
    login?(
      providerId: string,
      type: "api_key" | "oauth",
      interaction: {
        prompt: (prompt: { type: string; message?: string; options?: Array<{ id: string; label: string }> }) => Promise<string>;
        notify: (event: unknown) => void;
        signal?: AbortSignal;
      },
    ): Promise<unknown>;
    logout?(providerId: string): Promise<void>;
    refresh?(options?: { allowNetwork?: boolean }): Promise<unknown>;
    isUsingOAuth?(providerId: string): boolean;
  };
  resourceLoader?: {
    getAgentsFiles(): { agentsFiles: Array<{ path: string }> };
    getSkills(): { skills: Array<{ name?: string; description?: string; filePath?: string; path?: string; sourceInfo?: { source?: string; origin?: string; baseDir?: string } }> };
    getPrompts(): { prompts: Array<{ name?: string; description?: string; filePath?: string; path?: string; sourceInfo?: { source?: string; origin?: string; baseDir?: string } }> };
    getThemes(): { themes: Array<{ name?: string; filePath?: string; path?: string; sourceInfo?: { source?: string; origin?: string; baseDir?: string } }> };
    getExtensions(): { extensions: Array<{ path?: string; name?: string; sourceInfo?: { source?: string; origin?: string; baseDir?: string } }>; errors: Array<{ path: string; error: string }> };
  };
  extensionRunner?: { getRegisteredCommands(): Array<{ invocationName?: string; name: string; description?: string; sourceInfo?: { path?: string } }> };
}

export interface PiRuntimeLike {
  session: PiSessionLike;
  cwd: string;
  switchSession(sessionPath: string, options?: unknown): Promise<{ cancelled: boolean }>;
  newSession(options?: unknown): Promise<{ cancelled: boolean }>;
  fork(entryId: string, options?: unknown): Promise<{ cancelled: boolean }>;
  importFromJsonl(inputPath: string, cwdOverride?: string): Promise<{ cancelled: boolean }>;
  dispose(): Promise<void>;
  diagnostics?: Array<{ type?: string; message?: string }>;
}

export type PiRuntimeFactory = (options: { cwd: string; sessionPath?: string }) => Promise<PiRuntimeLike>;
export type PiEventListener = (event: PiEvent) => void;
export type AuthModelRuntimeFactory = () => Promise<ModelRuntime>;

export interface PiHostOptions {
  workspaceId?: string;
  agentDir?: string;
  runtime?: PiRuntimeLike;
  runtimeFactory?: PiRuntimeFactory;
  /** Override for Settings → Providers auth operations (tests). */
  authRuntimeFactory?: AuthModelRuntimeFactory;
  clipboardWriter?: (text: string) => void;
  /** Open a URL in the user's default browser (OAuth authorization links). */
  openExternal?: (url: string) => void;
  /** Override provider usage adapter registry (tests). */
  usageRegistry?: ProviderUsageRegistry;
  /** Balance cache TTL in ms (default 60s). */
  usageCacheTtlMs?: number;
  /** Tool calls within one turn before an automatic todo nudge fires (default 8). */
  todoNudgeThreshold?: number;
  /** Lower threshold for fast/cheap models (default 4). */
  todoNudgeFastThreshold?: number;
}

export interface RuntimeSlot {
  key: SessionKey;
  runtime: PiRuntimeLike;
  unsubscribe?: () => void;
  assistantMessageId?: string;
  thinkingMessageId?: string;
  sessionTodos: SessionTodoItem[];
  todoRevision: number;
  /** Tool calls completed in the current turn (for the todo nudge). */
  turnToolCount: number;
  turnNudged: boolean;
  /** Non-todo tools executed since agent_start; survives per-call turn resets. */
  runToolCount: number;
  sessionGeneration: number;
  status: SessionStatus;
  pendingFileMutations: Map<string, { path: string; absolutePath: string; before?: string }>;
  completedFileMutations: Map<string, { path: string; absolutePath: string; before?: string; after?: string }>;
  modeState: SessionModeState;
  planStore: PlanModeStore;
}

export type { AgentMode, SessionKey, ThinkingLevel };
