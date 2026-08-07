import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ProjectSummary } from "../../shared/protocol.js";

describe("HttpWorkbenchStore", () => {
  let appData = "";
  const project: ProjectSummary = {
    id: "/tmp/demo-project",
    name: "demo-project",
    path: "/tmp/demo-project",
    updatedAt: new Date().toISOString(),
    projectUid: "project-uid-demo",
  };

  beforeEach(async () => {
    appData = mkdtempSync(join(tmpdir(), "pi-http-workbench-"));
    vi.resetModules();
    const module = await import("./store.js");
    module.setHttpWorkbenchUserDataPath(appData);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (appData) rmSync(appData, { recursive: true, force: true });
    appData = "";
  });

  test("keeps project test assets under application data and nests environments", async () => {
    const { HttpWorkbenchStore } = await import("./store.js");
    const store = new HttpWorkbenchStore(() => [project]);

    await store.createFolder(project.id, "", "debug-login");
    const created = await store.createFile(project.id, "debug-login", "login");
    await store.createEnvironment(project.id, "staging");

    expect(existsSync(join(project.path, "debug-login"))).toBe(false);
    expect(readFileSync(join(appData, "http-workbench", "projects", project.projectUid!, "debug-login", "login.http"), "utf8")).toContain("GET");
    const environment = await store.workspace(project.id);
    expect(environment.environments.map((item) => item.name)).toEqual(["staging"]);
    expect(environment.tree.some((node) => node.name === "Environments" && node.kind === "folder")).toBe(true);
    expect(created.path).toBe("debug-login/login.http");
  });

  test("stores one response artifact per request and exposes it below Run History", async () => {
    const { HttpWorkbenchStore } = await import("./store.js");
    const store = new HttpWorkbenchStore(() => [project]);
    await store.createFolder(project.id, "", "debug-login");
    await store.createEnvironment(project.id, "local");
    await store.createFile(project.id, "debug-login", "login");
    await store.saveFile(project.id, "debug-login/login.http", "### Login\nGET {{baseUrl}}/health\n# expect-status: 200\n\n");

    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } })));
    const run = await store.run(project.id, "debug-login/login.http", "local");
    expect(run.status).toBe("passed");
    expect(run.environment).toBe("local");
    expect(run.requests[0]?.status).toBe(200);
    expect(run.requests[0]?.requestLine).toBe(2);
    expect(run.requests[0]?.responseFileName).toMatch(/\.200\.json$/);

    const runs = await store.listRuns(project.id, "debug-login/login.http");
    expect(runs).toHaveLength(1);
    expect((await store.readRun(project.id, "debug-login/login.http", run.id)).id).toBe(run.id);
    const workspace = await store.workspace(project.id);
    const folder = workspace.tree.find((node) => node.name === "debug-login");
    const history = folder?.children?.find((node) => node.kind === "history");
    expect(history?.runCount).toBe(1);
    expect(history?.children?.[0]?.kind).toBe("response");
    const response = await store.readResponse(project.id, "debug-login/login.http", run.id, run.requests[0]!.id);
    expect(response.response).toBe('{"ok":true}');
    expect(readFileSync(join(appData, "http-workbench", "projects", project.projectUid!, "debug-login", "run-history", run.id, run.requests[0]!.responseFileName!), "utf8")).toBe('{"ok":true}');
    const sourcePath = join(appData, "http-workbench", "projects", project.projectUid!, "debug-login", "login.http");
    expect(readFileSync(sourcePath, "utf8")).toContain(`<> ${run.requests[0]!.responseFileName}`);

    const afterResponseDelete = await store.deleteResponse(project.id, "debug-login/login.http", run.id, run.requests[0]!.id);
    const deletedHistoryFolder = afterResponseDelete.tree.find((node) => node.name === "debug-login");
    expect(deletedHistoryFolder?.children?.some((node) => node.kind === "history")).toBe(false);
    expect(readFileSync(sourcePath, "utf8")).not.toContain(`<> ${run.requests[0]!.responseFileName}`);

    const rerun = await store.run(project.id, "debug-login/login.http", "local");

    const afterSingleDelete = await store.deleteRun(project.id, "debug-login/login.http", rerun.id);
    const singleDeleteFolder = afterSingleDelete.tree.find((node) => node.name === "debug-login");
    expect(singleDeleteFolder?.children?.some((node) => node.kind === "history")).toBe(false);
    expect(await store.listRuns(project.id, "debug-login/login.http")).toHaveLength(0);

    const cleared = await store.deleteRunHistory(project.id, "debug-login");
    const clearedFolder = cleared.tree.find((node) => node.name === "debug-login");
    expect(clearedFolder?.children?.some((node) => node.kind === "history")).toBe(false);
    expect(await store.listRuns(project.id, "debug-login")).toHaveLength(0);
  });

  test("rejects paths that could escape the app-owned project space", async () => {
    const { HttpWorkbenchStore } = await import("./store.js");
    const store = new HttpWorkbenchStore(() => [project]);
    await expect(store.createFile(project.id, "../project-source", "bad")).rejects.toThrow(/inside/);
    await expect(store.createFile(project.id, "/absolute", "bad")).rejects.toThrow(/relative/);
    await expect(store.createFile(project.id, "environments", "bad")).rejects.toThrow(/managed/);
  });

  test("supports root actions, normalizes environment names, and rejects empty tests", async () => {
    const { HttpWorkbenchStore } = await import("./store.js");
    const store = new HttpWorkbenchStore(() => [project]);

    const created = await store.createFile(project.id, "", "root-check.http");
    expect(created.path).toBe("root-check.http");
    expect(created.content).toContain("https://example.com");
    await store.createEnvironment(project.id, "local.json");
    expect((await store.workspace(project.id)).environments.map((item) => item.name)).toEqual(["local"]);

    await store.saveFile(project.id, created.path, "### Health\nGET {{baseUrl}}/health\n\n");
    await store.saveEnvironment(project.id, "environments/local.json", '{"baseUrl":"http://localhost:3000"}');
    await expect(store.createFile(project.id, "", "root-check.http")).rejects.toThrow();
    await expect(store.run(project.id, "", "missing")).rejects.toThrow(/Environment not found/);

    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"ok":true}', { status: 200 })));
    const run = await store.run(project.id, "", "local");
    expect(run.scopePath).toBe("");
    expect(run.requestCount).toBe(1);
    expect((await store.readRun(project.id, "", run.id)).id).toBe(run.id);

    await store.saveFile(project.id, created.path, "# no request\n");
    await expect(store.run(project.id, created.path, "local")).rejects.toThrow(/No HTTP requests/);
  });

  test("runs one request by line, normalizes bare hosts, and reports missing variables", async () => {
    const { HttpWorkbenchStore } = await import("./store.js");
    const store = new HttpWorkbenchStore(() => [project]);
    await store.createFile(project.id, "", "requests");
    await store.saveFile(project.id, "requests.http", "### Public\nGET www.baidu.com\n\n### Private\nGET {{missingBaseUrl}}/health\n\n");

    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const single = await store.run(project.id, "requests.http", undefined, 2);
    expect(single.status).toBe("passed");
    expect(single.requestLine).toBe(2);
    expect(single.requestCount).toBe(1);
    expect(single.requests[0]?.url).toBe("https://www.baidu.com");

    const missing = await store.run(project.id, "requests.http", undefined, 6);
    expect(missing.status).toBe("failed");
    expect(missing.requests[0]?.error).toContain("missingBaseUrl");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("keeps the same application-owned space when a project is re-registered", async () => {
    const { HttpWorkbenchStore } = await import("./store.js");
    const store = new HttpWorkbenchStore(() => [project]);
    await store.createFolder(project.id, "", "release-check");
    const first = await store.workspace(project.id);

    const readded = { ...project, projectUid: "a-new-catalog-uid" };
    const rebound = new HttpWorkbenchStore(() => [readded]);
    const second = await rebound.workspace(readded.id);
    expect(second.projectUid).toBe(first.projectUid);
    expect(second.tree.some((node) => node.name === "release-check")).toBe(true);
  });
});
