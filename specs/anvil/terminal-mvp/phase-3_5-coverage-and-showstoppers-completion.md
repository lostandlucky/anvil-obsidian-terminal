# Phase 3.5 Complete: Coverage + Showstopper Fixes

**Mode:** Code Tests (Mode B) — RED gate already in place from the spec
slice (`tests/e2e/keyboard-passthrough.e2e.ts`); this phase upgraded
`tests/e2e/plugin.e2e.ts` to a two-sided contract (AC3), implemented
the FI-007 fix in `TerminalView`, and updated `../manual-test-checklist.md`
to reflect honest test status.
**Cycles:** 1 — clean pass on first GREEN run.
**Status:** GREEN — all automated acceptance criteria met. AC7 (manual
smoke check against the pinned binary) handed off to user.

**Test totals at phase end:** 100 unit passing (11 files), 32 e2e
passing (8 spec files — `keyboard-passthrough.e2e.ts`'s two RED tests
are now GREEN, and `plugin.e2e.ts` gained the upgraded contract assertion).

## Deliverables

### Source

- `src/view/TerminalView.ts` — rewrote the keyboard handling per D1.
  Removed the catch-all `Scope` swallow that registered every
  `Mod`/`Ctrl` modifier combination and the focusIn/focusOut
  push/pop machinery that gated it. Replaced with a single
  container-level bubble-phase `keydown` listener that calls
  `stopPropagation()` only on `ev.ctrlKey && !ev.metaKey`. Result: Cmd
  bubbles freely (Obsidian's command palette / hotkeys fire), Ctrl
  reaches xterm's textarea at target phase (so `\x03` flows through
  `host.onData → backend.write` to the PTY for SIGINT, and TUI
  bindings + zsh line editor work), and Obsidian's document-level
  keymap doesn't get a second crack at the Ctrl event after xterm has
  consumed it. Removed the `Scope` import and the `terminalScope` /
  `scopePushed` / `focusInHandler` / `focusOutHandler` private fields
  that the old machinery required.

### Tests

- `tests/e2e/plugin.e2e.ts` — the
  "Ctrl-C dispatched inside the focused terminal does NOT leak to
  Obsidian" test was renamed to "…reaches xterm but not Obsidian" and
  upgraded to assert the two-sided contract per AC3. Document-level
  bubble probe must NOT see the Ctrl-C, AND a textarea-target probe
  MUST see it. Pre-fix this turned RED on the second assertion (xterm
  never received the keydown — old scope was killing the event at
  document capture). Post-fix both halves pass.
- `tests/e2e/keyboard-passthrough.e2e.ts` — unchanged. Its two RED
  tests (real-keyboard Ctrl-C + Cmd-P via WebDriver `browser.keys`)
  flipped to GREEN once the FI-007 fix landed. Per spec these are the
  contract gates and should not be modified to make them pass.
- `tests/e2e/pty-backend.e2e.ts` — unchanged per D5. Its existing
  `backend.write("\x03")` Ctrl-C test still verifies the byte → PTY →
  SIGINT half of the path; the keyboard pipeline half is now
  independently covered by `keyboard-passthrough.e2e.ts`.

### Documentation / specs

- `../manual-test-checklist.md` — MT-002 updated per AC5.
  Added a new 2026-04-16 row recording the Phase 3.5 fix landing
  (`⏳ pending user verification`). The original 2026-04-14 Phase 2b
  ✅ row was annotated to flag it as `⚠️ retroactively invalid` —
  the test was never end-to-end verified with a real keypress, the
  Phase 2b e2e cheated by writing `\x03` directly to the backend.
  Added a one-line note to the test's "Why manual" section pointing
  at the new automated coverage.
- `phase-3_5-coverage-and-showstoppers-spec.md` — renamed
  the "Decisions for review" section to "Decision log" mid-phase
  during the audit pass (all five decisions were already `[RESOLVED]`
  before execution started, so the original heading overpromised).
- `meta-plan.md` — Phase 3.5 entry added between Phase 3
  and Phase 4 (mirroring how 2a/2b are represented), and a "Notes
  from Phase 3.5" section added under Phase 4.

## User Testing

Once Phase 3.5 lands in your local Obsidian build, exercise these by
hand against the pinned 1.12.7 binary + `manual-test-vault`:

1. **Ctrl-C actually stops things.** Open a terminal. Run `sleep 30`.
   Press Ctrl-C on your physical keyboard. The sleep should interrupt
   and return to the zsh prompt immediately. Repeat with `yes` to
   confirm.
2. **Cmd-P opens the command palette from inside the terminal.** Open
   a terminal, click into its prompt to focus it, press Cmd-P.
   Obsidian's command palette modal should appear. Type "open
   terminal" and hit Enter — the picker should appear as normal.
