import { describe, expect, test } from "vitest";
import { formatRelativeTime } from "./formatRelativeTime";

/** Local wall-clock instant (avoids UTC vs TZ calendar-day mismatches). */
function localMs(y: number, m: number, d: number, h = 12, min = 0, s = 0): number {
  return new Date(y, m - 1, d, h, min, s).getTime();
}

describe("formatRelativeTime", () => {
  const now = localMs(2026, 8, 8, 12, 0, 0);

  test("just now", () => {
    expect(formatRelativeTime(new Date(now - 30_000).toISOString(), now)).toBe("just now");
  });

  test("minutes", () => {
    expect(formatRelativeTime(new Date(now - 15 * 60_000).toISOString(), now)).toBe("15m");
  });

  test("hours", () => {
    expect(formatRelativeTime(new Date(now - 3 * 3600_000).toISOString(), now)).toBe("3h");
  });

  test("yesterday", () => {
    expect(formatRelativeTime(new Date(localMs(2026, 8, 7, 18)).toISOString(), now)).toBe("yesterday");
  });

  test("older dates use short month day", () => {
    const label = formatRelativeTime(new Date(localMs(2026, 8, 1, 12)).toISOString(), now);
    expect(label).toMatch(/Aug/);
    expect(label).toMatch(/1/);
  });

  test("invalid iso returns empty", () => {
    expect(formatRelativeTime("not-a-date", now)).toBe("");
  });
});
