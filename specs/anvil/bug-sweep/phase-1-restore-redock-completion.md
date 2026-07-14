# Phase Complete: Phase 1 — Restore-path redock (BUG-001)

**Mode:** Code Tests (Mode B, Brief + Execute)
**Cycles:** 1 (clean pass — full suite green on first GREEN-gate run: unit 230/230, e2e 13/13 spec files)
**Status:** GREEN
**Date:** 2026-07-14 · **Branch:** `autopilot/bug-sweep-2026-07-14` · Executed unattended under the autonomy contract (`no-audit`).

## Deliverables

- `src/dock/restore-redock.ts` — pure stray-classification module (no `obsidian` import): a terminal leaf is a "stray" iff the plugin did not place it this session AND it lives in the main window root. This predicate is the restore-vs-deliberate-move gate.
- `src/dock/restore-redock.test.ts` — 7 unit tests (placed/unplaced, popout/sidebar exclusion, mixed partition, throwing `getRoot`, missing root).
- `src/main.ts` — `reconcileRestore()`: runs from the existing `layout-change` handler and from `workspace.onLayoutReady` (real relaunch: plugin loads before layout restore). Guards: `layoutReady` gate, reentrancy flag, strays marked placed *before* redock (a failed redock can never loop). Redock = detach strays, re-run `openDefaultTerminal()` only if no docked container survived. `getOrCreateContainerView` marks every leaf it allocates into a `WeakSet`.
- `tests/e2e/bug-001-restore-redock.e2e.ts` — the user-named simulated serialize→restore harness: capture `getLayout()` → `disablePlugin`+`enablePlugin` (resets plugin memory exactly as a relaunch would) → `changeLayout()` → assert docked. Three tests: AC1a faithful roundtrip, AC1b observed relaunch shape (terminal as sibling tab next to the note), AC2 user-move no-fight/no-loop pin.
- Bookkeeping: BUG-001 removed from `specs/anvil/known-bugs.md` (BUG-002's cross-reference updated); `specs/anvil/manual-test-checklist.md` MT-016 expectation rewritten (bottom-docked; carries the latent "Loading workspace…" hang as a watch item) and MT-017 added (deliberate-move/popout/mid-drag manual check); `MORNING-UAT.md` manual-verification entries.

## Key empirical finding (recorded for the record)

The faithful `getLayout()`→`changeLayout()` roundtrip **reproduces BUG-001 without any hand-crafting**: rehydration loses the wrap-and-dock structure — rootSplit comes back `direction: "vertical"` (RED snapshot: `{"rootDirection":"vertical","inBottomSlot":true,...}`). The suspected root cause in the bug entry ("wrap structure not faithfully restored") is confirmed at the serialization layer, not just at app relaunch. The crafted sibling-tab variant (AC1b) additionally pins the exact user-reported shape (`sharesTabsWithForeignView: true` at RED). The latent "Loading workspace…" hang did **not** resurface in the simulation.

## User Testing

- Open a terminal in your real vault, quit Obsidian, relaunch → the terminal should come back **bottom-docked**, tab strip intact, fresh shell — no misplaced tab to clean up, no close-and-reopen dance.
- Repeat with `pkill -9 Obsidian` (crash path, MT-016).
- Drag the docked terminal's tab next to a note mid-session → it must stay where you put it (no snap-back).
- Park a terminal in a popout window, relaunch → the redock must leave it alone.

## Required Manual Verification

Carried from the Step 3 unautomatable list (excluded from GREEN; also in `MORNING-UAT.md`):

1. **True quit-relaunch redock (MT-016)** — the harness cannot relaunch the host app; the automated coverage simulates serialize→restore in-process. Verify a real quit (and a `pkill -9`) relaunch comes back bottom-docked.
2. **Latent "Loading workspace…" hang watch (MT-016 watch item)** — if relaunch stalls, capture the console and file a new bug; no automated coverage exists for the hang.
3. **No fighting deliberate moves / drags (MT-017)** — real pointer drags (tab drag, pane-resize divider) and "focus lands somewhere sane" are judgment/pointer interactions the harness can't honestly drive.

## Notes for downstream phases

- Nothing blocking Phases 2–4 (different subsystems). Reusable if needed: the simulated-restore harness pattern (`disablePlugin`/`enablePlugin` + `changeLayout`) is the first in-repo use of `getLayout`/`changeLayout` and works cleanly against the pinned Obsidian 1.12.7.
- All workspace APIs used in production for this fix (`rootSplit`, `layoutReady`, `onLayoutReady`, `getRoot`) are documented in the pinned typings — `undocumented-api-surface.test.ts` needed no extension.
