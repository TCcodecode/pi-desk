import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import type {
  HttpEnvironment,
  HttpRequestRunResult,
  HttpRunRecord,
  HttpTreeNode,
  HttpWorkspaceSnapshot,
  ProjectSummary,
} from "../../shared/protocol.js";

const WORKBENCH_DIR = "http-workbench";
const ENVIRONMENTS_DIR = "environments";
const RUN_HISTORY_DIR = "run-history";
const MAX_RESPONSE_SIZE = 200_000;

let userDataPath = "";
let uidCatalogRoot = "";
let uidCatalog: Record<string, string> = {};

export function setHttpWorkbenchUserDataPath(path: string): void {
  userDataPath = path;
  uidCatalogRoot = "";
  uidCatalog = {};
}

function projectKey(project: ProjectSummary): string {
  return project.path.replace(/\\+$/, "") || project.path;
}

function loadUidCatalog(): Record<string, string> {
  if (!userDataPath) return {};
  if (uidCatalogRoot === userDataPath) return uidCatalog;
  uidCatalogRoot = userDataPath;
  const path = join(userDataPath, WORKBENCH_DIR, "catalog.json");
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { projectUids?: Record<string, string> };
    uidCatalog = raw.projectUids && typeof raw.projectUids === "object" ? raw.projectUids : {};
  } catch {
    uidCatalog = {};
  }
  return uidCatalog;
}

function saveUidCatalog(): void {
  if (!userDataPath) return;
  const directory = join(userDataPath, WORKBENCH_DIR);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "catalog.json"), JSON.stringify({ projectUids: uidCatalog }, null, 2), "utf8");
}

function stableProjectUid(project: ProjectSummary): string {
  const catalog = loadUidCatalog();
  const key = projectKey(project);
  const existing = catalog[key];
  if (existing) return existing;
  const uid = project.projectUid ?? createHash("sha256").update(key).digest("hex").slice(0, 24);
  catalog[key] = uid;
  saveUidCatalog();
  return uid;
}

function requireSafeName(value: string, label: string): string {
  const name = value.trim();
  if (!name || name === "." || name === ".." || /[\\/\0]/.test(name)) {
    throw new Error(`${label} must be a single name`);
  }
  return name;
}

function safeRelativePath(value: string): string {
  if (typeof value !== "string") throw new Error("Path must stay inside the HTTP Workbench project space");
  const normalized = value.trim().replaceAll("\\", "/");
  if (!normalized || normalized === ".") return "";
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error("Path must be relative to the HTTP Workbench project space");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Path must stay inside the HTTP Workbench project space");
  }
  return parts.join("/");
}

function ensureInside(root: string, relativePath: string): string {
  const target = resolve(root, relativePath);
  const normalizedRoot = resolve(root);
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error("HTTP Workbench path escaped its application-owned project space");
  }
  return target;
}

function projectRoot(project: ProjectSummary): string {
  if (!userDataPath) throw new Error("HTTP Workbench is not initialized");
  return join(userDataPath, WORKBENCH_DIR, "projects", stableProjectUid(project));
}

function projectManifest(project: ProjectSummary) {
  return {
    projectUid: stableProjectUid(project),
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path,
    updatedAt: new Date().toISOString(),
  };
}

async function ensureProjectSpace(project: ProjectSummary): Promise<string> {
  const root = projectRoot(project);
  await mkdir(join(root, ENVIRONMENTS_DIR), { recursive: true });
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "project.json"), JSON.stringify(projectManifest(project), null, 2), "utf8");
  return root;
}

function projectPathFromRelative(root: string, value: string): string {
  return ensureInside(root, safeRelativePath(value));
}

function historyParentPath(scope: string): string {
  if (!scope.toLowerCase().endsWith(".http")) return scope;
  const parent = dirname(scope);
  return parent === "." ? "" : parent;
}

function assertTestAssetPath(value: string, label = "Test path"): string {
  const path = safeRelativePath(value);
  const parts = path.split("/");
  if (parts.includes(ENVIRONMENTS_DIR) || parts.includes(RUN_HISTORY_DIR)) {
    throw new Error(`${label} is managed by HTTP Workbench`);
  }
  return path;
}

function assertUserFolderPath(value: string, label: string): string {
  const path = safeRelativePath(value);
  const parts = path.split("/");
  if (parts.includes(ENVIRONMENTS_DIR) || parts.includes(RUN_HISTORY_DIR)) {
    throw new Error(`${label} is managed by HTTP Workbench`);
  }
  return path;
}

