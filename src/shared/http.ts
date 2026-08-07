export type HttpTreeNodeKind = "folder" | "file" | "environment" | "history" | "response";

export interface HttpTreeNode {
  id: string;
  name: string;
  kind: HttpTreeNodeKind;
  relativePath: string;
  children?: HttpTreeNode[];
  runCount?: number;
  /** Metadata for a virtual response artifact shown beneath Run History. */
  historyScopePath?: string;
  runId?: string;
  requestId?: string;
  status?: number;
}

export interface HttpEnvironment {
  name: string;
  relativePath: string;
  variables: Record<string, string>;
  updatedAt: string;
}

export interface HttpEnvironmentDocument {
  name: string;
  relativePath: string;
  content: string;
}

export interface HttpWorkspaceSnapshot {
  projectUid: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  tree: HttpTreeNode[];
  environments: HttpEnvironment[];
}

export interface HttpRequestRunResult {
  id: string;
  filePath: string;
  requestName: string;
  method: string;
  url: string;
  /** Raw request block captured when the run was executed. */
  requestSource?: string;
  /** Source line where the request starts, used for the response inlay. */
  requestLine?: number;
  /** Saved response output filename within the run artifact directory. */
  responseFileName?: string;
  status?: number;
  ok: boolean;
  durationMs: number;
  response?: string;
  headers?: Record<string, string>;
  error?: string;
}

export interface HttpRunRecord {
  id: string;
  scopePath: string;
  scopeName: string;
  projectId: string;
  environment: string;
  startedAt: string;
  durationMs: number;
  status: "passed" | "failed";
  requestCount: number;
  passedCount: number;
  failedCount: number;
  /** Present when a single request line was executed from an HTTP file. */
  requestLine?: number;
  requests: HttpRequestRunResult[];
}

export interface HttpApi {
  workspace(projectId: string): Promise<HttpWorkspaceSnapshot>;
  readFile(projectId: string, relativePath: string): Promise<{ path: string; content: string }>;
  saveFile(projectId: string, relativePath: string, content: string): Promise<void>;
  readEnvironment(projectId: string, relativePath: string): Promise<HttpEnvironmentDocument>;
  saveEnvironment(projectId: string, relativePath: string, content: string): Promise<void>;
  createFolder(projectId: string, parentPath: string, name: string): Promise<HttpWorkspaceSnapshot>;
  createFile(projectId: string, parentPath: string, name: string): Promise<{ path: string; content: string; workspace: HttpWorkspaceSnapshot }>;
  createEnvironment(projectId: string, name: string): Promise<HttpWorkspaceSnapshot>;
  listRuns(projectId: string, scopePath: string): Promise<HttpRunRecord[]>;
  readRun(projectId: string, scopePath: string, runId: string): Promise<HttpRunRecord>;
  readResponse(projectId: string, scopePath: string, runId: string, requestId: string): Promise<HttpRequestRunResult>;
  deleteRun(projectId: string, scopePath: string, runId: string): Promise<HttpWorkspaceSnapshot>;
  deleteResponse(projectId: string, scopePath: string, runId: string, requestId: string): Promise<HttpWorkspaceSnapshot>;
  deleteRunHistory(projectId: string, scopePath: string): Promise<HttpWorkspaceSnapshot>;
  run(projectId: string, scopePath: string, environmentName?: string, requestLine?: number): Promise<HttpRunRecord>;
}
