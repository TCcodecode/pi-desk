# Lucide Icon System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace pi-desk's mixed hand-written SVG, emoji, letter, and Unicode UI marks with one consistent Lucide outline icon system while preserving existing behavior and layout.

**Architecture:** Add one typed `AppIcon` adapter at `src/renderer/components/icons.tsx`. The adapter owns the approved Lucide icon registry, five sanctioned sizes, the default 1.5px stroke, and decorative-icon accessibility behavior. Components use only the adapter; CSS owns color, spacing, hover, and status treatment.

**Tech Stack:** React 19, TypeScript, Electron/Vite, `lucide-react`, existing CSS, Vitest, Testing Library.

---

## File map

- Create `src/renderer/components/icons.tsx`: typed icon registry and `AppIcon` adapter.
- Create `src/renderer/components/icons.test.tsx`: adapter defaults, sizes, and accessibility tests.
- Modify `package.json` and `package-lock.json`: add `lucide-react`.
- Modify `src/renderer/App.tsx`: replace the two top-bar hand-written SVGs.
- Modify `src/renderer/components/SessionSidebar.tsx`: replace sidebar SVGs, folder emoji, and search-clear glyph.
- Modify `src/renderer/components/SessionTabBar.tsx`: replace the pin SVG and close glyph.
- Modify `src/renderer/components/Composer.tsx`: replace file/session emoji and attach glyph.
- Modify `src/renderer/components/Timeline.tsx`: replace user letter, activity/tool disclosure glyphs, and activity marker glyphs.
- Modify `src/renderer/components/ResourceInspector.tsx`: replace symbol initials, todo marks, disclosure/close glyphs, and context-file marks.
- Modify `src/renderer/components/SettingsDialog.tsx`: replace dialog close and OAuth event glyphs.
- Modify `src/renderer/components/HelpDialog.tsx`, `src/renderer/components/ProjectPickerDialog.tsx`, `src/renderer/components/TreeDialog.tsx`: replace dialog close glyphs.
- Modify tests in `src/renderer/components/ResourceInspector.test.tsx`: assert named todo icon mappings instead of Unicode strings.
- Modify `src/renderer/styles.css`: style SVG icons as inline UI elements and remove glyph-specific backgrounds/typography.

## Task 1: Add the typed Lucide adapter

**Files:**
- Create: `src/renderer/components/icons.tsx`
- Create: `src/renderer/components/icons.test.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write the adapter test before implementation**

Create `src/renderer/components/icons.test.tsx` with these assertions:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppIcon } from "./icons";

describe("AppIcon", () => {
  it("renders decorative icons with the sanctioned size and stroke", () => {
    const { container } = render(<AppIcon name="search" size="sm" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "14");
    expect(svg).toHaveAttribute("height", "14");
    expect(svg).toHaveAttribute("stroke-width", "1.5");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps a semantic label available for non-decorative use", () => {
    const { container } = render(<AppIcon name="info" size="md" aria-label="Information" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-label", "Information");
    expect(svg).not.toHaveAttribute("aria-hidden", "true");
  });

  it("supports numeric sizes for the rare standalone case", () => {
    const { container } = render(<AppIcon name="pin" size={12} />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "12");
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails for the missing package/adapter**

Run: `npm test -- --run src/renderer/components/icons.test.tsx`

Expected: FAIL because `lucide-react` and `./icons` do not exist yet.

- [ ] **Step 3: Add the dependency**

Run: `npm install lucide-react --save`

Expected: `package.json` contains a `lucide-react` dependency and `package-lock.json` records the resolved package without removing existing dependencies.

- [ ] **Step 4: Implement the adapter with a closed icon registry**

Create `src/renderer/components/icons.tsx` with this API and registry:

```tsx
import {
  Brain,
  Braces,
  Check,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleHelp,
  ExternalLink,
  File,
  FileCode2,
  FileCog,
  FileJson,
  FileText,
  Folder,
  GitBranch,
  Info,
  Keyboard,
  Minus,
  MessageSquare,
  PanelRight,
  Pin,
  Plus,
  Search,
  Settings2,
  ShieldAlert,
  User,
  Wrench,
  X,
  type LucideProps,
} from "lucide-react";

const ICONS = {
  brain: Brain,
  braces: Braces,
  check: Check,
  chevronRight: ChevronRight,
  circle: Circle,
  circleAlert: CircleAlert,
  circleCheck: CircleCheck,
  circleDot: CircleDot,
  circleHelp: CircleHelp,
  externalLink: ExternalLink,
  file: File,
  fileCode2: FileCode2,
  fileCog: FileCog,
  fileJson: FileJson,
  fileText: FileText,
  folder: Folder,
  gitBranch: GitBranch,
  info: Info,
  keyboard: Keyboard,
  minus: Minus,
  messageSquare: MessageSquare,
  panelRight: PanelRight,
  pin: Pin,
  plus: Plus,
  search: Search,
  settings: Settings2,
  shieldAlert: ShieldAlert,
  user: User,
  wrench: Wrench,
  x: X,
} as const;

