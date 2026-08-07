const STORAGE_KEY = "pi.sidebar.hiddenSessions";

function readSet(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return new Set();
  }
}

function writeSet(paths: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...paths]));
}

export function loadHiddenSessionPaths(): Set<string> {
  return readSet();
}

export function hideSessionPath(sessionFile: string): Set<string> {
  const next = readSet();
  next.add(sessionFile);
  writeSet(next);
  return next;
}

export function unhideSessionPath(sessionFile: string): Set<string> {
  const next = readSet();
  next.delete(sessionFile);
  writeSet(next);
  return next;
}
