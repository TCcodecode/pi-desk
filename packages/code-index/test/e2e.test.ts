import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodeIndex } from "../src/index.js";

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "code-index-e2e-"));
}

async function createFixtureFiles(projectRoot: string): Promise<void> {
  await writeFile(
    join(projectRoot, "auth.ts"),
    `export class TokenManager {
  private token: string = "";

  refresh(): string {
    this.token = "new-token-" + Date.now();
    return this.token;
  }

  validate(): boolean {
    return this.token.length > 0;
  }
}
`,
  );

  await writeFile(
    join(projectRoot, "utils.ts"),
    `export function generateId(): string {
  return Math.random().toString(36).substring(2);
}
`,
  );

  await writeFile(
    join(projectRoot, "main.ts"),
    `import { TokenManager } from "./auth";
import { generateId } from "./utils";

export function bootstrap(): string {
  const manager = new TokenManager();
  return manager.refresh() + "-" + generateId();
}
`,
  );
}

async function setupProject(
  containerDir: string,
): Promise<{ projectRoot: string; dbPath: string }> {
  const projectRoot = join(containerDir, "project");
  await mkdir(projectRoot, { recursive: true });
  await createFixtureFiles(projectRoot);
  const dbPath = join(containerDir, "index.db");
  return { projectRoot, dbPath };
}

