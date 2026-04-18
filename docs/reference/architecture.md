# Architecture

A factual map of the moving pieces in the Obsidian Terminal Plugin and how they connect. This document does not justify the design — for the *why* behind any decision, see the relevant ADR under [`../adr/`](../adr/).

## Three pieces

The plugin is composed of three logical parts.

### 1. xterm.js renderer

[`src/terminal/xterm-host.ts`](../../src/terminal/xterm-host.ts). A thin wrapper around `@xterm/xterm` and `@xterm/addon-fit`. Owns the terminal lifecycle: init, mount into a DOM container, write bytes to the buffer, reflow on resize via `ResizeObserver` plus `FitAddon`, dispose on detach. Knows about xterm.js APIs and DOM only — no `obsidian` import, runnable in any element.

### 2. PTY backend

A standalone Rust binary at [`bin/pty-server`](../../pty-server/) (built from the sibling `pty-server/` cargo package) plus the TypeScript driver in [`src/pty/`](../../src/pty/). The binary owns the pseudoterminal and the spawned shell. The plugin spawns the binary as a subprocess, reads the discovered port from its first stdout line, and connects over a `127.0.0.1` WebSocket. Both directions of terminal IO travel as base64-wrapped JSON frames; resize is a separate frame on the same socket.

The TypeScript side defines a [`TerminalBackend`](../../src/pty/terminal-backend.ts) interface (`start`, `write`, `resize`, `onData`, `onExit`, `close`); [`PtyBackend`](../../src/pty/pty-backend.ts) is the production implementation that owns the child process and the WebSocket. One `PtyBackend` per tab; no shared state, no port pooling, no multiplexing at the backend. The decision and tradeoffs are recorded in [ADR 0003](../adr/0003-pty-backend.md). See [`pty-backend.md`](pty-backend.md) for the full reference.

**Multi-instance isolation** is per-tab and inherited from the container shape. Each tab inside the container view owns its own `PtyBackend`, so process-level isolation between terminals is a consequence of the per-tab architecture. Tab-group isolation (note-tab operations cannot replace or sibling-into the container leaf) is carried by `view.navigation = false` on `TerminalContainerView` plus its placement as a direct child of `rootSplit` with no `WorkspaceTabs` wrapper. [`tests/e2e/tab-isolation.e2e.ts`](../../tests/e2e/tab-isolation.e2e.ts) pins both properties. See [ADR 0006](../adr/0006-workspace-container.md) for the container decision.

**Mock REPL:** [`src/terminal/mock-repl.ts`](../../src/terminal/mock-repl.ts) is still in the tree but is no longer wired into the view. It remains as a unit-test reference for the seam shape and as offline scaffold.

### 3. Plugin glue

[`src/main.ts`](../../src/main.ts) and [`src/view/TerminalContainerView.ts`](../../src/view/TerminalContainerView.ts).

