# New Session Keyboard Shortcut Design

## Goal

Add `⌘N` on macOS (and `Ctrl+N` elsewhere) as a global shortcut for creating a new session.

## Behavior

The shortcut reuses the existing `requestNewSession` flow so it has the same project selection behavior as the sidebar button:

1. Prefer the project associated with the current session cwd.
2. Otherwise use the active project.
3. Otherwise use the first registered project.
4. If no project exists, open the existing project/folder flow.

When a project is available, the existing `handleNewSession(projectId)` path creates an empty session in that project and reserves a working-set tab. The shortcut must prevent the browser/Electron default new-window behavior and must not run when Shift or Alt is held.

## Implementation

- Add a `⌘N`/`Ctrl+N` branch to the renderer's global `keydown` handler in `src/renderer/App.tsx`.
- Call `requestNewSession()` from that branch, keeping project resolution and error handling in one place.
- Add `⌘N` to the keyboard-shortcuts data in `src/renderer/components/HelpDialog.tsx`.
- Do not add a second main-process menu accelerator or new IPC method; the renderer already owns the active project and working-set state.

## Error handling

Existing `requestNewSession` and `handleNewSession` behavior remains authoritative. Failures continue to surface through the existing `pushError` path. `preventDefault()` is applied before dispatching the async action so the shortcut cannot open a new browser window or print-like system action.

## Testing

- Add an app-level regression test that fires `Meta+N` with an active project and verifies a new session is started for that project.
- Assert that the existing session-creation API receives a generated session key, preserving the current multi-session behavior.
- Run the focused renderer tests, then the full test suite and typecheck before completion.
