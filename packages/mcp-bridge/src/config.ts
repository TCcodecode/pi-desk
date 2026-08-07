import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Standard MCP config locations read by pi-mcp-adapter in file-merge mode.
 * Order matters: later sources override earlier ones per server name.
 * These must stay in sync with the adapter's `getConfigSources()`.
 */
export function standardMcpConfigPaths(cwd: string): string[] {
  return [
    join(homedir(), ".config", "mcp", "mcp.json"),
    join(homedir(), ".agents", "mcp.json"),
    join(homedir(), ".agents", "mcp", "mcp.json"),
    join(homedir(), ".pi", "agent", "mcp.json"),
    resolve(cwd, ".mcp.json"),
    resolve(cwd, ".pi", "mcp.json"),
  ];
}

/** The project-scoped override file the desktop UI writes to (`.pi/mcp.json`). */
export function projectMcpOverridePath(cwd: string): string {
  return resolve(cwd, ".pi", "mcp.json");
}

export interface McpConfigFile {
  path: string;
  exists: boolean;
  servers: Record<string, Record<string, unknown>>;
  /** True when the file itself carries a `disabled: true` on the given server. */
}

export interface ReadMcpConfigResult {
  /** All standard sources, lowest to highest precedence. */
  sources: McpConfigFile[];
  /** Merged server map (later sources win per server). */
  mergedServers: Record<string, Record<string, unknown>>;
}

/**
 * Read and shallow-merge all standard mcp.json files for a workspace.
 * Per-server replacement matches the adapter's merge semantics; `imports`
 * expansion is intentionally not replicated here (the live status snapshot is
 * the source of truth for what the adapter actually loaded).
 */
