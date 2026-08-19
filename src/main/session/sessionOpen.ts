import { createReadStream, existsSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { SessionManager, type FileEntry } from "@earendil-works/pi-coding-agent";

const YIELD_EVERY_LINES = 20;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

type SessionManagerCtor = new (
  cwd: string,
  sessionDir: string,
  sessionFile: string,
  persist: boolean,
  options: undefined,
  entries: FileEntry[],
) => SessionManager;

/** Read a session JSONL in slices so the Electron main thread can keep painting. */
export async function loadEntriesFromFileAsync(filePath: string): Promise<FileEntry[]> {
  if (!existsSync(filePath)) return [];
  const entries: FileEntry[] = [];
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let seen = 0;
  for await (const line of rl) {
    if (line.trim()) {
      try {
        entries.push(JSON.parse(line) as FileEntry);
      } catch {
        // Skip corrupt rows the same way SessionManager does.
      }
    }
    seen += 1;
    if (seen % YIELD_EVERY_LINES === 0) await yieldToEventLoop();
  }
  return entries;
}

export async function openSessionManagerAsync(sessionPath: string, cwd: string): Promise<SessionManager> {
  const entries = await loadEntriesFromFileAsync(sessionPath);
  const Ctor = SessionManager as unknown as SessionManagerCtor;
  return new Ctor(cwd, dirname(sessionPath), sessionPath, true, undefined, entries);
}