export type AppIconName = keyof typeof ICONS;
export type AppIconSize = "xs" | "sm" | "md" | "lg" | "xl";

export const APP_ICON_SIZES: Record<AppIconSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
};

export interface AppIconProps extends Omit<LucideProps, "size"> {
  name: AppIconName;
  size?: AppIconSize | number;
  decorative?: boolean;
}

export function AppIcon({
  name,
  size = "md",
  strokeWidth = 1.5,
  decorative = true,
  "aria-label": ariaLabel,
  ...props
}: AppIconProps) {
  const Icon = ICONS[name];
  const pixelSize = typeof size === "number" ? size : APP_ICON_SIZES[size];
  return (
    <Icon
      {...props}
      size={pixelSize}
      strokeWidth={strokeWidth}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel || !decorative ? undefined : true}
    />
  );
}
```

- [ ] **Step 5: Run the adapter test and typecheck**

Run: `npm test -- --run src/renderer/components/icons.test.tsx`

Expected: 3 tests pass.

Run: `npm run typecheck`

Expected: both renderer and node TypeScript projects pass.

## Task 2: Replace shell, sidebar, tabs, and top-bar icons

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/SessionSidebar.tsx`
- Modify: `src/renderer/components/SessionTabBar.tsx`

- [ ] **Step 1: Replace SessionSidebar local SVG helpers**

Import `AppIcon` and remove `IconPlus`, `IconSearch`, `IconChevron`, and `IconSettings`. Use these exact replacements:

```tsx
<AppIcon name="plus" size="sm" />
<AppIcon name="search" size="sm" />
<AppIcon
  name="chevronRight"
  size="xs"
  style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .12s ease" }}
/>
<AppIcon name="settings" size="sm" />
```

Replace the project row's `📂` span with `<AppIcon name="folder" size="sm" />`, rename its class to `project-folder-icon`, and replace the search-clear `×` with `<AppIcon name="x" size="xs" />`.

- [ ] **Step 2: Replace App top-bar SVGs**

Import `AppIcon` in `App.tsx`. Replace the first custom SVG with `<AppIcon name="circleHelp" size="sm" />` and the second with `<AppIcon name="panelRight" size="sm" />`. Keep the existing labels and keyboard shortcut text unchanged.

- [ ] **Step 3: Replace SessionTabBar pin and close glyphs**

Remove `IconPin`. Render `<AppIcon name="pin" size="xs" fill={tab.pinned ? "currentColor" : "none"} />` inside the pin button and `<AppIcon name="x" size="xs" />` inside the close button. Keep the existing `aria-label` values and click behavior.

- [ ] **Step 4: Run shell component tests**

Run: `npm test -- --run src/renderer/components/SessionSidebar.test.tsx src/renderer/components/SessionTabBar.test.tsx src/renderer/app.send-flow.test.tsx`

Expected: all selected tests pass with the same accessible button names as before.

## Task 3: Replace Composer, Timeline, and ResourceInspector content icons

**Files:**
- Modify: `src/renderer/components/Composer.tsx`
- Modify: `src/renderer/components/Timeline.tsx`
- Modify: `src/renderer/components/ResourceInspector.tsx`
- Modify: `src/renderer/components/ResourceInspector.test.tsx`

- [ ] **Step 1: Replace Composer picker and attach glyphs**

Import `AppIcon`. Use `folder` for “Browse file…”, `folder` for directory entries, `file` for file entries, `messageSquare` for session entries, and `plus` for the attach control. Keep `.at-picker-icon` as the layout hook, but its child must be an SVG.

- [ ] **Step 2: Replace Timeline activity glyphs**

Import `AppIcon` and make these replacements:

```tsx
<AppIcon name="chevronRight" size="xs" className={`activity-chevron ${expanded ? "open" : ""}`} />
<AppIcon name="circleDot" size="xs" className="activity-dot" />
<AppIcon name="chevronRight" size="xs" className="activity-dot" />
<AppIcon name="chevronRight" size="xs" className={`timeline-chevron ${expanded ? "open" : ""}`} />
<span className="timeline-icon user"><AppIcon name="user" size="sm" /></span>
```

For every disclosure row, include the `open` class only when `expanded` is true and rotate the SVG with CSS rather than rendering `▾`. Keep `… {overflow} more` as text because it is a truncated-text label, not an icon.

- [ ] **Step 3: Replace ResourceInspector symbol and todo mappings**

Import `AppIcon` and `AppIconName`. Replace `kindIcon` with this deterministic mapping:

```tsx
function kindIcon(kind: string): AppIconName {
  if (kind === "class") return "fileCode2";
  if (kind === "function" || kind === "method") return "braces";
  return "fileText";
}
```

Render `<AppIcon name={kindIcon(hit.kind)} size="sm" />` in result and usage rows. Replace `todoStatusMark` with `todoStatusIcon` returning `circle`, `circleDot`, `circleCheck`, or `minus` for pending, in-progress, completed, and cancelled respectively. Render `<AppIcon name={todoStatusIcon(todo.status)} size="xs" />` and update unit tests to assert the names.

