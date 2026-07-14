# Phase Complete: Phase 3 — SIGTERM latency under WS flood (BUG-002)

**Date:** 2026-07-14 · **Branch:** `autopilot/bug-sweep-2026-07-14` · **Run:** unattended (autonomy contract)
**Mode:** Code Tests (Mode B — triage recommendation C, "the tests ARE the spec", `no-audit`)
**Cycles:** 1 (clean pass)
**Status:** GREEN — full closure; AC3 budget tightened 3s → 1s per the meta-plan's decision rule

## What was fixed

SIGTERM landed and `shutdown.trigger()` fired immediately, but the session loop could not
observe it while parked inside an in-flight `ws_sink.send().await` to a dead peer (1–3s TCP
drain tail) or to a connected peer that stopped reading (zero TCP window — measured ~5s
deterministic tail in the RED harness, and unbounded in principle). Three seams in
`pty-server/src/main.rs` `handle_client`:

1. **In-flight send is now abandonable.** The output arm races `ws_sink.send()` against the
   sticky `Shutdown` seam in a nested `biased` select — shutdown drops the parked send future
   and breaks the loop immediately. The abandoned frame is acceptable loss on the way out.
2. **Teardown goodbye is time-bounded.** The best-effort Exit + Close + sink-close sequence is
   wrapped in a 250ms timeout (`WS_GOODBYE_BUDGET`) — a live peer completes it in microseconds,
   a broken peer can no longer stall exit on it.
3. **PTY reader unblocked at teardown.** `drop(out_rx)` before awaiting the reader task: under
   flood the reader sat in `blocking_send` on a full channel that nothing drains once the loop
   breaks, previously eating the full 1s reader-join timeout on every flooded shutdown.

The `Shutdown` seam, trigger-before-log ordering, and `BestEffortStderr` (Phase 2 constraints)
are untouched; no dependency changes; wire protocol byte-identical (pinned by test).

## Measured latency distribution (drives the budget decision)

Mixed-load protocol per meta-plan: alternating dead-peer / slow-peer variants, release binary,
SIGTERM-to-(server AND shell child)-gone, 10ms poll resolution.

| Sample | Variant | Runs | min | median | max |
|---|---|---|---|---|---|
| RED (pre-fix) | dead-peer (undici close) | 6 | 11ms | 11ms | 11ms |
| RED (pre-fix) | slow-peer (zero window) | 6 | 4923ms | ~4950ms | 5066ms |
| GREEN pass 1 | mixed | 12 | 11ms | ~260ms | 271ms |
| GREEN pass 2 | mixed | 12 | 10ms | 260ms | 271ms |

GREEN slow-peer runs cluster at 260–271ms — dominated by the deliberate 250ms goodbye bound,
i.e. the worst case is now a design constant, not a kernel-drain lottery. Stable over 24 mixed
runs ⇒ per the meta-plan rule the AC3 e2e budget returns to **1s** (relaxed to 3s on
2026-04-29), and the watchdog suite's SIGTERM pin aligns at 1s. Hygiene e2e verified green in
isolation at the tightened budget (3/3, AC3 8.9s spec runtime).

Note: the unit-harness dead-peer variant (undici `close()`) does not reproduce the e2e drain
tail — undici fails the server's sends instantly. The deterministic encoding of the BUG-002
mechanism is the slow-peer variant (raw-socket WS client, reads paused), which is exactly the
case a pre-send `is_set()` check could never fix.

## Deliverables

- `pty-server/src/main.rs` — nested shutdown-vs-send select, bounded goodbye, reader unblock
- `tests/unit/sigterm-latency.test.ts` — new: dead-peer anchor, slow-peer variant, 12-run
  mixed-load stability protocol (logs full distribution), clean-exit protocol pin (Exit with
  status 0 before WS Close — first WS-level pin of the goodbye sequence)
- `tests/e2e/phase-3-hygiene.e2e.ts` — AC3 budget 3s → 1s
- `tests/unit/parent-death-watchdog.test.ts` — SIGTERM pin 3s → 1s
- `pty-server/PROTOCOL.md` — goodbye documented as best-effort + time-bounded; SIGTERM path
  documented sub-second under flood
- `specs/anvil/known-bugs.md` — BUG-002 removed (convention: remove on fix)
- `specs/anvil/manual-test-checklist.md` — MT-004 gains the heavy-output close round
- `tests/unit/orphan-pty-server-smoke.test.ts` — comment no longer points at removed bug entries

## User Testing

- Run `yes` in a plugin terminal, close the tab mid-flood: close feels instant, and
  `pgrep -f "bin/pty-server"` shows the instance gone within ~1s (MT-004 heavy-output round).
- Normal use unchanged: `exit` in the shell still shows the yellow `[shell exited: ...]` line
  (the Exit message still precedes the WS Close — pinned at the protocol level now).

## Required Manual Verification

- Real-vault perceived-latency check (MT-004 heavy-output round): with a real Obsidian, run
  `yes`, close the terminal tab, confirm it *feels* instant and no pty-server lingers
  (`pgrep -f "bin/pty-server"`). Why manual: the automated harness SIGTERMs a standalone
  binary; the real path goes through Obsidian's leaf-close → plugin dispose, and "instant" is
  a perception judgment (testing-approach Level 3).

## Notes for downstream phases

- None actionable for Phase 4 (first-fit cell measurement — different subsystem, no shared
  seams). Nothing pushed to the meta-plan.
- For any future pty-server work: the goodbye sequence is now bounded by `WS_GOODBYE_BUDGET`
  (250ms). If a future client *requires* the Exit message under adversarial peers, that budget
  is the knob — but PROTOCOL.md now explicitly tells clients not to rely on it when they
  initiated teardown.
