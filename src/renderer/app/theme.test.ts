import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/renderer/app/styles.css"), "utf8");

// Every z-index token must terminate its declaration; a missing semicolon
// swallows the following property (e.g. `inset: 0` on .palette-backdrop),
// which silently breaks backdrops and overlay positioning.
const Z_INDEX_TOKENS = /z-index:\s*var\(--z-[a-z-]+\)(?!\s*;)/g;

const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractRootBlock(source: string): { root: string; rest: string } {
  const match = source.match(/:root\s*\{/);
  if (!match || match.index === undefined) {
    return { root: "", rest: source };
  }
  const start = match.index + match[0].length;
  let depth = 1;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          root: source.slice(start, i),
          rest: source.slice(0, match.index) + source.slice(i + 1),
        };
      }
    }
  }
  return { root: "", rest: source };
}

describe("PI Desk light surface hierarchy", () => {
  it("defines the Codex-inspired light depth palette", () => {
    expect(css).toContain("--surface-center: #ffffff");
    expect(css).toContain("--surface-sidebar: #f5f5f5");
    expect(css).toContain("--surface-inspector: #ffffff");
    expect(css).toContain("--surface-topbar: #ffffff");
    expect(css).toContain("--surface-elevated: #ffffff");
    expect(css).toContain("--surface-code: #f7f7f7");
    expect(css).toContain("--border-subtle: #e5e5e5");
    expect(css).toContain("--accent-primary: #202020");
    expect(css).toContain("--warning: #f97316");
    expect(css).toContain("--interaction-hover-surface: #e9e9e9");
    expect(css).toContain("--interaction-selected-surface: #e9e9e9");
    expect(css).toContain("--interaction-focus-ring: 0 0 0 2px rgba(61, 61, 61, .14)");
    expect(css).toContain("color-scheme: light");
  });

  it("does not keep a .theme-light overlay", () => {
    expect(stripComments(css)).not.toMatch(/\.theme-light\b/);
  });

  it("drops retired dark aliases and unused surfaces", () => {
    const source = stripComments(css);
    expect(source).not.toContain("--text-primary-dark");
    expect(source).not.toContain("--text-secondary-dark");
    expect(source).not.toContain("--text-muted-dark");
    expect(source).not.toMatch(/\.session-picker\b/);
    expect(source).not.toMatch(/\.quick-actions\b/);
    expect(source).not.toMatch(/\.plan-workspace\b/);
    expect(source).not.toMatch(/\.timeline-task\b/);
    expect(source).not.toMatch(/\.header-model\b/);
    expect(source).not.toMatch(/\.http-results-tabs\b/);
    expect(source).not.toMatch(/\.approval-card\b/);
  });

  it("does not define unused --swatch tokens", () => {
    const defined = [...css.matchAll(/--(swatch-[0-9a-f]{6})\s*:/g)].map((match) => match[1]);
    const unused = defined.filter((name) => !css.includes(`var(--${name})`));
    expect(unused).toEqual([]);
  });

  it("keeps hex color literals in :root only", () => {
    const { rest } = extractRootBlock(stripComments(css));
    expect(rest.match(HEX_RE) ?? []).toEqual([]);
  });

  it("keeps z-index tokens syntactically valid (no swallowed properties)", () => {
    expect(css.match(Z_INDEX_TOKENS) ?? []).toEqual([]);
    expect(css).toContain(".palette-backdrop { position: fixed; z-index: var(--z-backdrop); inset: 0;");
    expect(css).toContain(".trust-backdrop { position: fixed; z-index: var(--z-dialog); inset: 0;");
  });

  it("assigns work-area surfaces with tokens, not a theme wrapper", () => {
    expect(css).toMatch(/\.app-shell\s*\{[^}]*background: var\(--surface-center\)/s);
    expect(css).toMatch(/\.sidebar\s*\{[^}]*background: var\(--surface-sidebar\)/s);
    expect(css).toMatch(/\.inspector\s*\{[^}]*background: var\(--surface-inspector\)/s);
    expect(css).toMatch(/\.topbar\s*\{[^}]*background: var\(--surface-topbar\)/s);
  });

  it("keeps HTTP Workbench on the shared surface hierarchy", () => {
    expect(css).toContain("background: var(--surface-center)");
    expect(css).toContain(".http-navigator,\n.http-empty-project-rail { color: var(--text-primary); background: var(--surface-sidebar); }");
    expect(css).toContain(".http-chat-column,\n.http-chat-collapsed { background: var(--surface-inspector); }");
    expect(css).toContain(".http-editor { color: var(--text-primary); background: var(--surface-code); }");
    expect(css).toMatch(/\.http-workbench-shell[^{]*\{[^}]*background: var\(--surface-center\)/s);
    expect(css).not.toContain(".http-workbench-shell.theme-light");
  });

  it("separates black primary actions from neutral navigation and index controls", () => {
    expect(css).toMatch(/\.send-button[\s\S]*background: var\(--accent-primary\)/);
    expect(css).toMatch(/\.mode-switcher button\.is-active[\s\S]*background: var\(--workspace-mode-accent\)/);
    expect(css).toContain(".index-btn");
    expect(css).toContain(".index-search-btn");
    expect(css).toContain("background: var(--surface-code)");
  });

  it("keeps chat bubbles and the composer neutral in daylight mode", () => {
    expect(css).toContain(".timeline-item.message-item.user .message-content");
    expect(css).toContain("background: var(--surface-message-user)");
    expect(css).toContain(".send-button");
    expect(css).toContain("border-radius: 50%");
    expect(css).toContain(".composer-card:focus-within");
    expect(css).toMatch(/\.composer-card\s*\{\s*padding-bottom: 8px;\s*\}/s);
    expect(css).toMatch(
      /\.topbar-button,[\s\S]*\.topbar-button\.active:hover\s*\{[^}]*color: var\(--text-secondary\);[^}]*background: transparent/s,
    );
    expect(css).toMatch(
      /\.topbar-button:active,[\s\S]*\.topbar-button\.active:focus-visible\s*\{[^}]*background: transparent[^}]*box-shadow: none[^}]*transform: none/s,
    );
    expect(css).toMatch(
      /\.topbar-button\.active,[\s\S]*\.topbar-button\.active:focus-visible\s*\{[^}]*color: var\(--text-primary\)[^}]*background: var\(--interaction-selected-surface\)[^}]*box-shadow: none/s,
    );
    expect(css).toMatch(/\.topbar-button \.topbar-kbd,[\s\S]*background: transparent/s);
    expect(css).toMatch(
      /\.composer-card \.ctrl-box,[\s\S]*\.composer-card \.composer-context-control\s*\{[^}]*border-color: transparent[^}]*background: transparent/s,
    );
    expect(css).toMatch(
      /\.composer-card \.ctrl-box:hover,[\s\S]*\.composer-card \.composer-context-control:hover\s*\{[^}]*background: var\(--surface-hover\)/s,
    );
  });

  it("gives daylight dialogs a hairline border and soft shadow", () => {
    expect(css).toContain(".settings-dialog,");
    expect(css).toContain("border-width: 1px");
    expect(css).toContain("box-shadow: 0 8px 24px color-mix(in srgb, var(--swatch-000000) 8%, transparent)");
    expect(css).toContain(".mode-switcher button,");
    expect(css).toContain("font-weight: 500");
  });

  it("keeps project selection hover-based while the open session stays selected", () => {
    expect(css).toContain(".project-node-row:hover");
    expect(css).toContain(".project-node.active .project-node-toggle");
    expect(css).toContain(".project-node.active .project-node-row");
    expect(css).toContain(".session-item.nested.active");
    expect(css).toContain(".project-session-list");
    expect(css).toContain("margin-top: 4px");
    expect(css).not.toContain(".project-node:hover > .project-node-row");
    expect(css).toContain("background: var(--interaction-selected-surface)");
    expect(css).toContain(".session-item.nested:hover,");
    expect(css).toContain(".composer-hints");
    expect(css).toMatch(/\.composer-hints\s*\{\s*color: var\(--text-primary\);\s*font-weight: 400;\s*\}/s);
    expect(css).toContain(".sidebar-user-label");
    expect(css).toMatch(/\.sidebar-user-label\s*\{[^}]*font-weight: 400/s);
    expect(css).toMatch(/\.project-node-name\s*\{\s*font-weight: 400;\s*\}/s);
    expect(css).toMatch(/\.sidebar-section-head\s*\{\s*color: var\(--text-section\);\s*font-size: 12px;\s*font-weight: 600;\s*text-transform: none;\s*\}/s);
    expect(css).toContain("--sidebar-leading-inset: 8px");
    expect(css).toContain("--sidebar-leading-gap: 6px");
    expect(css).toContain("--sidebar-leading-icon-slot: 16px");
    expect(css).toContain("--sidebar-selection-inset: 8px");
    expect(css).toContain("--sidebar-selection-gap: 4px");
    expect(css).toMatch(/\.sidebar-leading-control\s*\{\s*gap: var\(--sidebar-leading-gap\);\s*padding-left: var\(--sidebar-leading-inset\);\s*padding-right: var\(--sidebar-leading-inset\);\s*\}/s);
    expect(css).toMatch(/\.context-bar-track\s*\{\s*background: var\(--surface-active\);\s*\}/s);
    expect(css).toMatch(
      /\.project-session-list\s*\{[^}]*gap: var\(--sidebar-selection-gap\)[^}]*padding: 0 0 2px/s,
    );
    expect(css).toMatch(/\.project-tree\s*\{\s*padding-left: var\(--sidebar-selection-inset\);\s*\}/s);
    expect(css).toMatch(/\.session-item\.nested\s*\{[^}]*width: 100%[^}]*padding-left: 20px/s);
  });

  it("uses one neutral hover and selection surface across navigation and settings", () => {
    expect(css).toContain(".settings-tab:hover,");
    expect(css).toContain(".settings-tab.active,");
    expect(css).toContain(".session-item.nested:hover,");
    expect(css).toContain(".sidebar-user:hover,");
    expect(css).toMatch(
      /\.project-node-row:hover \.project-node-toggle,\s*\.project-node-row:hover \.sidebar-icon-btn\s*\{\s*color: inherit;\s*background: transparent;\s*\}/s,
    );
    expect(css).not.toContain(
      ".project-node-row:hover,\n.project-node-row:hover .project-node-toggle,",
    );
    expect(css).toMatch(
      /\.project-node-row:hover,\s*\.project-node\.active \.project-node-row:hover\s*\{\s*color: var\(--text-primary\);\s*background: var\(--interaction-hover-surface\);\s*\}/s,
    );
    expect(css).toContain("background: var(--interaction-hover-surface);");
    expect(css).toContain("background: var(--interaction-selected-surface);");
    expect(css).toContain(".settings-oauth-option:has(input:checked)");
    expect(css).toMatch(
      /\.session-item-delete:hover,\s*\.session-item-delete:focus-visible\s*\{\s*color: var\(--danger-strong\);\s*background: transparent;\s*\}/s,
    );
  });

  it("routes right-pane interactions through the shared neutral contract", () => {
    expect(css).toContain(".inspector .right-pane-mode-tabs button:hover,");
    expect(css).toContain(".inspector .change-tree-file:hover,");
    expect(css).toContain(".inspector .right-pane-mode-tabs button.selected,");
    expect(css).toContain(".inspector .change-tree-file.selected");
    expect(css).toContain(".inspector .inspector-header-actions .icon-button:focus-visible");
    expect(css).toMatch(
      /\.inspector \.right-pane-mode-tabs button\.selected,[\s\S]*background: var\(--interaction-selected-surface\)/s,
    );
    expect(css).toMatch(
      /\.inspector \.right-pane-mode-tabs button:hover,[\s\S]*background: var\(--interaction-hover-surface\)/s,
    );
  });

  it("keeps right-pane status colors semantic and indicator-only", () => {
    expect(css).toContain("--right-pane-content-padding: var(--space-4)");
    expect(css).toContain("--right-pane-row-height: 28px");
    expect(css).toContain(".todo-active,");
    expect(css).toContain(".mcp-status-label.cached { color: var(--info); background-color: transparent; }");
    expect(css).toContain(".resource-icon.failed,");
    expect(css).toContain(".mcp-status-label.failed { color: var(--danger); background-color: transparent; }");
    expect(css).toMatch(/\.status-dot\.running\s*\{[\s\S]*background: var\(--status-running\)/s);
    expect(css).toMatch(/\.status-dot\.idle\s*\{[\s\S]*background: var\(--status-idle\)/s);
  });

  it("keeps Inspector and Changes on the same content and control rhythm", () => {
    expect(css).toMatch(
      /\.inspector-content,[\s\S]*\.changes-inspector-content\s*\{[\s\S]*padding: var\(--right-pane-content-padding\) var\(--right-pane-content-padding\) var\(--right-pane-content-bottom\)/s,
    );
    expect(css).toMatch(
      /\.changes-inspector \.change-inspector-section-heading\s*\{[\s\S]*font-size: var\(--text-sm\)[\s\S]*line-height: var\(--leading-sm\)/s,
    );
    expect(css).toMatch(
      /\.changes-inspector \.change-collapse-button,[\s\S]*\.changes-inspector \.change-undo-button\s*\{[\s\S]*min-height: var\(--control-height-compact\)[\s\S]*border-radius: var\(--radius-sm\)/s,
    );
  });

  it("uses the indigo accent for Inspector switches", () => {
    expect(css).toContain("--inspector-switch-accent: #319DFF");
    expect(css).toMatch(
      /\.inspector \.tool-toggle-row:has\(\.inspector-switch-input:checked\) \.inspector-switch,[\s\S]*background: var\(--inspector-switch-accent\);/s,
    );
    expect(css).not.toContain(".tool-toggle-row:hover .inspector-switch");
    expect(css).not.toContain(".skill-group-heading:hover .inspector-switch");
    expect(css).not.toContain(".skill-toggle-row:hover .inspector-switch");
  });

  it("styles change summaries as light Codex cards", () => {
    expect(css).toContain(".change-summary");
    expect(css).toContain("border-color: var(--border-card)");
    expect(css).toContain("background: var(--surface-card)");
    expect(css).toContain(".change-summary-review");
    expect(css).toContain("background: var(--surface-elevated)");
    expect(css).toContain(".change-summary-file:hover");
    expect(css).toContain("background: var(--surface-hover)");
    expect(css).toContain(".change-summary-files.is-single-file .change-summary-file");
    expect(css).toContain("width: 100%");
    expect(css).toContain("max-width: 100%");
  });

  it("keeps accent jobs in :root and gold only on the workspace switcher", () => {
    expect(css).toContain("--settings-accent: #319DFF");
    expect(css).toContain("--mode-selected: #F599C6");
    expect(css).toContain("--workspace-mode-accent: #ffea88");
    expect(css).toContain("--workspace-mode-ink: #3d3d3d");

    expect(css).toMatch(
      /\.mode-switcher button\.is-active[\s\S]*background: var\(--workspace-mode-accent\)/,
    );
    expect(css).toMatch(
      /\.http-workbench-shell \.mode-switcher button\.is-active[\s\S]*background: var\(--workspace-mode-accent\)/,
    );

    expect(css).not.toMatch(/#e4b961/i);
    expect(css).not.toMatch(/#f0c46b/i);
  });
});
