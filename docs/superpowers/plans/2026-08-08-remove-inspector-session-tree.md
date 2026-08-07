# Remove Inspector Session Tree Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Session Tree button from the Inspector while preserving the Session Tree dialog and `/tree` backend capability.

**Architecture:** Make a renderer-only entry-point change. `ResourceInspector` no longer exposes or renders `onOpenTree`; `App` stops passing that callback. `TreeDialog`, `SessionTree`, IPC, and PiHost behavior remain unchanged.

**Tech Stack:** React, TypeScript, Vitest, Testing Library.

---

### Task 1: Remove the Inspector entry point

**Files:**
- Modify: `src/renderer/components/ResourceInspector.tsx`
- Modify: `src/renderer/App.tsx`
- Test: `src/renderer/components/ResourceInspector.test.tsx`

- [ ] **Step 1: Write the failing regression test**

Render `ResourceInspector` and assert that no button named `Open session tree` is present. The current header button makes this assertion fail.

- [ ] **Step 2: Run the targeted test and verify it fails**

Run: `npm test -- --run src/renderer/components/ResourceInspector.test.tsx`

Expected: the new absence assertion fails because the Inspector currently renders the Session Tree button.

- [ ] **Step 3: Remove only the Inspector entry wiring**

Delete `onOpenTree` from `ResourceInspectorProps`, remove it from the component destructuring, remove the header button, and remove `onOpenTree={() => setTreeOpen(true)}` from `App.tsx`. Leave `TreeDialog`, `SessionTree`, `getSessionTree`, `forkSession`, and `/tree` unchanged.

- [ ] **Step 4: Run the targeted test and verify it passes**

Run: `npm test -- --run src/renderer/components/ResourceInspector.test.tsx`

Expected: all ResourceInspector tests pass, including the new absence assertion.

- [ ] **Step 5: Run the renderer test suite and type/build checks**

Run: `npm test -- --run src/renderer` and `npm run build`

Expected: exit code 0 with no test failures or TypeScript/build errors.
