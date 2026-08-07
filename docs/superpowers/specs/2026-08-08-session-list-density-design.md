# Session List Density Design

## Status

**Approved by the user on 2026-08-08.**

## Goal

Make the session sidebar denser and easier to scan without hiding session history:

- Show each session name and its relative update time on one horizontal row.
- Show the eight most recently updated sessions for each project by default.
- Keep older sessions available inside a collapsed group with an explicit count.

## Scope

The change is limited to the renderer session sidebar and its existing tests/styles. It does not change session storage, IPC, the session catalog API, hidden-session preferences, project expansion preferences, or session actions.

## Interaction design

Each project continues to own its own session list. For a project with more than eight visible sessions:

1. The first eight sessions, ordered newest to oldest by `updatedAt`, render normally.
2. The remaining sessions render only after the user activates a button labeled `还有 N 个较早会话`.
3. The button changes to `收起较早会话` while the older group is open.
4. The older group uses the same session row and context-menu behavior as the recent group.
5. The older group is collapsed by default and its expanded state is local to the current sidebar render; it is not persisted.

When search is active, matching sessions are shown without the eight-session collapse so search results are not hidden behind a second interaction. Existing project expansion behavior remains unchanged: a query opens matching project nodes.

The relative time remains visible, but moves from a second line to the right side of the session-name row. The session name remains the flexible, truncating column; the time stays compact and does not shrink away.

Project rows keep their expand/collapse behavior without a leading chevron. The project button begins with the folder icon and project name; clicking it still selects the project and toggles its session list. The button exposes `aria-expanded` so keyboard and assistive-technology users retain the same state information.

## Component and data flow

`SessionSidebar` already receives or loads all session summaries. The renderer will derive the display groups from the current project session list after existing hidden-session and search filtering:

```text
loaded sessions
  -> hide hidden sessions unless requested
  -> apply search filter
  -> sort by updatedAt descending
  -> recent = first 8
  -> older = remaining sessions
```

No new host or protocol fields are required. A small renderer helper is preferred for the deterministic grouping/sorting behavior so it can be tested independently of Radix context menus and asynchronous loading.

## Styling

The existing `.session-item-text` flex chain will become a single-line row. `.session-title` will keep `flex: 1; min-width: 0` and ellipsis behavior. `.session-meta` will become a non-shrinking trailing label with a small gap and right alignment. The older-session toggle will use the existing muted sidebar control style, with a dedicated class only if needed for spacing/indentation.

## Edge cases

- Zero to eight visible sessions: no older-session toggle is rendered.
- Exactly nine visible sessions: the toggle says `还有 1 个较早会话`.
- Hidden sessions remain excluded unless the existing “Show hidden” control is active; they count only when already visible.
- Search results are never hidden by the older-session grouping.
- A malformed or missing `updatedAt` does not crash rendering; the existing relative-time formatter continues to return an empty label for invalid values.
- Live status overlays, active-session status, rename mode, context menus, deletion confirmation, duplicate, and hide/unhide actions remain unchanged.

## Testing

Add renderer tests covering:

- the relative time appears in the same session row as the name;
- eight sessions render directly and the ninth is initially absent from the DOM;
- the older-session toggle exposes all remaining sessions and can collapse them again;
- search exposes matching older sessions without requiring the toggle;
- project rows do not render a leading expand icon and clicking the project row still toggles its session list;
- the grouping is based on newest `updatedAt`, independent of input order.

Run the focused sidebar tests, then the full test suite and typecheck before reporting completion.
