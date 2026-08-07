import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { ProjectSummary } from "../../shared/protocol.js";

interface ProjectStore {
  projects: ProjectSummary[];
  activeProjectId?: string;
}

let catalogFilePath: string | undefined;

/** Prefer Electron userData; fall back to ~/.pi-desk. */
export function setProjectCatalogPath(path: string): void {
  catalogFilePath = path;
}

function storePath(): string {
  return catalogFilePath ?? join(homedir(), ".pi-desk", "projects.json");
}

function emptyStore(): ProjectStore {
  return { projects: [] };
}

export function loadProjectStore(): ProjectStore {
  const path = storePath();
  try {
    if (!existsSync(path)) return emptyStore();
    const raw = JSON.parse(readFileSync(path, "utf8")) as ProjectStore;
    let migrated = false;
    const projects = Array.isArray(raw.projects)
      ? raw.projects.map((project) => {
          if (project.projectUid) return project;
          migrated = true;
          return { ...project, projectUid: randomUUID() };
        })
      : [];
    const store = {
      projects,
      activeProjectId: typeof raw.activeProjectId === "string" ? raw.activeProjectId : undefined,
    };
    if (migrated) saveProjectStore(store);
    return {
      projects: store.projects,
      activeProjectId: store.activeProjectId,
    };
  } catch {
    return emptyStore();
  }
}

export function saveProjectStore(store: ProjectStore): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2), "utf8");
}

export function projectIdFromPath(projectPath: string): string {
  // Normalize trailing slashes so the same folder isn't added twice.
  return projectPath.replace(/\/+$/, "") || projectPath;
}

export function toProjectSummary(projectPath: string, now = new Date().toISOString()): ProjectSummary {
  const path = projectIdFromPath(projectPath);
  return {
    id: path,
    name: basename(path) || path,
    path,
    updatedAt: now,
    projectUid: randomUUID(),
  };
}

export function listProjects(): ProjectSummary[] {
  const store = loadProjectStore();
  return [...store.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getActiveProjectId(): string | undefined {
  return loadProjectStore().activeProjectId;
}

export function addProject(projectPath: string): ProjectSummary {
  const store = loadProjectStore();
  const now = new Date().toISOString();
  const id = projectIdFromPath(projectPath);
  const existing = store.projects.find((project) => project.id === id);
  if (existing) {
    existing.path = id;
    existing.name = basename(id) || id;
    existing.projectUid ??= randomUUID();
    store.activeProjectId = id;
    saveProjectStore(store);
    return existing;
  }
  const project = toProjectSummary(id, now);
  store.projects.unshift(project);
  store.activeProjectId = id;
  saveProjectStore(store);
  return project;
}

export function setActiveProject(projectId: string): ProjectSummary | undefined {
  const store = loadProjectStore();
  const id = projectIdFromPath(projectId);
  const project = store.projects.find((item) => item.id === id);
  if (!project) return undefined;
  store.activeProjectId = id;
  saveProjectStore(store);
  return project;
}

// Bump a project's updatedAt so it surfaces to the top of the list.
// Called only when a message is actually sent (prompt / steer / followUp).
export function touchProject(projectId: string): void {
  const store = loadProjectStore();
  const id = projectIdFromPath(projectId);
  const project = store.projects.find((item) => item.id === id);
  if (!project) return;
  project.updatedAt = new Date().toISOString();
  saveProjectStore(store);
}

export function removeProject(projectId: string): void {
  const store = loadProjectStore();
  const id = projectIdFromPath(projectId);
  store.projects = store.projects.filter((project) => project.id !== id);
  if (store.activeProjectId === id) {
    store.activeProjectId = store.projects[0]?.id;
  }
  saveProjectStore(store);
}