function assertEnvironmentPath(value: string): string {
  const path = safeRelativePath(value);
  const parts = path.split("/");
  if (parts.length !== 2 || parts[0] !== ENVIRONMENTS_DIR || !parts[1]?.toLowerCase().endsWith(".json")) {
    throw new Error("Only project environment files can be opened here");
  }
  return path;
}

function historyVirtualPath(scopePath: string): string {
  return `.run-history/${scopePath || "project"}`;
}

function responseArtifactName(record: HttpRunRecord, request: HttpRequestRunResult, index: number): string {
  const timestamp = record.startedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const status = request.status ?? "ERR";
  const contentType = request.headers?.["content-type"]?.toLowerCase() ?? "";
  const extension = request.error ? "txt" : contentType.includes("json") ? "json" : contentType.includes("html") ? "html" : "txt";
  return `${timestamp}.${status}${index ? `-${index + 1}` : ""}.${extension}`;
}

function isResponseLink(line: string): boolean {
  return /^\s*<>\s+\S+\s*$/.test(line);
}

async function addResponseLinks(root: string, record: HttpRunRecord): Promise<void> {
  const byFile = new Map<string, HttpRequestRunResult[]>();
  for (const request of record.requests) {
    if (!request.responseFileName || !request.requestLine) continue;
    const entries = byFile.get(request.filePath) ?? [];
    entries.push(request);
    byFile.set(request.filePath, entries);
  }
  await Promise.all([...byFile].map(async ([filePath, requests]) => {
    const target = projectPathFromRelative(root, filePath);
    const lines = (await readFile(target, "utf8")).split(/\r?\n/);
    for (const request of requests.sort((a, b) => b.requestLine! - a.requestLine!)) {
      if (lines.some((line) => line.trim() === `<> ${request.responseFileName}`)) continue;
      const start = request.requestLine! - 1;
      let end = lines.findIndex((line, index) => index > start && /^\s*###/.test(line));
      if (end < 0) end = lines.length;
      lines.splice(end, 0, `<> ${request.responseFileName}`);
    }
    await writeFile(target, lines.join("\n"), "utf8");
  }));
}

async function removeResponseLink(root: string, request: HttpRequestRunResult): Promise<void> {
  if (!request.responseFileName) return;
  const target = projectPathFromRelative(root, request.filePath);
  try {
    const lines = (await readFile(target, "utf8")).split(/\r?\n/);
    const index = lines.findIndex((line) => line.trim() === `<> ${request.responseFileName}`);
    if (index >= 0) {
      lines.splice(index, 1);
      await writeFile(target, lines.join("\n"), "utf8");
    }
  } catch {
    // The source test can have been deleted independently of its response history.
  }
}

async function historyNode(root: string, scopePath: string, directory: string): Promise<HttpTreeNode> {
  const children: HttpTreeNode[] = [];
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const record = JSON.parse(await readFile(join(directory, entry.name, "record.json"), "utf8")) as HttpRunRecord;
        record.requests.forEach((request, index) => {
          const name = request.responseFileName ?? responseArtifactName(record, request, index);
          children.push({
            id: `response:${scopePath || "."}:${record.id}:${request.id}`,
            name,
            kind: "response",
            relativePath: `${historyVirtualPath(scopePath)}/${record.id}/${request.id}`,
            historyScopePath: scopePath,
            runId: record.id,
            requestId: request.id,
            status: request.status,
          });
        });
      } catch {
        // Ignore incomplete records left by an interrupted run.
      }
    }
  } catch {
    // A history directory is optional until the first request runs.
  }
  children.sort((a, b) => b.name.localeCompare(a.name));
  return {
    id: `history:${scopePath || "."}`,
    name: "Run History",
    kind: "history",
    relativePath: historyVirtualPath(scopePath),
    runCount: children.length,
    children,
    historyScopePath: scopePath,
  };
}

async function environmentNodes(root: string): Promise<HttpTreeNode[]> {
  const directory = join(root, ENVIRONMENTS_DIR);
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".json")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({
      id: `environment:${entry.name}`,
      name: entry.name.replace(/\.json$/i, ""),
      kind: "environment" as const,
      relativePath: `${ENVIRONMENTS_DIR}/${entry.name}`,
    }));
}