`main.ts` loads and normalizes persisted settings, registers the `TerminalContainerView` view type, exposes the `open-terminal` command, registers the `AnvilSettingsTab`, and wires the profile picker — discover available shells, discover tmux sessions, open [`ProfilePickerModal`](../../src/picker/profile-picker.ts), call `openTerminalWithSpec` with the chosen spec. `openTerminalWithSpec` either reuses the existing container leaf or creates one via `getOrCreateContainerView` + `allocateContainerLeaf`, then calls `container.addTab(spec)`. `main.ts` also subscribes to the workspace `layout-change` event and runs two reconcilers on every fire: `reconcileWrap` (closes the FI-012 wrapper when the container leaf goes away) and `reconcileEmptySibling` (see [Workspace layout](#workspace-layout) below).

`TerminalContainerView` ([`src/view/TerminalContainerView.ts`](../../src/view/TerminalContainerView.ts)) is a single `ItemView` that hosts N xterm tabs. It draws its own chrome into `containerEl.children[1]`: a tab strip (`.anvil-terminal-tabstrip`) containing a tab list (`.anvil-terminal-tab-list`) and a persistent `+` affordance (`.anvil-terminal-tab-add`); a content area (`.anvil-terminal-content`) holding per-tab panes (`.anvil-terminal-pane`); and a reserved bottom buffer (`.anvil-terminal-bottom-buffer`). Each tab owns its own `XtermHost` + `PtyBackend` pair; tab switching toggles `display: none` on sibling panes — backends and xterm instances stay live across switches. The view exposes `addTab`, `switchTab`, `closeTab`, `getTabIds`, `getActiveTabId`, `getActiveHost`, and `getActiveBackend`. `view.navigation = false` is load-bearing — it prevents Obsidian's leaf-picker from landing markdown opens inside the container. Container height is persisted in-session: a `ResizeObserver` on `leaf.containerEl` snapshots the height onto the plugin; on reopen, the saved height is applied via `leaf.dimension` + `parent.recomputeChildrenDimensions()`, or via inline flex when the container is the only child.

The profile picker is a `SuggestModal` subclass at [`src/picker/profile-picker.ts`](../../src/picker/profile-picker.ts), with the section-aware data model in [`src/picker/picker-items.ts`](../../src/picker/picker-items.ts). Section headers render as decorated sibling DOM rather than selectable items; see [ADR 0005](../adr/0005-picker-section-labels-as-decorated-siblings.md).

The settings tab lives in [`src/settings/`](../../src/settings/): [`settings.ts`](../../src/settings/settings.ts) defines the `AnvilSettings` shape and the `normalizeSettings` loader; [`settings-tab.ts`](../../src/settings/settings-tab.ts) is the `PluginSettingTab` subclass. Current fields: `defaultShell`, `userShellList`, `preserveTmuxDimensions`.

## How they connect

Live data flow for one tab:

```
keystroke    → xterm textarea  → host.onData   → backend.write
             → WebSocket frame → pty-server    → PTY → shell

shell output → pty-server      → WebSocket frame → backend.onData
             → host.write      → xterm buffer

resize       → host.onResize   → backend.resize → WebSocket frame → PTY
```

The renderer never sees Obsidian. The backend never sees Obsidian. Only the glue does.

## Keyboard routing

Per-tab. `TerminalContainerView.addTab` installs a keydown listener on the tab's pane element in the bubble phase. The handler calls `stopPropagation()` only when the event has `ctrlKey && !metaKey`. Cmd-modified keys bubble normally to Obsidian's keymap; Ctrl-modified keys reach xterm at target phase and are then stopped from continuing up. Plain unmodified keys aren't touched.

The asymmetric outcome (Cmd → Obsidian, Ctrl → shell) is macOS-specific and intentional. The model and phasing rationale live in [`docs/explanations/keyboard-handling.md`](../explanations/keyboard-handling.md); the decision record is [ADR 0004](../adr/0004-keyboard-handling-asymmetric-cmd-ctrl.md).

## Workspace layout

The container leaf lives as a direct child of `rootSplit`, not wrapped in a `WorkspaceTabs`. `allocateContainerLeaf` in `main.ts` prefers `workspace.createLeafInParent(rootSplit, index)` when available; when the API is absent it falls back to `workspace.getLeaf("split", "horizontal")` and sets a `window.__anvilFallbackWarned` flag.

**FI-012 wrap-and-dock.** [`src/dock/wrap-and-dock.ts`](../../src/dock/wrap-and-dock.ts) is the open/close recipe that preserves side-by-side columns when the container opens. `createWrapAndDock` feature-detects `workspace.createLeafBySplit`, `rootSplit.insertChild`, `rootSplit.removeChild`, and `rootSplit.setDirection` (`canWrap`). When `rootSplit` has ≥ 2 children and all four are present, `openWithWrap` hijacks `createLeafBySplit` to build a nested `WorkspaceSplit` around the existing children, flips the wrapper back to the original direction, and flips `rootSplit` to horizontal so the container can dock as a full-width row below. `closeWithUnwrap` drains the wrapper's children back into `rootSplit` and restores the original direction. When `canWrap` is false or `rootSplit` has < 2 children, `openWithWrap` returns `null` and `allocateContainerLeaf` falls back to flipping `rootSplit.direction` directly. [ADR 0007](../adr/0007-fi-012-wrap-and-dock.md) records the decision. [`tests/e2e/fi-012-wrap-and-dock.e2e.ts`](../../tests/e2e/fi-012-wrap-and-dock.e2e.ts) pins the forward and reverse paths.

**Empty-sibling reconciler.** `reconcileEmptySibling` in `main.ts` runs on every `layout-change`. If the container is open and would otherwise be the only leaf under `rootSplit`, it injects a native empty leaf as a sibling via `workspace.getLeaf("split", "horizontal")` + `rootSplit.removeChild` / `rootSplit.insertChild` to place the new wrapper at index 0. Guarded by the `insertingEmptySibling` reentrancy flag and by a `createLeafInParent` feature-detect. Covers the "user closed the last note while the terminal was open" case so the note area never disappears.

## What is not here

- **Cross-platform support.** macOS Apple silicon only — see [ADR 0001](../adr/0001-macos-arm64-only.md).
