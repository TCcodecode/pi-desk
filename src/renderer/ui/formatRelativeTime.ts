/** Compact relative time for sidebar rows (en-US style labels). */
export function formatRelativeTime(iso: string | undefined, nowMs: number = Date.now()): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const deltaSec = Math.round((nowMs - then) / 1000);
  if (deltaSec < 45) return "just now";

  const thenDate = new Date(then);
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfThen = new Date(thenDate.getFullYear(), thenDate.getMonth(), thenDate.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfThen) / 86400000);
  if (dayDiff === 1) return "yesterday";
  if (dayDiff > 1) {
    return thenDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  // Same calendar day.
  if (deltaSec < 3600) return `${Math.max(1, Math.round(deltaSec / 60))}m`;
  return `${Math.max(1, Math.round(deltaSec / 3600))}h`;
}
