import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type {
  PlanArtifactSummary,
  PlanStatus,
  SessionModeState,
  ThinkingLevel,
} from "../../../shared/protocol.js";

const PLAN_DIR = ".pai/plan";
const MODES_FILE = ".pai/session-modes.json";
const MAX_PLAN_SIZE = 512_000;
const PLAN_STATUSES = new Set<PlanStatus>(["draft", "ready", "executing", "superseded", "completed"]);

export const PLAN_TOOL_NAMES = ["plan_save", "plan_list", "plan_read"] as const;
export const PLAN_READ_TOOL_NAMES = ["read", "grep", "find", "ls", ...PLAN_TOOL_NAMES] as const;
/** Built-in tools that can mutate the local workspace in this runtime. */
export const PLAN_BLOCKED_TOOL_NAMES = ["bash", "edit", "write"] as const;

export function isPlanBlockedTool(name: string): boolean {
  return (PLAN_BLOCKED_TOOL_NAMES as readonly string[]).includes(name);
}

type StoredMode = SessionModeState;

interface ModesDocument {
  version: 1;
  sessions: Record<string, StoredMode>;
}

export interface PlanReadResult {
  summary: PlanArtifactSummary;
  content: string;
}

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function isoNow(): string {
  return new Date().toISOString();
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "implementation-plan";
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

function yamlValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === "string" ? parsed : String(parsed);
  } catch {
    return trimmed.replace(/^['"]|['"]$/g, "");
  }
}

function parseFrontMatter(content: string): { fields: Record<string, string>; body: string } {
  if (!content.startsWith("---\n")) return { fields: {}, body: content };
  const end = content.indexOf("\n---", 4);
  if (end < 0) return { fields: {}, body: content };
  const header = content.slice(4, end);
  const fields: Record<string, string> = {};
  for (const line of header.split("\n")) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (match) fields[match[1]!] = yamlValue(match[2]) ?? "";
  }
  return { fields, body: content.slice(end + "\n---".length).replace(/^\n/, "") };
}

function titleFromBody(body: string, fallback: string): string {
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  return heading || fallback;
}

function statusFromFields(fields: Record<string, string>): PlanStatus {
  const status = fields.status as PlanStatus | undefined;
  return status && PLAN_STATUSES.has(status) ? status : "draft";
}

function serializePlan(fields: { id: string; status: PlanStatus; createdAt: string; updatedAt: string; sourceSession: string }, body: string): string {
  return [
    "---",
    `id: ${quoteYaml(fields.id)}`,
    `status: ${fields.status}`,
    `createdAt: ${quoteYaml(fields.createdAt)}`,
    `updatedAt: ${quoteYaml(fields.updatedAt)}`,
    `sourceSession: ${quoteYaml(fields.sourceSession)}`,
    "---",
    "",
    body.trimEnd(),
    "",
  ].join("\n");
}

function canonicalPlanDir(cwd: string): string {
  return resolve(cwd, PLAN_DIR);
}

function ensurePlanDir(cwd: string): string {
  const dir = canonicalPlanDir(cwd);
  assertPlanRootSafe(cwd);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function assertPlanRootSafe(cwd: string): void {
  let current = resolve(cwd);
  for (const segment of [".pai", "plan"]) {
    current = join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(".pai/plan cannot be a symbolic link");
  }
}

function assertPlanPath(cwd: string, path: string): string {
  assertPlanRootSafe(cwd);
  const dir = canonicalPlanDir(cwd);
  const resolved = resolve(dir, path);
  const prefix = `${dir}${sep}`;
  if (resolved !== dir && !resolved.startsWith(prefix)) throw new Error("Plan path must stay inside .pai/plan");
  if (!resolved.endsWith(".md")) throw new Error("Plan files must use the .md extension");
  if (existsSync(resolved) && lstatSync(resolved).isSymbolicLink()) throw new Error("Plan files cannot be symbolic links");
  return resolved;
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, "utf8");
    renameSync(temporary, path);
  } finally {
    try { if (existsSync(temporary)) unlinkSync(temporary); } catch { /* best effort */ }
  }
}

function readModes(path: string): ModesDocument {
  if (!existsSync(path)) return { version: 1, sessions: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ModesDocument>;
    if (!parsed || parsed.version !== 1 || !parsed.sessions || typeof parsed.sessions !== "object") {
      return { version: 1, sessions: {} };
    }
    return { version: 1, sessions: parsed.sessions as Record<string, StoredMode> };
  } catch {
    return { version: 1, sessions: {} };
  }
}

export function defaultModeState(modelKey: string | undefined, thinkingLevel: ThinkingLevel): SessionModeState {
  const profile = { modelKey, thinkingLevel };
  return { mode: "execute", executeProfile: { ...profile }, planProfile: { ...profile } };
}

export class PlanModeStore {
  private readonly cwd: string;
  private readonly modesPath: string;

  constructor(cwd: string) {
    this.cwd = resolve(cwd);
    this.modesPath = join(this.cwd, MODES_FILE);
  }

  getMode(sessionKey: string, fallback: SessionModeState): SessionModeState {
    const stored = readModes(this.modesPath).sessions[sessionKey];
    return stored ? { ...fallback, ...stored, planProfile: { ...fallback.planProfile, ...stored.planProfile }, executeProfile: { ...fallback.executeProfile, ...stored.executeProfile } } : fallback;
  }