async function buildTree(root: string, currentRelative = ""): Promise<HttpTreeNode[]> {
  const directory = ensureInside(root, currentRelative);
  const entries = await readdir(directory, { withFileTypes: true });
  const nodes: HttpTreeNode[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "project.json") continue;
    const entryRelative = currentRelative ? `${currentRelative}/${entry.name}` : entry.name;
    if (entry.name === ENVIRONMENTS_DIR && entry.isDirectory()) {
      nodes.push({
        id: `folder:${entryRelative}`,
        name: "Environments",
        kind: "folder",
        relativePath: entryRelative,
        children: await environmentNodes(root),
      });
      continue;
    }
    if (entry.name === RUN_HISTORY_DIR && entry.isDirectory()) {
      nodes.push(await historyNode(root, currentRelative, join(directory, entry.name)));
      continue;
    }
    if (entry.isDirectory()) {
      nodes.push({
        id: `folder:${entryRelative}`,
        name: entry.name,
        kind: "folder",
        relativePath: entryRelative,
        children: await buildTree(root, entryRelative),
      });
      continue;
    }
    if (entry.isFile() && extname(entry.name).toLowerCase() === ".http") {
      nodes.push({
        id: `file:${entryRelative}`,
        name: entry.name,
        kind: "file",
        relativePath: entryRelative,
      });
    }
  }
  return nodes;
}

async function readEnvironments(root: string): Promise<HttpEnvironment[]> {
  const directory = join(root, ENVIRONMENTS_DIR);
  const entries = await readdir(directory, { withFileTypes: true });
  const environments: HttpEnvironment[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".json") continue;
    const relativePath = `${ENVIRONMENTS_DIR}/${entry.name}`;
    try {
      const raw = JSON.parse(await readFile(join(directory, entry.name), "utf8")) as Record<string, unknown>;
      const variables = Object.fromEntries(
        Object.entries(raw).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value)).map(([key, value]) => [key, String(value)]),
      );
      const fileStat = await stat(join(directory, entry.name));
      environments.push({
        name: entry.name.replace(/\.json$/i, ""),
        relativePath,
        variables,
        updatedAt: fileStat.mtime.toISOString(),
      });
    } catch {
      environments.push({
        name: entry.name.replace(/\.json$/i, ""),
        relativePath,
        variables: {},
        updatedAt: new Date(0).toISOString(),
      });
    }
  }
  return environments.sort((a, b) => a.name.localeCompare(b.name));
}

function resolveProject(projects: ProjectSummary[], projectId: string): ProjectSummary {
  const project = projects.find((item) => item.id === projectId || item.path === projectId || item.projectUid === projectId);
  if (!project) throw new Error("Project is not registered in PI Desk");
  return project;
}

export class HttpWorkbenchStore {
  constructor(private readonly listProjects: () => ProjectSummary[]) {}

  private project(projectId: string): ProjectSummary {
    return resolveProject(this.listProjects(), projectId);
  }

  async workspace(projectId: string): Promise<HttpWorkspaceSnapshot> {
    const project = this.project(projectId);
    const root = await ensureProjectSpace(project);
    return {
      projectUid: stableProjectUid(project),
      projectId: project.id,
      projectName: project.name,
      projectPath: project.path,
      tree: await buildTree(root),
      environments: await readEnvironments(root),
    };
  }

  async readFile(projectId: string, relativePath: string): Promise<{ path: string; content: string }> {
    const project = this.project(projectId);
    const root = await ensureProjectSpace(project);
    const path = assertTestAssetPath(relativePath, "HTTP test path");
    if (!path.toLowerCase().endsWith(".http")) throw new Error("Only .http assets can be opened in HTTP Workbench");
    return { path, content: await readFile(projectPathFromRelative(root, path), "utf8") };
  }

