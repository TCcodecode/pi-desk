# PI Desk Shell Depth Theme Design

## Goal

Align the application shell with the supplied Codex reference: the side rails remain dark, but are visibly lighter than the central work area. The center becomes the deepest surface so conversation, code, diffs, and tool output have the strongest reading contrast.

## Visual hierarchy

1. Central work area: deepest neutral surface and primary focus.
2. Left navigation rail: medium-dark neutral surface with slightly higher separation from the center.
3. Right inspector: medium-dark neutral surface, distinct from both the center and left rail.
4. Topbar: belongs to the central work area and should not read as a light header.
5. Composer and code surfaces: elevated dark surfaces inside the central area.

## Initial semantic palette

```text
shell-center:       #171717
shell-sidebar:      #242424
shell-inspector:    #2B2B2B
shell-topbar:       #181818
surface-elevated:   #222222
surface-code:       #101010
border-subtle:      #343434
text-primary-dark:  #F1F1F1
text-secondary-dark:#A6A6A6
text-muted-dark:    #707070
accent-primary:     #E4B961
```

These values are starting tokens, not a request to use pure black or white everywhere. Component-specific hover, active, and error states should remain derived from the same neutral hierarchy.

## Scope

- Update the app shell, main column, topbar, left sidebar, right inspector, composer, code/diff surfaces, and their borders/backgrounds.
- Keep the existing typography, spacing, component structure, and interaction behavior unchanged in this pass.
- Preserve the current gold accent, but use it only for active states, primary actions, and status emphasis.
- Keep dialogs and popovers on the dark surface family so they remain visually attached to the central work area.

## Acceptance criteria

- The center is perceptibly darker than both side rails at a glance.
- The left rail and right inspector are distinct from the center without becoming light-mode panels.
- Body text, code, diffs, and tool output retain readable contrast on the central surface.
- Existing light/dark text contrast, hover states, and status colors remain legible.
- No layout dimensions, typography sizes, or component behavior change as part of this pass.