3. **TUI bindings work.** Open a terminal, run `vim /tmp/test.txt`,
   try Ctrl-W in normal mode (vim's window-pane binding), Ctrl-R
   (redo), Ctrl-F (page down). All should reach vim. Quit with `:q`.
4. **zsh word-delete works.** Type `echo foo bar baz`. Press Ctrl-W.
   Should delete "baz" only.
5. **Cmd-W still closes tabs the Obsidian way.** Focus a note tab
   (not the terminal), press Cmd-W. Obsidian should close that tab.
   This confirms Cmd-keys still reach Obsidian globally — we didn't
   accidentally capture Cmd-W.
6. **Phase 3 regression sweep.** Re-run MT-005, MT-009, MT-012
   quickly to confirm nothing broke. These are the ones most likely
   to regress if the scope rewrite has unintended side effects.

If everything passes, fill the new MT-002 row's result in
`../manual-test-checklist.md`.

## Required Manual Verification

Carrying these forward verbatim from the Cannot-Be-Automatically-Verified
list confirmed at RED. They cannot pass or fail an automated check —
the user must verify them by hand before Phase 3.5 is truly done.

| Item | Why not automatable | What to do |
|---|---|---|
| Real-keyboard Ctrl-C interrupts `sleep 30` | Even with the WebDriver `keyboard-passthrough` test green, "real physical keypress in the actual binary" is what FI-007 was hidden by last time. The spec deliberately keeps this as a human gate. | Run `sleep 30`, press physical Ctrl-C, see prompt return. Repeat with `yes`. |
| Real-keyboard Cmd-P opens command palette | Same — WebDriver covers it, but the spec wants a human confirmation against the pinned 1.12.7 binary. | Focus terminal, press Cmd-P, type "open terminal", verify picker opens. |
| TUI bindings (vim Ctrl-W / Ctrl-R / Ctrl-F) | Requires real PTY + vim TUI redraw assertions — explicitly Level 3 per `../testing-approach.md`. Spec says "no explicit e2e per key required." | `vim /tmp/test.txt`, exercise each binding, `:q`. |
| zsh word-delete (Ctrl-W in zsh prompt) | Shell-internal line editor behavior; same Level-3 reasoning. | Type `echo foo bar baz`, press Ctrl-W, verify only "baz" deleted. |
| Cmd-W still closes Obsidian tabs (outside terminal) | Could in principle be automated, but the spec puts it in manual smoke as a regression sanity check that the asymmetric model didn't accidentally capture Cmd-W globally. | Focus a note tab (not terminal), Cmd-W, tab closes. |
| Phase 3 regression sweep (MT-005, MT-009, MT-012) | MT-005/009/012 graduated to e2e on 2026-04-16, but each kept a *subjective* judgment slice (visual layout, picker feel, multi-instance). Those judgments aren't codified. | Re-run those three quickly after the fix to confirm no regression in the subjective parts. |

## Notes for downstream phases

- **Documentation followup for Phase 4 / `/document` run.** The new
  asymmetric Cmd/Ctrl keyboard model is the first non-trivial WHY in
  the codebase that isn't obvious from the code. The container-level
  bubble-phase `stopPropagation` pattern, why Cmd is left alone, and
  the macOS-specific tradeoff (Obsidian's few Ctrl bindings won't
  fire while the terminal is focused) all want a short explanation
  doc — likely `docs/explanations/keyboard-handling.md` or similar.
  This is the same model FI-011 (cross-platform) will need to
  redesign, so anchoring an explanation now will pay off later. Code
  comment in `TerminalView.ts` is intentionally one short line — it
  points at FI-007 in the backlog rather than carrying the full
  rationale inline.
- **FI-011 (cross-platform) inherits this design directly.** The
  current "Ctrl bubble-stop" model maps cleanly onto FI-011's
  recommended Option W-C (VS Code-style "commands to skip shell"
  list). When that work is picked up, the existing
  `containerKeydownHandler` is the right extension point — replace
  the hardcoded `ev.ctrlKey && !ev.metaKey` predicate with a lookup
  against a configurable skip-list. Don't redesign the listener
  topology; the bubble-phase placement is what makes the asymmetric
  outcome possible.
- **Reduced surface area in `TerminalView`.** The fix removed four
  private fields and ~30 lines of scope/focus machinery. If Phase 4
  needs to add per-view keyboard config (e.g. theming hotkeys, or
  the FI-011 skip-list), keep resisting the urge to bring back a
  Scope-based mechanism — a single keydown handler with a predicate
  is the working pattern.
- **MT-002 is now `⏳ pending user verification`.** Phase 4 should
  close it out (or whoever does the manual sweep). The retroactive
  `⚠️ invalid` annotation on the original Phase 2b row is a
  permanent record — don't remove it; future readers need to
  understand why a ✅ row exists for a test that didn't actually pass.
- **`TerminalBackend` interface unchanged.** Per spec constraint, no
  widening. The fix lived entirely in `TerminalView`.
- **Dependency maintenance kickoff still belongs to Phase 4.** Per
  the spec's source notes, 3.5 explicitly did not pull this work
  forward. Phase 4 should still start with the `wdio-obsidian-service`
  + Obsidian binary version audit per `CLAUDE.md`'s cadence.
