import type { CodeStore } from "./store.js";

export interface SymbolHit {
  name: string;
  kind: string;
  file: string;
  line: number;
  endLine: number;
  qualified: string;
  score?: number;
}

export interface UsageHit {
  name: string;
  kind: string;
  file: string;
  line: number;
  edgeKind: string;
}

function sanitizeFtsQuery(input: string): string {
  return `"${input.replace(/"/g, '""')}"`;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class CodeSearch {
  private store: CodeStore;

  constructor(store: CodeStore) {
    this.store = store;
  }

  async searchSymbols(
    query: string,
    opts?: { limit?: number },
  ): Promise<SymbolHit[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const limit = Math.min(opts?.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const matchQuery = sanitizeFtsQuery(trimmed);

    const rows = this.store.query<SymbolHit>(
      `SELECT s.name, s.kind, s.file, s.line, s.end_line AS endLine, s.qualified
       FROM symbols_fts f
       JOIN symbols s ON s.id = f.rowid
       WHERE f.name MATCH ?
       LIMIT ?`,
      matchQuery,
      limit,
    );

    const queryLower = trimmed.toLowerCase();
    rows.sort((a, b) => {
      const aExact = a.name.toLowerCase() === queryLower;
      const bExact = b.name.toLowerCase() === queryLower;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return (a.qualified ?? "").localeCompare(b.qualified ?? "");
    });

    return rows;
  }

  async findUsages(
    qualifiedName: string,
    opts?: { kind?: string },
  ): Promise<UsageHit[]> {
    const targets = this.store.query<{ id: number }>(
      "SELECT id FROM symbols WHERE qualified = ?",
      qualifiedName,
    );
    if (targets.length === 0) return [];

    const targetId = targets[0].id;

    const kind = opts?.kind;
    if (kind) {
      return this.store.query<UsageHit>(
        `SELECT s.name, s.kind, s.file, s.line, e.kind AS edgeKind
         FROM edges e
         JOIN symbols s ON s.id = e.from_id
         WHERE e.to_id = ? AND e.kind = ?`,
        targetId,
        kind,
      );
    }

    return this.store.query<UsageHit>(
      `SELECT s.name, s.kind, s.file, s.line, e.kind AS edgeKind
       FROM edges e
       JOIN symbols s ON s.id = e.from_id
       WHERE e.to_id = ?`,
      targetId,
    );
  }
}
