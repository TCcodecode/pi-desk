# Typography System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bundle Inter and IBM Plex Mono and apply a consistent, readable typography and shortcut system across Pi Desk.

**Architecture:** Font packages are imported once by the renderer entry point and exposed through semantic CSS tokens in `styles.css`. A small `ShortcutKeys` component owns platform labels and key-token markup so the topbar and help dialog share the same keyboard presentation.

**Tech Stack:** React 19, TypeScript, Vitest, Electron Vite, CSS custom properties, `@fontsource-variable/inter`, `@fontsource/ibm-plex-mono`.

---

### Task 1: Add bundled fonts and renderer typography tokens

**Files:**
- Modify: `package.json` and `package-lock.json`
- Modify: `src/renderer/main.tsx`
- Modify: `src/renderer/styles.css:1-20`
- Test: `src/renderer/typography.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/typography.test.ts` with an explicit contract for the semantic tokens and bundled family names:

```ts
import { describe, expect, it } from "vitest";
import { TYPOGRAPHY_FONT_FAMILIES, TYPOGRAPHY_SCALE } from "./typography";

describe("typography tokens", () => {
  it("uses bundled UI and mono families with a readable minimum scale", () => {
    expect(TYPOGRAPHY_FONT_FAMILIES.ui).toContain("Inter");
    expect(TYPOGRAPHY_FONT_FAMILIES.mono).toContain("IBM Plex Mono");
    expect(TYPOGRAPHY_SCALE.ui.px).toBe(12);
    expect(TYPOGRAPHY_SCALE.body.px).toBe(13);
    expect(TYPOGRAPHY_SCALE.message.px).toBe(13.5);
    expect(TYPOGRAPHY_SCALE.compact.px).toBeGreaterThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run src/renderer/typography.test.ts`

Expected: FAIL because `src/renderer/typography.ts` and the exported tokens do not exist yet.

- [ ] **Step 3: Implement the token module and load the font packages**

Add `src/renderer/typography.ts` with the tested family and scale values, install `@fontsource-variable/inter` and `@fontsource/ibm-plex-mono`, then add these imports at the top of `src/renderer/main.tsx` before the app stylesheet:

```ts
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
```

Add `--font-ui`, `--font-mono`, `--text-*`, and `--weight-*` variables to `:root` in `styles.css`, and set `:root`/`body` to use `var(--font-ui)`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run src/renderer/typography.test.ts`

Expected: PASS.

- [ ] **Step 5: Record the checkpoint without staging mixed files**

Run: `git diff --check -- package.json package-lock.json src/renderer/main.tsx src/renderer/typography.ts src/renderer/typography.test.ts src/renderer/styles.css`.

Expected: no whitespace errors. Do not create an intermediate commit because the listed existing files already contain unrelated user changes.

### Task 2: Create and test the shared shortcut renderer

**Files:**
- Create: `src/renderer/components/ShortcutKeys.tsx`
- Create: `src/renderer/components/ShortcutKeys.test.tsx`
- Modify: `src/renderer/components/HelpDialog.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Write the failing component test**

Create a test that renders macOS and Windows key labels without relying on the host platform:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShortcutKeys } from "./ShortcutKeys";