  async saveFile(projectId: string, relativePath: string, content: string): Promise<void> {
    const project = this.project(projectId);
    const root = await ensureProjectSpace(project);
    const path = assertTestAssetPath(relativePath, "HTTP test path");
    if (!path.toLowerCase().endsWith(".http")) throw new Error("Only .http assets can be saved in HTTP Workbench");
    const target = projectPathFromRelative(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }

  async readEnvironment(projectId: string, relativePath: string): Promise<{ name: string; relativePath: string; content: string }> {
    const project = this.project(projectId);
    const root = await ensureProjectSpace(project);
    const path = assertEnvironmentPath(relativePath);
    return {
      name: path.split("/").pop()!.replace(/\.json$/i, ""),
      relativePath: path,
      content: await readFile(projectPathFromRelative(root, path), "utf8"),
    };
  }

  async saveEnvironment(projectId: string, relativePath: string, content: string): Promise<void> {
    const project = this.project(projectId);
    const root = await ensureProjectSpace(project);
    const path = assertEnvironmentPath(relativePath);
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Environment must be a JSON object");
    await writeFile(projectPathFromRelative(root, path), JSON.stringify(parsed, null, 2), "utf8");
  }

  async createFolder(projectId: string, parentPath: string, name: string): Promise<HttpWorkspaceSnapshot> {
    const project = this.project(projectId);
    const root = await ensureProjectSpace(project);
    const parent = assertUserFolderPath(parentPath, "This directory");
    const folderName = requireSafeName(name, "Folder name");
    if (folderName.toLowerCase() === ENVIRONMENTS_DIR || folderName.toLowerCase() === RUN_HISTORY_DIR) throw new Error("This folder name is reserved by HTTP Workbench");
    await mkdir(projectPathFromRelative(root, parent ? `${parent}/${folderName}` : folderName), { recursive: true });
    return this.workspace(project.id);
  }

  async createFile(projectId: string, parentPath: string, name: string): Promise<{ path: string; content: string; workspace: HttpWorkspaceSnapshot }> {
    const project = this.project(projectId);
    const root = await ensureProjectSpace(project);
    const parent = assertUserFolderPath(parentPath, "HTTP tests cannot be created inside a managed directory");
    const rawName = requireSafeName(name, "File name");
    const fileName = rawName.toLowerCase().endsWith(".http") ? rawName : `${rawName}.http`;
    const path = parent ? `${parent}/${fileName}` : fileName;
    const target = projectPathFromRelative(root, path);
    const content = "### New request\nGET https://example.com\n\n";
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, { encoding: "utf8", flag: "wx" });
    return { path, content, workspace: await this.workspace(project.id) };
  }

  async createEnvironment(projectId: string, name: string): Promise<HttpWorkspaceSnapshot> {
    const project = this.project(projectId);
    const root = await ensureProjectSpace(project);
    const rawName = requireSafeName(name, "Environment name");
    const environmentName = rawName.replace(/\.json$/i, "");
    if (!environmentName) throw new Error("Environment name must be a single name");
    const target = projectPathFromRelative(root, `${ENVIRONMENTS_DIR}/${environmentName}.json`);
    await writeFile(target, JSON.stringify({ baseUrl: "http://localhost:3000" }, null, 2), { encoding: "utf8", flag: "wx" });
    return this.workspace(project.id);
  }

