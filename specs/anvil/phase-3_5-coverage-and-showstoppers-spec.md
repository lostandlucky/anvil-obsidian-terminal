# Phase 3.5 Spec: Coverage + Showstopper Fixes

## Objective

Fix the severe regression that Phase 3's manual test walkthrough surfaced — Ctrl-C and Cmd-P being blocked by the terminal scope (FI-007) — and close the test-coverage gaps that let it hide behind green tests. "Phase 3 complete" should mean the plugin is genuinely usable, not "complete pending a showstopper fix." This is a tight interstitial phase between Phase 3 and Phase 4, not a feature phase.

Note: FI-002 (rootSplit children reorientation) was originally scoped into this phase but was closed as invalid on 2026-04-16 after user clarification. The restore works correctly; the original report was a miscommunication about the flatten-while-open behavior, which is expected per D7.

## Decisions for review

### D1: FI-007 scope model → asymmetric (Cmd → Obsidian, Ctrl → shell) **[RESOLVED]**

Drop the `Mod` (Cmd) registrations from `TerminalView`'s scope entirely — let Cmd-modifier keys fall through to Obsidian so the command palette (`Cmd-P`), tab switching, and global shortcuts work normally inside the terminal. Keep Ctrl-handling, but replace the swallow-everything pattern with a narrower mechanism that lets xterm process Ctrl-modifier keys in target phase (for SIGINT, word-delete, TUI bindings, etc.) while still preventing Obsidian's document-level Ctrl bindings from firing.

Obsidian's macOS bindings are mostly Cmd-anchored, so dropping the Ctrl-shield for the few Ctrl bindings Obsidian does use is an acceptable tradeoff — users can override those per-vault if they conflict. The executing agent picks the exact mechanism (capture-phase container listener with `stopPropagation`, dropping the scope entirely and relying on xterm's `preventDefault`, etc.) — the constraint is the asymmetric outcome, not the implementation.

### D2: ~~FI-002 rootSplit children reorientation~~ → CLOSED, not in scope **[RESOLVED]**

FI-002 was closed as invalid on 2026-04-16. The restore works correctly. See FI-002 entry in `future-ideas-backlog.md` for details.

### D3: FI-010 picker header UX → OUT of scope this phase **[RESOLVED]**

Logged during MT-009 Part C. Not a regression, just cosmetic polish. Deferred to Phase 4.

### D4: Other FI entries (FI-003 close affordance, FI-004 height persistence, FI-005 session persistence, FI-006 draggable terminal leaf) → OUT of scope this phase **[RESOLVED]**

All Phase 4 polish. None are broken behavior.

### D5: Phase 2b's `backend.write("\x03")` Ctrl-C test → keep as-is, complement with the real-keyboard test **[RESOLVED]**

The existing `pty-backend.e2e.ts` Ctrl-C test isn't wrong — it verifies the byte → PTY → SIGINT half of the path, which is still a contract worth guarding. The problem was that it was the ONLY Ctrl-C test, so the keyboard-pipeline half went untested. The new `keyboard-passthrough.e2e.ts` covers that half. Leave the old test in place; don't demote it.

## Requirements

- A real-keyboard Ctrl-C inside a focused terminal MUST reach xterm's textarea, which MUST forward `\x03` to the PTY, which MUST deliver SIGINT to the running process. The existing `keyboard-passthrough.e2e.ts` "Ctrl-C via real keyboard" test is the automated gate.
- A real-keyboard Cmd-P inside a focused terminal MUST reach Obsidian's command palette (the `.modal-container .prompt` element MUST appear in the DOM). The existing `keyboard-passthrough.e2e.ts` "Cmd-P while terminal is focused" test is the automated gate.
- Other Ctrl-modifier keys (Ctrl-W, Ctrl-R, Ctrl-U, vim/htop/less control bindings) MUST reach the shell's PTY inside the terminal. No explicit e2e is required for every key, but the mechanism must be consistent with the Ctrl-C path.
- `tests/e2e/plugin.e2e.ts`'s "Ctrl-C dispatched inside the focused terminal does NOT leak to Obsidian" test MUST be upgraded to a two-sided contract: it still asserts Obsidian's document-level handler does NOT see the keydown, AND it additionally asserts that xterm's textarea DID see the keydown (or the resulting `backend.write("\x03")` call fires, or the PTY produces interruption output — any concrete signal that xterm processed the key).
- MT-002 in `manual-test-checklist.md` MUST be honestly re-verified against the fixed build with a new 2026-04-15 row. The original Phase 2b ✅ row MUST be annotated to note that it was never actually end-to-end verified, so the test log reflects reality.
- No regression in Phase 3's existing 100 unit + 28 e2e tests. `npm run test:unit` and `npm run test:e2e` MUST continue to pass everything that was passing before this phase started.
- The fix for FI-007 MUST NOT reintroduce the Phase 2b concern that Obsidian's hotkeys would fire unexpectedly while the terminal is focused — specifically, typing `Cmd-W` (close tab) or other Cmd-modified Obsidian bindings inside a focused terminal must behave the same as it does outside the terminal (i.e., Obsidian handles it). The asymmetric model makes this a natural consequence, but it's called out as a requirement so the executing agent doesn't accidentally re-broaden the scope.
- The executing agent MUST NOT widen the `TerminalBackend` interface.

