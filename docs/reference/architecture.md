# Architecture

A factual map of the moving pieces in the Obsidian Terminal Plugin and how they connect. This document does not justify the design — for the *why* behind any decision, see the relevant ADR under [`../adr/`](../adr/).

## Three pieces

The plugin is composed of three logical parts. All three ship as of Phase 2b.

### 1. xterm.js renderer

[`src/terminal/xterm-host.ts`](../../src/terminal/xterm-host.ts). A thin wrapper around `@xterm/xterm` and `@xterm/addon-fit`. Owns the terminal lifecycle: init, mount into a DOM container, write bytes to the buffer, reflow on resize via `ResizeObserver` plus `FitAddon`, dispose on detach. Knows about xterm.js APIs and DOM only — no `obsidian` import, runnable in any element.

**Status:** Shipped (Phase 1).

### 2. PTY backend

A standalone Rust binary at [`bin/pty-server`](../../pty-server/) (built from the sibling `pty-server/` cargo package) plus the TypeScript driver in [`src/pty/`](../../src/pty/). The binary owns the pseudoterminal and the spawned shell. The plugin spawns the binary as a subprocess, reads the discovered port from its first stdout line, and connects over a `127.0.0.1` WebSocket. Both directions of terminal IO travel as base64-wrapped JSON frames; resize is a separate frame on the same socket.

The TypeScript side defines a [`TerminalBackend`](../../src/pty/terminal-backend.ts) interface (`start`, `write`, `resize`, `onData`, `onExit`, `close`); [`PtyBackend`](../../src/pty/pty-backend.ts) is the production implementation that owns the child process and the WebSocket. The view consumes only this interface — see [`pty-backend.md`](pty-backend.md) for the full reference.

**Status:** Shipped (Phase 2b). One backend per terminal view, one binary per backend; no shared state, no port pooling, no multiplexing. The decision and tradeoffs are recorded in [ADR 0003](../adr/0003-pty-backend.md).

**Multi-instance isolation** is per-instance and inherited from the dock placement — the plugin does not implement a central coordinator. Each `TerminalView` owns its own `PtyBackend`, so process-level isolation between terminals is a consequence of the per-instance architecture. Tab-group isolation (note-tab operations cannot replace or sibling-into the terminal leaf) is provided by Obsidian's default workspace semantics under `rootSplit`; [`tests/e2e/tab-isolation.e2e.ts`](../../tests/e2e/tab-isolation.e2e.ts) is a verify-don't-implement suite that pins this behavior. [`tests/e2e/multi-instance.e2e.ts`](../../tests/e2e/multi-instance.e2e.ts) pins the per-instance side.

**Mock REPL:** [`src/terminal/mock-repl.ts`](../../src/terminal/mock-repl.ts) is still in the tree but is no longer wired into the view. It remains as a unit-test reference for the seam shape and as offline scaffold.

### 3. Plugin glue

[`src/main.ts`](../../src/main.ts) and [`src/view/TerminalView.ts`](../../src/view/TerminalView.ts). `main.ts` loads and normalizes persisted settings, registers the Obsidian `ItemView`, exposes the `open-terminal` command, registers the `AnvilSettingsTab`, and wires the profile picker — discover available shells, discover tmux sessions, open [`ProfilePickerModal`](../../src/picker/profile-picker.ts), launch a terminal with the chosen spec. `TerminalView` mounts the renderer into the view, routes input from the renderer to whatever backend is wired in, and installs the container-level keyboard routing handler (see below). This is the only layer that imports both `obsidian` and the backend interface.

**Status:** Shipped (Phase 2b). The view routes input to a `PtyBackend` instance and surfaces backend errors as red ANSI lines in the xterm buffer.

The profile picker is a `SuggestModal` subclass at [`src/picker/profile-picker.ts`](../../src/picker/profile-picker.ts), with the section-aware data model in [`src/picker/picker-items.ts`](../../src/picker/picker-items.ts). Section headers render as decorated sibling DOM rather than selectable items; see [ADR 0005](../adr/0005-picker-section-labels-as-decorated-siblings.md).

The settings tab lives in [`src/settings/`](../../src/settings/): [`settings.ts`](../../src/settings/settings.ts) defines the `AnvilSettings` shape and the `normalizeSettings` loader; [`settings-tab.ts`](../../src/settings/settings-tab.ts) is the `PluginSettingTab` subclass. Current fields: `defaultShell`, `userShellList`, `preserveTmuxDimensions`.

## How they connect

Live data flow:

```
keystroke    → xterm textarea  → host.onData   → backend.write
             → WebSocket frame → pty-server    → PTY → shell

shell output → pty-server      → WebSocket frame → backend.onData
             → host.write      → xterm buffer

resize       → host.onResize   → backend.resize → WebSocket frame → PTY
```

The renderer never sees Obsidian. The backend never sees Obsidian. Only the glue does.

## Keyboard routing

A load-bearing piece of glue worth calling out. `TerminalView` installs a single keydown listener on the terminal container element in the **bubble phase**. The handler calls `stopPropagation()` only when the event has `ctrlKey && !metaKey`. Cmd-modified keys are left alone and bubble normally to Obsidian's keymap; Ctrl-modified keys reach xterm at target phase (so the textarea can write the right control byte to the PTY) and are then stopped from continuing up to any document-level Obsidian listener. Plain unmodified keys aren't touched — xterm's textarea receives ordinary typing as usual.

The asymmetric outcome (Cmd → Obsidian, Ctrl → shell) is macOS-specific and intentional. The model and the phasing rationale live in [`docs/explanations/keyboard-handling.md`](../explanations/keyboard-handling.md); the decision record is [ADR 0004](../adr/0004-keyboard-handling-asymmetric-cmd-ctrl.md). Anyone tempted to "simplify" this to a document-level scope or capture-phase listener will reintroduce the bug ADR 0004 exists to prevent.

## What is not here

- **Cross-platform support.** macOS Apple silicon only — see [ADR 0001](../adr/0001-macos-arm64-only.md).