Replace the Inspector section disclosure glyph with `AppIcon name="chevronRight"`, the session-tree button glyph with `AppIcon name="gitBranch"`, the Inspector close glyph with `AppIcon name="x"`, and context-file `✓`/`○` with `circleCheck`/`circle`.

- [ ] **Step 4: Run content component tests**

Run: `npm test -- --run src/renderer/components/Composer.test.tsx src/renderer/components/Timeline.test.tsx src/renderer/components/ResourceInspector.test.tsx`

Expected: all selected tests pass, including the updated todo icon mapping assertions.

## Task 4: Replace dialog and OAuth status icons

**Files:**
- Modify: `src/renderer/components/SettingsDialog.tsx`
- Modify: `src/renderer/components/HelpDialog.tsx`
- Modify: `src/renderer/components/ProjectPickerDialog.tsx`
- Modify: `src/renderer/components/TreeDialog.tsx`

- [ ] **Step 1: Replace all dialog close buttons**

Import `AppIcon` in each file and replace every close-button `×` with `<AppIcon name="x" size="sm" />`. Keep each existing `aria-label`; add `type="button"` to the TreeDialog close button if it is missing.

- [ ] **Step 2: Replace Settings OAuth event glyphs**

Use this exact event mapping in `OAuthEventRow`:

| Event | Icon |
|---|---|
| `auth_url` | `externalLink` |
| `device_code` | `keyboard` |
| `info` | `info` |
| `progress` | `circleDot` |
| `done` | `check` |
| `error` | `circleAlert` |

All icons use `size="sm"`. Preserve the existing success/error classes and event text.

- [ ] **Step 3: Run dialog tests**

Run: `npm test -- --run src/renderer/components/SettingsDialog.test.tsx src/renderer/components/HelpDialog.test.tsx`

Expected: all selected tests pass and existing dialog accessible names remain unchanged.

## Task 5: Remove glyph-specific CSS and preserve visual hierarchy

**Files:**
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Normalize icon layout rules**

Apply these CSS changes:

```css
.project-folder-icon,
.at-picker-icon,
.settings-oauth-event-icon,
.timeline-icon,
.resource-icon,
.todo-mark {
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
}

.project-folder-icon svg,
.at-picker-icon svg,
.settings-oauth-event-icon svg,
.timeline-icon svg,
.resource-icon svg,
.todo-mark svg {
  display: block;
}
```

- [ ] **Step 2: Remove decorative icon tiles**

Change `.resource-icon` and `.timeline-icon` from colored square tiles to transparent inline icons. Preserve semantic state colors in `.purple`, `.amber`, `.failed`, `.user`, `.thinking`, `.error`, and `.approval`, but remove their `background`, `border-radius`, `font-size`, and glyph-only dimensions. Keep the existing status-dot CSS for running/waiting/error state rows.

- [ ] **Step 3: Normalize disclosure and close icon styles**

Set `.section-chevron`, `.timeline-chevron`, and `.activity-chevron` to `display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; color: #6f7580;`. Apply rotation through the existing open-state classes. Set `.session-tab-close svg` and `.settings-heading button svg` to `display: block`. Keep the existing hover colors and hit-area padding.

- [ ] **Step 4: Remove obsolete selectors**

Delete `.project-folder-emoji` and remove font-size rules that only sized emoji/Unicode glyphs. Keep `.at-picker-icon`, `.resource-icon`, `.timeline-icon`, `.settings-oauth-event-icon`, and `.todo-mark` as semantic layout hooks so component markup stays readable.

- [ ] **Step 5: Run CSS-sensitive component tests and inspect the diff**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `npm test -- --run`

Expected: the complete Vitest suite passes.

## Task 6: Full verification and handoff

**Files:**
- Verify all files changed by Tasks 1–5.

- [ ] **Step 1: Search for remaining UI glyph assets**

Run:

```bash
rg -n --hidden -g '*.tsx' -g '*.css' "📂|📁|📄|💬|↗|⌨|ℹ|✓|✕|▾|▸|＋" src/renderer
```

Expected: no matches in production renderer files. Textual keyboard labels (`⌘`, `⌥`, `⇧`), prose ellipses (`…`), and test-only expected strings are allowed only where they are not being used as an icon.

- [ ] **Step 2: Run typecheck, tests, and production build**

Run: `npm run typecheck`

Expected: pass.

Run: `npm test -- --run`

Expected: all tests pass.

Run: `npm run build`

Expected: Electron main, preload, and renderer bundles build successfully.

- [ ] **Step 3: Review the final file diff**

Run: `git diff --stat` and `git diff --check`.

Confirm that changes are limited to the Lucide icon dependency, adapter, icon call sites, tests, CSS, and the two Lucide design documents; do not stage or revert unrelated existing worktree changes.

- [ ] **Step 4: Commit only the icon migration files**

Stage the new dependency, adapter, renderer component changes, tests, CSS, and implementation plan with an explicit path list. Do not stage unrelated pre-existing modifications. Commit with:

```bash
git commit -m "feat: unify renderer icons with Lucide"
```
