import { generateUnifiedPatch } from "@earendil-works/pi-coding-agent";

export interface FileChangeSummary {
  path: string;
  additions: number;
  deletions: number;
  diff: string;
}

const FILE_MUTATION_TOOLS = new Set([
  "append",
  "create",
  "delete",
  "delete_file",
  "edit",
  "insert",
  "patch",
  "rename",
  "search_replace",
  "write",
]);

export function isFileMutationTool(toolName: string): boolean {
  return FILE_MUTATION_TOOLS.has(toolName.toLowerCase());
}

export function filePathFromToolArgs(toolName: string, args: unknown): string | undefined {
  if (!isFileMutationTool(toolName) || typeof args !== "object" || args === null) return undefined;
  const record = args as Record<string, unknown>;
  for (const key of ["path", "file_path", "file"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return undefined;
}

export function filePathFromToolInput(toolName: string, input: string): string | undefined {
  try {
    return filePathFromToolArgs(toolName, JSON.parse(input));
  } catch {
    return undefined;
  }
}

/** Count actual added/removed lines between the file contents before and after a mutation. */
export function createFileChangeSummary(
  path: string,
  before: string | undefined,
  after: string | undefined,
): FileChangeSummary | undefined {
  if (before === after) return undefined;
  if (before === undefined && after === undefined) return undefined;

  const patch = generateUnifiedPatch(path, before ?? "", after ?? "");
  return createFileChangeSummaryFromPatch(path, patch);
}

export function createFileChangeSummaryFromPatch(path: string, patch: string): FileChangeSummary | undefined {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions++;
    if (line.startsWith("-")) deletions++;
  }
  return additions === 0 && deletions === 0 ? undefined : { path, additions, deletions, diff: patch };
}
