import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodeStore } from "../src/store.js";
import { CodeSearch } from "../src/search.js";
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

describe("CodeSearch", () => {
  let tmpDir: string;
  let dbPath: string;
  let store: CodeStore;
  let search: CodeSearch;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "code-index-search-test-"));
    dbPath = join(tmpDir, "test.db");
    store = new CodeStore(dbPath);
    store.open();
    search = new CodeSearch(store);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // ignore
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── searchSymbols ──────────────────────────────────────────

  it("searchSymbols: finds by partial trigram", async () => {
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

    const hits = await search.searchSymbols("createSdk");

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      name: "createSdkRuntime",
      qualified: "PiHost.createSdkRuntime",
      kind: "method",
      file: "src/sdk.ts",
      line: 42,
      endLine: 60,
    });
  });

  it("searchSymbols: exact match ranks first", async () => {
    store.insertSymbols("src/host.ts", [
      makeSymbol({
        name: "PiHost",
        file: "src/host.ts",
        qualified: "PiHost",
        kind: "class",
        line: 10,
        endLine: 50,
      }),
      makeSymbol({
        name: "PiHostHelper",
        file: "src/host.ts",
        qualified: "PiHostHelper",
        kind: "class",
        line: 52,
        endLine: 80,
      }),
    ]);

    const hits = await search.searchSymbols("PiHost");

    expect(hits.length).toBeGreaterThanOrEqual(1);
    // "PiHost" must come before "PiHostHelper"
    const names = hits.map((h) => h.name);
    const exactIdx = names.indexOf("PiHost");
    const helperIdx = names.indexOf("PiHostHelper");
    expect(exactIdx).toBeGreaterThanOrEqual(0);
    if (helperIdx >= 0) {
      expect(exactIdx).toBeLessThan(helperIdx);
    }
  });

  it("searchSymbols: with limit caps results", async () => {
    const symbols: SymbolExtraction[] = [];
    for (let i = 0; i < 5; i++) {
      symbols.push(
        makeSymbol({
          name: `fn${i}`,
          file: `src/a${i}.ts`,
          qualified: `fn${i}`,
          line: i + 1,
          endLine: i + 3,
        }),
      );
    }
    store.insertSymbols("src/a.ts", symbols);

    const hits = await search.searchSymbols("fn", { limit: 2 });

    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it("searchSymbols: limit defaults to 20", async () => {
    const symbols: SymbolExtraction[] = [];
    for (let i = 0; i < 25; i++) {
      symbols.push(
        makeSymbol({
          name: `util${i}`,
          file: `src/util.ts`,
          qualified: `util${i}`,
          line: i + 1,
          endLine: i + 2,
        }),
      );
    }
    store.insertSymbols("src/util.ts", symbols);

    const hits = await search.searchSymbols("util");
    expect(hits).toHaveLength(20);
  });

  it("searchSymbols: limit capped at 100", async () => {
    const symbols: SymbolExtraction[] = [];
    for (let i = 0; i < 120; i++) {
      const padded = String(i).padStart(3, "0");
      symbols.push(
        makeSymbol({
          name: `item${padded}`,
          file: `src/bulk.ts`,
          qualified: `item${padded}`,
          line: i + 1,
          endLine: i + 2,
        }),
      );
    }
    store.insertSymbols("src/bulk.ts", symbols);

    const hits = await search.searchSymbols("item", { limit: 999 });
    expect(hits).toHaveLength(100);
  });

  it("searchSymbols: empty query returns []", async () => {
    store.insertSymbols("src/a.ts", [
      makeSymbol({
        name: "hello",
        file: "src/a.ts",
        qualified: "hello",
        line: 1,
        endLine: 3,
      }),
    ]);

    const hits = await search.searchSymbols("");
    expect(hits).toEqual([]);

    const hitsWs = await search.searchSymbols("   ");
    expect(hitsWs).toEqual([]);
  });

  it("searchSymbols: unknown query returns []", async () => {
    store.insertSymbols("src/a.ts", [
      makeSymbol({
        name: "hello",
        file: "src/a.ts",
        qualified: "hello",
        line: 1,
        endLine: 3,
      }),
    ]);

    const hits = await search.searchSymbols("nonexistent_xyz");
    expect(hits).toEqual([]);
  });

  it("searchSymbols: special chars in query do not throw", async () => {
    store.insertSymbols("src/auth.ts", [
      makeSymbol({
        name: "authenticate",
        file: "src/auth.ts",
        qualified: "authenticate",
        line: 1,
        endLine: 5,
      }),
    ]);

    // These should not throw SQL errors
    await expect(
      search.searchSymbols("auth*"),
    ).resolves.toBeDefined();

    await expect(
      search.searchSymbols('foo"bar'),
    ).resolves.toBeDefined();

    await expect(
      search.searchSymbols("foo-bar"),
    ).resolves.toBeDefined();
  });

  // ── findUsages ─────────────────────────────────────────────

  it("findUsages: returns referencers with edgeKind", async () => {
    store.insertSymbols("src/a.ts", [
      makeSymbol({
        name: "alpha",
        file: "src/a.ts",
        qualified: "alpha",
        line: 1,
        endLine: 5,
      }),
      makeSymbol({
        name: "beta",
        file: "src/b.ts",
        qualified: "beta",
        line: 10,
        endLine: 15,
      }),
      makeSymbol({
        name: "gamma",
        file: "src/c.ts",
        qualified: "gamma",
        line: 20,
        endLine: 25,
      }),
    ]);

    store.insertEdge("alpha", "beta", "calls");
    store.insertEdge("gamma", "beta", "references");

    const usages = await search.findUsages("beta");

    expect(usages).toHaveLength(2);
    const kinds = usages.map((u) => u.edgeKind).sort();
    expect(kinds).toContain("calls");
    expect(kinds).toContain("references");

    // Verify one of the results
    const alphaUsage = usages.find((u) => u.name === "alpha");
    expect(alphaUsage).toBeDefined();
    expect(alphaUsage!).toMatchObject({
      name: "alpha",
      file: "src/a.ts",
      line: 1,
      edgeKind: "calls",
    });
  });

  it("findUsages: unknown symbol returns []", async () => {
    const usages = await search.findUsages("nonexistent");
    expect(usages).toEqual([]);
  });

  it("findUsages: kind filter works", async () => {
    store.insertSymbols("src/a.ts", [
      makeSymbol({
        name: "caller",
        file: "src/a.ts",
        qualified: "caller",
        line: 1,
        endLine: 5,
      }),
      makeSymbol({
        name: "ref",
        file: "src/b.ts",
        qualified: "ref",
        line: 10,
        endLine: 15,
      }),
      makeSymbol({
        name: "target",
        file: "src/c.ts",
        qualified: "target",
        line: 20,
        endLine: 25,
      }),
    ]);

    store.insertEdge("caller", "target", "calls");
    store.insertEdge("ref", "target", "references");

    const callsOnly = await search.findUsages("target", { kind: "calls" });
    expect(callsOnly).toHaveLength(1);
    expect(callsOnly[0].name).toBe("caller");
    expect(callsOnly[0].edgeKind).toBe("calls");

    const refsOnly = await search.findUsages("target", { kind: "references" });
    expect(refsOnly).toHaveLength(1);
    expect(refsOnly[0].name).toBe("ref");
    expect(refsOnly[0].edgeKind).toBe("references");
  });

  it("findUsages: non-matching kind filter returns []", async () => {
    store.insertSymbols("src/a.ts", [
      makeSymbol({
        name: "caller",
        file: "src/a.ts",
        qualified: "caller",
        line: 1,
        endLine: 5,
      }),
      makeSymbol({
        name: "target",
        file: "src/c.ts",
        qualified: "target",
        line: 20,
        endLine: 25,
      }),
    ]);

    store.insertEdge("caller", "target", "calls");

    const usages = await search.findUsages("target", { kind: "imports" });
    expect(usages).toEqual([]);
  });

  it("findUsages: resolves dotted qualified names", async () => {
    store.insertSymbols("src/host.ts", [
      makeSymbol({
        name: "PiHost",
        file: "src/host.ts",
        qualified: "PiHost",
        kind: "class",
        line: 10,
        endLine: 100,
      }),
      makeSymbol({
        name: "createSdkRuntime",
        file: "src/host.ts",
        qualified: "PiHost.createSdkRuntime",
        kind: "method",
        line: 42,
        endLine: 60,
      }),
      makeSymbol({
        name: "start",
        file: "src/launcher.ts",
        qualified: "Launcher.start",
        kind: "method",
        line: 5,
        endLine: 30,
      }),
    ]);

    store.insertEdge("Launcher.start", "PiHost.createSdkRuntime", "calls");

    const usages = await search.findUsages("PiHost.createSdkRuntime");
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({
      name: "start",
      kind: "method",
      file: "src/launcher.ts",
      line: 5,
      edgeKind: "calls",
    });
  });
});
