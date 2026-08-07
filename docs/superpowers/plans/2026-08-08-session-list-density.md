# Denser Session List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the session sidebar denser by placing each relative timestamp beside its session name and collapsing sessions older than the eight most recently updated sessions per project.

**Architecture:** Keep all session loading and existing actions in `SessionSidebar`. Add a small pure renderer helper that copies, sorts, and splits a project’s already-filtered sessions into `recent` and `older` groups. The component owns only transient older-group expansion state; search bypasses the collapse so matching sessions remain visible.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, existing CSS and Radix context-menu components.

---

## Files and responsibilities

- Create: `src/renderer/components/sessionListDisplay.ts` — deterministic recent/older grouping for sidebar sessions.
- Create: `src/renderer/components/sessionListDisplay.test.ts` — unit coverage for descending update order and the eight-session split.
- Modify: `src/renderer/components/SessionSidebar.tsx` — use the helper, manage transient older-group expansion, and render the count toggle.
- Modify: `src/renderer/components/SessionSidebar.test.tsx` — verify inline metadata, collapse/expand behavior, and search visibility.
- Modify: `src/renderer/styles.css` — make name/time a single-line flex row and style the older-session toggle.

No protocol, host, IPC, persistence, or dependency changes are needed.

### Task 1: Add the tested session grouping helper

**Files:**
- Create: `src/renderer/components/sessionListDisplay.test.ts`
- Create: `src/renderer/components/sessionListDisplay.ts`

- [ ] **Step 1: Write the failing unit tests.**

Create `src/renderer/components/sessionListDisplay.test.ts` with a small `SessionSummary` factory and these behaviors:

```ts
import { describe, expect, test } from "vitest";
import type { SessionSummary } from "../../shared/protocol";
import { MAX_VISIBLE_SESSIONS, splitSessionList } from "./sessionListDisplay";

function makeSession(id: string, updatedAt: string): SessionSummary {
  return {
    sessionId: id,
    cwd: "/tmp/project",
    name: id,
    status: "idle",
    model: "",
    thinkingLevel: "medium",
    sessionFile: `/tmp/project/${id}.jsonl`,
    messageCount: 1,
    updatedAt,
  };
}

describe("splitSessionList", () => {
  test("sorts sessions newest first before splitting", () => {
    const sessions = [
      makeSession("old", "2026-08-01T00:00:00.000Z"),
      makeSession("newest", "2026-08-08T00:00:00.000Z"),
      makeSession("middle", "2026-08-04T00:00:00.000Z"),
    ];

    const result = splitSessionList(sessions);

    expect(result.recent.map((item) => item.sessionId)).toEqual(["newest", "middle", "old"]);
    expect(result.older).toEqual([]);
  });

  test("puts sessions after the first eight in the older group", () => {
    const sessions = Array.from({ length: MAX_VISIBLE_SESSIONS + 2 }, (_, index) =>
      makeSession(`session-${index}`, new Date(2026, 7, 8, index).toISOString()),
    );

    const result = splitSessionList(sessions);

    expect(result.recent).toHaveLength(8);
    expect(result.older.map((item) => item.sessionId)).toEqual(["session-1", "session-0"]);
  });
});
```

- [ ] **Step 2: Run the helper tests and confirm the expected missing-module failure.**

Run:

```bash
npm test -- src/renderer/components/sessionListDisplay.test.ts --run
```

Expected: Vitest fails because `./sessionListDisplay` does not exist yet; it must not fail because of a test syntax error.

- [ ] **Step 3: Implement the minimal helper.**

Create `src/renderer/components/sessionListDisplay.ts`:

```ts
import type { SessionSummary } from "../../shared/protocol";

export const MAX_VISIBLE_SESSIONS = 8;

export interface SessionListGroups {
  recent: SessionSummary[];
  older: SessionSummary[];
}

export function splitSessionList(
  sessions: SessionSummary[],
  visibleLimit: number = MAX_VISIBLE_SESSIONS,
): SessionListGroups {
  const sorted = [...sessions].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt);
    const rightTime = Date.parse(right.updatedAt);
    if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
    if (Number.isNaN(leftTime)) return 1;
    if (Number.isNaN(rightTime)) return -1;
    return rightTime - leftTime;
  });

  return {
    recent: sorted.slice(0, visibleLimit),
    older: sorted.slice(visibleLimit),
  };
}
```

- [ ] **Step 4: Run the helper tests and confirm they pass.**

Run the same Vitest command. Expected: 2 tests pass with 0 failures.

- [ ] **Step 5: Commit the isolated helper.**

```bash
git add src/renderer/components/sessionListDisplay.ts src/renderer/components/sessionListDisplay.test.ts
git commit -m "feat: group older sessions for sidebar display"
```

### Task 2: Add component-level red tests for inline time and collapse behavior

**Files:**
- Modify: `src/renderer/components/SessionSidebar.test.tsx`

- [ ] **Step 1: Strengthen the existing time test.**

Keep the existing setup but assert that `.session-title` and `.session-meta` share the same `.session-item-text` parent, so the test describes the required inline layout without depending on CSS computed styles:

