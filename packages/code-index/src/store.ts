import { DatabaseSync } from "node:sqlite";
import type { SymbolExtraction } from "./parser.js";

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS symbols (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    file TEXT NOT NULL,
    line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    qualified TEXT
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(name, qualified, tokenize='trigram')`,
  `CREATE TABLE IF NOT EXISTS edges (
    from_id INTEGER NOT NULL,
    to_id INTEGER NOT NULL,
    kind TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id)`,
  `CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id)`,
  `CREATE TABLE IF NOT EXISTS file_hashes (
    path TEXT PRIMARY KEY,
    hash TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS file_imports (
    file TEXT PRIMARY KEY,
    imports TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file)`,
  `CREATE INDEX IF NOT EXISTS idx_symbols_qualified ON symbols(qualified)`,
];

export class CodeStore {
  private _db: DatabaseSync | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  open(): void {
    if (this._db) return;
    this._db = new DatabaseSync(this.dbPath);
    this._db.exec("PRAGMA journal_mode = WAL");
    for (const stmt of SCHEMA_STATEMENTS) {
      this._db.exec(stmt);
    }
  }

  upsertFile(path: string, hash: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO file_hashes(path, hash) VALUES (?, ?)")
      .run(path, hash);
  }

  getFileHash(path: string): string | undefined {
    const row = this.db
      .prepare("SELECT hash FROM file_hashes WHERE path = ?")
      .get(path) as { hash: string } | undefined;
    return row?.hash;
  }

  removeFile(path: string): void {
    this.db.prepare("DELETE FROM file_hashes WHERE path = ?").run(path);
  }

  removeFileImports(path: string): void {
    this.db.prepare("DELETE FROM file_imports WHERE file = ?").run(path);
  }

  upsertFileImports(file: string, imports: string[]): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO file_imports(file, imports) VALUES (?, ?)",
      )
      .run(file, JSON.stringify(imports));
  }

  getAllFileImports(): Array<{ file: string; imports: string[] }> {
    const rows = this.db
      .prepare("SELECT file, imports FROM file_imports")
      .all() as Array<{ file: string; imports: string }>;
    return rows.map((row) => ({
      file: row.file,
      imports: JSON.parse(row.imports) as string[],
    }));
  }

  deleteImportEdgesFromFile(file: string): void {
    this.db
      .prepare(
        "DELETE FROM edges WHERE kind = 'import' AND from_id IN (SELECT id FROM symbols WHERE file = ?)",
      )
      .run(file);
  }

  clearSymbolsForFile(file: string): void {
    const db = this.db;
    db.exec("BEGIN");
    try {
      const ids = db
        .prepare("SELECT id FROM symbols WHERE file = ?")
        .all(file) as { id: number }[];

      if (ids.length > 0) {
        const placeholders = ids.map(() => "?").join(", ");
        const params = ids.map((r) => r.id);

        db.prepare(
          `DELETE FROM edges WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`,
        ).run(...params);
      }

      db.prepare(
        "DELETE FROM symbols_fts WHERE rowid IN (SELECT id FROM symbols WHERE file = ?)",
      ).run(file);
      db.prepare("DELETE FROM symbols WHERE file = ?").run(file);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  insertSymbols(_file: string, symbols: SymbolExtraction[]): void {
    const db = this.db;
    const insertSym = db.prepare(
      "INSERT INTO symbols(name, kind, file, line, end_line, qualified) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insertFts = db.prepare(
      "INSERT INTO symbols_fts(rowid, name, qualified) VALUES (?, ?, ?)",
    );

    db.exec("BEGIN");
    try {
      for (const sym of symbols) {
        const result = insertSym.run(
          sym.name,
          sym.kind,
          sym.file,
          sym.line,
          sym.endLine,
          sym.qualified,
        );
        const rowid = Number(result.lastInsertRowid);
        insertFts.run(rowid, sym.name, sym.qualified);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  insertEdge(
    fromQualified: string,
    toQualified: string,
    kind: string,
  ): void {
    const db = this.db;
    const fromRow = db
      .prepare("SELECT id FROM symbols WHERE qualified = ?")
      .get(fromQualified) as { id: number } | undefined;
    if (!fromRow) return;

    const toRow = db
      .prepare("SELECT id FROM symbols WHERE qualified = ?")
      .get(toQualified) as { id: number } | undefined;
    if (!toRow) return;

    const insertEdgeStmt = db.prepare(
      `INSERT INTO edges(from_id, to_id, kind)
       SELECT ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM edges WHERE from_id = ? AND to_id = ? AND kind = ?
       )`,
    );
    insertEdgeStmt.run(
      fromRow.id,
      toRow.id,
      kind,
      fromRow.id,
      toRow.id,
      kind,
    );
  }

  /**
   * Run a parameterised SELECT query and return matching rows.
   * Provided for read-only consumers such as CodeSearch.
   */
  query<T>(sql: string, ...params: (string | number | null)[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  countSymbols(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS cnt FROM symbols")
      .get() as { cnt: number };
    return row.cnt;
  }

  close(): void {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }

  private get db(): DatabaseSync {
    if (!this._db) {
      throw new Error("CodeStore is not open");
    }
    return this._db;
  }
}
