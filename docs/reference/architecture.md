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

**Mock REPL:** [`src/terminal/mock-repl.ts`](../../src/terminal/mock-repl.ts) is still in the tree but is no longer wired into the view. It remains as a unit-test reference for the seam shape and as offline scaffold.

### 3. Plugin glue

[`src/main.ts`](../../src/main.ts) and [`src/view/TerminalView.ts`](../../src/view/TerminalView.ts). Registers the Obsidian `ItemView`, exposes the `open-terminal` command in the command palette, mounts the renderer into the view, routes input from the renderer to whatever backend is wired in, and installs the container-level keyboard routing handler (see below). The only piece that imports both `obsidian` and the backend interface.

**Status:** Shipped (Phase 2b). The view routes input to a `PtyBackend` instance and surfaces backend errors as red ANSI lines in the xterm buffer.

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

The asymmetric outcome (Cmd → Obsidian, Ctrl → shell) is macOS-specific and intentional. The model and the phasing rationale live in [`docs/explanations/keyboard-handling.md`](../explanations/keyboard-handling.md); the decision record is [ADR 0004](../adr/0004-keyboard-handling-asymmetric-cmd-ctrl.md). Anyone tempted to "simplify" this to a document-level scope or capture-phase listener will reintroduce [FI-007](../../specs/anvil/future-ideas-backlog.md).

## What is not here

- **Settings tab.** No user-configurable settings exist; no `SettingTab` is registered.
- **Multi-instance isolation.** Multiple terminal panes can be opened, but no isolation guarantees beyond what each `TerminalView` provides on its own.
- **Profile picker, tmux attach, shell selection.** Vision items deferred to Phase 3. The shell today is hardcoded to `process.env.SHELL || "/bin/zsh"`, launched at the vault root.
- **Cross-platform support.** macOS Apple silicon only — see [ADR 0001](../adr/0001-macos-arm64-only.md).