## Acceptance criteria

- **AC1:** `tests/e2e/keyboard-passthrough.e2e.ts` — both currently-RED tests pass after the FI-007 fix. No other changes to that spec file are required (it was written to be the gate).
- **AC2:** ~~FI-002 RED→GREEN test~~ — removed; FI-002 closed as invalid on 2026-04-16.
- **AC3:** `tests/e2e/plugin.e2e.ts`'s "Ctrl-C doesn't leak to Obsidian" test is upgraded to a two-sided contract and still passes.
- **AC4:** `npm run test:unit` passes with no regressions. `npm run test:e2e` passes with no regressions on any previously-green spec.
- **AC5:** MT-002 in `manual-test-checklist.md` has a new row dated 2026-04-15 with the real Obsidian 1.12.7 verification result. The Phase 2b row is annotated as retroactively invalid (or at least flagged that the test was not actually exercised end-to-end until 2026-04-15).
- **AC6:** `npm run build` compiles cleanly; the plugin loads in Obsidian without console errors after the scope rewrite.
- **AC7:** Manual smoke check: with the fix applied, running `sleep 30` in a picker-launched terminal and pressing real Ctrl-C on the physical keyboard interrupts the sleep and returns to a prompt. Same smoke check for Cmd-P opening Obsidian's command palette. Recorded in the MT-002 row or a new MT entry.

## User testing

Once the phase is done, exercise these by hand against the pinned Obsidian 1.12.7 binary + `manual-test-vault`:

