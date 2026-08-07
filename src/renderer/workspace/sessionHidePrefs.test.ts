import { beforeEach, describe, expect, test } from "vitest";
import { hideSessionPath, loadHiddenSessionPaths, unhideSessionPath } from "./sessionHidePrefs";

describe("sessionHidePrefs", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("hide and unhide round-trip", () => {
    expect(loadHiddenSessionPaths().size).toBe(0);
    const afterHide = hideSessionPath("/tmp/a.jsonl");
    expect(afterHide.has("/tmp/a.jsonl")).toBe(true);
    expect(loadHiddenSessionPaths().has("/tmp/a.jsonl")).toBe(true);
    const afterUnhide = unhideSessionPath("/tmp/a.jsonl");
    expect(afterUnhide.has("/tmp/a.jsonl")).toBe(false);
  });
});
