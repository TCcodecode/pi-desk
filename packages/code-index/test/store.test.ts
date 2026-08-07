import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { CodeStore } from "../src/store.js";
import type { SymbolExtraction } from "../src/parser.js";

function makeSymbol(
  overrides: Partial<SymbolExtraction> & { name: string; file: string },
): SymbolExtraction {
  return {
    kind: "function",
    line: 1,
    endLine: 5,
    qualified: overrides.name,
    ...overrides,
  };
}

describe("CodeStore", () => {
  let tmpDir: string;
  let dbPath: string;
  let store: CodeStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "code-index-test-"));
    dbPath = join(tmpDir, "test.db");
    store = new CodeStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // close may already be called — suppress
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function verifyDb(): DatabaseSync {
    return new DatabaseSync(dbPath);
  }

  it("open() creates all expected tables and indexes", () => {
    store.open();

    const db = verifyDb();
    const rows = db
      .prepare(
        "SELECT name, type FROM sqlite_master WHERE type IN ('table','index') ORDER BY name",
      )
      .all() as { name: string; type: string }[];
    db.close();

    const tables = rows.filter((r) => r.type === "table").map((r) => r.name);
    const indexes = rows.filter((r) => r.type === "index").map((r) => r.name);

    expect(tables).toContain("symbols");
    expect(tables).toContain("symbols_fts");
    expect(tables).toContain("edges");
    expect(tables).toContain("file_hashes");
    expect(indexes).toContain("idx_edges_from");
    expect(indexes).toContain("idx_edges_to");
    expect(indexes).toContain("idx_symbols_file");
    expect(indexes).toContain("idx_symbols_qualified");
  });

  it("upsertFile, getFileHash, and removeFile roundtrip", () => {
    store.open();

    expect(store.getFileHash("src/foo.ts")).toBeUndefined();

    store.upsertFile("src/foo.ts", "abc123");
    expect(store.getFileHash("src/foo.ts")).toBe("abc123");

    store.upsertFile("src/foo.ts", "def456");
    expect(store.getFileHash("src/foo.ts")).toBe("def456");

    store.upsertFile("src/bar.ts", "xyz789");
    expect(store.getFileHash("src/bar.ts")).toBe("xyz789");
    expect(store.getFileHash("src/foo.ts")).toBe("def456");

    store.removeFile("src/foo.ts");
    expect(store.getFileHash("src/foo.ts")).toBeUndefined();
    expect(store.getFileHash("src/bar.ts")).toBe("xyz789");

    expect(() => store.removeFile("nonexistent.ts")).not.toThrow();
  });

  it("insertSymbols creates symbol rows and FTS rows", () => {
    store.open();

    store.insertSymbols("src/a.ts", [
      makeSymbol({
        name: "hello",
        file: "src/a.ts",
        kind: "function",
        qualified: "hello",
        line: 1,
        endLine: 3,
      }),
      makeSymbol({
        name: "MyClass",
        file: "src/a.ts",
        kind: "class",
        qualified: "MyClass",
        line: 5,
        endLine: 20,
      }),
    ]);

    expect(store.countSymbols()).toBe(2);

    const db = verifyDb();
    const rows = db
      .prepare("SELECT name, kind, file, qualified FROM symbols ORDER BY id")
      .all() as { name: string; kind: string; file: string; qualified: string }[];
    db.close();

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: "hello",
      kind: "function",
      file: "src/a.ts",
      qualified: "hello",
    });
    expect(rows[1]).toMatchObject({
      name: "MyClass",
      kind: "class",
      file: "src/a.ts",
      qualified: "MyClass",
    });
  });

  it("clearSymbolsForFile removes FTS entries and leaves other files JOIN-intact", () => {
    store.open();

    store.insertSymbols("src/a.ts", [
      makeSymbol({ name: "hello", file: "src/a.ts", kind: "function", qualified: "hello", line: 1, endLine: 3 }),
    ]);
    store.insertSymbols("src/b.ts", [
      makeSymbol({ name: "bye", file: "src/b.ts", kind: "function", qualified: "bye", line: 1, endLine: 2 }),
    ]);
    expect(store.countSymbols()).toBe(2);

    store.clearSymbolsForFile("src/a.ts");
    expect(store.countSymbols()).toBe(1);

    const db = verifyDb();

    const clearedFts = db
      .prepare("SELECT rowid FROM symbols_fts WHERE name MATCH ?")
      .all("hello") as { rowid: number }[];
    expect(clearedFts).toHaveLength(0);

    const remaining = db
      .prepare(
        "SELECT s.name, s.file, s.line FROM symbols_fts f JOIN symbols s ON s.id = f.rowid WHERE f.name MATCH ?",
      )
      .all("bye") as { name: string; file: string; line: number }[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ name: "bye", file: "src/b.ts", line: 1 });

    db.close();
  });

  it("insertEdge resolves qualified names and inserts edges", () => {
    store.open();

    store.insertSymbols("src/a.ts", [
      makeSymbol({ name: "alpha", file: "src/a.ts", qualified: "alpha", line: 1, endLine: 5 }),
    ]);
    store.insertSymbols("src/b.ts", [
      makeSymbol({ name: "beta", file: "src/b.ts", qualified: "beta", line: 1, endLine: 3 }),
    ]);

    store.insertEdge("alpha", "beta", "calls");

    const db = verifyDb();
    const edges = db
      .prepare("SELECT from_id, to_id, kind FROM edges")
      .all() as { from_id: number; to_id: number; kind: string }[];
    db.close();

    expect(edges).toHaveLength(1);
    expect(edges[0].kind).toBe("calls");
  });

  it("insertEdge silently skips unknown qualified names", () => {
    store.open();

    store.insertSymbols("src/a.ts", [
      makeSymbol({ name: "alpha", file: "src/a.ts", qualified: "alpha", line: 1, endLine: 5 }),
    ]);

    store.insertEdge("unknown", "alpha", "calls");
    store.insertEdge("alpha", "unknown", "calls");
    store.insertEdge("unknown", "ghost", "calls");

    const db = verifyDb();
    const edges = db.prepare("SELECT COUNT(*) AS cnt FROM edges").get() as { cnt: number };
    db.close();

    expect(edges.cnt).toBe(0);
  });

  it("insertEdge deduplicates identical edges", () => {
    store.open();

    store.insertSymbols("src/a.ts", [
      makeSymbol({ name: "alpha", file: "src/a.ts", qualified: "alpha", line: 1, endLine: 5 }),
      makeSymbol({ name: "beta", file: "src/a.ts", qualified: "beta", line: 10, endLine: 15 }),
    ]);

    store.insertEdge("alpha", "beta", "calls");
    store.insertEdge("alpha", "beta", "calls");

    const db = verifyDb();
    const edges = db.prepare("SELECT COUNT(*) AS cnt FROM edges").get() as { cnt: number };
    db.close();

    expect(edges.cnt).toBe(1);
  });

  it("countSymbols returns 0 for empty store", () => {
    store.open();
    expect(store.countSymbols()).toBe(0);
  });

  it("countSymbols reflects inserted symbols", () => {
    store.open();
    expect(store.countSymbols()).toBe(0);

    store.insertSymbols("src/a.ts", [
      makeSymbol({ name: "a", file: "src/a.ts", qualified: "a", line: 1, endLine: 2 }),
      makeSymbol({ name: "b", file: "src/a.ts", qualified: "b", line: 3, endLine: 4 }),
      makeSymbol({ name: "c", file: "src/a.ts", qualified: "c", line: 5, endLine: 6 }),
    ]);
    expect(store.countSymbols()).toBe(3);
  });

  it("insertSymbols rolls back on mid-batch failure", () => {
    store.open();

    const good = makeSymbol({ name: "good", file: "src/a.ts", qualified: "good", line: 1, endLine: 2 });
    const bad = { ...good, name: undefined as unknown as string };

    expect(() => {
      store.insertSymbols("src/a.ts", [good, bad]);
    }).toThrow();

    expect(store.countSymbols()).toBe(0);
  });

  it("FTS trigram search matches partial tokens", () => {
    store.open();

    store.insertSymbols("src/sdk.ts", [
      makeSymbol({
        name: "createSdkRuntime",
        file: "src/sdk.ts",
        qualified: "PiHost.createSdkRuntime",
        kind: "method",
        line: 42,
        endLine: 60,
      }),
    ]);

    const db = verifyDb();
    const results = db
      .prepare("SELECT rowid FROM symbols_fts WHERE symbols_fts MATCH ?")
      .all("createSdk") as { rowid: number }[];
    db.close();

    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("FTS rowid matches symbols.id via JOIN", () => {
    store.open();

    store.insertSymbols("src/lib.ts", [
      makeSymbol({
        name: "createSdkRuntime",
        file: "src/lib.ts",
        qualified: "PiHost.createSdkRuntime",
        kind: "method",
        line: 42,
        endLine: 60,
      }),
      makeSymbol({
        name: "destroyRuntime",
        file: "src/lib.ts",
        qualified: "PiHost.destroyRuntime",
        kind: "method",
        line: 65,
        endLine: 72,
      }),
    ]);

    const db = verifyDb();
    const results = db
      .prepare(
        "SELECT s.name, s.file, s.line FROM symbols_fts f JOIN symbols s ON s.id = f.rowid WHERE f.name MATCH ?",
      )
      .all("createSdk") as { name: string; file: string; line: number }[];
    db.close();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      name: "createSdkRuntime",
      file: "src/lib.ts",
      line: 42,
    });
  });

  it("open() enables WAL journal mode", () => {
    store.open();

    const db = verifyDb();
    const row = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    db.close();

    expect(row.journal_mode).toBe("wal");
  });

  it("open() is idempotent", () => {
    store.open();
    expect(() => store.open()).not.toThrow();
    expect(store.countSymbols()).toBe(0);
    store.close();
  });

  it("close() is idempotent", () => {
    store.open();
    store.close();
    expect(() => store.close()).not.toThrow();
    expect(() => store.close()).not.toThrow();
  });

  it("open() throws for invalid path", () => {
    const bad = new CodeStore("/nonexistent/dir/should/fail/db.sqlite");
    expect(() => bad.open()).toThrow();
  });
});
