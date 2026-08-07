import { describe, expect, test } from "vitest";
import { createFileChangeSummary, filePathFromToolArgs } from "./fileChanges.js";

describe("file changes", () => {
  test("counts actual added and removed lines", () => {
    expect(createFileChangeSummary("src/App.tsx", "one\ntwo\nthree\n", "one\nupdated\nthree\nfour\n")).toEqual({
      path: "src/App.tsx",
      additions: 2,
      deletions: 1,
      diff: expect.stringContaining("+updated"),
    });
  });

  test("recognizes edit and write file arguments", () => {
    expect(filePathFromToolArgs("edit", { path: "src/App.tsx", edits: [] })).toBe("src/App.tsx");
    expect(filePathFromToolArgs("write", { file_path: "src/new.ts", content: "export {}" })).toBe("src/new.ts");
    expect(filePathFromToolArgs("bash", { path: "src/App.tsx" })).toBeUndefined();
  });
});
