import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import ignoreFactory from "ignore";

export interface ScanResult {
  files: string[];
}

const BUILD_ARTIFACT_DIRS = new Set([
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
]);

function normalizePath(filePath: string): string {
  return filePath.split(sep).join("/");
}

function isBuildArtifactDir(dirName: string): boolean {
  return BUILD_ARTIFACT_DIRS.has(dirName);
}

function prefixGitignore(content: string, dirPrefix: string): string {
  if (!dirPrefix) return content;

  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;

      const isNegation = trimmed.startsWith("!");
      const pattern = isNegation ? trimmed.slice(1) : trimmed;
      const stripped = pattern.startsWith("/") ? pattern.slice(1) : pattern;

      const body = stripped.endsWith("/") ? stripped.slice(0, -1) : stripped;
      const needsRecursive = !body.includes("/");

      const scoped = needsRecursive
        ? `**/${stripped}`
        : stripped;

      return (isNegation ? "!" : "") + dirPrefix + "/" + scoped;
    })
    .join("\n");
}

function scanViaGit(projectRoot: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd: projectRoot },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        const files = stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .filter((f) => !f.split("/").some((seg) => isBuildArtifactDir(seg)))
          // git ls-files --cached lists the index, which can hold entries that
          // were deleted from the working tree (unstaged deletions). Skip
          // anything that no longer exists on disk.
          .filter((f) => existsSync(join(projectRoot, f)));

        resolve(files);
      },
    );
  });
}

async function scanViaWalk(projectRoot: string): Promise<string[]> {
  const ig = ignoreFactory();

  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name === ".gitignore") {
        const fullPath = join(dir, entry.name);
        const content = await readFile(fullPath, "utf-8");
        const relDir = relative(projectRoot, dir) || "";
        const dirPrefix = normalizePath(relDir);
        ig.add(prefixGitignore(content, dirPrefix));
      }
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (isBuildArtifactDir(entry.name)) continue;
        await walk(fullPath);
      } else if (entry.isFile()) {
        const relPath = relative(projectRoot, fullPath);
        const normalized = normalizePath(relPath);

        if (ig.ignores(normalized)) continue;

        files.push(normalized);
      }
    }
  }

  await walk(projectRoot);

  return files.sort();
}

export async function scanProject(projectRoot: string): Promise<ScanResult> {
  try {
    const files = await scanViaGit(projectRoot);
    return { files: files.sort() };
  } catch {
    const files = await scanViaWalk(projectRoot);
    return { files };
  }
}