  async listRuns(projectId: string, scopePath: string): Promise<HttpRunRecord[]> {
    const project = this.project(projectId);
    const root = await ensureProjectSpace(project);
    const scope = assertTestAssetPath(scopePath, "Run scope");
    const historyParent = historyParentPath(scope);
    const historyDirectory = projectPathFromRelative(root, historyParent ? `${historyParent}/${RUN_HISTORY_DIR}` : RUN_HISTORY_DIR);
    try {
      const entries = await readdir(historyDirectory, { withFileTypes: true });
      const records: HttpRunRecord[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const record = JSON.parse(await readFile(join(historyDirectory, entry.name, "record.json"), "utf8")) as HttpRunRecord;
          if (!scope || record.scopePath === scope || !scope.toLowerCase().endsWith(".http") || record.requests.some((request) => request.filePath === scope)) records.push(record);
        } catch {
          // Ignore incomplete records left by an interrupted run.
        }
      }
      return records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    } catch {
      return [];
    }
  }

  async readRun(projectId: string, scopePath: string, runId: string): Promise<HttpRunRecord> {
    const project = this.project(projectId);
    const root = await ensureProjectSpace(project);
    const scope = assertTestAssetPath(scopePath, "Run scope");
    const safeRunId = requireSafeName(runId, "Run id");
    const historyParent = historyParentPath(scope);
    const target = projectPathFromRelative(root, historyParent ? `${historyParent}/${RUN_HISTORY_DIR}/${safeRunId}/record.json` : `${RUN_HISTORY_DIR}/${safeRunId}/record.json`);
    return JSON.parse(await readFile(target, "utf8")) as HttpRunRecord;
  }

  async readResponse(projectId: string, scopePath: string, runId: string, requestId: string): Promise<HttpRequestRunResult> {
    const project = this.project(projectId);
    const root = await ensureProjectSpace(project);
    const scope = assertTestAssetPath(scopePath, "Run scope");
    const safeRunId = requireSafeName(runId, "Run id");
    const safeRequestId = requireSafeName(requestId, "Request id");
    const historyParent = historyParentPath(scope);
    const recordDirectory = projectPathFromRelative(root, historyParent ? `${historyParent}/${RUN_HISTORY_DIR}/${safeRunId}` : `${RUN_HISTORY_DIR}/${safeRunId}`);
    const record = JSON.parse(await readFile(join(recordDirectory, "record.json"), "utf8")) as HttpRunRecord;
    const request = record.requests.find((item) => item.id === safeRequestId);
    if (!request) throw new Error("Response was not found in this run");
    if (request.responseFileName) {
      try {
        return { ...request, response: await readFile(join(recordDirectory, requireSafeName(request.responseFileName, "Response filename")), "utf8") };
      } catch {
        // Keep older run records readable when their response was stored inline only.
      }
    }
    return request;
  }

  async deleteRun(projectId: string, scopePath: string, runId: string): Promise<HttpWorkspaceSnapshot> {
    const project = this.project(projectId);
    const root = await ensureProjectSpace(project);
    const scope = assertTestAssetPath(scopePath, "Run scope");
    const safeRunId = requireSafeName(runId, "Run id");
    const historyParent = historyParentPath(scope);
    const historyDirectory = projectPathFromRelative(root, historyParent ? `${historyParent}/${RUN_HISTORY_DIR}` : RUN_HISTORY_DIR);
    const target = projectPathFromRelative(root, historyParent ? `${historyParent}/${RUN_HISTORY_DIR}/${safeRunId}` : `${RUN_HISTORY_DIR}/${safeRunId}`);
    await rm(target, { recursive: true, force: true });
    try {
      const remaining = await readdir(historyDirectory, { withFileTypes: true });
      if (remaining.length === 0) await rm(historyDirectory, { recursive: true, force: true });
    } catch {
      // The history directory may already be gone after a concurrent cleanup.
    }
    return this.workspace(project.id);
  }

  async deleteResponse(projectId: string, scopePath: string, runId: string, requestId: string): Promise<HttpWorkspaceSnapshot> {
    const project = this.project(projectId);
    const root = await ensureProjectSpace(project);
    const scope = assertTestAssetPath(scopePath, "Run scope");
    const safeRunId = requireSafeName(runId, "Run id");
    const safeRequestId = requireSafeName(requestId, "Request id");
    const historyParent = historyParentPath(scope);
    const recordDirectory = projectPathFromRelative(root, historyParent ? `${historyParent}/${RUN_HISTORY_DIR}/${safeRunId}` : `${RUN_HISTORY_DIR}/${safeRunId}`);
    const recordPath = join(recordDirectory, "record.json");
    const record = JSON.parse(await readFile(recordPath, "utf8")) as HttpRunRecord;
    const response = record.requests.find((item) => item.id === safeRequestId);
    if (!response) return this.workspace(project.id);
    await removeResponseLink(root, response);
    if (response.responseFileName) await rm(join(recordDirectory, requireSafeName(response.responseFileName, "Response filename")), { force: true });
    record.requests = record.requests.filter((item) => item.id !== safeRequestId);
    record.requestCount = record.requests.length;
    record.passedCount = record.requests.filter((item) => item.ok).length;
    record.failedCount = record.requests.filter((item) => !item.ok).length;
    record.status = record.failedCount ? "failed" : "passed";
    if (record.requests.length) {
      await writeFile(recordPath, JSON.stringify(record, null, 2), "utf8");
    } else {
      await rm(recordDirectory, { recursive: true, force: true });
      const historyDirectory = dirname(recordDirectory);
      try {
        if ((await readdir(historyDirectory)).length === 0) await rm(historyDirectory, { recursive: true, force: true });
      } catch {
        // The directory may have been removed by another cleanup.
      }
    }
    return this.workspace(project.id);
  }

  async deleteRunHistory(projectId: string, scopePath: string): Promise<HttpWorkspaceSnapshot> {
    const project = this.project(projectId);
    const root = await ensureProjectSpace(project);
    const scope = assertUserFolderPath(scopePath, "Run history scope");
    const target = projectPathFromRelative(root, scope ? `${scope}/${RUN_HISTORY_DIR}` : RUN_HISTORY_DIR);
    await rm(target, { recursive: true, force: true });
    return this.workspace(project.id);
  }

  async run(projectId: string, scopePath: string, environmentName?: string, requestLine?: number): Promise<HttpRunRecord> {
    const project = this.project(projectId);
    const root = await ensureProjectSpace(project);
    const scope = assertTestAssetPath(scopePath, "Run scope");
    const target = projectPathFromRelative(root, scope);
    const targetStat = await stat(target);
    if (targetStat.isFile() && !scope.toLowerCase().endsWith(".http")) {
      throw new Error("Only .http assets can be run in HTTP Workbench");
    }
    if (requestLine !== undefined && (!Number.isInteger(requestLine) || requestLine < 1)) {
      throw new Error("Request line must be a positive integer");
    }
    if (requestLine !== undefined && targetStat.isDirectory()) {
      throw new Error("A single request can only be run from an HTTP file");
    }
    const files = targetStat.isDirectory() ? await collectHttpFiles(root, scope) : [scope];
    if (files.length === 0) throw new Error("This test folder contains no .http files");

    const environments = await readEnvironments(root);
    const environment = environmentName
      ? environments.find((item) => item.name === environmentName)
      : environments[0];
    if (environmentName && !environment) throw new Error(`Environment not found: ${environmentName}`);
    const variables = environment?.variables ?? {};
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const requests: HttpRequestRunResult[] = [];
    for (const file of files) {
      const source = await readFile(projectPathFromRelative(root, file), "utf8");
      const parsedRequests = parseHttpFile(source, file);
      const selectedRequests = requestLine === undefined
        ? parsedRequests
        : parsedRequests.filter((request) => request.startLine === requestLine);
      if (requestLine !== undefined && selectedRequests.length === 0) {
        throw new Error(`No HTTP request starts at line ${requestLine}`);
      }
      for (const request of selectedRequests) {
        requests.push(await executeRequest(request, variables));
      }
    }
    if (requests.length === 0) throw new Error("No HTTP requests found in the selected test scope");
    const record: HttpRunRecord = {
      id: `${Date.now()}-${randomUUID().slice(0, 8)}`,
      scopePath: scope,
      scopeName: scope ? scope.split("/").pop() ?? scope : project.name,
      projectId: project.id,
      environment: environment?.name ?? "No environment",
      startedAt,
      durationMs: Date.now() - started,
      status: requests.every((request) => request.ok) ? "passed" : "failed",
      requestCount: requests.length,
      passedCount: requests.filter((request) => request.ok).length,
      failedCount: requests.filter((request) => !request.ok).length,
      requestLine,
      requests,
    };
    const historyParent = historyParentPath(scope);
    const recordDirectory = projectPathFromRelative(root, historyParent ? `${historyParent}/${RUN_HISTORY_DIR}/${record.id}` : `${RUN_HISTORY_DIR}/${record.id}`);
    record.requests.forEach((request, index) => {
      request.responseFileName = responseArtifactName(record, request, index);
      delete request.requestSource;
    });
    await mkdir(recordDirectory, { recursive: true });
    await Promise.all(record.requests.map((request) => writeFile(
      join(recordDirectory, request.responseFileName!),
      request.response ?? request.error ?? "",
      "utf8",
    )));
    record.requests.forEach((request) => delete request.response);
    await writeFile(join(recordDirectory, "record.json"), JSON.stringify(record, null, 2), "utf8");
    await addResponseLinks(root, record);
    return record;
  }
}

