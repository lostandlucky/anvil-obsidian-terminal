# Keyboard handling in the terminal

Why does Ctrl-C interrupt a running command inside the terminal, but Cmd-P still open Obsidian's command palette? Why isn't it symmetric? What's stopping Obsidian's keymap from eating your Ctrl-W in vim?

This doc is about the model the plugin uses to answer those questions, and about what it'll take to carry that model to Windows and Linux later. It's written for someone who's new to this codebase but not new to DOM event flow.

## The problem space: three actors, one keystroke

When you press a key inside a focused terminal pane, three different handlers are waiting for that event, each in a different part of the DOM lifecycle.

**Obsidian's keymap.** Registered via `app.scope`. Listens at the **document capture phase** — which means it fires *before* the event reaches the element it was dispatched on. This is what runs your command-palette hotkey (Cmd-P), your tab-close (Cmd-W), and anything you've bound in Settings → Hotkeys. Scope handlers in Obsidian that return `false` get `preventDefault + stopPropagation` applied at document capture, and the event stops there.

**xterm's textarea handler.** xterm.js mounts a hidden `.xterm-helper-textarea` inside the terminal container and listens for keydown on that element directly — the **target phase**. When xterm sees a keydown it decides what byte sequence to write to the PTY (`\x03` for Ctrl-C, and so on) and emits it through its `onData` callback. In this plugin, `onData` is wired to `backend.write` in `TerminalView.onOpen`, which is what actually sends the control byte down the WebSocket to the `pty-server` binary and into the shell.

**Everything else listening on `document` or `window` in the bubble phase.** Anything that registered a bubble-phase keydown listener up the tree sees the event after it has visited its target.

The natural conflict: Ctrl-C should reach the shell as SIGINT — that's xterm's job — but Obsidian's keymap fires first at capture. Meanwhile, Cmd-P should reach Obsidian and open the palette, and the shell almost never wants a Cmd-modified key. You can't hand "all modifiers" to one actor and call it done. The right answer is asymmetric.

## The model: Cmd is Obsidian's, Ctrl is the shell's

On macOS, host-app shortcuts use Cmd by convention (Cmd-C copy, Cmd-W close, Cmd-Space Spotlight), and shell shortcuts use Ctrl (Ctrl-C SIGINT, Ctrl-W zsh word-delete, Ctrl-R reverse-search). Users learn them as two different keys from day one. The plugin rides that separation:

- **Cmd-modified keys fall through to Obsidian.** The command palette opens, your hotkeys fire, tab navigation works. The shell doesn't want these; Obsidian does.
- **Ctrl-modified keys go to the shell.** xterm sees them, writes the right control byte to the PTY, and the shell interrupts, deletes a word, searches history, whatever it does with that byte.

This gives each modifier to its natural owner. It's asymmetric on purpose.

There's an explicit cost: any Obsidian command bound to a Ctrl combo will not fire while the terminal is focused. On macOS, Obsidian's own defaults are mostly Cmd-anchored, so the practical leak surface is small. Users who bind their own Ctrl-* commands can rebind to Cmd-* or accept that they don't fire inside the terminal. That's the tradeoff the phase-3.5 design locked in.

This model is macOS-specific. On Windows and Linux, there's no Cmd. Both Obsidian and the shell want Ctrl, because Ctrl is the only meta-modifier those platforms use. `Ctrl-C` is *both* the shell SIGINT and Obsidian's copy; `Ctrl-W`, `Ctrl-P`, `Ctrl-R`, `Ctrl-K` all have meanings in both worlds. When cross-platform support lands, the asymmetric rule collapses and the model has to generalize. The recommended direction is a VS Code-style "commands to skip shell" list, where today's macOS rule is the degenerate case of a skip-list that contains every Ctrl combo.

## The mechanism: one listener, on the container, in the bubble phase

The model is easy to state. Getting three actors to actually behave that way takes more care than it looks.

The fix needs three properties at once:

1. xterm must see the keydown at target phase, so it can emit the control byte.
2. Obsidian's document-level listeners must not see the event *after* xterm consumes it — otherwise Ctrl-bound Obsidian commands fire anyway.
3. Cmd-modified keys must still reach Obsidian normally, so the command palette and friends keep working.

The mechanism that satisfies all three is a single keydown listener registered on the **terminal container element** (between `document` and the xterm textarea in the DOM tree), in the **bubble phase**, with a predicate that only cares about Ctrl-without-Cmd. Lifted from [`src/view/TerminalView.ts`](../../src/view/TerminalView.ts):

```typescript
this.containerKeydownHandler = (ev: KeyboardEvent) => {
  if (ev.ctrlKey && !ev.metaKey) {
    ev.stopPropagation();
  }
};
container.addEventListener("keydown", this.containerKeydownHandler);
```

The phasing is load-bearing. A capture-phase listener at the container would fire *before* target, blocking xterm. A capture-phase listener at document would fire alongside Obsidian's own scope handler (also at document capture) — too late to keep Obsidian out cleanly, too early to let xterm in. A bubble-phase listener at document would fire after the event had already left the terminal subtree — too late to be local to the terminal. Bubble at container is the unique sweet spot: xterm has already seen the event at target, and we stop it before it bubbles up to any document-level listeners.

