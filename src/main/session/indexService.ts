import {
  createCodeIndex,
  type CodeIndex,
  type IndexStatus,
  type IndexStats,
  type SymbolHit,
  type UsageHit,
} from "@pi-desk/code-index";
import { join } from "node:path";

export class CodeIndexService {
  private indexes = new Map<string, CodeIndex>();
  private onStatusChange?: (status: IndexStatus, cwd: string) => void;
  private disposed = false;

  constructor(opts: { onStatusChange?: (status: IndexStatus, cwd: string) => void } = {}) {
    this.onStatusChange = opts.onStatusChange;
  }

  async ensureIndexed(cwd: string): Promise<IndexStats> {
    if (this.disposed) throw new Error("CodeIndexService has been disposed");

    const idx = this.getOrCreate(cwd);
    try {
      const stats = await idx.index(cwd);
      this.safeNotify(idx.getStatus(), cwd);
      return stats;
    } catch (error) {
      this.safeNotify(idx.getStatus(), cwd);
      throw error;
    }
  }

  /** Re-scan and re-index changed files for a project (incremental, fast). */
  async refresh(cwd: string): Promise<IndexStats> {
    return this.ensureIndexed(cwd);
  }

  getStatus(cwd: string): IndexStatus {
    const idx = this.indexes.get(cwd);
    if (!idx) return { state: "idle", filesIndexed: 0, symbolsIndexed: 0 };
    return idx.getStatus();
  }

  async searchSymbols(
    cwd: string,
    query: string,
    opts?: { limit?: number },
  ): Promise<SymbolHit[]> {
    const idx = this.indexes.get(cwd);
    if (!idx) return [];
    return idx.searchSymbols(query, opts);
  }

  async findUsages(
    cwd: string,
    qualified: string,
    opts?: { kind?: string },
  ): Promise<UsageHit[]> {
    const idx = this.indexes.get(cwd);
    if (!idx) return [];
    return idx.findUsages(qualified, opts);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const idx of this.indexes.values()) {
      idx.dispose();
    }
    this.indexes.clear();
  }

  private getOrCreate(cwd: string): CodeIndex {
    let idx = this.indexes.get(cwd);
    if (!idx) {
      const dbPath = join(cwd, ".code-index", "index.db");
      idx = createCodeIndex({ dbPath });
      this.indexes.set(cwd, idx);
    }
    return idx;
  }

  private safeNotify(status: IndexStatus, cwd: string): void {
    if (!this.onStatusChange) return;
    try {
      this.onStatusChange(status, cwd);
    } catch {
      // callback errors must not propagate
    }
  }
}
