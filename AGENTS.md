# PI Desk

Desktop GUI host around [Pi](https://github.com/earendil-works/pi). Pi owns agent semantics. This repo is the second screen.

## Placement

Four product surfaces, same names in `src/main/` and `src/renderer/`:

| Domain | Owns |
|---|---|
| `app` | Window, IPC router, updates, settings, command palette |
| `session` | PiHost facade, event projection, timeline, composer, plan mode |
| `workspace` | Projects, working-set tabs, sidebar |
| `http` | HTTP workbench store, extension, UI |

`src/main/provider/` is host-only (auth + usage). Renderer provider chrome stays in `session/` (model pill) and `app/` (settings).
`src/renderer/ui/` is primitives with no product logic.
`src/shared/` is the only cross-process contract. `protocol.ts` is `PiApi` + `PiEvent` plus re-exports.

## Rules

- New Pi semantics: forward through `src/main/session/host.ts`. Do not reimplement in React.
- New agent capability: `registerTool` / `registerCommand` in a domain `extension.ts`, or a `packages/*` Pi package.
- New desktop panel: `src/renderer/<domain>/`.
- New IPC field: add the type in `src/shared/<domain>.ts` first.
- Do not create `core/`, `context/`, `utils/`, `helpers/`, or `services/`.
- `packages/` only when there is a second consumer (Pi CLI or a pure engine). HTTP and plan stay under `src/`.

Cross-domain runtime traffic goes through `window.pi`. Renderer must not import `src/main`. Main must not import `src/renderer`.

## Commands

```sh
npm test
npm run typecheck
npm run lint
npm run dev
```
