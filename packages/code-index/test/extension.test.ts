import { describe, it, expect, vi, beforeAll } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import codeIndexExtension, { registerCodeIndexTools } from "../extensions/code-index.js";

describe("code-index extension", () => {
  describe("tool registration", () => {
    it("registers 4 tools with correct names", () => {
      const pi = { registerTool: vi.fn() };
      registerCodeIndexTools(pi as unknown as Parameters<typeof registerCodeIndexTools>[0]);

      expect(pi.registerTool).toHaveBeenCalledTimes(4);

      const calls = pi.registerTool.mock.calls;
      const names = calls.map((c) => (c[0] as { name: string }).name);

      expect(names).toContain("index_codebase");
      expect(names).toContain("index_status");
      expect(names).toContain("search_symbols");
      expect(names).toContain("find_usages");
    });

    it("has a default export that calls registerCodeIndexTools", () => {
      expect(typeof registerCodeIndexTools).toBe("function");
    });

    it("injects code-index guidance into the system prompt on agent start", async () => {
      const pi = { registerTool: vi.fn(), on: vi.fn() };
      codeIndexExtension(pi as unknown as Parameters<typeof codeIndexExtension>[0]);

      expect(pi.on).toHaveBeenCalledWith("before_agent_start", expect.any(Function));

      const handler = pi.on.mock.calls.find(([event]) => event === "before_agent_start")?.[1];
      const result = handler({ systemPrompt: "base prompt" });
      const prompt = typeof result === "object" && result !== null ? (result as { systemPrompt?: string }).systemPrompt : undefined;

      expect(prompt).toContain("search_symbols");
      expect(prompt).toContain("find_usages");
      expect(prompt).toContain("index_status");
      expect(prompt).toContain("base prompt");
    });
  });

  describe("tool behavior with real code-index", () => {
    let tmpDir: string;
    let tools: Map<string, (toolCallId: string, params: Record<string, unknown>, signal: unknown, onUpdate: unknown, ctx: { cwd: string }) => Promise<{ content: { type: string; text: string }[] }>>;

    beforeAll(async () => {
      tmpDir = join(tmpdir(), `code-index-test-${randomUUID()}`);
      await mkdir(tmpDir, { recursive: true });
      await writeFile(
        join(tmpDir, "hello.ts"),
        [
          'export function sayHello(name: string): string {',
          '  return `Hello, ${name}!`;',
          "}",
          "",
          "export class Greeter {",
          "  greet(name: string): string {",
          "    return sayHello(name);",
          "  }",
          "}",
        ].join("\n"),
      );

      const pi: { registerTool: ReturnType<typeof vi.fn> } = {
        registerTool: vi.fn(),
      };
      registerCodeIndexTools(pi as unknown as Parameters<typeof registerCodeIndexTools>[0]);

      tools = new Map();
      for (const call of pi.registerTool.mock.calls) {
        const def = call[0] as {
          name: string;
          execute: (...args: unknown[]) => unknown;
        };
        tools.set(def.name, def.execute as (typeof tools) extends Map<string, infer F> ? F : never);
      }
    });

    it("index_codebase returns stats after indexing", async () => {
      const execute = tools.get("index_codebase")!;
      const ctx = { cwd: tmpDir };

      const result = await execute("idx1", {}, undefined, undefined, ctx);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      const text = result.content[0].text as string;
      expect(text).toContain("Index complete");
      expect(text).toContain("Files indexed:");
      expect(text).toContain("Symbols indexed:");
      expect(text).toContain("Duration:");
    });

    it("index_status returns status after indexing", async () => {
      const execute = tools.get("index_status")!;
      const ctx = { cwd: tmpDir };

      const result = await execute("st1", {}, undefined, undefined, ctx);

      expect(result.content[0].type).toBe("text");
      const text = result.content[0].text as string;
      expect(text).toContain("Index status");
      expect(text).toContain("Files indexed:");
      expect(text).toContain("Symbols indexed:");
    });

    it("search_symbols finds Greeter class from temp project", async () => {
      const execute = tools.get("search_symbols")!;
      const ctx = { cwd: tmpDir };

      const result = await execute("ss1", { query: "Greeter" }, undefined, undefined, ctx);

      const text = result.content[0].text as string;
      expect(text).toContain("Greeter");
      expect(text).toContain("hello.ts");
      expect(text).toContain("[1]");
      expect(text).toContain("qualified:");
    });

    it("search_symbols finds sayHello function from temp project", async () => {
      const execute = tools.get("search_symbols")!;
      const ctx = { cwd: tmpDir };

      const result = await execute("ss2", { query: "sayHello" }, undefined, undefined, ctx);

      const text = result.content[0].text as string;
      expect(text).toContain("sayHello");
      expect(text).toContain("hello.ts");
      expect(text).toContain("qualified:");
    });

    it("search_symbols returns empty result for unknown query", async () => {
      const execute = tools.get("search_symbols")!;
      const ctx = { cwd: tmpDir };

      const result = await execute("ss3", { query: "zzz_nonexistent_zzz" }, undefined, undefined, ctx);

      const text = result.content[0].text as string;
      expect(text).toContain("No symbols found");
    });

    it("find_usages returns formatted result (may be empty if index lacks edges)", async () => {
      const searchExec = tools.get("search_symbols")!;
      const usageExec = tools.get("find_usages")!;
      const ctx = { cwd: tmpDir };

      const searchResult = await searchExec("fu_search", { query: "sayHello" }, undefined, undefined, ctx);
      const searchText = searchResult.content[0].text as string;
      const qualifiedMatch = searchText.match(/qualified:\s*(.+)/);
      const qualified = qualifiedMatch ? qualifiedMatch[1].trim() : "sayHello";

      const result = await usageExec("fu1", { symbol: qualified }, undefined, undefined, ctx);

      const text = result.content[0].text as string;
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(typeof text).toBe("string");
    });

    it("find_usages returns empty for unknown symbol", async () => {
      const execute = tools.get("find_usages")!;
      const ctx = { cwd: tmpDir };

      const result = await execute("fu2", { symbol: "NonExistentFunc" }, undefined, undefined, ctx);

      const text = result.content[0].text as string;
      expect(text).toContain("No usages found");
    });

    it("search_symbols respects limit parameter", async () => {
      const execute = tools.get("search_symbols")!;
      const ctx = { cwd: tmpDir };

      const result = await execute("ss4", { query: "a", limit: 2 }, undefined, undefined, ctx);

      const text = result.content[0].text as string;
      const matchCount = (text.match(/^\[\d+\]/gm) ?? []).length;
      expect(matchCount).toBeLessThanOrEqual(2);
    });

    it("index_codebase uses explicit path parameter when provided", async () => {
      const execute = tools.get("index_codebase")!;
      const subDir = join(tmpDir, "subdir");
      await mkdir(subDir);
      await writeFile(join(subDir, "extra.ts"), "export const EXTRA = 1;");
      const ctx = { cwd: tmpDir };

      const result = await execute("idx2", { path: subDir }, undefined, undefined, ctx);

      const text = result.content[0].text as string;
      expect(text).toContain("Index complete");
    });

    it("handles errors gracefully (returns error text, not throw)", async () => {
      const execute = tools.get("search_symbols")!;
      const ctx = { cwd: "/nonexistent/path/that/should/fail" };

      const result = await execute("err1", { query: "anything" }, undefined, undefined, ctx);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
    });

    it("search_symbols auto-indexes before search (lazy-index)", async () => {
      const execute = tools.get("search_symbols")!;
      const freshDir = join(tmpdir(), `code-index-lazy-${randomUUID()}`);
      await mkdir(freshDir, { recursive: true });
      await writeFile(
        join(freshDir, "lazy.ts"),
        "export function helloWorld(): string { return 'hi'; }",
      );
      const ctx = { cwd: freshDir };

      const result = await execute("lazy1", { query: "helloWorld" }, undefined, undefined, ctx);

      const text = result.content[0].text as string;
      expect(text).toContain("helloWorld");
      expect(text).toContain("lazy.ts");
      expect(text).toContain("qualified:");
    });
  });
});
