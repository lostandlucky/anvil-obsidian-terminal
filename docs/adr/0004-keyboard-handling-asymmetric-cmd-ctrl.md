# 0004. Asymmetric Cmd/Ctrl keyboard handling on macOS

- **Status:** Accepted
- **Date:** 2026-04-16

## Context

Obsidian's keymap, xterm.js, and any document-level DOM listeners all want to handle keystrokes that happen inside a focused terminal pane. The Phase 2b implementation tried to give all modified keys to the shell by pushing an Obsidian `Scope` onto `app.keymap` whenever the terminal was focused, with wildcard handlers registered for every modified chord pattern (`Mod`, `Mod+Shift`, `Mod+Alt`, `Mod+Shift+Alt`, `Ctrl`, `Ctrl+Shift`, `Ctrl+Alt`, `Alt`) returning `false`.

Returning `false` from a scope handler causes Obsidian to call `preventDefault + stopPropagation` at document capture phase, which kills the event before it ever reaches xterm's textarea handler at target phase. Real-keyboard Ctrl-C never produced `\x03`, SIGINT never fired, and Cmd-P couldn't open the command palette while the terminal was focused — both failures with the same root cause. The bug sat behind two passing tests for an entire phase: a Ctrl-C test that bypassed the keyboard pipeline by writing `\x03` directly to the backend, and a "doesn't leak to Obsidian" test that asserted only the document-side half of the contract.

Phase 3.5 needed a fix that let xterm process Ctrl-modified keys at target phase (so SIGINT, word-delete, TUI bindings work), prevented Obsidian's keymap from also handling them (so Ctrl-bound Obsidian commands don't fire on top), and left Cmd-modified keys alone (so the command palette still opens). Three properties at once.

## Decision

Drop the catch-all Obsidian `Scope` registration entirely. Replace it with a single keydown listener on the terminal container element, in the **bubble phase**, with the predicate `ev.ctrlKey && !ev.metaKey` calling `ev.stopPropagation()` only on Ctrl-without-Cmd events.

This gives **Cmd to Obsidian and Ctrl to the shell** — the asymmetric model that matches macOS conventions, where Cmd is the host-app modifier and Ctrl is the shell-line-editor modifier and users already learn them as different keys. The container-level bubble-phase placement is load-bearing; it's the only spot where xterm sees the event at target *and* document-level listeners are blocked from seeing it after.

The full mental model — three actors, the phasing rationale for why bubble at container is the unique sweet spot, the worked incident, and the cross-platform implications — is documented in [`docs/explanations/keyboard-handling.md`](../explanations/keyboard-handling.md). This ADR records the decision; the Explanation carries the model.

## Consequences

**Easier:**

- Real-keyboard Ctrl-C, Ctrl-W, Ctrl-R, vim TUI bindings, zsh line-editor bindings — all work without intervention. xterm sees them at target phase like any other keydown.
- Cmd-P, Cmd-W on note tabs, and any user-bound Cmd hotkey continue to work normally even while the terminal is focused. Asymmetry is the whole point.
- `TerminalView` lost ~30 lines of scope/focus machinery (the eight chord registrations, push/pop helpers, focusin/focusout gating). One bubble-phase listener with a 4-line predicate replaces all of it. The `Scope` import disappeared.
- The `TerminalBackend` interface stayed at six methods. The fix is entirely a view-layer concern.

**Harder:**

- Any Obsidian command bound to a plain Ctrl combo will not fire while the terminal is focused. On macOS, Obsidian's defaults are mostly Cmd-anchored, so the practical leak surface is small — but a user who binds their own `Ctrl-K` (or whatever) to an Obsidian command needs to either rebind to `Cmd-*` or accept that it doesn't fire inside the terminal. This is the explicit tradeoff the design accepts.
- The asymmetric Cmd/Ctrl rule is **macOS-only**. On Windows and Linux there's no Cmd, so both Obsidian and the shell want Ctrl, and the asymmetric model collapses. Cross-platform support will need to redesign the predicate — likely to a VS Code-style `commandsToSkipShell` allowlist where today's macOS rule becomes the degenerate case.
- The bubble-phase / container placement is non-obvious. Anyone tempted to "simplify" it to a document-level capture listener (or back to a Scope) will reintroduce FI-007. The Explanation doc exists to make that tradeoff visible.

**Reversible?** Yes, locally. The fix lives entirely in `TerminalView.onOpen` / `onClose`. The `containerKeydownHandler` is the single hook point — when FI-011 lands, the predicate becomes data-driven against a skip-list, but the listener topology (where and in what phase the handler runs) doesn't need to change.
