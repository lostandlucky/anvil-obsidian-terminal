# Architecture

A factual map of the moving pieces in the Obsidian Terminal Plugin and how they connect. This document does not justify the design — for the *why* behind any decision, see the relevant ADR under [`../adr/`](../adr/).

## Three pieces

The plugin is composed of three logical parts. Two of them ship in Phase 1; the third is reserved for Phase 2.

### 1. xterm.js renderer

[`src/terminal/xterm-host.ts`](../../src/terminal/xterm-host.ts). A thin wrapper around `@xterm/xterm` and `@xterm/addon-fit`. Owns the terminal lifecycle: init, mount into a DOM container, write bytes to the buffer, reflow on resize via `ResizeObserver` plus `FitAddon`, dispose on detach. Knows about xterm.js APIs and DOM only — no `obsidian` import, runnable in any element.

**Status:** Shipped (Phase 1).

### 2. PTY backend

The component that will create a pseudoterminal, spawn a shell process, forward bytes between the shell's stdio and the renderer, and resize the PTY when the pane resizes.

**Status:** Not built. Phase 2 will pick the implementation from three candidates documented in the meta-plan: a Python `pty` helper, a Rust binary over WebSocket, or `node-pty` with prebuilt binaries. The decision will be recorded in the reserved ADR slot at [`../adr/0003-pty-backend.md`](../adr/0003-pty-backend.md).

**Stand-in today:** [`src/terminal/mock-repl.ts`](../../src/terminal/mock-repl.ts) — an in-process command parser that understands `help`, `echo`, `clear`, and `colors`. It is not a PTY, does not spawn a process, and will be replaced.

### 3. Plugin glue

[`src/main.ts`](../../src/main.ts) and [`src/view/TerminalView.ts`](../../src/view/TerminalView.ts). Registers the Obsidian `ItemView`, exposes the `open-terminal` command in the command palette, mounts the renderer into the view, routes input from the renderer to whatever backend is wired in, and manages the hotkey guard. The only piece that imports both `obsidian` and the backend interface.

**Status:** Shipped (Phase 1), currently routing input to the mock REPL.

## How they connect

Phase 1 data flow (mock REPL):

```
keystroke → xterm textarea → host.onData → TerminalView.handleInput
         → mock-repl.run → host.write → xterm buffer
```

Phase 2 data flow (planned, with a real backend):

```
keystroke → xterm textarea → host.onData → backend.write
         → PTY → shell process

shell output → backend.onData → host.write → xterm buffer
```

The renderer never sees Obsidian. The backend (when it exists) will not see Obsidian either. Only the glue does.

## The hotkey guard

A load-bearing piece of glue worth calling out. `TerminalView` pushes a `Scope` onto Obsidian's `app.keymap` whenever the terminal container is focused, and pops it on focus out. The scope handles every modified chord pattern (`Mod`, `Mod+Shift`, `Mod+Alt`, `Mod+Shift+Alt`, `Ctrl`, `Ctrl+Shift`, `Ctrl+Alt`, `Alt`) with a wildcard key, so chord hotkeys like Cmd-P and Ctrl-C don't fire Obsidian commands while the terminal is focused. Plain unmodified keys are not blocked — xterm's textarea still receives ordinary typing. This part of the glue is the most likely to bite future-you if it is weakened.

## What is not here

- **Settings tab.** No user-configurable settings exist; no `SettingTab` is registered.
- **Multi-instance isolation.** Multiple terminal panes can be opened, but no isolation guarantees beyond what each `TerminalView` provides on its own.
- **Profile picker, tmux attach, shell selection.** Vision items, deferred until the PTY backend lands.
- **Cross-platform support.** macOS Apple silicon only — see [ADR 0001](../adr/0001-macos-arm64-only.md).
