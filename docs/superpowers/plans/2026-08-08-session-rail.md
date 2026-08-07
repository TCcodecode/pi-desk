# Session Rail Implementation Plan

> **For agentic workers:** Implement against `docs/superpowers/specs/2026-08-08-session-rail-design.md`.

**Goal:** Left sidebar as work-memory index (Resume / Find / Attention / Safe declutter) using Radix headless + custom CSS.

**Architecture:** Domain logic stays in Pi host + catalog; sidebar owns list cache and UI; Radix provides context menu + alert dialog.

**Tech Stack:** React 19, `@radix-ui/react-context-menu`, `@radix-ui/react-alert-dialog`, existing `styles.css`, Vitest.

---

## PR1 — Done (this change set)

- [x] Radix deps + design constraint documented
- [x] `formatRelativeTime` + tests
- [x] Session row: relative time + status dots (active status overlay)
- [x] Search clear; search forces expand; default expand only active project
- [x] Delete… → Radix AlertDialog; Cancel does not delete
- [x] Active delete → `disposeRuntime` (not `newSession`); main empty state + New session CTA
- [x] Incremental refresh when parent `sessions` changes (cwd-scoped)
- [x] Sidebar tests expanded; deleteSession host test updated

## PR2 — Project lifecycle

- [x] Expose `removeProject` via host / IPC / preload / protocol
- [x] Project context menu (Radix): Remove from list, Copy path, Reveal in Finder
- [x] `shell.showItemInFolder` bridge

## PR3 — Main CTA + chrome

- [x] Top “New session” for active project
- [x] Settings footer shows model · thinking
- [x] Persist expand map in `localStorage`
- [x] Duplicate non-active (open-then-clone)

## PR4 — Declutter

- [x] Local hide set for sessions (+ Show N hidden)
- [x] Dead CSS cleanup

## Session Tabs (iTerm-style)

- [x] PR-T1: openTabs store helpers, SessionTabBar, App wire-up, ⌘1–9, abort-on-switch
- [ ] PR-T2: polish (drag reorder, ⌘W/⌘T) — optional
