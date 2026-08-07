# Pi Desk Typography System Design

## Goal

为 Pi Desk 建立一套在 Windows 和 macOS 上视觉稳定、可商用、层级清晰的字体系统，并统一界面文字、代码文字和快捷键的字体、字号、字重、行高与数字排版。

## Chosen direction

- UI font: `Inter Variable`, bundled with the renderer through `@fontsource-variable/inter`.
- Monospace font: `IBM Plex Mono`, bundled at the weights used by the UI through `@fontsource/ibm-plex-mono`.
- CJK fallback: platform CJK fonts for the current English-first UI; add a bundled CJK family only when localized UI copy is introduced.
- Commercial distribution: both selected font packages are OFL-1.1 fonts. Keep the package license notices in the shipped dependency tree and do not sell the fonts as standalone assets.

## Typography tokens

The renderer will use semantic CSS tokens rather than isolated font values:

| Token | Value | Use |
| --- | --- | --- |
| `--font-ui` | Inter, system fallback | All UI and message text |
| `--font-mono` | IBM Plex Mono, system fallback | Code, paths, diagnostics, shortcuts |
| `--text-xs` | 10px / 14px | Dense status and diagnostic metadata only |
| `--text-sm` | 11px / 16px | Secondary metadata and section labels |
| `--text-ui` | 12px / 16px | Buttons, controls, tabs, compact UI |
| `--text-body` | 13px / 20px | Sidebar, dialogs, activity text |
| `--text-message` | 13.5px / 21px | User and assistant messages |
| `--text-title` | 15px / 20px | Dialog and panel titles |
| `--text-display` | 24px / 32px | Empty-state and welcome headings |

Normal user-facing copy will not use 8px or 9px text. Those sizes remain only for highly compact diagnostic/status labels where the surrounding context already explains the value.

Weights are limited to 400 for reading text, 500 for controls and values, and 600 for headings, active labels, and emphasized actions. Numeric values use tabular figures where alignment matters.

## Shortcut treatment

`ShortcutKeys` will be the shared renderer for topbar hints and help-dialog keycaps. It will render platform-specific key labels (`⌘` on macOS, `Ctrl` on Windows/Linux) as individual key tokens and use `IBM Plex Mono` for stable glyph widths.

- Topbar: compact, low-contrast inline shortcut tokens.
- Help dialog: 24px keycaps with a 2px lower edge and 11px mono text.
- Footer hints: the same keycap primitive with wrapping enabled.

## Scope

The implementation covers the root font loading and tokens, sidebar, topbar/session tabs, composer, timeline/markdown, inspector, command/session dialogs, settings/trust dialogs, and help/shortcut presentation. Existing colors, spacing, icon choices, and interaction behavior remain unchanged unless a typography adjustment requires a small alignment correction.

## Acceptance criteria

1. Fonts are bundled into the Electron renderer and do not depend on network availability or the host OS's Inter installation.
2. `ShortcutKeys` is used by the topbar and help dialog, with platform-aware labels and accessible text.
3. User-facing UI text follows the semantic scale and no longer relies on the current scattered 8–9px defaults.
4. Code, paths, diagnostics, and shortcuts use the mono family consistently.
5. Existing tests, type checking, and production build pass.