```ts
test("shows relative time beside the session name", async () => {
  renderSidebar();
  const name = await screen.findByText("My session");
  const rowText = name.closest(".session-item-text");

  expect(rowText).not.toBeNull();
  expect(rowText?.querySelector(".session-meta")?.textContent).toBeTruthy();
});
```

- [ ] **Step 2: Add the failing collapse/expand test.**

Add a test that supplies ten sessions in reverse chronological input order. It must verify eight direct rows, two hidden older rows, the count label, and both toggle directions:

```tsx
test("collapses sessions after the eight most recently updated", async () => {
  const manySessions = Array.from({ length: 10 }, (_, index) => ({
    ...session,
    sessionId: `session-${index}`,
    name: `Session ${index}`,
    sessionFile: `/tmp/p/session-${index}.jsonl`,
    updatedAt: new Date(2026, 7, 8, index).toISOString(),
  }));
  renderSidebar({
    sessions: manySessions,
    loadSessions: vi.fn(async () => [...manySessions].reverse()),
  });

  expect(await screen.findByText("Session 9")).toBeInTheDocument();
  expect(screen.queryByText("Session 1")).not.toBeInTheDocument();

  const toggle = screen.getByRole("button", { name: "还有 2 个较早会话" });
  fireEvent.click(toggle);
  expect(screen.getByText("Session 1")).toBeInTheDocument();
  expect(screen.getByText("Session 0")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "收起较早会话" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "收起较早会话" }));
  expect(screen.queryByText("Session 1")).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Add the failing search exception test.**

```tsx
test("search shows matching older sessions without the collapse toggle", async () => {
  const manySessions = Array.from({ length: 10 }, (_, index) => ({
    ...session,
    sessionId: `session-${index}`,
    name: index === 0 ? "Older matching session" : `Session ${index}`,
    sessionFile: `/tmp/p/session-${index}.jsonl`,
    updatedAt: new Date(2026, 7, 8, index).toISOString(),
  }));
  renderSidebar({
    sessions: manySessions,
    loadSessions: vi.fn(async () => manySessions),
  });

  const search = screen.getByRole("searchbox", { name: /search sessions/i });
  fireEvent.change(search, { target: { value: "older matching" } });

  expect(await screen.findByText("Older matching session")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /较早会话/ })).not.toBeInTheDocument();
});
```

- [ ] **Step 4: Run the focused sidebar tests and verify these new tests fail for the missing behavior.**

Run:

```bash
npm test -- src/renderer/components/SessionSidebar.test.tsx --run
```

Expected: the existing sidebar tests may pass, but the new grouping test fails because the component still renders every session flat and the current row metadata is stacked.

### Task 3: Implement grouping, transient toggle state, and inline metadata

**Files:**
- Modify: `src/renderer/components/SessionSidebar.tsx`

- [ ] **Step 1: Import the grouping helper and add local state.**

Add:

```ts
import { MAX_VISIBLE_SESSIONS, splitSessionList } from "./sessionListDisplay";
```

Near the other sidebar UI state, add:

```ts
const [expandedOlderProjects, setExpandedOlderProjects] = useState<Record<string, boolean>>({});
```

Inside the project render, after the existing hidden/search filtering, derive:

```ts
const sessionGroups = splitSessionList(projectSessions, MAX_VISIBLE_SESSIONS);
const showOlderSessions = Boolean(q) || expandedOlderProjects[project.id] === true;
const renderedSessions = q || showOlderSessions
  ? [...sessionGroups.recent, ...sessionGroups.older]
  : sessionGroups.recent;