async function collectHttpFiles(root: string, directoryRelative: string): Promise<string[]> {
  const directory = projectPathFromRelative(root, directoryRelative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === RUN_HISTORY_DIR || entry.name === ENVIRONMENTS_DIR) continue;
    const child = directoryRelative ? `${directoryRelative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await collectHttpFiles(root, child));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".http")) files.push(child);
  }
  return files;
}

interface ParsedRequest {
  filePath: string;
  startLine: number;
  requestName: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  expectedStatus?: number;
}

function parseHttpFile(content: string, filePath: string): ParsedRequest[] {
  const sourceLines = content.split(/\r?\n/);
  const blocks: Array<{ lines: string[]; startLine: number }> = [];
  let currentLines: string[] = [];
  let currentStartLine = 1;
  sourceLines.forEach((line, index) => {
    if (/^\s*###/.test(line)) {
      if (currentLines.length) blocks.push({ lines: currentLines, startLine: currentStartLine });
      currentLines = [];
      currentStartLine = index + 2;
      return;
    }
    currentLines.push(line);
  });
  if (currentLines.length) blocks.push({ lines: currentLines, startLine: currentStartLine });

  const requests: ParsedRequest[] = [];
  blocks.forEach((block, index) => {
    const lines = block.lines;
    const requestIndex = lines.findIndex((line) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s+/i.test(line.trim()));
    if (requestIndex < 0) return;
    const requestLine = lines[requestIndex].trim().split(/\s+/);
    const method = requestLine.shift()!.toUpperCase();
    const url = requestLine.join(" ");
    const headers: Record<string, string> = {};
    let cursor = requestIndex + 1;
    for (; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (!line.trim()) {
        cursor += 1;
        break;
      }
      const header = line.match(/^([^:#\s][^:]*):\s*(.*)$/);
      if (header) headers[header[1].trim()] = header[2].trim();
    }
    const body = lines.slice(cursor).filter((line) => !isResponseLink(line)).join("\n").trim() || undefined;
    const expectedStatus = lines.map((line) => line.match(/^\s*#\s*expect-status:\s*(\d+)/i)?.[1]).find(Boolean);
    requests.push({
      filePath,
      startLine: block.startLine + requestIndex,
      requestName: `${filePath.split("/").pop() ?? filePath} · request ${index + 1}`,
      method,
      url,
      headers,
      body,
      expectedStatus: expectedStatus ? Number(expectedStatus) : undefined,
    });
  });
  return requests;
}

function interpolate(value: string, variables: Record<string, string>): string {
  return value.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, key: string) => variables[key] ?? match);
}

function missingVariables(variables: Record<string, string>, ...values: Array<string | undefined>): string[] {
  const names = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    for (const match of value.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)) {
      if (!(match[1] in variables)) names.add(match[1]);
    }
  }
  return [...names];
}

function normalizeRequestUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function redact(value: string | undefined, variables: Record<string, string>): string | undefined {
  if (value === undefined) return undefined;
  let result = value;
  for (const secret of Object.values(variables)) {
    if (secret.length >= 4) result = result.split(secret).join("<redacted>");
  }
  return result.slice(0, MAX_RESPONSE_SIZE);
}

async function executeRequest(request: ParsedRequest, variables: Record<string, string>): Promise<HttpRequestRunResult> {
  const interpolatedUrl = interpolate(request.url, variables);
  const interpolatedHeaders = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, interpolate(value, variables)]));
  const interpolatedBody = request.body ? interpolate(request.body, variables) : undefined;
  const url = normalizeRequestUrl(interpolatedUrl);
  const started = Date.now();
  const result: HttpRequestRunResult = {
    id: randomUUID(),
    filePath: request.filePath,
    requestName: request.requestName,
    method: request.method,
    url,
    requestLine: request.startLine,
    ok: false,
    durationMs: 0,
  };
  try {
    const missing = missingVariables(variables, request.url, ...Object.keys(request.headers).flatMap((key) => [key, request.headers[key]]), request.body);
    if (missing.length) {
      return {
        ...result,
        durationMs: Date.now() - started,
        error: `Missing environment variable: ${missing.join(", ")}`,
      };
    }
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return { ...result, durationMs: Date.now() - started, error: `Unsupported request URL: ${url}` };
    }
    const response = await fetch(url, {
      method: request.method,
      headers: interpolatedHeaders,
      body: interpolatedBody,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    const responseHeaders = Object.fromEntries(response.headers.entries());
    const ok = request.expectedStatus ? response.status === request.expectedStatus : response.status >= 200 && response.status < 400;
    return {
      ...result,
      status: response.status,
      ok,
      durationMs: Date.now() - started,
      response: redact(text, variables),
      headers: Object.fromEntries(Object.entries(responseHeaders).map(([key, value]) => [key, redact(value, variables) ?? ""])),
      error: ok ? undefined : request.expectedStatus ? `Expected status ${request.expectedStatus}, received ${response.status}` : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ...result,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
