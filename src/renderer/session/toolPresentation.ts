import type { FileChangeSummary, TimelineItem } from "../../shared/protocol";
import type { AppIconName } from "../ui/icons";

export type ToolItem = Extract<TimelineItem, { kind: "tool" }>;

export type ToolCategory = "shell" | "read" | "search" | "change" | "web" | "plan" | "mcp" | "other";

export interface ToolPresentation {
  label: string;
  category: ToolCategory;
  icon: AppIconName;
  preview?: string;
  /** Present-tense label shown while the tool is still running. */
  runningLabel?: string;
}

/** A run of same-category completed tools collapsed into one expandable row. */
export interface ToolGroup {
  kind: "toolGroup";
  id: string;
  category: ToolCategory;
  items: ToolItem[];
  /** Completed thinking blocks absorbed from between the tools; shown expanded. */
  thinking: TimelineItem[];
}

export type TimelineEntry = TimelineItem | ToolGroup;

const TOOL_PREVIEW_KEYS = ["command", "pattern", "query", "path", "file", "filePath", "url", "glob", "directory", "name"];

/**
 * Categories whose consecutive completed tools collapse into one row. Edits,
 * MCP calls, and plan updates stay individual because each carries a distinct
 * file diff, server·tool target, or checklist change that grouping would hide.
 */
const AGGREGATABLE_CATEGORIES: ReadonlySet<ToolCategory> = new Set(["shell", "read", "search", "web", "other"]);

export const CATEGORY_GROUP_LABEL: Record<ToolCategory, (count: number) => string> = {
  shell: (count) => `Ran ${count} ${count === 1 ? "command" : "commands"}`,
  read: (count) => `Read ${count} ${count === 1 ? "file" : "files"}`,
  search: (count) => `Searched ${count} ${count === 1 ? "time" : "times"}`,
  change: (count) => `Changed ${count} ${count === 1 ? "file" : "files"}`,
  web: (count) => `Browsed ${count} ${count === 1 ? "time" : "times"}`,
  mcp: (count) => `MCP · ${count} ${count === 1 ? "call" : "calls"}`,
  plan: (count) => `Updated plan ${count} ${count === 1 ? "time" : "times"}`,
  other: (count) => `Used ${count} ${count === 1 ? "tool" : "tools"}`,
};

/**
 * MCP-backed tools surface as the adapter's unified proxy tool (`mcp`) or as
 * prefixed direct tools (`mcp__<server>__<tool>`). Light annotation only —
 * no data-flow changes.
 */
export function isMcpTool(name: string): boolean {
  return name === "mcp" || name.startsWith("mcp__") || name.startsWith("mcp_");
}