1. **Ctrl-C actually stops things.** Open a terminal. Run `sleep 30`. Press Ctrl-C on your physical keyboard. The sleep should interrupt and return to the zsh prompt immediately. Repeat with `yes` (or any other noisy process) to confirm.
2. **Cmd-P opens the command palette from inside the terminal.** Open a terminal, click into its prompt to focus it, press Cmd-P. Obsidian's command palette modal should appear. Type "open terminal" and hit Enter — the picker should appear as normal.
3. **TUI bindings work.** Open a terminal, run `vim /tmp/test.txt`, try Ctrl-W in normal mode (vim's window-pane binding), Ctrl-R (redo), Ctrl-F (page down). All should reach vim. Quit with `:q`.
4. **zsh word-delete works.** Type `echo foo bar baz`. Press Ctrl-W. Should delete "baz" only.
5. **Cmd-W still closes tabs the Obsidian way.** Focus a note tab (not the terminal), press Cmd-W. Obsidian should close that tab. This confirms Cmd-keys still reach Obsidian globally, we didn't accidentally capture Cmd-W.
6. **Phase 3 regression sweep.** Re-run MT-005, MT-009, MT-012 quickly to confirm nothing broke. These are the ones most likely to regress if the scope rewrite has unintended side effects.

## Boundaries

Explicitly NOT in Phase 3.5 scope — all of these stay deferred to Phase 4 or later:

- FI-002 — closed as invalid on 2026-04-16 (restore works correctly).
- FI-003 — close affordance on the dock leaf (no X, empty `...` menu).
- FI-004 — terminal dock height persistence across open/close.
- FI-005 — shell session persistence when the leaf closes.
- FI-006 — draggable terminal leaf.
- FI-010 — picker section header UX / arrow-navigation skip logic.
- D3 / `preserveTmuxDimensions` setting being consumed by the tmux attach spawn path.
- MT-010 second half — the preserveTmuxDimensions manual half that was deferred on 2026-04-14.
- Theme integration, distribution packaging, cross-platform support.
- Widening `TerminalBackend`.
- Restructuring the picker items data model.
- Any refactor to `PtyBackend`, `pty-server`, or the shell-discovery / tmux-discovery code that isn't strictly required for the FI-007 fix.

## Sources

### In-repo

- `specs/anvil/meta-plan.md` — Phase 3/4 transition point. 3.5 is an interstitial not yet in the meta-plan; executing agent should add a brief Phase 3.5 entry during the completion-report slice, mirroring how Phase 2a/2b are represented.
- `specs/anvil/phase-3-completion.md` — what Phase 3 shipped and what was explicitly flagged for downstream phases.
- `specs/anvil/phase-3-picker-and-sessions-spec.md` — the phase-3 decisions and requirements, for context. Nothing in 3.5 re-opens these.
- `specs/anvil/future-ideas-backlog.md` — FI-002 and FI-007 are the load-bearing entries. FI-007 has the full fix plan including the asymmetric Cmd/Ctrl model and the planned test upgrades.
- `specs/anvil/manual-test-checklist.md` — MT-002 (to be re-verified), MT-006 (FI-002's original manual finding), MT-009/MT-012 (regression-sweep targets for step 7 above).
- `specs/anvil/testing-approach.md` — the pure-module boundary rule and the three test levels. No changes expected this phase but worth re-reading before restructuring `TerminalView`.
- `CLAUDE.md` — conventions, dependency cadence (the Phase 4 dependency-maintenance kickoff is NOT part of 3.5 — it moves to Phase 4 start as originally planned).

### In-code (read before implementing)

- `src/view/TerminalView.ts` — the scope registration in `onOpen` is the entire FI-007 fix surface. The current code registers catch-all swallows for every Mod/Ctrl combination. Read the `focusInHandler`/`focusOutHandler` logic too — the scope push/pop tied to focus is load-bearing.
- `tests/e2e/keyboard-passthrough.e2e.ts` — the two RED tests that are the AC1 gate. Executing agent should NOT modify these to make them pass unless a test-logic bug is discovered — they're the contract.
- `tests/e2e/plugin.e2e.ts` — specifically the "Ctrl-C dispatched inside the focused terminal does NOT leak to Obsidian" test, which needs the two-sided upgrade (AC3).
- `tests/e2e/pty-backend.e2e.ts` — the cheating `backend.write("\x03")` Ctrl-C test. Stays as-is per D5; just know it's there so you don't accidentally treat it as the real keyboard test.

### External

- [Obsidian Scope API](https://docs.obsidian.md/Reference/TypeScript+API/Scope) — for the Cmd/Ctrl scope rewrite. The `Scope.register` return value and the `false` return semantic are what we're currently misusing.
- [xterm.js keyboard handling](https://xtermjs.org/docs/api/terminal/classes/terminal/#attachcustomkeyeventhandler) — if the fix ends up routing through xterm's `attachCustomKeyEventHandler` rather than DOM-level scope management, read this first.
- [identity16/obsidian-terminal](https://github.com/identity16/obsidian-terminal) — reference implementation to check how they handle Ctrl-C inside a terminal view. Worth a quick read for both the scope approach and the dock close-path if they handle children reorientation.

## Notes from Phase 3

This phase exists because Phase 3's manual-test walkthrough surfaced two severe bugs and a pile of test-coverage gaps that let them slip through green CI. The three coverage gaps worth internalising before executing — they should shape what tests you write, not just what you fix:

1. ~~**Property checks miss user-facing behavior.**~~ Gap #1 was based on the FI-002 misinterpretation. The e2e test actually passes because the restore genuinely works. This gap is resolved.
2. **Two-sided contracts need two-sided tests.** `plugin.e2e.ts`'s "Ctrl-C doesn't leak to Obsidian" verified `swallow → stop` but never asserted xterm received the key before it was stopped. Half-contracts are how FI-007 hid.
3. **Tests that don't follow through.** `picker.e2e.ts` opens the modal and asserts it renders — it never dispatches a choice and verifies the resulting backend spawn matches intent. FI-009 slipped past because of this. Cover the full "user picks X → system does X" loop, not just "system offers X."

The AC3 upgrade is a direct response to gap #2. Gap #3 was already addressed by the picker coverage added at the end of Phase 3.
