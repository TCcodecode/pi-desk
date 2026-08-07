import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  importCursorMcpConfig,
  parseMcpJson,
  projectMcpOverridePath,
  readMcpConfigs,
  setMcpServerDisabled,
  standardMcpConfigPaths,
  stripJsonComments,
} from "../src/config.js";

let root: string;
let project: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-desk-mcp-bridge-"));
  project = join(root, "project");
  mkdirSync(join(project, ".pi"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("standardMcpConfigPaths", () => {
  test("orders sources lowest to highest, project override last", () => {
    const paths = standardMcpConfigPaths(project);
    expect(paths.length).toBe(6);
    expect(paths[paths.length - 2]).toBe(resolve(project, ".mcp.json"));
    expect(paths[paths.length - 1]).toBe(resolve(project, ".pi", "mcp.json"));
    // Global sources come first.
    expect(paths[0]).toContain(".config");
  });
});

describe("readMcpConfigs", () => {
  test("merges per server with the project override winning", () => {
    writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { shared: { command: "global-cmd" }, onlyLower: { command: "lower" } } }));
    writeFileSync(join(project, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { shared: { command: "override-cmd" }, onlyProject: { command: "project" } } }));

    const { sources, mergedServers } = readMcpConfigs(project);

    expect(sources[4].path).toBe(resolve(project, ".mcp.json"));
    expect(sources[4].exists).toBe(true);
    expect(sources[5].path).toBe(resolve(project, ".pi", "mcp.json"));
    expect(sources[5].exists).toBe(true);

    // Project override replaces the lower source per server name.
    expect(mergedServers.shared).toEqual({ command: "override-cmd" });
    expect(mergedServers.onlyLower).toEqual({ command: "lower" });
    expect(mergedServers.onlyProject).toEqual({ command: "project" });
  });

  test("reports malformed project files as existing with no servers", () => {
    writeFileSync(join(project, ".pi", "mcp.json"), "{ not json ]");

    const { sources, mergedServers } = readMcpConfigs(project);

    expect(sources[5].exists).toBe(true);
    expect(sources[5].servers).toEqual({});
    expect(mergedServers).toEqual({});
  });
});

describe("setMcpServerDisabled", () => {
  test("disable writes disabled:true and preserves other fields", () => {
    writeFileSync(join(project, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { srv: { command: "npx foo", env: { K: "v" } } } }));

    const result = setMcpServerDisabled(project, "srv", true);

    expect(result.changed).toBe(true);
    expect(result.path).toBe(projectMcpOverridePath(project));
    const raw = JSON.parse(readFileSync(result.path, "utf-8")) as { mcpServers: Record<string, Record<string, unknown>> };
    expect(raw.mcpServers.srv).toEqual({ command: "npx foo", env: { K: "v" }, disabled: true });
  });

  test("disable creates a minimal override entry for a lower-source-only server", () => {
    writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { srv: { command: "lower-cmd" } } }));

    const result = setMcpServerDisabled(project, "srv", true);

    expect(result.changed).toBe(true);
    const raw = JSON.parse(readFileSync(result.path, "utf-8")) as { mcpServers: Record<string, Record<string, unknown>> };
    expect(raw.mcpServers.srv).toEqual({ disabled: true });
  });

  test("enable drops the disabled key and removes an emptied entry", () => {
    writeFileSync(join(project, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { srv: { disabled: true } } }));

    const result = setMcpServerDisabled(project, "srv", false);

    expect(result.changed).toBe(true);
    const raw = JSON.parse(readFileSync(result.path, "utf-8")) as { mcpServers: Record<string, Record<string, unknown>> };
    expect(raw.mcpServers.srv).toBeUndefined();
  });

  test("enable writes explicit disabled:false when a lower source disables the server", () => {
    writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { srv: { command: "lower-cmd", disabled: true } } }));
    writeFileSync(join(project, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { srv: { command: "override-cmd" } } }));

    const result = setMcpServerDisabled(project, "srv", false);

    expect(result.changed).toBe(true);
    const raw = JSON.parse(readFileSync(result.path, "utf-8")) as { mcpServers: Record<string, Record<string, unknown>> };
    // The explicit override is required to beat the lower-priority disable.
    expect(raw.mcpServers.srv).toEqual({ command: "override-cmd", disabled: false });
  });

  test("no-op when the override already matches the requested state", () => {
    writeFileSync(join(project, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { srv: { command: "x", disabled: true } } }));

    const result = setMcpServerDisabled(project, "srv", true);

    expect(result.changed).toBe(false);
  });
});

describe("importCursorMcpConfig", () => {
  test("imports new servers, keeps existing project servers, reports skipped", () => {
    const cursorConfig = join(root, "cursor-mcp.json");
    writeFileSync(
      cursorConfig,
      JSON.stringify({
        mcpServers: {
          newSrv: { command: "npx new" },
          existingSrv: { command: "npx cursor-version" },
          badEntry: "not-an-object",
        },
      }),
    );
    writeFileSync(join(project, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { existingSrv: { command: "npx project-version" } } }));

    const result = importCursorMcpConfig(project, cursorConfig);

    expect(result.imported).toEqual(["newSrv"]);
    expect(result.skipped).toEqual(["existingSrv", "badEntry"]);
    const raw = JSON.parse(readFileSync(result.path, "utf-8")) as { mcpServers: Record<string, Record<string, unknown>> };
    expect(raw.mcpServers.newSrv).toEqual({ command: "npx new" });
    // Project entry wins — untouched by the import.
    expect(raw.mcpServers.existingSrv).toEqual({ command: "npx project-version" });
  });

  test("returns empty result when no cursor config exists", () => {
    const result = importCursorMcpConfig(project, join(root, "missing.json"));

    expect(result.imported).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(existsSync(projectMcpOverridePath(project))).toBe(false);
  });
});

describe("parseMcpJson / stripJsonComments", () => {
  test("strips comments but not comment-like strings inside values", () => {
    const input = `{
      // line comment
      /* block comment */
      "mcpServers": {
        "srv": { "command": "npx // not a comment", "url": "https://example.com" }
      }
    }`;
    const parsed = parseMcpJson(input) as { mcpServers: Record<string, Record<string, unknown>> };
    expect(parsed.mcpServers.srv.command).toBe("npx // not a comment");
    expect(parsed.mcpServers.srv.url).toBe("https://example.com");
  });

  test("stripJsonComments leaves trailing-newline JSON intact", () => {
    expect(stripJsonComments('{"a": 1}\n')).toBe('{"a": 1}\n');
  });
});
