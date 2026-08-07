# PI Desk Brand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old `Pi Desktop` plus `π` mark with the text-only `PI Desk` wordmark throughout the visible desktop shell.

**Architecture:** Keep the repository and package identifiers as `pi-desk`. Change only the renderer brand markup, document title, brand CSS, and smoke-test expectation; no logo asset or new icon is introduced.

**Tech Stack:** React, TypeScript, Electron Vite, CSS, Vitest, Testing Library.

---

### Task 1: Update the visible brand contract

**Files:**
- Modify: `src/renderer/smoke.test.tsx:10-15`

- [ ] **Step 1: Write the failing test**

Change the smoke test to assert the approved visible product name:

```tsx
describe("PI Desk shell", () => {
  test("renders the PI Desk workspace shell", () => {
    render(<App />);

    expect(screen.getByText("PI Desk")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /message/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run src/renderer/smoke.test.tsx`

Expected: FAIL because the sidebar still renders `Pi Desktop`.

### Task 2: Replace the wordmark and document title

**Files:**
- Modify: `src/renderer/components/SessionSidebar.tsx:308-311`
- Modify: `src/renderer/styles.css:336-361`
- Modify: `src/renderer/index.html:6`

- [ ] **Step 1: Implement the minimal brand change**

Replace the current sidebar brand block:

```tsx
<div className="sidebar-brand" aria-label="PI Desk">
  <span className="brand-title">PI Desk</span>
</div>
```

Remove the obsolete `.brand-mark` CSS rule. Keep `.sidebar-brand` as a simple flex container and set `.brand-title` to the existing Inter UI family with `font-size: 14px`, `font-weight: 600`, `letter-spacing: -0.01em`, and the existing sidebar color. Change the HTML title to:

```html
<title>PI Desk</title>
```

- [ ] **Step 2: Run the brand test to verify it passes**

Run: `npm test -- --run src/renderer/smoke.test.tsx`

Expected: PASS, with no `π` element rendered.

### Task 3: Verify scope and integration

**Files:**
- No additional files; inspect the four files changed above.

- [ ] **Step 1: Verify old visible branding is gone**

Run: `rg -n 'Pi Desktop|>π<|className="brand-mark"' src/renderer/index.html src/renderer/components/SessionSidebar.tsx src/renderer/smoke.test.tsx src/renderer/styles.css`

Expected: no matches.

- [ ] **Step 2: Run type checking**

Run: `npm run typecheck`

Expected: both TypeScript projects exit with code 0.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: Electron Vite completes successfully.

- [ ] **Step 4: Check the diff without staging unrelated work**

Run: `git diff --check -- src/renderer/components/SessionSidebar.tsx src/renderer/styles.css src/renderer/index.html src/renderer/smoke.test.tsx`.

Expected: no whitespace errors. Do not stage or commit the mixed consumer files because the workspace contains unrelated uncommitted changes.
