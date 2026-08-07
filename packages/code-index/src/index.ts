import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export { scanProject } from "./scanner.js";
export type { ScanResult } from "./scanner.js";
export { extractSymbols, parseFile } from "./parser.js";
export type { SymbolExtraction, ParsedFile } from "./parser.js";
export { CodeSearch } from "./search.js";
export type { SymbolHit, UsageHit } from "./search.js";

import { scanProject } from "./scanner.js";
import { parseFile } from "./parser.js";
import { CodeStore } from "./store.js";
import { CodeSearch } from "./search.js";
import type { SymbolHit, UsageHit } from "./search.js";

export interface IndexStats {
  filesIndexed: number;
  symbolsIndexed: number;
  filesChanged: number;
  filesDeleted: number;
  durationMs: number;
}

export interface IndexStatus {
  state: "idle" | "indexing" | "ready" | "error";
  filesIndexed: number;
  symbolsIndexed: number;
  lastIndexedAt?: string;
  error?: string;
}

export interface CodeIndex {
  index(projectRoot: string): Promise<IndexStats>;
  searchSymbols(
    query: string,
    opts?: { limit?: number },
  ): Promise<SymbolHit[]>;
  findUsages(
    symbolName: string,
    opts?: { kind?: string },
  ): Promise<UsageHit[]>;
  getStatus(): IndexStatus;
  dispose(): void;
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

async function asyncPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;

  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      await fn(items[i]);
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );

  await Promise.all(runners);
}

class CodeIndexImpl implements CodeIndex {
  private store: CodeStore;
  private search: CodeSearch;
  private status: IndexStatus;

  constructor(dbPath: string) {
    this.store = new CodeStore(dbPath);
    this.search = new CodeSearch(this.store);
    this.status = { state: "idle", filesIndexed: 0, symbolsIndexed: 0 };
    this.store.open();
  }

  async index(projectRoot: string): Promise<IndexStats> {
    const startTime = Date.now();

    this.status = {
      state: "indexing",
      filesIndexed: this.status.filesIndexed,
      symbolsIndexed: this.status.symbolsIndexed,
      lastIndexedAt: this.status.lastIndexedAt,
    };

    try {
      const { files } = await scanProject(projectRoot);

      const storedFileRows = this.store.query<{ path: string }>(
        "SELECT path FROM file_hashes",
      );
      const storedFileSet = new Set(storedFileRows.map((r) => r.path));
      const scanFileSet = new Set(files);

      let filesChanged = 0;
      let filesDeleted = 0;

      for (const path of storedFileSet) {
        if (!scanFileSet.has(path)) {
          filesDeleted++;
          this.store.removeFile(path);
          this.store.removeFileImports(path);
          this.store.clearSymbolsForFile(path);
        }
      }

      await asyncPool(files, 4, async (file: string) => {
        let content: string;
        try {
          content = await readFile(join(projectRoot, file), "utf-8");
        } catch {
          // File vanished between scan and read (or stale scanner entry):
          // drop it instead of failing the whole index.
          filesChanged++;
          this.store.removeFile(file);
          this.store.removeFileImports(file);
          this.store.clearSymbolsForFile(file);
          return;
        }
        try {
          const hash = createHash("sha256").update(content).digest("hex");

          const storedHash = this.store.getFileHash(file);
          if (storedHash === hash) return;

          filesChanged++;
          const parsed = await parseFile(file, content);
          this.store.clearSymbolsForFile(file);
          if (parsed.symbols.length > 0) {
            this.store.insertSymbols(file, parsed.symbols);
          }
          this.store.upsertFileImports(file, parsed.imports);
          this.store.upsertFile(file, hash);
        } catch {
          // A single unparsable file (grammar crash, transient write) must
          // not fail the whole index. Leave the hash unrecorded so the next
          // scan retries it.
          this.store.clearSymbolsForFile(file);
        }
      });

      for (const { file, imports } of this.store.getAllFileImports()) {
        this.store.deleteImportEdgesFromFile(file);
        const anchorRows = this.store.query<{ qualified: string }>(
          "SELECT qualified FROM symbols WHERE file = ? AND kind IN ('class', 'function') ORDER BY line LIMIT 1",
          file,
        );
        if (anchorRows.length === 0) continue;
        const anchorQualified = anchorRows[0].qualified;

        for (const importedName of imports) {
          this.store.insertEdge(anchorQualified, importedName, "import");
        }
      }

      const symbolsIndexed = this.store.countSymbols();
      const filesIndexed = (
        this.store.query<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM file_hashes",
        )[0] ?? { cnt: 0 }
      ).cnt;

      this.status = {
        state: "ready",
        filesIndexed,
        symbolsIndexed,
        lastIndexedAt: new Date().toISOString(),
      };

      return {
        filesIndexed,
        symbolsIndexed,
        filesChanged,
        filesDeleted,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.status = {
        state: "error",
        filesIndexed: this.status.filesIndexed,
        symbolsIndexed: this.status.symbolsIndexed,
        lastIndexedAt: this.status.lastIndexedAt,
        error: message,
      };
      throw err;
    }
  }

  async searchSymbols(
    query: string,
    opts?: { limit?: number },
  ): Promise<SymbolHit[]> {
    return this.search.searchSymbols(query, opts);
  }

  async findUsages(
    symbolName: string,
    opts?: { kind?: string },
  ): Promise<UsageHit[]> {
    return this.search.findUsages(symbolName, opts);
  }

  getStatus(): IndexStatus {
    return { ...this.status };
  }

  dispose(): void {
    this.store.close();
  }
}

export function createCodeIndex(opts?: { dbPath?: string }): CodeIndex {
  const dbPath =
    opts?.dbPath ?? join(process.cwd(), ".code-index", "index.db");

  if (dbPath !== ":memory:") {
    ensureDir(dirname(dbPath));
  }

  return new CodeIndexImpl(dbPath);
}
