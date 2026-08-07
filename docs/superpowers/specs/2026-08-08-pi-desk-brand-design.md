# PI Desk Brand Design

## Decision

Use `PI Desk` as the visible product name in the desktop UI. The name follows the GitHub repository and package identity (`pi-desk`) while presenting a more intentional product wordmark than `Pi Desktop`.

## Brand treatment

- Render `PI Desk` as a text-only wordmark in the sidebar's top-left brand area.
- Remove the existing `π` glyph and its circular mark completely; do not replace it with another icon.
- Keep the existing Inter typography system: 14px display size, semibold weight, compact tracking, and the current dark-rail colors.
- Use the same `PI Desk` title in the Electron document title.
- Keep technical identifiers unchanged: GitHub repository, npm package, CSS selectors unrelated to the brand, and internal API names remain `pi-desk`.
- Update accessibility labels and smoke-test copy to match the visible product name.

## Scope

- `src/renderer/components/SessionSidebar.tsx`: replace the brand markup with one text wordmark.
- `src/renderer/styles.css`: remove the obsolete mark styling and refine the text-only brand spacing.
- `src/renderer/index.html`: update the document title.
- `src/renderer/smoke.test.tsx`: assert the new visible name.

## Acceptance criteria

1. The sidebar shows `PI Desk` with no `π` glyph or brand icon element.
2. The document title is `PI Desk`.
3. Existing package/repository identifiers remain `pi-desk`.
4. Brand-related tests, type checking, and production build pass.
