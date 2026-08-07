import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("typography tokens", () => {
  it("defines semantic font tokens and avoids the old tiny shortcut hint", () => {
    const css = readFileSync(resolve(process.cwd(), "src/renderer/app/styles.css"), "utf8");

    expect(css).toContain("--font-ui");
    expect(css).toContain("--font-mono");
    expect(css).toContain("font-family: var(--font-mono)");
    expect(css).toMatch(/\.topbar-kbd\s*\{[^}]*height: 20px/s);
    expect(css).toMatch(/\.topbar-kbd\s*\{[^}]*border: 1px solid var\(--border-subtle\)/s);
    expect(css).toMatch(/\.topbar-kbd(?:\.shortcut-keys--compact)?\s+kbd\s*\{[^}]*font-size: var\(--text-sm\)/s);
    expect(css).toMatch(/\.topbar-kbd\.shortcut-keys--compact kbd\[data-shortcut-key="mod"\]\s*\{[^}]*font-size: 13px/s);
    expect(css).not.toContain('.topbar-kbd { color: #484d58; font-size: 9px');
  });
});
