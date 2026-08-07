# Pi Parity GUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable Electron + React desktop GUI that exposes Pi Agent's interactive workflow and keeps the real Pi SDK session as the source of truth.

**Architecture:** Electron owns the Pi runtime and filesystem boundary. A typed preload bridge exposes commands and normalized Pi events to a React renderer. The renderer projects those events into a session timeline and resource/status panels; it does not emulate agent behavior or access Node APIs directly.

**Tech Stack:** Electron, React, TypeScript, Vite, Zustand, Zod, Vitest, Playwright, `@earendil-works/pi-coding-agent`.

---

### Task 1: Create the application skeleton and test harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `electron/main.ts`
- Create: `electron/preload.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`
- Create: `src/renderer/styles.css`
- Test: `src/renderer/smoke.test.tsx`

- [ ] **Step 1: Write the failing renderer smoke test**

```tsx
import { render, screen } from "@testing-library/react";
import { App } from "./App";

test("renders the Pi workspace shell", () => {
  render(<App />);
  expect(screen.getByText("Pi Desktop")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: /message/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run `npm test -- --run src/renderer/smoke.test.tsx` and verify it fails because the app files do not exist.**
- [ ] **Step 3: Add the Electron/Vite scripts and minimal app shell.** The `dev` script must start Vite and Electron, `build` must emit a distributable renderer/main bundle, `test` must run Vitest, and `typecheck` must run `tsc --noEmit`.
- [ ] **Step 4: Run the smoke test and typecheck; both must pass.**
- [ ] **Step 5: Commit `chore: scaffold pi desktop app`.**

### Task 2: Define the typed Pi event protocol and renderer state

**Files:**
- Create: `src/shared/protocol.ts`
- Create: `src/renderer/state/appStore.ts`
- Create: `src/renderer/state/appStore.test.ts`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Write failing reducer tests for event projection.** Cover `session_started`, streamed assistant deltas, tool call start/update/end, queue updates, `approval_requested`, `file_changed`, `thinking_level_changed`, `model_changed`, `session_error`, and `session_completed`.
- [ ] **Step 2: Run the focused tests and verify they fail because the reducer and event types are absent.**
- [ ] **Step 3: Define `PiEvent`, `PiSnapshot`, `SessionSummary`, `TimelineItem`, `ToolCallState`, `ApprovalRequest`, `DiffFile`, `ResourceSnapshot`, and `RuntimeDiagnostics` in `src/shared/protocol.ts`. Every event carries `eventId`, `workspaceId`, optional `sessionId`, `timestamp`, `sequence`, `type`, and `payload`.
- [ ] **Step 4: Implement a pure `reducePiEvent(state, event)` and a Zustand store that only applies protocol events or dispatches IPC commands.**
- [ ] **Step 5: Run the focused tests and typecheck; then render the shell from store state.**
- [ ] **Step 6: Commit `feat: add pi event projection state`.**

### Task 3: Connect the Electron host to the real Pi SDK

**Files:**
- Create: `electron/piHost.ts`
- Create: `electron/piHost.test.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/shared/protocol.ts`
- Create: `src/renderer/state/piApi.ts`

- [ ] **Step 1: Write failing host tests using a fake `AgentSession` event source.** Test that `prompt`, `steer`, `followUp`, `abort`, `newSession`, `switchSession`, `fork`, `import`, `compact`, `setModel`, `setThinkingLevel`, `setTools`, and `reload` map to the corresponding Pi runtime method and produce normalized events.
- [ ] **Step 2: Run the focused tests and verify they fail because `PiHost` does not exist.**
- [ ] **Step 3: Implement `PiHost` around `createAgentSessionRuntime` and `AgentSessionRuntime`.** Initialize with the selected cwd, subscribe to `AgentSession` events, expose `SessionManager.list(cwd)`, and translate Pi event payloads without dropping `raw` diagnostics.
- [ ] **Step 4: Register typed IPC handlers in `electron/main.ts` and expose only `window.pi` from `electron/preload.ts`.** The bridge must include `getSnapshot`, `chooseWorkspace`, `prompt`, `steer`, `followUp`, `abort`, `newSession`, `resumeSession`, `forkSession`, `importSession`, `compact`, `setModel`, `setThinkingLevel`, `setTools`, `reload`, `listSessions`, `getResources`, `getModels`, and `getDiagnostics`.
- [ ] **Step 5: Run host tests, typecheck, and a local no-network startup test that creates an in-memory Pi session without sending a model request.**
- [ ] **Step 6: Commit `feat: connect desktop host to pi sdk`.**

### Task 4: Implement the Pi-native desktop interaction shell

**Files:**
- Create: `src/renderer/components/SessionSidebar.tsx`
- Create: `src/renderer/components/Timeline.tsx`
- Create: `src/renderer/components/Composer.tsx`
- Create: `src/renderer/components/FooterStatus.tsx`
- Create: `src/renderer/components/ReviewPanel.tsx`
- Create: `src/renderer/components/ResourceInspector.tsx`
- Create: `src/renderer/components/CommandPalette.tsx`
- Create: `src/renderer/components/SessionTree.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Test: `src/renderer/components/Composer.test.tsx`
- Test: `src/renderer/components/Timeline.test.tsx`

