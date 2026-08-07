import { describe, expect, it, vi } from "vitest";
import { parseFile } from "../src/parser.js";
import { createCodeIndex } from "../src/index.js";

describe("index resilience", () => {
  it("skips a file whose grammar parse traps the WASM VM", async () => {
    const parserModule = await import("web-tree-sitter");
    const realParse = parserModule.Parser.prototype.parse;
    // Simulate the tree-sitter "memory access out of bounds" WASM trap.
    parserModule.Parser.prototype.parse = vi.fn(() => {
      throw new Error("memory access out of bounds");
    });
    try {
      const parsed = await parseFile("/tmp/x.ts", "export function a() {}");
      expect(parsed).toEqual({ symbols: [], imports: [] });
    } finally {
      parserModule.Parser.prototype.parse = realParse;
    }
  });

  it("completes the whole index when one file crashes parsing", async () => {
    const parserModule = await import("web-tree-sitter");
    const realParse = parserModule.Parser.prototype.parse;
    let calls = 0;
    parserModule.Parser.prototype.parse = vi.fn(function (this: unknown, ...args: unknown[]) {
      calls++;
      if (calls === 1) throw new Error("memory access out of bounds");
      return realParse.apply(this, args as [string]);
    });
    try {
      const idx = createCodeIndex({ dbPath: ":memory:" });
      const stats = await idx.index("/Users/tc/work/pi-workspace");
      expect(stats.filesIndexed).toBeGreaterThan(0);
      expect(stats.filesChanged).toBeGreaterThan(0);
    } finally {
      parserModule.Parser.prototype.parse = realParse;
    }
  });
});
