import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let agentDir = "";

describe("projectCatalog", () => {
  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-projects-"));
    vi.resetModules();
  });

  afterEach(() => {
    if (agentDir) rmSync(agentDir, { recursive: true, force: true });
    agentDir = "";
  });

  test("adds projects and remembers the active one", async () => {
    const catalog = await import("./projectCatalog.js");
    catalog.setProjectCatalogPath(join(agentDir, "projects.json"));

    const first = catalog.addProject("/tmp/alpha-app/");
    expect(first.name).toBe("alpha-app");
    expect(first.id).toBe("/tmp/alpha-app");
    expect(catalog.getActiveProjectId()).toBe("/tmp/alpha-app");

    const second = catalog.addProject("/tmp/beta-app");
    expect(second.name).toBe("beta-app");
    expect(catalog.listProjects().map((project) => project.name)).toEqual(["beta-app", "alpha-app"]);

    catalog.setActiveProject("/tmp/alpha-app");
    expect(catalog.getActiveProjectId()).toBe("/tmp/alpha-app");
  });

  test("re-adding an existing project does NOT reorder it", async () => {
    const catalog = await import("./projectCatalog.js");
    catalog.setProjectCatalogPath(join(agentDir, "projects.json"));

    catalog.addProject("/tmp/alpha-app");
    catalog.addProject("/tmp/beta-app");
    // beta-app was added last, so it's at the top.
    expect(catalog.listProjects().map((project) => project.name)).toEqual(["beta-app", "alpha-app"]);

    // Re-add alpha-app — must NOT bump it to the top.
    catalog.addProject("/tmp/alpha-app");
    expect(catalog.listProjects().map((project) => project.name)).toEqual(["beta-app", "alpha-app"]);

    // setActiveProject must NOT reorder either.
    catalog.setActiveProject("/tmp/alpha-app");
    expect(catalog.listProjects().map((project) => project.name)).toEqual(["beta-app", "alpha-app"]);
  });

  test("touchProject moves an existing project to the top", async () => {
    const catalog = await import("./projectCatalog.js");
    catalog.setProjectCatalogPath(join(agentDir, "projects.json"));

    catalog.addProject("/tmp/alpha-app");
    catalog.addProject("/tmp/beta-app");
    catalog.addProject("/tmp/gamma-app");
    expect(catalog.listProjects().map((project) => project.name)).toEqual(["gamma-app", "beta-app", "alpha-app"]);

    // Ensure a distinct timestamp so the bump is visible in sort order.
    await new Promise((r) => setTimeout(r, 5));
    catalog.touchProject("/tmp/alpha-app");
    expect(catalog.listProjects().map((project) => project.name)).toEqual(["alpha-app", "gamma-app", "beta-app"]);
  });

  test("removeProject drops catalog entry and reassigns active", async () => {
    const catalog = await import("./projectCatalog.js");
    catalog.setProjectCatalogPath(join(agentDir, "projects.json"));

    catalog.addProject("/tmp/alpha-app");
    catalog.addProject("/tmp/beta-app");
    expect(catalog.getActiveProjectId()).toBe("/tmp/beta-app");

    catalog.removeProject("/tmp/beta-app");
    expect(catalog.listProjects().map((project) => project.name)).toEqual(["alpha-app"]);
    expect(catalog.getActiveProjectId()).toBe("/tmp/alpha-app");
  });
});