- [ ] **Step 1: Write failing component tests.** Verify the four regions render, the composer distinguishes Prompt/Steer/Follow-up, queued messages are visibly different, Tool Calls can expand, and an approval card exposes Allow/Reject/Stop actions.
- [ ] **Step 2: Run the focused component tests and verify the expected failures.**
- [ ] **Step 3: Implement the dark desktop layout with keyboard-accessible controls.** Keep the central Timeline dominant, use a collapsible right review panel, and keep current model, thinking level, context, token, cache, cost, cwd, and status visible in the footer.
- [ ] **Step 4: Implement keyboard semantics: Enter sends the selected delivery mode, Alt+Enter sends Follow-up, Escape aborts, Shift+Enter inserts a newline, Ctrl+G opens the external editor hook, Ctrl+X copies the last assistant response, Ctrl+L opens model selection, and Ctrl+P opens scoped-model cycling.
- [ ] **Step 5: Run component tests, typecheck, and the renderer build.**
- [ ] **Step 6: Commit `feat: add pi native desktop interaction shell`.**

### Task 5: Expose Pi parity commands, sessions, resources, models, and diffs

**Files:**
- Create: `electron/piCommands.ts`
- Create: `electron/sessionCatalog.ts`
- Create: `electron/diffService.ts`
- Create: `src/renderer/components/SettingsDialog.tsx`
- Create: `src/renderer/components/ModelSelector.tsx`
- Create: `src/renderer/components/DiffViewer.tsx`
- Create: `src/renderer/components/ApprovalCard.tsx`
- Create: `src/renderer/components/PackagePanel.tsx`
- Create: `src/renderer/components/DiagnosticsPanel.tsx`
- Modify: `electron/piHost.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/state/appStore.ts`
- Test: `electron/sessionCatalog.test.ts`
- Test: `electron/diffService.test.ts`
- Test: `src/renderer/components/CommandPalette.test.tsx`

- [ ] **Step 1: Write failing tests for session catalog sorting, unified diff parsing, command registration, and model/thinking state changes.**
- [ ] **Step 2: Run the tests and verify they fail for the missing services/components.**
- [ ] **Step 3: Implement session list/resume/new/fork/clone/import/export/share command plumbing using Pi SessionManager and AgentSessionRuntime rather than copying JSONL logic.
- [ ] **Step 4: Implement the Slash Command palette for Pi's built-in commands (`/login`, `/logout`, `/model`, `/scoped-models`, `/settings`, `/resume`, `/new`, `/name`, `/session`, `/tree`, `/trust`, `/fork`, `/clone`, `/compact`, `/copy`, `/export`, `/import`, `/share`, `/reload`, `/hotkeys`, `/changelog`, `/quit`) and dynamically merge commands registered by Extensions.
- [ ] **Step 5: Implement Resource Inspector, Package panel, Model selector, Settings, Diagnostics, Diff viewer, and Approval card.** Extension commands/tools/events/UI must remain visible in the same timeline and resource model.
- [ ] **Step 6: Run all focused tests, typecheck, and build.**
- [ ] **Step 7: Commit `feat: expose pi parity controls`.**

### Task 6: Add end-to-end startup and Pi interoperability checks

**Files:**
- Create: `tests/e2e/app.spec.ts`
- Create: `tests/fixtures/fixture-project/AGENTS.md`
- Create: `tests/fixtures/fixture-project/.pi/SYSTEM.md`
- Create: `tests/fixtures/fixture-project/package.json`
- Modify: `package.json`

- [ ] **Step 1: Write a Playwright test that launches Electron, selects the fixture project, creates a Session, renders the Pi context files, and verifies the composer, timeline, footer, resource inspector, and diagnostics panel.
- [ ] **Step 2: Run the test and verify the initial failure against the incomplete app.
- [ ] **Step 3: Add a deterministic no-network fake-model mode behind `PI_DESKTOP_TEST_MODE=1` for the E2E fixture only; production startup must continue to use the real Pi SDK and configured providers.
- [ ] **Step 4: Verify the E2E flow, Pi Session JSONL creation, reload/resume, and renderer/main process shutdown.
- [ ] **Step 5: Run the full verification command: `npm test -- --run`, `npm run typecheck`, `npm run build`, and `npm run e2e`.
- [ ] **Step 6: Commit `test: verify pi parity gui startup`.**

### Task 7: Review and integrate the feature branch

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-pi-desktop-workspace-design.md` only if implementation decisions differ from the approved Pi Parity scope.

- [ ] **Step 1: Re-read the Pi Parity definition and acceptance criteria in the design spec.**
- [ ] **Step 2: Compare each requirement against a test, a runtime handler, and a visible UI surface; record any gap instead of claiming completion.
- [ ] **Step 3: Run all tests/build/e2e commands again from a clean worktree and inspect `git diff --check`.
- [ ] **Step 4: Commit any final fixes with a focused message.**
- [ ] **Step 5: Merge the verified `codex/pi-parity-gui` branch into the target branch only after the full verification output is clean.
