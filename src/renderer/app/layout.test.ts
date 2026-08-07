import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/renderer/app/styles.css"), "utf8");

describe("layout tokens", () => {
  it("defines the approved spacing and sizing scale", () => {
    expect(css).toContain("--space-1: 4px");
    expect(css).toContain("--space-2: 8px");
    expect(css).toContain("--space-3: 12px");
    expect(css).toContain("--space-4: 16px");
    expect(css).toContain("--space-5: 20px");
    expect(css).toContain("--space-6: 24px");
    expect(css).toContain("--space-8: 32px");
    expect(css).toContain("--shell-sidebar-width: 248px");
    expect(css).toContain("--shell-inspector-width: 300px");
    expect(css).toContain("--shell-changes-width: clamp(520px, 65vw, 1280px)");
    expect(css).toContain("--shell-resizer-width: 4px");
    expect(css).toContain("--topbar-height: 44px");
  });

  it("applies the layout scale to the primary regions", () => {
    expect(css).toMatch(/body\s*\{[^}]*min-width: 1040px/s);
    expect(css).toMatch(/\.app-shell\.chat-only\s*\{[^}]*var\(--shell-resizer-width\)/s);
    expect(css).toMatch(/\.sidebar\s*\{[^}]*padding: 48px 12px 12px/s);
    expect(css).toMatch(/\.topbar\s*\{[^}]*height: var\(--topbar-height\)/s);
    expect(css).toMatch(/\.chat-column\s*\{[^}]*padding: 24px 0 20px/s);
    expect(css).toMatch(/\.composer-card textarea\s*\{[^}]*height: 76px/s);
    expect(css).toMatch(/\.inspector-header\s*\{[^}]*height: 44px/s);
    expect(css).toMatch(/\.app-shell\.with-inspector\.changes-open\s*\{[^}]*var\(--shell-changes-width\)/s);
    expect(css).toMatch(/\.app-shell\.with-inspector\s*\{[^}]*var\(--right-panel-width/s);
    expect(css).toMatch(/\.change-tree\s*\{[^}]*overflow: auto/s);
    expect(css).toMatch(/\.change-diff-line\s*\{[^}]*white-space: pre-wrap/s);
  });

  it("keeps sidebar trailing actions on one alignment inset", () => {
    expect(css).toMatch(/\.sidebar-scroll\s*\{[^}]*--sidebar-action-right-inset: 8px/s);
    expect(css).toMatch(/\.sidebar-section-head\s*\{[^}]*padding: 6px var\(--sidebar-action-right-inset\) 6px 8px/s);
    expect(css).toMatch(/\.project-tree\s*\{[^}]*padding: 0 var\(--sidebar-action-right-inset\) 12px 2px/s);
    expect(css).toMatch(/\.sidebar-section-head \{ min-height: 28px; padding: 0 var\(--sidebar-action-right-inset\); \}/);
    expect(css).toMatch(/\.project-tree \{ gap: 4px; padding: 0 var\(--sidebar-action-right-inset\) 16px 0; \}/);
  });
});