```

- [ ] **Step 2: Render the recent/older groups through one session-row map.**

Change the existing `projectSessions.map(...)` to `renderedSessions.map(...)`, preserving the current row body and context-menu handlers. This keeps rename, active/live status, hide/unhide, duplicate, reveal, copy, and delete behavior identical for both groups.

After the rendered row map, add the toggle only when there are older sessions and no active search:

```tsx
{sessionGroups.older.length > 0 && !q ? (
  <button
    type="button"
    className="session-older-toggle"
    aria-expanded={showOlderSessions}
    onClick={() => {
      setExpandedOlderProjects((prev) => ({
        ...prev,
        [project.id]: !prev[project.id],
      }));
    }}
  >
    {showOlderSessions ? "收起较早会话" : `还有 ${sessionGroups.older.length} 个较早会话`}
  </button>
) : null}
```

The existing empty-state branch remains based on `projectSessions.length`, so a project with no matching sessions still says `No matching sessions` during search.

- [ ] **Step 3: Run the focused sidebar tests and confirm they pass.**

Run:

```bash
npm test -- src/renderer/components/SessionSidebar.test.tsx --run
```

Expected: all sidebar tests pass, including the new inline-time, collapse/expand, and search tests.

- [ ] **Step 4: Commit the component behavior.**

```bash
git add src/renderer/components/SessionSidebar.tsx src/renderer/components/SessionSidebar.test.tsx
git commit -m "feat: collapse older sidebar sessions"
```

### Task 4: Adjust CSS for the compact row and toggle

**Files:**
- Modify: `src/renderer/styles.css:292-308`

- [ ] **Step 1: Make the session text container a single-line flex row.**

Update the existing rules to:

```css
.session-item-text {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: baseline;
  gap: 8px;
  text-align: left;
}
.session-title {
  flex: 1;
  min-width: 0;
}
.session-meta {
  flex-shrink: 0;
  overflow: hidden;
  color: #6f6f6f;
  font-size: 10.5px;
  line-height: 1.2;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-item.nested.active .session-meta { color: #8f8f8f; }
```

Remove the old column-only properties from `.session-item-text` (`flex-direction: column` and `gap: 1px`) and the old block-only properties from `.session-title` (`display: block` and `line-height: 1.35`). The title still ellipsizes because the shared overflow/min-width/text-overflow/white-space rules remain.

- [ ] **Step 2: Add a muted, indented toggle style.**

Add near `.project-session-empty`:

```css
.session-older-toggle {
  width: 100%;
  padding: 6px 8px;
  border-radius: 7px;
  color: #7e7e7e;
  background: transparent;
  font-size: 11px;
  text-align: left;
}
.session-older-toggle:hover {
  color: #d4d4d4;
  background: #212121;
}
```

- [ ] **Step 3: Run the focused tests after the CSS change.**

Run:

```bash
npm test -- src/renderer/components/SessionSidebar.test.tsx src/renderer/components/sessionListDisplay.test.ts --run
```

Expected: all focused tests pass. CSS is validated by the DOM structure test and the production build in the final task.

### Task 5: Full verification and handoff

**Files:**
- No additional files.

- [ ] **Step 1: Run the complete test suite.**

```bash
npm test -- --run
```

Expected: Vitest exits with code 0 and reports zero failed tests.

- [ ] **Step 2: Run typecheck.**

```bash
npm run typecheck
```

Expected: both TypeScript projects finish with no diagnostics.

- [ ] **Step 3: Run the production build.**

```bash
npm run build
```

Expected: electron-vite exits with code 0 and produces the renderer/main bundles.

- [ ] **Step 4: Inspect the final diff and verify scope.**

```bash
git diff d0172cd..HEAD --check
git status --short
git show --stat --oneline d0172cd..HEAD
```

Confirm the implementation commits contain only the helper, sidebar component/tests, and CSS changes; existing unrelated worktree changes remain untouched.

### Follow-up Task 6: Remove the leading project chevron while preserving collapse

**Files:**
- Modify: `src/renderer/components/SessionSidebar.test.tsx`
- Modify: `src/renderer/components/SessionSidebar.tsx:385-415`
- Modify: `src/renderer/styles.css:154-164`

- [ ] **Step 1: Write the failing project-row test.**

Add this test to `SessionSidebar.test.tsx`:

```tsx
test("project row toggles sessions without a leading expand button", async () => {
  const onSelectProject = vi.fn();
  renderSidebar({ onSelectProject });
  await screen.findByText("My session");

  const projectButton = screen.getByRole("button", { name: "Select project p" });
  expect(screen.queryByRole("button", { name: "Collapse p" })).not.toBeInTheDocument();
  expect(projectButton.querySelector(".project-folder-icon")).toBeInTheDocument();
  expect(projectButton).toHaveAttribute("aria-expanded", "true");

  fireEvent.click(projectButton);
  expect(onSelectProject).toHaveBeenCalledWith("/tmp/p");
  expect(projectButton).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("My session")).not.toBeInTheDocument();

  fireEvent.click(projectButton);
  expect(projectButton).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("My session")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and confirm it fails on the old project-row behavior.**

```bash
npm test -- src/renderer/components/SessionSidebar.test.tsx --run
```

Expected: the new test fails because the chevron button still exists, the project button has no `aria-expanded`, and clicking the project button does not collapse an already-open project.

- [ ] **Step 3: Move the collapse trigger onto the project button.**

Remove the standalone `project-twistie-btn` block and its `AppIcon` from `SessionSidebar.tsx`. Update the project button to carry the state and toggle it:

```tsx
<button
  type="button"
  className="project-node-toggle"
  aria-current={active ? "true" : undefined}
  aria-expanded={open}
  aria-label={`Select project ${project.name}`}
  title={`${project.path}\nClick to set as New session target`}
  onClick={() => {
    onSelectProject(project.id);
    setProjectExpanded(project.id, !open);
  }}
>
  <span className="project-folder-icon" aria-hidden>
    <AppIcon name="folder" size="sm" />
  </span>
  <span className="project-node-name">{project.name}</span>
</button>
```

Remove the now-unused `.project-twistie-btn` CSS block. The existing project row padding and folder icon styles keep the folder/name aligned at the start of the row.

- [ ] **Step 4: Run the focused sidebar tests and confirm the new behavior passes.**

```bash
npm test -- src/renderer/components/SessionSidebar.test.tsx --run
```

Expected: all sidebar tests pass, including the new no-chevron and toggle test.

- [ ] **Step 5: Run final verification for the follow-up.**

```bash
npm test -- --run
npm run typecheck
npm run build
```

Expected: 0 test failures, no TypeScript diagnostics, and a successful electron-vite build.
