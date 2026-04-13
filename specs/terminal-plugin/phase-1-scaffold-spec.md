# Phase 1 Spec: Plugin Scaffold + Terminal Rendering

## Objective

Get an Obsidian plugin that opens a pane with xterm.js rendering in it. No real shell — prove that xterm.js works inside Obsidian's view system, handles resize, and captures keystrokes without Obsidian intercepting them. This retires all Obsidian plugin API risk before Phase 2 adds PTY complexity.

## Decisions for Review

1. **Mock PTY behavior** — Phase 1 has no real shell. The terminal needs *something* to respond to input so we can verify keystrokes arrive and output renders. Options:
   - **(a) Local echo** — keystrokes echo back to the terminal. Simplest. Proves input capture and output rendering.
   - **(b) Simple REPL** — a tiny command handler (e.g., `help`, `clear`, `echo <text>`) that demonstrates bidirectional I/O and ANSI color rendering.

   Recommendation: **(b)** — it's marginally more work but lets us verify ANSI rendering and gives a better demo for user testing. **[RESOLVED: (b)]**

## Requirements

- Standard Obsidian plugin scaffold producing a loadable plugin build (manifest, compiled JS, stylesheet)
- Plugin registers a command palette action to open a terminal pane
- Terminal is rendered by xterm.js inside an Obsidian pane view
- Terminal fills its container and reflows on container resize
- When the terminal pane has focus, Obsidian hotkeys (Ctrl-C, Ctrl-P, Ctrl-K, etc.) must not fire — keystrokes go to xterm.js
- When the user clicks outside the terminal or navigates away, Obsidian hotkeys resume normally
- xterm.js styles are scoped so they do not visually break Obsidian's theme
- View survives Obsidian layout operations: drag to new split, resize split, close and reopen via command palette
- Mock backend responds to input with visible output including ANSI colors (proves the rendering pipeline end-to-end)
- Closing the pane fully disposes the terminal and any observers (no leaks on reopen)

## Implementation Notes (non-binding)

These are pointers from the technical research, not hard requirements. The executing agent should deviate if it finds a better path.

- xterm.js via `@xterm/xterm` + `@xterm/addon-fit` is the expected library choice
- Obsidian's `ItemView` is the standard base class for custom panes
- `ResizeObserver` + `FitAddon` is the known-good reflow pattern
- Reference existing plugins for key interception patterns: polyipseity/obsidian-terminal, clevcode/obsidian-terminal-plugin, ZyphrZero/Termy

## Acceptance Criteria

1. The project's build command produces a complete, loadable Obsidian plugin bundle with no errors
2. Plugin loads in Obsidian without errors in the developer console
3. "Open terminal" appears in the command palette and opens a terminal pane
4. xterm.js renders in the pane with a visible cursor
5. Typing in the terminal produces visible output (mock backend responds)
6. ANSI-colored output renders correctly (colors visible, not raw escape codes)
7. Ctrl-C, Ctrl-P, and Ctrl-K do NOT trigger Obsidian commands when the terminal is focused
8. Clicking outside the terminal restores normal Obsidian hotkey behavior
9. Dragging the terminal pane to a different split position preserves the terminal (or cleanly recreates it)
10. Resizing the pane causes the terminal to reflow (no clipping, no overflow, no scrollbar-on-scrollbar)
11. Closing and reopening the terminal via command palette works without errors
12. No errors or warnings in the Obsidian developer console during normal use

## User Testing

After building and loading the plugin in Obsidian:

1. **Open a terminal** — Cmd-P → "Open terminal". A pane should appear with a blinking cursor and a welcome message.
2. **Type commands** — Try `help`, `echo hello world`, `clear`. Output should appear, colors should render.
3. **Test hotkey capture** — With the terminal focused, press Ctrl-C, Ctrl-P, Ctrl-K. None of these should open Obsidian's command palette or trigger Obsidian actions. Then click on a note — Ctrl-P should open the command palette again.
4. **Resize the pane** — Drag the pane border. Terminal text should reflow to fit the new size without visual glitches.
5. **Move the pane** — Drag the terminal tab to a different split. It should either survive the move or cleanly reinitialize.
6. **Close and reopen** — Close the terminal pane, then reopen via command palette. Should work cleanly with no console errors.

## Boundaries

- **No real shell / PTY** — this phase uses a mock backend only. No `child_process`, no Python, no node-pty.
- **No settings UI** — hardcoded defaults (font size, theme, etc.). Settings are Phase 4.
- **No multiple instances** — single terminal pane is sufficient. Multi-instance is Phase 3.
- **No tmux / session management** — Phase 3.
- **No profile/shell picker** — Phase 3.
- **No state persistence across Obsidian restarts** — terminal content doesn't need to survive a full app restart.
- **macOS arm64 only** — no cross-platform testing or CI.

## Sources

- **Meta-plan:** `specs/terminal-plugin/meta-plan.md`
- **Technical research:** Vault → `Programming/Obsidian Terminal Plugin - Technical Design Research.md`
- **Obsidian ItemView API:** https://docs.obsidian.md/Reference/TypeScript+API/ItemView
- **xterm.js docs:** https://xtermjs.org/
- **@xterm/addon-fit:** https://www.npmjs.com/package/@xterm/addon-fit
- **Existing plugins for reference patterns:**
  - polyipseity/obsidian-terminal (key interception approach)
  - clevcode/obsidian-terminal-plugin (simple architecture)
  - ZyphrZero/Termy (clean separation)
- **Obsidian CSS variables:** https://docs.obsidian.md/Reference/CSS+variables
