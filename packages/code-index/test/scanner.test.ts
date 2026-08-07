import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scanProject } from "../src/scanner.js";

const execFileAsync = promisify(execFile);

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "code-index-test-"));
}

async function createFile(dir: string, relPath: string, content = ""): Promise<void> {
  const fullPath = join(dir, relPath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, content);
}

describe("scanProject", () => {
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

  it("returns files in a non-git directory, excluding build artifacts", async () => {
    const dir = await useTempDir();
    await createFile(dir, "src/index.ts");
    await createFile(dir, "src/utils.ts");
    await createFile(dir, "package.json");
    await createFile(dir, "node_modules/.package-lock.json");
    await createFile(dir, ".git/config");
    await createFile(dir, "dist/bundle.js");

    const result = await scanProject(dir);

    expect(result.files).toContain("src/index.ts");
    expect(result.files).toContain("src/utils.ts");
    expect(result.files).toContain("package.json");
    expect(result.files).not.toContain("node_modules/.package-lock.json");
    expect(result.files).not.toContain(".git/config");
    expect(result.files).not.toContain("dist/bundle.js");
  });

  it("excludes common build artifact directories", async () => {
    const dir = await useTempDir();
    const artifactDirs = [
      "node_modules",
      ".git",
      "dist",
      "build",
      "out",
      ".next",
      ".cache",
      ".venv",
      "venv",
      "target",
      "coverage",
      ".code-index",
    ];

    await createFile(dir, "real-file.txt");
    for (const ad of artifactDirs) {
      await createFile(dir, `${ad}/some-file.txt`);
    }

    const result = await scanProject(dir);

    expect(result.files).toEqual(["real-file.txt"]);
  });

  it("excludes .code-index database files in walk mode", async () => {
    const dir = await useTempDir();
    await createFile(dir, "src/main.ts");
    await createFile(dir, ".code-index/index.db");
    await createFile(dir, ".code-index/index.db-wal");
    await createFile(dir, ".code-index/index.db-shm");

    const result = await scanProject(dir);

    expect(result.files).toEqual(["src/main.ts"]);
  });

  it("respects .gitignore rules", async () => {
    const dir = await useTempDir();
    await createFile(dir, ".gitignore", "*.log\n/tmp\n# comment\n");
    await createFile(dir, "src/index.ts");
    await createFile(dir, "debug.log");
    await createFile(dir, "error.log");
    await createFile(dir, "tmp/cache.dat");

    const result = await scanProject(dir);

    expect(result.files).toContain("src/index.ts");
    expect(result.files).toContain(".gitignore");
    expect(result.files).not.toContain("debug.log");
    expect(result.files).not.toContain("error.log");
    expect(result.files).not.toContain("tmp/cache.dat");
  });

  it("returns relative paths without leading ./ or absolute paths", async () => {
    const dir = await useTempDir();
    await createFile(dir, "README.md");

    const result = await scanProject(dir);

    expect(result.files).toHaveLength(1);
    const file = result.files[0];
    expect(file).not.toMatch(/^\.\//);
    expect(file).not.toBe(dir);
    expect(file).not.toMatch(new RegExp(`^${dir}`));
    expect(file).toBe("README.md");
  });

  it("uses forward slashes on all platforms", async () => {
    const dir = await useTempDir();
    await createFile(dir, "src/nested/deep/file.ts");

    const result = await scanProject(dir);

    expect(result.files).toContain("src/nested/deep/file.ts");
    const file = result.files[0];
    expect(file).not.toContain("\\");
    expect(file).toContain("/");
  });

  it("returns empty list for an empty directory", async () => {
    const dir = await useTempDir();

    const result = await scanProject(dir);

    expect(result.files).toEqual([]);
  });

  it("handles deeply nested files", async () => {
    const dir = await useTempDir();
    await createFile(dir, "a/b/c/d/e/f/g/h/i/j/deep.ts");

    const result = await scanProject(dir);

    expect(result.files).toEqual(["a/b/c/d/e/f/g/h/i/j/deep.ts"]);
  });

  it("handles .gitignore with negation patterns", async () => {
    const dir = await useTempDir();
    await createFile(dir, ".gitignore", "*.log\n!keep.log\n");
    await createFile(dir, "debug.log");
    await createFile(dir, "keep.log");

    const result = await scanProject(dir);

    expect(result.files).toContain("keep.log");
    expect(result.files).not.toContain("debug.log");
  });

  it("respects nested .gitignore files in subdirectories", async () => {
    const dir = await useTempDir();
    await createFile(dir, ".gitignore", "*.tmp\n");
    await createFile(dir, "root.tmp");
    await createFile(dir, "src/main.ts");
    await createFile(dir, "src/temp.tmp");
    await createFile(dir, "sub/.gitignore", "*.log\n");
    await createFile(dir, "sub/data.ts");
    await createFile(dir, "sub/debug.log");

    const result = await scanProject(dir);

    expect(result.files).toContain("src/main.ts");
    expect(result.files).toContain("sub/data.ts");
    expect(result.files).not.toContain("root.tmp");
    expect(result.files).not.toContain("src/temp.tmp");
    expect(result.files).not.toContain("sub/debug.log");
  });

  it("respects deeply nested .gitignore files", async () => {
    const dir = await useTempDir();
    await createFile(dir, "a/b/.gitignore", "secret.txt\n");
    await createFile(dir, "a/b/c/d/.gitignore", "build/\n");
    await createFile(dir, "a/b/data.ts");
    await createFile(dir, "a/b/secret.txt");
    await createFile(dir, "a/b/c/d/source.ts");
    await createFile(dir, "a/b/c/d/build/output.js");

    const result = await scanProject(dir);

    expect(result.files).toContain("a/b/data.ts");
    expect(result.files).toContain("a/b/c/d/source.ts");
    expect(result.files).not.toContain("a/b/secret.txt");
    expect(result.files).not.toContain("a/b/c/d/build/output.js");
  });
});

describe("scanProject with git", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function useGitTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "code-index-git-"));
    tmpDirs.push(dir);
    await execFileAsync("git", ["init"], { cwd: dir });
    await execFileAsync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
    return dir;
  }

  async function createFile(dir: string, relPath: string, content = ""): Promise<void> {
    const fullPath = join(dir, relPath);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content);
  }

  async function gitAdd(dir: string, paths: string[]): Promise<void> {
    await execFileAsync("git", ["add", ...paths], { cwd: dir });
  }

  it("returns tracked and untracked non-ignored files via git ls-files", async () => {
    const dir = await useGitTempDir();

    await createFile(dir, "src/index.ts", "export {}");
    await createFile(dir, "src/utils.ts", "export {}");
    await createFile(dir, ".gitignore", "*.log\nnode_modules/\n");
    await createFile(dir, "debug.log");
    await createFile(dir, "node_modules/pkg/index.js", "");
    await createFile(dir, "README.md");

    await gitAdd(dir, ["src/index.ts", "src/utils.ts", ".gitignore", "README.md"]);

    const result = await scanProject(dir);

    expect(result.files).toContain("src/index.ts");
    expect(result.files).toContain("src/utils.ts");
    expect(result.files).toContain(".gitignore");
    expect(result.files).toContain("README.md");
    expect(result.files).not.toContain("debug.log");
    expect(result.files).not.toContain("node_modules/pkg/index.js");
  });

  it("includes untracked files that are not gitignored", async () => {
    const dir = await useGitTempDir();

    await createFile(dir, "tracked.ts", "export {}");
    await createFile(dir, "untracked.ts", "export {}");
    await createFile(dir, ".gitignore", "*.log\n");
    await createFile(dir, "error.log");

    await gitAdd(dir, ["tracked.ts", ".gitignore"]);

    const result = await scanProject(dir);

    expect(result.files).toContain("tracked.ts");
    expect(result.files).toContain("untracked.ts");
    expect(result.files).not.toContain("error.log");
  });

  it("excludes node_modules even without .gitignore entry", async () => {
    const dir = await useGitTempDir();

    await createFile(dir, "main.ts", "export {}");
    await createFile(dir, "node_modules/pkg/index.js", "");
    await createFile(dir, "dist/bundle.js", "");

    await gitAdd(dir, ["main.ts"]);

    const result = await scanProject(dir);

    expect(result.files).toContain("main.ts");
    expect(result.files).not.toContain("node_modules/pkg/index.js");
    expect(result.files).not.toContain("dist/bundle.js");
  });
});
