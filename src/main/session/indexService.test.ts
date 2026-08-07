// @vitest-environment node

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeIndexService } from "./indexService.js";
import { PiHost } from "./host.js";
import type { IndexStatus } from "@pi-desk/code-index";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-desk-index-"));
}

function createFixtureProject(root: string): void {
  writeFileSync(
    join(root, "calculator.ts"),
    `export class Calculator {
  add(a: number, b: number): number { return a + b; }
  subtract(a: number, b: number): number { return a - b; }
  multiply(a: number, b: number): number { return a * b; }
}
`,
  );
  writeFileSync(
    join(root, "utils.ts"),
    `export function formatResult(n: number): string {
  return \`Result: \${n}\`;
}
`,
  );
  writeFileSync(
    join(root, "main.ts"),
    `import { Calculator } from "../../../electron/calculator";
import { formatResult } from "../../../electron/utils";

export function bootstrap(): string {
  const calc = new Calculator();
  return formatResult(calc.add(1, 2));
}
`,
  );
}

describe("CodeIndexService", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  function trackTempDir(): string {
    const dir = createTempDir();
    tmpDirs.push(dir);
    return dir;
  }

  it("indexes a fixture project and reports ready via onStatusChange", async () => {
    const container = trackTempDir();
    const projectDir = join(container, "project");
    mkdirSync(projectDir, { recursive: true });
    createFixtureProject(projectDir);

    const events: Array<{ status: IndexStatus; cwd: string }> = [];
    const svc = new CodeIndexService({
      onStatusChange: (status, cwd) => events.push({ status, cwd }),
    });

    const stats = await svc.ensureIndexed(projectDir);

    expect(stats.filesIndexed).toBeGreaterThanOrEqual(3);
    expect(stats.symbolsIndexed).toBeGreaterThanOrEqual(4);

    // onStatusChange should have been called with ready
    const lastEvent = events[events.length - 1];
    expect(lastEvent.status.state).toBe("ready");
    expect(lastEvent.cwd).toBe(projectDir);
    expect(lastEvent.status.filesIndexed).toBeGreaterThanOrEqual(3);
    expect(lastEvent.status.symbolsIndexed).toBeGreaterThan(0);
    expect(lastEvent.status.lastIndexedAt).toBeTruthy();
    expect(lastEvent.status.error).toBeUndefined();

    svc.dispose();
  });

  it("getStatus returns correct status after indexing", async () => {
    const container = trackTempDir();
    const projectDir = join(container, "project");
    mkdirSync(projectDir, { recursive: true });
    createFixtureProject(projectDir);

    const svc = new CodeIndexService();

    // Before indexing
    const before = svc.getStatus(projectDir);
    expect(before.state).toBe("idle");
    expect(before.filesIndexed).toBe(0);

    await svc.ensureIndexed(projectDir);

    // After indexing
    const after = svc.getStatus(projectDir);
    expect(after.state).toBe("ready");
    expect(after.filesIndexed).toBeGreaterThanOrEqual(3);
    expect(after.symbolsIndexed).toBeGreaterThan(0);

    // Unknown cwd returns idle
    const unknown = svc.getStatus("/nonexistent/path");
    expect(unknown.state).toBe("idle");

    svc.dispose();
  });

  it("searchSymbols finds symbols in indexed project", async () => {
    const container = trackTempDir();
    const projectDir = join(container, "project");
    mkdirSync(projectDir, { recursive: true });
    createFixtureProject(projectDir);

    const svc = new CodeIndexService();
    await svc.ensureIndexed(projectDir);

    const calcHits = await svc.searchSymbols(projectDir, "Calculator");
    expect(calcHits.length).toBe(1);
    expect(calcHits[0]).toMatchObject({
      name: "Calculator",
      kind: "class",
      file: "calculator.ts",
    });

    const addHits = await svc.searchSymbols(projectDir, "add");
    expect(addHits.length).toBe(1);
    expect(addHits[0]).toMatchObject({
      name: "add",
      kind: "method",
      file: "calculator.ts",
    });

    const unknownHits = await svc.searchSymbols(projectDir, "nonexistent_xyz");
    expect(unknownHits).toEqual([]);

    // Unknown cwd returns empty
    const emptyHits = await svc.searchSymbols("/nonexistent/path", "anything");
    expect(emptyHits).toEqual([]);

    svc.dispose();
  });

  it("findUsages returns import edges", async () => {
    const container = trackTempDir();
    const projectDir = join(container, "project");
    mkdirSync(projectDir, { recursive: true });
    createFixtureProject(projectDir);

    const svc = new CodeIndexService();
    await svc.ensureIndexed(projectDir);

    const usages = await svc.findUsages(projectDir, "Calculator");
    expect(usages.length).toBeGreaterThanOrEqual(1);

    const importUsage = usages.find((u) => u.edgeKind === "import");
    expect(importUsage).toBeTruthy();
    expect(importUsage!.file).toBe("main.ts");

    // Unknown cwd returns empty
    const emptyUsages = await svc.findUsages("/nonexistent/path", "Calculator");
    expect(emptyUsages).toEqual([]);

    svc.dispose();
  });

  it("second ensureIndexed is incremental and fires onStatusChange again", async () => {
    const container = trackTempDir();
    const projectDir = join(container, "project");
    mkdirSync(projectDir, { recursive: true });
    createFixtureProject(projectDir);

    const events: Array<{ status: IndexStatus; cwd: string }> = [];
    const svc = new CodeIndexService({
      onStatusChange: (status, cwd) => events.push({ status, cwd }),
    });

    // First index
    await svc.ensureIndexed(projectDir);
    expect(events.length).toBe(1);
    expect(events[0].status.state).toBe("ready");

    // Second index (incremental - no files changed)
    const stats2 = await svc.ensureIndexed(projectDir);
    expect(stats2.durationMs).toBeGreaterThanOrEqual(0);
    expect(events.length).toBe(2);
    expect(events[1].status.state).toBe("ready");

    svc.dispose();
  });

  it("dispose cleans up and is safe to call twice", () => {
    const container = trackTempDir();
    const projectDir = join(container, "project");
    mkdirSync(projectDir, { recursive: true });

    const svc = new CodeIndexService();
    svc.dispose();

    // Double dispose should not throw
    expect(() => svc.dispose()).not.toThrow();
  });

  it("returns idle status for unknown cwd and error state after disposed", async () => {
    const svc = new CodeIndexService();

    const unknown = svc.getStatus("/nonexistent/path");
    expect(unknown.state).toBe("idle");
    expect(unknown.filesIndexed).toBe(0);

    // After dispose, ensureIndexed should throw
    svc.dispose();
    await expect(svc.ensureIndexed("/any/path")).rejects.toThrow("disposed");

    // searchSymbols on disposed service returns empty
    const hits = await svc.searchSymbols("/any/path", "test");
    expect(hits).toEqual([]);
  });

  it("onStatusChange errors do not propagate", async () => {
    const container = trackTempDir();
    const projectDir = join(container, "project");
    mkdirSync(projectDir, { recursive: true });
    createFixtureProject(projectDir);

    let callCount = 0;
    const svc = new CodeIndexService({
      onStatusChange: () => {
        callCount++;
        throw new Error("callback error");
      },
    });

    // Should not throw from the callback error
    await svc.ensureIndexed(projectDir);
    expect(callCount).toBe(1);

    svc.dispose();
  });
});

describe("PiHost.emitIndexStatus", () => {
  it("emits index_status_changed event to subscriber", () => {
    const host = new PiHost();
    const events: Array<{ type: string; payload: unknown }> = [];

    host.subscribe((event) => {
      events.push({ type: event.type, payload: event.payload });
    });

    const status: IndexStatus = {
      state: "ready",
      filesIndexed: 42,
      symbolsIndexed: 100,
      lastIndexedAt: "2026-01-01T00:00:00.000Z",
    };

    host.emitIndexStatus(status, "/test/project");

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("index_status_changed");
    expect(events[0].payload).toEqual({ status, cwd: "/test/project" });
  });
});