The predicate matters too. `ev.ctrlKey && !ev.metaKey` is the asymmetric rule written as code. Cmd-modified events skip the `stopPropagation` call and bubble normally, and Obsidian's document-level keymap behaves as it always has. (In practice, Cmd events Obsidian wants to handle never reach the container bubble handler in the first place — Obsidian's scope handler at document capture already `preventDefault`'d them — but the predicate keeps the logic honest either way.)

## A worked example: FI-007, or how the test suite lied

The plugin didn't start out with this mechanism. The earlier phase-2b implementation went the other direction: it pushed an Obsidian `Scope` onto `app.keymap` whenever the terminal was focused, and registered every modified chord pattern (`Mod`, `Mod+Shift`, `Mod+Alt`, `Mod+Shift+Alt`, `Ctrl`, `Ctrl+Shift`, `Ctrl+Alt`, `Alt`) with a wildcard handler that returned `false`. The intent was reasonable: "stop Obsidian's hotkeys from firing while the terminal is focused, so my keys go to the shell."

The bug was in the phasing. Returning `false` from a scope handler makes Obsidian call `preventDefault + stopPropagation` at document capture. `stopPropagation` in the capture phase kills the event before it ever reaches the target phase — so xterm's textarea listener never fired. Ctrl-C never produced `\x03`. SIGINT never happened. And the Cmd side collapsed with it: Cmd-P was swallowed the same way, so the command palette couldn't open while the terminal was focused. Both modifier families were broken, symmetrically, which is the shape you get when you give all modifiers to one actor.

The interesting part is why the test suite didn't catch it. Two tests existed and both passed:

- `tests/e2e/pty-backend.e2e.ts` had a "Ctrl-C interrupts a long-running program" test that called `backend.write("\x03")` directly. It verified byte → PTY → SIGINT, which is the *second* half of the pipeline. It never pressed a key. A comment in the test admitted it was dodging `browser.keys` because "modifier handling [is] unreliable across WebDriver versions."
- `tests/e2e/plugin.e2e.ts` had a "Ctrl-C does NOT leak to Obsidian" test that dispatched a synthetic `KeyboardEvent` on the xterm textarea and asserted a document-level probe didn't see it. It verified the "doesn't leak" half — but it never asserted that xterm *did* see the event at target phase. The test passed for the wrong reason: the scope swallow was killing the event before either side got it.

Both tests were true statements. Neither test was the whole contract. Half-contract tests are how showstoppers hide.

The phase-3.5 fix replaces both with tests that exercise the full path:

- [`tests/e2e/keyboard-passthrough.e2e.ts`](../../tests/e2e/keyboard-passthrough.e2e.ts) drives real keystrokes via WebdriverIO's `browser.keys`. It starts `sleep 30`, sends `["Control", "c"]`, and asserts the shell prompt returns. Then it sends `["Meta", "p"]` while the terminal is focused and asserts `.modal-container .prompt` appears (and isn't the plugin's own picker). No synthetic events, no backend shortcuts.
- [`tests/e2e/plugin.e2e.ts`](../../tests/e2e/plugin.e2e.ts) gets a rewritten Ctrl-C assertion that's *two-sided*: a document-level probe MUST NOT see the event, AND a textarea-target probe MUST see it. That's the actual contract — "xterm got it AND Obsidian didn't" — and it only passes when both halves hold.

In the fix itself, `TerminalView` lost about 30 lines of machinery: the `Scope` creation loop with its eight modifier-combination wildcards, the push/pop helpers, the focusin/focusout handlers gating scope state. The `Scope` import disappeared. In its place is the four-line bubble-phase listener above, installed during `onOpen` after the xterm host is mounted and before the backend starts — so a slow backend handshake can't race your first keystroke — and torn down in `onClose`. The `TerminalBackend` interface wasn't widened. This is a view-layer fix end to end.

## What this hands to the cross-platform future

When Windows and Linux support becomes real work, the container-level bubble-phase listener is the right extension point. The listener topology — *where* and *in what phase* the handler runs — is what makes the asymmetric outcome possible in the first place. That part does not want to be redesigned.

What needs to change is the predicate. `ev.ctrlKey && !ev.metaKey` is today's hardcoded rule; it becomes a lookup against a configurable list — the VS Code `terminal.integrated.commandsToSkipShell` model. On macOS the default list is "every Ctrl combo." On Windows and Linux, it's the standard shell vocabulary (`Ctrl-C`, `Ctrl-W`, `Ctrl-R`, `Ctrl-U`, `Ctrl-L`, `Ctrl-D`, a few more) with the rest falling through to Obsidian, and users edit the list in settings when their muscle memory disagrees with the defaults.

The current macOS implementation is the degenerate case of that future design. At the time of writing, macOS is the only supported platform and the hardcoded predicate is the right amount of code. When the port happens, this file is the place to start reading — and the source of truth for why you shouldn't touch the phasing.
