const STORAGE_KEY = "pi.sidebar.expanded";

export function loadExpandedMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "boolean") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveExpandedMap(map: Record<string, boolean>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}
