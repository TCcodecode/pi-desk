import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/renderer/app/styles.css"), "utf8");

describe("PI Desk interaction language", () => {
  it("defines a shared control and motion scale", () => {
    expect(css).toContain("--control-height: 32px");
    expect(css).toContain("--control-height-compact: 28px");
    expect(css).toContain("--control-radius: 8px");
    expect(css).toContain("--focus-ring: 0 0 0 1px rgba(32, 32, 32, .16), 0 4px 14px rgba(0, 0, 0, .14)");
    expect(css).toContain("--transition-fast: 120ms ease");
    expect(css).toContain("--transition-normal: 180ms ease");
  });

  it("gives keyboard users a consistent visible focus state", () => {
    expect(css).toMatch(
      /button:focus-visible,\s*select:focus-visible,\s*\[role="button"\]:focus-visible\s*\{[^}]*box-shadow: var\(--focus-ring\)/s,
    );
  });

  it("uses the shared control rhythm in the composer", () => {
    expect(css).toMatch(
      /\.ctrl-box,\s*\.composer-menu-control,\s*\.composer-context-control\s*\{[^}]*min-height: var\(--control-height\)[^}]*border-radius: var\(--control-radius\)/s,
    );
    expect(css).toMatch(/\.send-button\s*\{[^}]*transition:[^}]*var\(--transition-fast\)/s);
    expect(css).toMatch(/\.send-button:active\s*\{[^}]*transform: translateY\(1px\)/s);
  });

  it("respects reduced-motion preferences", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{/);
  });

  it("keeps the composer frame while flattening its secondary controls", () => {
    expect(css).toMatch(/\.composer-card\s*\{[^}]*border: 1px solid/s);
    expect(css).toMatch(
      /\.composer-card \.ctrl-box,\s*\.composer-card \.composer-menu-control,\s*\.composer-card \.composer-context-control\s*\{[^}]*border-color: transparent[^}]*background: transparent/s,
    );
    expect(css).toMatch(
      /\.composer-card \.ctrl-box:hover,[\s\S]*\.composer-card \.composer-context-control:hover\s*\{[^}]*background: var\(--surface-hover\)/s,
    );
  });

  it("uses an inset white capsule instead of an underline or outer halo for the active session tab", () => {
    // The capsule lives on the sliding indicator, not on each tab.
    expect(css).toMatch(
      /\.session-tab-slider[\s\S]*?border: 1px solid var\(--border-tab\)[\s\S]*?background: var\(--surface-elevated\)[\s\S]*?box-shadow: 0 1px 2px color-mix\(in srgb, var\(--swatch-000000\) 4\.5%, transparent\)/,
    );
    // The active tab itself no longer paints its own capsule.
    expect(css).toMatch(
      /\.session-tab\.session-tab--stacked\.active[\s\S]*?background: transparent/,
    );
    expect(css).not.toContain("0 0 0 3px rgba(0, 0, 0, .08)");
  });

  it("uses one shared recessed rail for compact, single-line session tabs", () => {
    expect(css).toMatch(
      /\.session-tab-scroll\s*\{[^}]*height: 30px[^}]*padding: 2px[^}]*border-radius: 15px[^}]*background: var\(--surface-tab-rail\)/s,
    );
    expect(css).toMatch(
      /\.session-tab\.session-tab--stacked\s*\{[^}]*min-height: 26px[^}]*border-radius: 13px[^}]*background: transparent/s,
    );
    expect(css).toMatch(
      /\.session-tab\.session-tab--stacked \.session-tab-project\s*\{\s*display: none/s,
    );
  });

  it("keeps the pin shortcut close to the pin, but separates it from the title", () => {
    expect(css).toMatch(
      /\.session-tab\.session-tab--stacked\s*\{[^}]*--session-tab-inline-gap: var\(--space-3\)[^}]*--session-tab-control-gap: var\(--space-2\)/s,
    );
    expect(css).toMatch(
      /\.session-tab\.session-tab--stacked \.session-tab-pin-control\s*\{[^}]*gap: var\(--session-tab-control-gap\)/s,
    );
    expect(css).toMatch(
      /\.session-tab-scroll\.is-single \.session-tab\.session-tab--stacked\s*\{[^}]*gap: var\(--session-tab-inline-gap\)/s,
    );
    expect(css).toMatch(
      /\.session-tab\.session-tab--stacked \.session-tab-pin-control\s*\{[^}]*width: auto[^}]*gap: var\(--session-tab-control-gap\)/s,
    );
    expect(css).toMatch(
      /\.session-tab\.session-tab--stacked \.session-tab-pin-control\.is-icon-only\s*\{[^}]*width: 24px[^}]*flex-basis: 24px/s,
    );
    expect(css).toMatch(
      /\.session-tab\.session-tab--stacked \.session-tab-pin-control\.is-pinned:not\(\.is-icon-only\)\s*\{[^}]*gap: var\(--space-1\)/s,
    );
    expect(css).toMatch(
      /\.session-tab-scroll\.is-single \.session-tab\.session-tab--stacked \.session-tab-pin-control \.session-tab-pin-kbd\.shortcut-keys\s*\{[^}]*padding: 0/s,
    );
  });

  it("centers a lone tab independently from the right-side actions", () => {
    expect(css).toMatch(/\.topbar-with-tabs\s*\{[^}]*position: relative/s);
    expect(css).toMatch(
      /\.topbar-with-tabs:has\(\.session-tab-scroll\.is-single\) \.topbar-tabs\s*\{[^}]*position: absolute[^}]*inset: 0[^}]*justify-content: center/s,
    );
  });
});