describe("createCodeIndex e2e", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function useTempDir(): Promise<string> {
    const dir = await createTempDir();
    tmpDirs.push(dir);
    return dir;
  }

  it("indexes a fixture project and finds symbols via search", async () => {
    const dir = await useTempDir();
    const { projectRoot, dbPath } = await setupProject(dir);

    const idx = createCodeIndex({ dbPath });

    const stats = await idx.index(projectRoot);

    expect(stats.filesIndexed).toBe(3);
    expect(stats.symbolsIndexed).toBeGreaterThanOrEqual(5);
    expect(stats.filesChanged).toBe(3);
    expect(stats.durationMs).toBeGreaterThan(0);

    const tokenHits = await idx.searchSymbols("TokenManager");
    expect(tokenHits.length).toBe(1);
    expect(tokenHits[0]).toMatchObject({
      name: "TokenManager",
      kind: "class",
      file: "auth.ts",
    });
    expect(tokenHits[0].line).toBeGreaterThan(0);

    const refreshHits = await idx.searchSymbols("refresh");
    expect(refreshHits.length).toBe(1);
    expect(refreshHits[0]).toMatchObject({
      name: "refresh",
      kind: "method",
      file: "auth.ts",
    });

    const bootstrapHits = await idx.searchSymbols("bootstrap");
    expect(bootstrapHits.length).toBe(1);
    expect(bootstrapHits[0]).toMatchObject({
      name: "bootstrap",
      kind: "function",
      file: "main.ts",
    });

    const unknown = await idx.searchSymbols("nonexistent_xyz");
    expect(unknown).toEqual([]);

    idx.dispose();
  });

  it("incrementally re-indexes only changed files", async () => {
    const dir = await useTempDir();
    const { projectRoot, dbPath } = await setupProject(dir);

    const idx = createCodeIndex({ dbPath });

    await idx.index(projectRoot);

    await writeFile(
      join(projectRoot, "auth.ts"),
      `export class TokenManager {
  private token: string = "";

  refresh(): string {
    this.token = "new-token-" + Date.now();
    return this.token;
  }

  validate(): boolean {
    return this.token.length > 0;
  }

  revoke(): void {
    this.token = "";
  }
}
`,
    );

    const stats2 = await idx.index(projectRoot);

    expect(stats2.filesChanged).toBe(1);
    expect(stats2.filesIndexed).toBe(3);

    const revokeHits = await idx.searchSymbols("revoke");
    expect(revokeHits.length).toBe(1);
    expect(revokeHits[0]).toMatchObject({
      name: "revoke",
      kind: "method",
      file: "auth.ts",
    });

    const tokenHits = await idx.searchSymbols("TokenManager");
    expect(tokenHits.length).toBe(1);

    const refreshHits = await idx.searchSymbols("refresh");
    expect(refreshHits.length).toBe(1);

    idx.dispose();
  });

  it("detects and removes deleted files on subsequent index", async () => {
    const dir = await useTempDir();
    const projectRoot = join(dir, "project");
    await mkdir(projectRoot, { recursive: true });

    await writeFile(
      join(projectRoot, "alpha.ts"),
      "export function alpha(): string { return 'a'; }\n",
    );
    await writeFile(
      join(projectRoot, "beta.ts"),
      "export function beta(): string { return 'b'; }\n",
    );

    const idx = createCodeIndex({ dbPath: join(dir, "index.db") });

    const stats1 = await idx.index(projectRoot);
    expect(stats1.filesIndexed).toBe(2);
    expect(stats1.symbolsIndexed).toBe(2);
    expect(stats1.filesChanged).toBe(2);
    expect(stats1.filesDeleted).toBe(0);

    const alphaHits = await idx.searchSymbols("alpha");
    expect(alphaHits.length).toBe(1);

    await rm(join(projectRoot, "alpha.ts"));

    const stats2 = await idx.index(projectRoot);

    expect(stats2.filesDeleted).toBe(1);
    expect(stats2.filesChanged).toBe(0);
    expect(stats2.filesIndexed).toBe(1);
    expect(stats2.symbolsIndexed).toBe(1);

    const deletedHits = await idx.searchSymbols("alpha");
    expect(deletedHits).toEqual([]);

    const betaHits = await idx.searchSymbols("beta");
    expect(betaHits.length).toBe(1);

    idx.dispose();
  });

  it("reports 'ready' status after indexing", async () => {
    const dir = await useTempDir();
    const { projectRoot, dbPath } = await setupProject(dir);

    const idx = createCodeIndex({ dbPath });

    const statusBefore = idx.getStatus();
    expect(statusBefore.state).toBe("idle");
    expect(statusBefore.filesIndexed).toBe(0);

    await idx.index(projectRoot);
    const statusAfter = idx.getStatus();
    expect(statusAfter.state).toBe("ready");
    expect(statusAfter.filesIndexed).toBe(3);
    expect(statusAfter.symbolsIndexed).toBeGreaterThan(0);
    expect(statusAfter.lastIndexedAt).toBeTruthy();
    expect(statusAfter.error).toBeUndefined();

    idx.dispose();
  });

  it("persists data to disk and survives dispose + recreate", async () => {
    const dir = await useTempDir();
    const { projectRoot, dbPath } = await setupProject(dir);

    const idx1 = createCodeIndex({ dbPath });
    await idx1.index(projectRoot);
    idx1.dispose();

    const idx2 = createCodeIndex({ dbPath });
    const status = idx2.getStatus();
    expect(status.state).toBe("idle");

    const hits = await idx2.searchSymbols("TokenManager");
    expect(hits.length).toBe(1);
    expect(hits[0].name).toBe("TokenManager");

    const stats = await idx2.index(projectRoot);
    expect(stats.filesChanged).toBe(0);

    idx2.dispose();
  });

  it("handles an empty project directory", async () => {
    const dir = await useTempDir();
    const projectRoot = join(dir, "project");
    await mkdir(projectRoot, { recursive: true });

    const idx = createCodeIndex({ dbPath: join(dir, "index.db") });
    const stats = await idx.index(projectRoot);

    expect(stats.filesIndexed).toBe(0);
    expect(stats.symbolsIndexed).toBe(0);
    expect(stats.filesChanged).toBe(0);
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);

    const hits = await idx.searchSymbols("anything");
    expect(hits).toEqual([]);

    idx.dispose();
  });

  it("handles files with no extractable symbols", async () => {
    const dir = await useTempDir();
    const projectRoot = join(dir, "project");
    await mkdir(projectRoot, { recursive: true });

    await writeFile(join(projectRoot, "config.json"), JSON.stringify({ key: "val" }));
    await writeFile(
      join(projectRoot, "empty.ts"),
      "// just a comment, no declarations\n",
    );

    const idx = createCodeIndex({ dbPath: join(dir, "index.db") });
    const stats = await idx.index(projectRoot);

    expect(stats.filesIndexed).toBe(2);
    expect(stats.symbolsIndexed).toBe(0);
    expect(stats.filesChanged).toBe(2);

    idx.dispose();
  });

  it("transitions to error state when indexing a nonexistent directory", async () => {
    const dir = await useTempDir();
    const nonexistentDir = join(dir, "does-not-exist");

    const idx = createCodeIndex({ dbPath: join(dir, "index.db") });

    await expect(idx.index(nonexistentDir)).rejects.toThrow();

    const status = idx.getStatus();
    expect(status.state).toBe("error");
    expect(status.error).toBeTruthy();
    expect(status.error!.length).toBeGreaterThan(0);

    idx.dispose();
  });

  it("findUsages returns import edge for symbol imported by another file", async () => {
    const dir = await useTempDir();
    const projectRoot = join(dir, "project");
    await mkdir(projectRoot, { recursive: true });

    await writeFile(
      join(projectRoot, "lib.ts"),
      `export class TokenManager {
  issue(): string { return "token"; }
}
`,
    );
    await writeFile(
      join(projectRoot, "app.ts"),
      `import { TokenManager } from "./lib";

export function start(): void {
  const tm = new TokenManager();
  tm.issue();
}
`,
    );

    const idx = createCodeIndex({ dbPath: join(dir, "index.db") });
    await idx.index(projectRoot);

    // Verify symbols were indexed
    const hits = await idx.searchSymbols("TokenManager");
    expect(hits.length).toBeGreaterThanOrEqual(1);

    const usages = await idx.findUsages("TokenManager");
    expect(usages.length).toBe(1);
    expect(usages[0]).toMatchObject({
      edgeKind: "import",
    });
    // The usage should come from app.ts (the importing file)
    expect(usages[0].file).toBe("app.ts");

    idx.dispose();
  });

  it("findUsages returns empty for symbol with no importers", async () => {
    const dir = await useTempDir();
    const projectRoot = join(dir, "project");
    await mkdir(projectRoot, { recursive: true });

    await writeFile(
      join(projectRoot, "lonely.ts"),
      `export class UnusedClass {
  doSomething(): void {}
}
`,
    );

    const idx = createCodeIndex({ dbPath: join(dir, "index.db") });
    await idx.index(projectRoot);

    const usages = await idx.findUsages("UnusedClass");
    expect(usages).toEqual([]);

    idx.dispose();
  });

  it("import edges survive incremental re-index of the importee file", async () => {
    const dir = await useTempDir();
    const projectRoot = join(dir, "project");
    await mkdir(projectRoot, { recursive: true });

    await writeFile(
      join(projectRoot, "db.ts"),
      `export class Database {
  connect(): void {}
  query(): string { return "result"; }
}
`,
    );
    await writeFile(
      join(projectRoot, "service.ts"),
      `import { Database } from "./db";

export class Service {
  private db = new Database();

  run(): string {
    return this.db.query();
  }
}
`,
    );

    const idx = createCodeIndex({ dbPath: join(dir, "index.db") });

    await idx.index(projectRoot);

    const usagesBefore = await idx.findUsages("Database");
    expect(usagesBefore.length).toBe(1);
    expect(usagesBefore[0]).toMatchObject({
      edgeKind: "import",
      file: "service.ts",
    });

    await writeFile(
      join(projectRoot, "db.ts"),
      `export class Database {
  connect(): void {}
  query(): string { return "result"; }
  disconnect(): void {}
}
`,
    );

    const stats = await idx.index(projectRoot);
    expect(stats.filesChanged).toBe(1);

    const usagesAfter = await idx.findUsages("Database");
    expect(usagesAfter.length).toBe(1);
    expect(usagesAfter[0]).toMatchObject({
      edgeKind: "import",
      file: "service.ts",
    });

    idx.dispose();
  });
});