export function readMcpConfigs(cwd: string): ReadMcpConfigResult {
  const sources: McpConfigFile[] = [];
  const mergedServers: Record<string, Record<string, unknown>> = {};
  for (const path of standardMcpConfigPaths(cwd)) {
    let servers: Record<string, Record<string, unknown>> = {};
    let exists = false;
    if (existsSync(path)) {
      exists = true;
      try {
        const parsed = parseMcpJson(readFileSync(path, "utf-8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const raw = parsed as Record<string, unknown>;
          const key = raw.mcpServers !== undefined ? "mcpServers" : raw["mcp-servers"] !== undefined ? "mcp-servers" : "mcpServers";
          const rawServers = raw[key];
          if (rawServers && typeof rawServers === "object" && !Array.isArray(rawServers)) {
            servers = rawServers as Record<string, Record<string, unknown>>;
          }
        }
      } catch {
        // Malformed file: report it as existing but with no servers; the
        // adapter logs the real error when it loads the file.
      }
    }
    sources.push({ path, exists, servers });
    for (const [name, entry] of Object.entries(servers)) {
      mergedServers[name] = entry;
    }
  }
  return { sources, mergedServers };
}

export interface ServerDisabledOverrideResult {
  path: string;
  changed: boolean;
}

/**
 * Enable/disable a server in the project override file (`.pi/mcp.json`),
 * mirroring pi-mcp-adapter's `writeProjectServerDisabledOverride` semantics:
 *
 * - disable → set `mcpServers.<name>.disabled = true` (preserving any existing
 *   entry fields; a server defined only in lower-priority configs gets a
 *   minimal override entry).
 * - enable → drop the `disabled` key from the override entry; if the entry
 *   becomes empty it is removed. When a lower-priority source still disables
 *   the server, an explicit `disabled: false` is written to keep it enabled.
 */
export function setMcpServerDisabled(cwd: string, serverName: string, disabled: boolean): ServerDisabledOverrideResult {
  const filePath = projectMcpOverridePath(cwd);
  let raw: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    const parsed = parseMcpJson(readFileSync(filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Failed to read project MCP override at ${filePath}: root value must be an object`);
    }
    raw = parsed as Record<string, unknown>;
  }

  const serverKey = raw.mcpServers !== undefined ? "mcpServers" : raw["mcp-servers"] !== undefined ? "mcp-servers" : "mcpServers";
  const rawServers = raw[serverKey];
  if (rawServers !== undefined && (!rawServers || typeof rawServers !== "object" || Array.isArray(rawServers))) {
    throw new Error(`Failed to update project MCP override at ${filePath}: ${serverKey} must be an object`);
  }
  const servers = (rawServers ?? {}) as Record<string, unknown>;
  const previous = servers[serverName];
  if (previous !== undefined && (!previous || typeof previous !== "object" || Array.isArray(previous))) {
    throw new Error(`Failed to update project MCP override at ${filePath}: server "${serverName}" must be an object`);
  }
  const existing = previous as Record<string, unknown> | undefined;

  let next: Record<string, unknown>;
  if (disabled) {
    next = { ...existing, disabled: true };
  } else {
    next = Object.fromEntries(Object.entries(existing ?? {}).filter(([key]) => key !== "disabled"));
    // A lower-priority source may still disable the server — keep an explicit
    // override in that case so enabling actually takes effect. The project
    // override file itself is excluded (it has not been written yet).
    const lower = readMcpConfigs(cwd).sources
      .filter((source) => source.path !== filePath)
      .reduce<Record<string, Record<string, unknown>>>((merged, source) => {
        for (const [name, entry] of Object.entries(source.servers)) merged[name] = entry;
        return merged;
      }, {});
    if (lower[serverName]?.disabled === true) {
      next.disabled = false;
    }
  }

  if ((!existing && Object.keys(next).length === 0) || JSON.stringify(existing) === JSON.stringify(next)) {
    return { path: filePath, changed: false };
  }
  if (Object.keys(next).length === 0) delete servers[serverName];
  else servers[serverName] = next;

  raw[serverKey] = servers;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(raw, null, 2)}\n`, "utf-8");
  return { path: filePath, changed: true };
}

export interface ImportMcpConfigResult {
  path: string;
  imported: string[];
  skipped: string[];
}

/**
 * Copy `mcpServers` from `~/.cursor/mcp.json` into the project override file
 * (`.pi/mcp.json`). Existing project entries win; nothing is overwritten.
 * Returns the imported and skipped server names.
 */
export function importCursorMcpConfig(cwd: string, cursorConfigPath = join(homedir(), ".cursor", "mcp.json")): ImportMcpConfigResult {
  const imported: string[] = [];
  const skipped: string[] = [];
  if (!existsSync(cursorConfigPath)) {
    return { path: cursorConfigPath, imported, skipped };
  }
  const parsed = parseMcpJson(readFileSync(cursorConfigPath, "utf-8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Failed to read Cursor MCP config at ${cursorConfigPath}: root value must be an object`);
  }
  const cursorRaw = parsed as Record<string, unknown>;
  const cursorServers = (cursorRaw.mcpServers ?? cursorRaw["mcp-servers"] ?? {}) as Record<string, unknown>;

  const filePath = projectMcpOverridePath(cwd);
  let raw: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    const existing = parseMcpJson(readFileSync(filePath, "utf-8"));
    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
      raw = existing as Record<string, unknown>;
    }
  }
  const serverKey = raw.mcpServers !== undefined ? "mcpServers" : "mcpServers";
  const servers = (raw[serverKey] ?? {}) as Record<string, unknown>;

  for (const [name, entry] of Object.entries(cursorServers)) {
    if (servers[name] !== undefined || !entry || typeof entry !== "object") {
      skipped.push(name);
      continue;
    }
    servers[name] = entry;
    imported.push(name);
  }
  if (imported.length === 0) {
    return { path: filePath, imported, skipped };
  }
  raw[serverKey] = servers;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(raw, null, 2)}\n`, "utf-8");
  return { path: filePath, imported, skipped };
}

/** Strip line and block comment markers outside of strings (mcp.json allows them). */
export function stripJsonComments(input: string): string {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Parse an mcp.json file tolerantly (comments allowed, trailing commas not). */
export function parseMcpJson(input: string): unknown {
  return JSON.parse(stripJsonComments(input));
}