/** Extract a one-line human summary from a tool call's input. */
export function toolPreview(input: string, preferredKeys = TOOL_PREVIEW_KEYS): string {
  const text = input.trim();
  if (!text) return "";
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      for (const key of preferredKeys) {
        const value = obj[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      const first = Object.values(obj).find((value): value is string => typeof value === "string" && Boolean(value.trim()));
      if (first) return first.trim();
      return JSON.stringify(obj).replace(/[{}"[\]]/g, "").slice(0, 80);
    } catch {
      /* not JSON — fall through to raw text */
    }
  }
  return text.split("\n")[0];
}

function parsedToolInput(input: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(input) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Compact preview for todo-list tools. The raw input carries the whole todo
 * array; dumping it would repeat every task title on the trace row. Show the
 * progress delta instead, which is the only new information the call adds.
 */
function todoToolPreview(toolName: string, input: string): string | undefined {
  const parsed = parsedToolInput(input);
  if (!parsed) return undefined;
  if (toolName === "todocreate") {
    const content = typeof parsed.content === "string" ? parsed.content.trim() : "";
    return content ? `added “${content.slice(0, 40)}”` : undefined;
  }
  if (toolName === "todoupdate") {
    const content = typeof parsed.content === "string" ? parsed.content.trim() : "";
    return content ? `updated “${content.slice(0, 40)}”` : undefined;
  }
  if (toolName === "todoread") return undefined;
  const todos = Array.isArray(parsed.todos) ? parsed.todos : [];
  if (todos.length === 0) return "cleared";
  const done = todos.filter((todo) => todo && typeof todo === "object" && (todo as { status?: string }).status === "completed").length;
  return `${done}/${todos.length} done`;
}

function stringInput(input: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!input) return undefined;
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function mcpTarget(toolName: string, input: string): string | undefined {
  if (toolName.startsWith("mcp__")) {
    const [, server, ...toolParts] = toolName.split("__");
    return [server, toolParts.join("__")].filter(Boolean).join(" · ") || undefined;
  }
  const parsed = parsedToolInput(input);
  const tool = stringInput(parsed, ["tool", "name", "method"]);
  const server = stringInput(parsed, ["server", "serverName"]);
  return [server, tool].filter(Boolean).join(" · ") || undefined;
}

/** Destructive tools get a warning treatment so they are not lost in the trace. */
export function isDangerousTool(item: ToolItem): boolean {
  const name = item.toolName.toLowerCase();
  if (["delete", "remove", "rm", "delete_file", "unlink"].includes(name)) return true;
  if (name === "bash" || name === "shell") {
    const command = toolPreview(item.input, ["command", "script", "cmd"])?.toLowerCase() ?? "";
    // Keep the matchers narrow: bare words like "format" or "del" appear in
    // harmless commands (git format-patch, echo del), so require command-shaped
    // context instead of matching the word alone.
    return /\brm\s+(?:-[a-z]*r[a-z]*|--recursive)\b|\brmdir\s+\/s\b|\bshred\b|\bdd\s+of=|\bmkfs(?:\.\w+)?\b|\bdrop\s+table\b|\bgit\s+(?:clean\s+-[a-z]*f[a-z]*|reset\s+--hard|push\s+-f)\b|\bformat\s+[a-z]:/.test(command);
  }
  return false;
}

export function describeTool(item: ToolItem): ToolPresentation {
  const name = item.toolName.toLowerCase();
  if (isMcpTool(name)) {
    return { label: "MCP", category: "mcp", icon: "wrench", preview: mcpTarget(item.toolName, item.input), runningLabel: "Calling MCP…" };
  }
  if (["bash", "shell", "exec", "execute", "terminal", "command"].includes(name)) {
    return { label: "Ran", category: "shell", icon: "play", preview: toolPreview(item.input, ["command", "script", "cmd"]), runningLabel: "Running…" };
  }
  if (["read", "cat", "open_file", "view_file", "list", "ls", "list_files"].includes(name)) {
    return { label: "Read", category: "read", icon: "fileText", preview: toolPreview(item.input, ["path", "file", "filePath", "directory", "glob"]), runningLabel: "Reading…" };
  }
  if (["grep", "rg", "search", "find", "glob", "code_search", "mcp_search"].includes(name)) {
    return { label: "Searched", category: "search", icon: "search", preview: toolPreview(item.input, ["pattern", "query", "glob", "path", "file"]), runningLabel: "Searching…" };
  }
  if (["edit", "patch", "apply_patch", "replace"].includes(name)) {
    return { label: "Edited", category: "change", icon: "fileCode2", preview: toolPreview(item.input, ["path", "file", "filePath"]), runningLabel: "Editing…" };
  }
  if (["write", "create", "create_file"].includes(name)) {
    return { label: "Wrote", category: "change", icon: "fileCode2", preview: toolPreview(item.input, ["path", "file", "filePath"]), runningLabel: "Writing…" };
  }
  if (["delete", "remove", "rm", "delete_file"].includes(name)) {
    return { label: "Deleted", category: "change", icon: "trash", preview: toolPreview(item.input, ["path", "file", "filePath"]), runningLabel: "Deleting…" };
  }
  if (["web", "browser", "fetch", "http", "http_request"].includes(name)) {
    return { label: "Browsed", category: "web", icon: "globe", preview: toolPreview(item.input, ["url", "query", "path"]), runningLabel: "Browsing…" };
  }
  if (["todowrite", "todocreate", "todoupdate", "todoread", "todo", "update_todos"].includes(name)) {
    return { label: "Updated plan", category: "plan", icon: "check", preview: todoToolPreview(name, item.input), runningLabel: "Updating plan…" };
  }
  return { label: "Used tool", category: "other", icon: "wrench", preview: toolPreview(item.input), runningLabel: "Using tool…" };
}

/**
 * Collapse consecutive completed tool calls of a noisy category into one
 * expandable row. Hard breaks (user/assistant text, notifications, errors,
 * in-flight tools) and non-aggregatable tools flush any pending group.
 * Completed thinking blocks between the tools are absorbed into the group
 * instead of eating their own row; standalone thinking stays visible.
 */
export function groupTimelineTools(trace: TimelineItem[]): TimelineEntry[] {
  const result: TimelineEntry[] = [];
  let group: ToolItem[] = [];
  let groupCategory: ToolCategory | undefined;
  let groupThinking: TimelineItem[] = [];
  let pendingThinking: TimelineItem[] = [];

  const flush = () => {
    if (group.length === 1) {
      result.push(...groupThinking);
      result.push(group[0]!);
    } else if (group.length > 1) {
      result.push({
        kind: "toolGroup",
        id: `group:${group[0]!.id}`,
        category: groupCategory!,
        items: group,
        thinking: groupThinking,
      });
    }
    group = [];
    groupCategory = undefined;
    groupThinking = [];
  };

  const flushPendingThinking = () => {
    if (pendingThinking.length > 0) {
      result.push(...pendingThinking);
      pendingThinking = [];
    }
  };

  for (const item of trace) {
    if (item.kind === "thinking" && item.status !== "streaming") {
      pendingThinking.push(item);
      continue;
    }
    if (item.kind === "tool" && item.status === "completed") {
      const category = describeTool(item).category;
      if (AGGREGATABLE_CATEGORIES.has(category)) {
        if (groupCategory === category) {
          group.push(item);
          groupThinking.push(...pendingThinking);
          pendingThinking = [];
          continue;
        }
        flush();
        group = [item];
        groupCategory = category;
        groupThinking = [...pendingThinking];
        pendingThinking = [];
        continue;
      }
    }
    flush();
    flushPendingThinking();
    result.push(item);
  }
  flush();
  flushPendingThinking();
  return result;
}

export function oneLine(text: string, limit = 120): string | undefined {
  const line = text.split("\n").map((value) => value.trim()).find(Boolean);
  if (!line) return undefined;
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

/**
 * Keep raw payloads opt-in, but make command outcome and file-change impact
 * visible directly on the trace row. File reads/searches deliberately avoid
 * default output, since their payload is usually the noisy part.
 */
export function toolResultSummary(item: ToolItem, presentation: ToolPresentation): string | undefined {
  if (item.status === "error") return oneLine(item.output ?? "") || "failed";
  if (item.change) {
    const stats = [item.change.additions ? `+${item.change.additions}` : "", item.change.deletions ? `−${item.change.deletions}` : ""].filter(Boolean).join(" ");
    return stats || "changed";
  }
  return presentation.category === "shell" ? oneLine(item.output ?? "") : undefined;
}

export function durationBetween(start: string | undefined, end: string | undefined): string | undefined {
  if (!start || !end) return undefined;
  const elapsed = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return undefined;
  if (elapsed < 1000) return `${elapsed}ms`;
  return `${(elapsed / 1000).toFixed(elapsed >= 10_000 ? 0 : 1).replace(/\.0$/, "")}s`;
}

export function timelineDuration(item: TimelineItem): string | undefined {
  return durationBetween(item.startedAt, item.completedAt);
}

export function groupDuration(items: ToolItem[]): string | undefined {
  return durationBetween(items[0]?.startedAt, items[items.length - 1]?.completedAt);
}

export function thinkingSummary(content: string): string | undefined {
  // Only the first line is needed; avoid splitting the entire (possibly large,
  // still-streaming) thinking block on every render.
  const newline = content.indexOf("\n");
  const firstLine = (newline === -1 ? content : content.slice(0, newline)).trim();
  if (!firstLine) return undefined;
  return firstLine.length > 96 ? `${firstLine.slice(0, 95)}…` : firstLine;
}

// Keep the diff type import used by callers of toolResultSummary via FileChangeSummary.
export type { FileChangeSummary };
