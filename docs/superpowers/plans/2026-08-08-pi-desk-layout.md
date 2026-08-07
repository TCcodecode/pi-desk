# PI Desk Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with checkpoints.

**Goal:** Apply the approved PI Desk layout specification to the renderer without changing the icon system or color theme.

**Architecture:** Keep the existing React component structure and make `src/renderer/styles.css` the single layout source of truth. Add a small CSS contract test that checks the semantic spacing, sizing, and typography tokens plus the critical region declarations. Use the existing typography tokens rather than introducing a second font system.

**Tech Stack:** React 19, TypeScript, Electron Vite, CSS custom properties, Vitest.

---

## File map

- Create: `src/renderer/layout.test.ts` — CSS contract tests for the approved layout tokens and region dimensions.
- Modify: `src/renderer/styles.css` — add layout tokens and apply them to the shell, rails, timeline, composer, empty state, inspector, and dialogs.
- Do not modify: icon components, color values, React behavior, or component markup unless a layout-only selector requires an existing class.

## Task 1: Add the failing layout contract

**Files:**
- Create: `src/renderer/layout.test.ts`

- [ ] **Step 1: Write the failing test**

Create a Vitest test that reads `src/renderer/styles.css` and asserts the approved token values and key declarations:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8");

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
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --run src/renderer/layout.test.ts`

Expected: FAIL because the new layout tokens and target declarations do not yet exist in `styles.css`.

## Task 2: Add layout tokens and update the shell geometry

**Files:**
- Modify: `src/renderer/styles.css:1-80`

- [ ] **Step 1: Add the semantic layout tokens**

Add the following declarations inside `:root` without changing the existing color tokens:

```css
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --shell-sidebar-width: 248px;
  --shell-inspector-width: 300px;
  --shell-resizer-width: 4px;
  --topbar-height: 44px;
```

Update `body` to `min-width: 1040px`, use the new shell tokens in both `.app-shell` grid declarations, and make `.panel-resizer` use `width: var(--shell-resizer-width)`.

- [ ] **Step 2: Apply the outer rail dimensions**

Update `.sidebar` to `padding: 48px 12px 12px`, keep its existing background/color declarations unchanged, and update `.topbar` to fixed `height: var(--topbar-height)`, `min-height: var(--topbar-height)`, and `padding: 0 12px`.

Update `.main-column` only for layout: preserve its current background, set `min-width: 0`, and leave its flex behavior intact.

- [ ] **Step 3: Run the focused test**

Run: `npm test -- --run src/renderer/layout.test.ts`

Expected: The token assertions and shell geometry assertions pass; the remaining primary-region assertions may still fail until Task 3 and Task 4 are complete.

## Task 3: Normalize Sidebar, Topbar, Timeline, empty state, and Composer

**Files:**
- Modify: `src/renderer/styles.css:90-355, 600-1000`

- [ ] **Step 1: Normalize Sidebar rows and spacing**

Apply these layout declarations to the existing selectors:

```css
.sidebar-top { padding-bottom: 12px; }
.sidebar-brand .brand-title { font-size: 15px; line-height: 20px; }
.sidebar-search { margin: 0 0 8px; padding: 0 8px; min-height: 32px; }
.sidebar-nav { gap: 4px; margin-bottom: 16px; }
.sidebar-new-session { min-height: 34px; padding: 0 10px; }
.sidebar-section-head { min-height: 28px; padding: 0 8px; }
.project-tree { gap: 4px; padding: 0 0 16px; }
.project-node-toggle { min-height: 32px; padding: 0 8px; }
.project-session-list { gap: 0; margin: 0 0 8px 20px; padding: 0; }
.session-item.nested { min-height: 28px; padding: 0 8px; }
.session-title { font-size: 12px; line-height: 16px; }
.session-meta { font-size: 11px; line-height: 16px; }
```

Do not change colors or icon sizes in this task. Preserve the existing ellipsis/flex rules.

- [ ] **Step 2: Normalize Topbar and Session Tabs**

Keep the current tab behavior and update only geometry: Session Tabs use `height: 32px`, `min-width: 152px`, `padding: 0 8px`, and `gap: 4px`; topbar action buttons use a 30px height and 8px inter-control spacing. Keep the existing stacked-tab class for cases that need project context, but make its internal padding conform to the same 32px tab height.

- [ ] **Step 3: Normalize Timeline and empty state**

Set `.chat-column` to `width: min(760px, calc(100% - 48px))` and `padding: 24px 0 20px`. Keep the empty-state full-width override but use `padding: 24px` for its outer gutter. Set the welcome graphic slot to 48px with a 20px bottom gap, welcome copy to 13px/20px, and quick actions to 32px top margin, 8px grid gap, and 12px card padding.

- [ ] **Step 4: Normalize Composer geometry**

Use the shared content axis and set `.composer-dock` bottom padding to 16px and its nested `.chat-column` top padding to 12px. Keep `.composer-card` at 12px padding. Set the textarea to 76px height and 13.5px/21px, `.composer-toolbar` gap to 8px, `.ctrl-box` to 32px minimum height with 0 8px horizontal padding, and keep the send button at 32px square. Set hint text to 10px/14px Mono with an 8px top gap.

- [ ] **Step 5: Run the focused test**

Run: `npm test -- --run src/renderer/layout.test.ts`

Expected: All token, shell, timeline, composer, and typography assertions pass except the Inspector assertion reserved for Task 4.

## Task 4: Normalize Inspector, dialogs, and layout-specific typography

**Files:**
- Modify: `src/renderer/styles.css:1000-1260, 1370-1660`

- [ ] **Step 1: Normalize Inspector geometry**

Set `.inspector` width behavior through the existing grid column, `.inspector-header` to 44px height and 16px horizontal padding, `.inspector-tabs` buttons to a 36px row, and `.inspector-content` to 16px horizontal padding. Set section headings to 28px minimum height, data rows to 28px minimum height, and row gaps to 8px. Keep the current inspector tab switching and content structure unchanged.

- [ ] **Step 2: Normalize dialogs and floating surfaces**

Use 16px outer dialog padding, 48px header height where the dialog has a header, 16px section gaps, 36px minimum list rows, 12px horizontal list padding, and 8px trigger-to-popover distance. Keep the existing dialog widths, max heights, colors, shadows, and behaviors unchanged.

- [ ] **Step 3: Verify the focused layout contract**

Run: `npm test -- --run src/renderer/layout.test.ts`

Expected: PASS with both tests green.

## Task 5: Full verification

**Files:**
- Modify: none unless verification finds a layout regression.

- [ ] **Step 1: Run renderer tests**

Run: `npm test -- --run src/renderer`

Expected: All renderer tests pass with zero failures.

- [ ] **Step 2: Run the complete test suite**

Run: `npm test -- --run`

Expected: All repository tests pass with zero failures.

- [ ] **Step 3: Run typecheck and build**

Run: `npm run typecheck && npm run build`

Expected: TypeScript exits 0 and Electron Vite produces the renderer/main bundles successfully.

- [ ] **Step 4: Inspect the final diff**

Run: `git diff --check && git diff --stat`

Expected: No whitespace errors; the diff is limited to the layout test and `styles.css`, with no icon or color changes.

