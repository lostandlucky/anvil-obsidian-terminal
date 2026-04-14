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

[`src/main.ts`](../../src/main.ts) and [`src/view/TerminalView.ts`](../../src/view/TerminalView.ts). Registers the Obsidian `ItemView`, exposes the `open-terminal` command in the command palette, mounts the renderer into the view, routes input from the renderer to whatever backend is wired in, and manages the hotkey guard. The only piece that imports both `obsidian` and the backend interface.

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

## The hotkey guard

A load-bearing piece of glue worth calling out. `TerminalView` pushes a `Scope` onto Obsidian's `app.keymap` whenever the terminal container is focused, and pops it on focus out. The scope handles every modified chord pattern (`Mod`, `Mod+Shift`, `Mod+Alt`, `Mod+Shift+Alt`, `Ctrl`, `Ctrl+Shift`, `Ctrl+Alt`, `Alt`) with a wildcard key, so chord hotkeys like Cmd-P and Ctrl-C don't fire Obsidian commands while the terminal is focused. Plain unmodified keys are not blocked — xterm's textarea still receives ordinary typing. This part of the glue is the most likely to bite future-you if it is weakened.

## What is not here

- **Settings tab.** No user-configurable settings exist; no `SettingTab` is registered.
- **Multi-instance isolation.** Multiple terminal panes can be opened, but no isolation guarantees beyond what each `TerminalView` provides on its own.
- **Profile picker, tmux attach, shell selection.** Vision items deferred to Phase 3. The shell today is hardcoded to `process.env.SHELL || "/bin/zsh"`, launched at the vault root.
- **Cross-platform support.** macOS Apple silicon only — see [ADR 0001](../adr/0001-macos-arm64-only.md).