  /**
   * Session mode must follow Pi's stable session id, never a renderer tab key.
   * The fallback scan imports records written by the first Plan-mode MVP, which
   * used ephemeral `tmp:*` tab keys but did persist the plan's sourceSession.
   */
  getModeForSession(sessionId: string, fallback: SessionModeState): SessionModeState {
    const sessions = readModes(this.modesPath).sessions;
    const stored = sessions[sessionId] ?? Object.values(sessions).find(
      (state) => state.activePlan?.sourceSession === sessionId,
    );
    return stored
      ? {
          ...fallback,
          ...stored,
          planProfile: { ...fallback.planProfile, ...stored.planProfile },
          executeProfile: { ...fallback.executeProfile, ...stored.executeProfile },
        }
      : fallback;
  }

  hasMode(sessionKey: string): boolean {
    return Boolean(readModes(this.modesPath).sessions[sessionKey]);
  }

  hasLegacyModeForSession(sessionId: string): boolean {
    return Object.entries(readModes(this.modesPath).sessions).some(
      ([key, state]) => key !== sessionId && state.activePlan?.sourceSession === sessionId,
    );
  }

  setMode(sessionKey: string, mode: SessionModeState): void {
    const document = readModes(this.modesPath);
    document.sessions[sessionKey] = mode;
    atomicWrite(this.modesPath, `${JSON.stringify(document, null, 2)}\n`);
  }

  listPlans(sourceSession?: string): PlanArtifactSummary[] {
    assertPlanRootSafe(this.cwd);
    const dir = canonicalPlanDir(this.cwd);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .map((name) => this.readSummary(name))
      .filter((plan) => !sourceSession || plan.sourceSession === sourceSession)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  readPlan(id: string, sourceSession?: string): PlanReadResult {
    const summary = this.listPlans(sourceSession).find((plan) => plan.id === id || relative(canonicalPlanDir(this.cwd), plan.path) === id);
    if (!summary) throw new Error(`Plan not found: ${id}`);
    const content = readFileSync(summary.path, "utf8");
    if (Buffer.byteLength(content, "utf8") > MAX_PLAN_SIZE) throw new Error("Plan is too large to load");
    return { summary: { ...summary, revision: hash(content) }, content };
  }

  savePlan(input: { title: string; content: string; status?: PlanStatus; planId?: string; sourceSession: string }): PlanReadResult {
    ensurePlanDir(this.cwd);
    if (Buffer.byteLength(input.content, "utf8") > MAX_PLAN_SIZE) throw new Error("Plan is too large");
    const existing = input.planId ? this.readPlan(input.planId, input.sourceSession) : undefined;
    const id = existing?.summary.id ?? `plan_${randomUUID().replaceAll("-", "")}`;
    let filename = existing ? relative(canonicalPlanDir(this.cwd), existing.summary.path) : `${new Date().toISOString().replace(/[:.]/g, "-")}-${slugify(input.title)}.md`;
    if (!existing) {
      const base = filename.replace(/\.md$/, "");
      let suffix = 1;
      while (existsSync(assertPlanPath(this.cwd, filename))) {
        suffix += 1;
        filename = `${base}-${suffix}.md`;
      }
    }
    const path = assertPlanPath(this.cwd, filename);
    const parsed = existing ? parseFrontMatter(input.content) : { fields: {}, body: input.content };
    const now = isoNow();
    const content = serializePlan({
      id,
      status: input.status ?? statusFromFields(parsed.fields),
      createdAt: existing?.summary.updatedAt ?? now,
      updatedAt: now,
      sourceSession: input.sourceSession,
    }, parsed.body || `# ${input.title}\n\n## Goal\n\n## Current understanding\n\n## Decisions and trade-offs\n\n## Implementation steps\n\n## Verification\n\n## Risks / open questions\n\n## Execution handoff\n`);
    atomicWrite(path, content);
    return { summary: this.readSummary(filename), content };
  }

  updatePlan(id: string, content: string, revision: string, sourceSession?: string): PlanArtifactSummary {
    const current = this.readPlan(id, sourceSession);
    if (current.summary.revision !== revision) throw new Error("Plan changed since it was opened; reload it before saving");
    const parsed = parseFrontMatter(content);
    const status = statusFromFields(parsed.fields);
    const owner = sourceSession ?? current.summary.sourceSession ?? parsed.fields.sourceSession ?? "user";
    const saved = this.savePlan({ title: current.summary.title, content: parsed.body, status, planId: current.summary.id, sourceSession: owner });
    return saved.summary;
  }

  setPlanStatus(id: string, status: PlanStatus, sourceSession?: string): PlanArtifactSummary {
    const current = this.readPlan(id, sourceSession);
    const parsed = parseFrontMatter(current.content);
    const content = serializePlan({
      id: current.summary.id,
      status,
      createdAt: parsed.fields.createdAt || current.summary.updatedAt,
      updatedAt: isoNow(),
      sourceSession: sourceSession ?? parsed.fields.sourceSession ?? "unknown",
    }, parsed.body);
    const path = assertPlanPath(this.cwd, relative(canonicalPlanDir(this.cwd), current.summary.path));
    atomicWrite(path, content);
    return this.readSummary(relative(canonicalPlanDir(this.cwd), path));
  }

  private readSummary(filename: string): PlanArtifactSummary {
    const path = assertPlanPath(this.cwd, filename);
    const content = readFileSync(path, "utf8");
    const parsed = parseFrontMatter(content);
    const stat = statSync(path);
    return {
      id: parsed.fields.id || filename.replace(/\.md$/, ""),
      path,
      title: titleFromBody(parsed.body, filename.replace(/\.md$/, "")),
      status: statusFromFields(parsed.fields),
      updatedAt: parsed.fields.updatedAt || stat.mtime.toISOString(),
      revision: hash(content),
      ...(parsed.fields.sourceSession ? { sourceSession: parsed.fields.sourceSession } : {}),
    };
  }
}
