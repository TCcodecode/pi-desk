import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { persistComposerImage } from "./attachments.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("persistComposerImage", () => {
  test("writes png bytes under the attachment temp directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-desk-attachments-"));
    roots.push(root);

    const saved = await persistComposerImage({
      rootDir: root,
      name: "clipboard.png",
      mimeType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });

    expect(saved.name).toBe("clipboard.png");
    expect(saved.path.endsWith(".png")).toBe(true);
    expect(readFileSync(saved.path)).toEqual(Buffer.from([137, 80, 78, 71]));
  });

  test("normalizes unsafe filenames and preserves extension", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-desk-attachments-"));
    roots.push(root);

    const saved = await persistComposerImage({
      rootDir: root,
      name: "../../Screen Shot 2026-08-13.PNG",
      mimeType: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(saved.name).toBe("screen-shot-2026-08-13.png");
    expect(saved.path.endsWith("screen-shot-2026-08-13.png")).toBe(true);
  });

  test("avoids overwriting an existing attachment with the same normalized name", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-desk-attachments-"));
    roots.push(root);
    writeFileSync(join(root, "clipboard.png"), Buffer.from([0]));

    const saved = await persistComposerImage({
      rootDir: root,
      name: "Clipboard.PNG",
      mimeType: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(saved.name).toMatch(/^clipboard-[a-f0-9]{8}\.png$/);
    expect(readFileSync(saved.path)).toEqual(Buffer.from([1, 2, 3]));
    expect(readFileSync(join(root, "clipboard.png"))).toEqual(Buffer.from([0]));
  });
});