describe("ShortcutKeys", () => {
  it("renders platform-specific individual key tokens", () => {
    render(<ShortcutKeys keys={["mod", "B"]} platform="mac" label="Toggle inspector" />);
    expect(screen.getByLabelText("Toggle inspector: Command B")).toBeInTheDocument();
    expect(screen.getAllByRole("kbd")).toHaveLength(2);
    expect(screen.getByText("⌘")).toBeInTheDocument();

    render(<ShortcutKeys keys={["mod", "B"]} platform="windows" label="Toggle inspector" />);
    expect(screen.getByLabelText("Toggle inspector: Control B")).toBeInTheDocument();
    expect(screen.getByText("Ctrl")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run src/renderer/components/ShortcutKeys.test.tsx`

Expected: FAIL because the shared component does not exist.

- [ ] **Step 3: Implement the component and migrate consumers**

Implement `ShortcutKeys` with `keys: string[]`, `platform?: "mac" | "windows"`, `label?: string`, and `compact?: boolean`. Map `mod` to `⌘`/`Ctrl`, render each key as `<kbd>`, and expose an `aria-label` with the readable key names. Use the browser platform only when `platform` is omitted.

Replace HelpDialog's direct `<kbd>` mapping with `ShortcutKeys`, keeping its public `HelpShortcut` data unchanged. Replace App's `topbar-kbd` text spans with `ShortcutKeys compact` for the help and inspector buttons.

- [ ] **Step 4: Run the component test**

Run: `npm test -- --run src/renderer/components/ShortcutKeys.test.tsx`

Expected: PASS.

- [ ] **Step 5: Record the checkpoint without staging mixed files**

Run: `git diff --check -- src/renderer/components/ShortcutKeys.tsx src/renderer/components/ShortcutKeys.test.tsx src/renderer/components/HelpDialog.tsx src/renderer/App.tsx`.

Expected: no whitespace errors. Do not create an intermediate commit because the existing consumer files already contain unrelated user changes.

### Task 3: Apply the typography scale to the renderer UI

**Files:**
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Write the CSS contract test**

Extend `src/renderer/typography.test.ts` to read the stylesheet and assert the key contracts:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

it("defines semantic font tokens and avoids tiny user-facing defaults", () => {
  const css = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8");
  expect(css).toContain("--font-ui");
  expect(css).toContain("--font-mono");
  expect(css).toContain("font-family: var(--font-mono)");
  expect(css).not.toContain(".topbar-kbd { color: #484d58; font-size: 9px");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run src/renderer/typography.test.ts`

Expected: FAIL because the existing stylesheet still contains the old topbar shortcut rule and scattered font declarations.

- [ ] **Step 3: Refactor CSS to use the tokens**

Update the root tokens and the typography-bearing selectors in `styles.css` in these groups:

1. Root, body, buttons, inputs, code, and `kbd` use the bundled families.
2. Sidebar, topbar/session tabs, composer controls, dialogs, settings, and timeline use the 10/11/12/13/13.5/15/24px semantic scale.
3. Inspector and dense diagnostics use 10px compact text only for metadata; visible labels and values become at least 11px.
4. Markdown inline code, code blocks, paths, tool previews, diffs, diagnostics, and shortcut tokens use `var(--font-mono)`.
5. Replace one-off 700/800 UI weights with the 400/500/600 token set, retaining 700 only for the welcome orb glyph if needed.
6. Add `font-variant-numeric: tabular-nums` to status/count classes and `font-feature-settings: "tnum"` to mono key tokens.

Use the existing colors and layout values; this task changes visual hierarchy and legibility without changing component behavior.

- [ ] **Step 4: Run the CSS contract test**

Run: `npm test -- --run src/renderer/typography.test.ts`

Expected: PASS.

### Task 4: Verify the complete typography migration

**Files:**
- Modify: `src/renderer/styles.css` if verification finds a missed user-facing text rule

- [ ] **Step 1: Run the complete test suite**

Run: `npm test -- --run`

Expected: all existing and typography tests pass with zero failures.

- [ ] **Step 2: Run type checking**

Run: `npm run typecheck`

Expected: both TypeScript projects exit with code 0.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: Electron Vite completes successfully and bundles the font assets.

- [ ] **Step 4: Inspect the final diff and verify scope**

Run: `git diff --stat` and `git diff -- src/renderer/styles.css src/renderer/main.tsx src/renderer/App.tsx src/renderer/components/HelpDialog.tsx src/renderer/components/ShortcutKeys.tsx package.json`.

Expected: only the bundled font, typography token, shortcut renderer, and typography CSS changes from this plan are present; unrelated existing worktree changes remain untouched.
