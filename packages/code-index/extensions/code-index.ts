import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createCodeIndex, type CodeIndex, type IndexStats, type SymbolHit, type UsageHit } from "@pi-desk/code-index";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const INDEX_MAP = new Map<string, CodeIndex>();

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function getDbPath(cwd: string): string {
  const base = process.env.CODE_INDEX_DB_DIR ?? cwd;
  return join(base, ".code-index", "index.db");
}

function getOrCreateIndex(cwd: string): CodeIndex {
  const key = cwd;
  let index = INDEX_MAP.get(key);
  if (!index) {
    const dbPath = getDbPath(cwd);
    ensureDir(dirname(dbPath));
    index = createCodeIndex({ dbPath });
    INDEX_MAP.set(key, index);
  }
  return index;
}

function formatIndexStats(stats: IndexStats): string {
  return [
    "Index complete:",
    `  Files indexed: ${stats.filesIndexed}`,
    `  Symbols indexed: ${stats.symbolsIndexed}`,
    `  Files changed: ${stats.filesChanged}`,
    `  Files deleted: ${stats.filesDeleted}`,
    `  Duration: ${stats.durationMs}ms`,
  ].join("\n");
}

function formatSymbolHit(hit: SymbolHit, index: number): string {
  return `[${index}] ${hit.kind} ${hit.name} @ ${hit.file}:${hit.line}\n  qualified: ${hit.qualified}`;
}

function formatUsageHit(hit: UsageHit, index: number): string {
  return `[${index}] ${hit.kind} ${hit.name} @ ${hit.file}:${hit.line} (${hit.edgeKind})`;
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], details: {} as const };
}

export function registerCodeIndexTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "index_codebase",
    label: "Index Codebase",
    description: "Index the project codebase for symbol search and usage lookup",
    parameters: Type.Object({
      path: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      try {
        const projectRoot = params.path ?? ctx.cwd;
        const codeIndex = getOrCreateIndex(ctx.cwd);
        const stats = await codeIndex.index(projectRoot);
        return { content: [{ type: "text" as const, text: formatIndexStats(stats) }], details: {} };
      } catch (err) {
        return errorResult(err);
      }
    },
  });

  pi.registerTool({
    name: "index_status",
    label: "Index Status",
    description: "Get the current status of the code index",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx: ExtensionContext) {
      try {
        const codeIndex = getOrCreateIndex(ctx.cwd);
        const status = codeIndex.getStatus();
        const text = [
          `Index status: ${status.state}`,
          `  Files indexed: ${status.filesIndexed}`,
          `  Symbols indexed: ${status.symbolsIndexed}`,
          status.lastIndexedAt ? `  Last indexed: ${status.lastIndexedAt}` : null,
          status.error ? `  Error: ${status.error}` : null,
        ]
          .filter(Boolean)
          .join("\n");
        return { content: [{ type: "text" as const, text }], details: {} };
      } catch (err) {
        return errorResult(err);
      }
    },
  });

  pi.registerTool({
    name: "search_symbols",
    label: "Search Symbols",
    description: "Search code symbols by name",
    parameters: Type.Object({
      query: Type.String(),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      try {
        const codeIndex = getOrCreateIndex(ctx.cwd);
        await codeIndex.index(ctx.cwd);
        const hits = await codeIndex.searchSymbols(params.query, {
          limit: params.limit ?? 20,
        });
        if (hits.length === 0) {
          return {
            content: [{ type: "text" as const, text: `No symbols found for "${params.query}"` }],
            details: {},
          };
        }
        const text = hits.map((h, i) => formatSymbolHit(h, i + 1)).join("\n");
        return { content: [{ type: "text" as const, text }], details: {} };
      } catch (err) {
        return errorResult(err);
      }
    },
  });

  pi.registerTool({
    name: "find_usages",
    label: "Find Usages",
    description: "Find usages of a symbol by qualified name",
    parameters: Type.Object({
      symbol: Type.String(),
      kind: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      try {
        const codeIndex = getOrCreateIndex(ctx.cwd);
        await codeIndex.index(ctx.cwd);
        const hits = await codeIndex.findUsages(params.symbol, {
          kind: params.kind,
        });
        if (hits.length === 0) {
          return {
            content: [{ type: "text" as const, text: `No usages found for "${params.symbol}"` }],
            details: {},
          };
        }
        const text = hits.map((h, i) => formatUsageHit(h, i + 1)).join("\n");
        return { content: [{ type: "text" as const, text }], details: {} };
      } catch (err) {
        return errorResult(err);
      }
    },
  });
}

export default function (pi: ExtensionAPI): void {
  registerCodeIndexTools(pi);

  // Guide the agent to use the code index instead of blind grep: the index
  // answers symbol/reference questions with exact file:line in one call,
  // whereas grep requires multiple fuzzy rounds.
  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}

Code index tools are available for this repository:
- When asked to find where a symbol, class, or function is DEFINED, call search_symbols first (exact match, returns file:line) instead of grep.
- When asked who CALLS or IMPORTS a symbol, call find_usages with its qualified name (e.g. PiHost.createSdkRuntime) instead of reading files to trace references.
- Before relying on search results, call index_status once to confirm the index is ready (state: ready). If it is not ready, call index_codebase first.
- search_symbols matches partial names (e.g. "createSdk" finds createSdkRuntime) and ranks exact matches first. Prefer it over grep for identifier lookups.`,
  }));
}
