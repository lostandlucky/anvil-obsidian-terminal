# Phase Complete: Phase 2 — Parent-death watchdog (BUG-004)

**Date:** 2026-07-14 · **Branch:** `autopilot/bug-sweep-2026-07-14` · **Brief:** `phase-2-parent-death-watchdog-brief.md`
**Mode:** Code Tests (Mode B, Brief + Execute per triage)
**Cycles:** 1 (full-suite GREEN gate passed on first run; the inner TDD loop took two passes — see Discovery)
**Status:** GREEN

## Deliverables

- `pty-server/src/main.rs` — kqueue `EVFILT_PROC | NOTE_EXIT` parent-death watchdog on a detached OS thread, firing the existing sticky `Shutdown` seam; registration-race handling via `getppid()` re-checks (startup / post-registration / on-failure); `BestEffortStderr` writer for the tracing subscriber (see Discovery). First `unsafe` in the codebase, confined to syscall sites with per-site SAFETY comments.
- `pty-server/Cargo.toml` + `Cargo.lock` — `libc = "=0.2.185"` (pre-approved in the meta-plan shared constraints; was already in the lockfile transitively at that exact version).
- `tests/unit/parent-death-watchdog.test.ts` — standalone-binary harness (vitest shells out, builds the release binary via cargo in `beforeAll`, speaks the WS protocol with Node's global `WebSocket`): kill-the-parent mid-session (anchor), parent-dead-at-startup race, idle-survival pin, SIGTERM pin.
- Bookkeeping: BUG-004 removed from `specs/anvil/known-bugs.md` (BUG-002's cross-reference updated); MT-013 expectation corrected in `specs/anvil/manual-test-checklist.md` (the "launchd reaps orphans ≤5s" claim was empirically false); `pty-server/PROTOCOL.md` lifecycle section documents parent-death behavior; `MORNING-UAT.md` manual items; meta-plan Phase 3 notes.

## Discovery (load-bearing for Phase 3)

The kqueue watch itself worked on the first pass — but the anchor test stayed red: **once the parent dies, its piped stderr breaks, and the log line ahead of `shutdown.trigger()` killed the watchdog thread.** tracing-subscriber's fallback on a writer error is `eprintln!`, and `eprintln!` panics when stderr is gone. Verified by `sample`-ing the stuck process: the watchdog thread had vanished; kernel event delivered, trigger never ran. Production has the same shape (`src/pty/pty-backend.ts` spawns with `stdio: ["ignore","pipe","pipe"]`), so this was a real-world defeat of the fix, not a test artifact. Resolution: trigger-before-log on every death path, plus a `BestEffortStderr` writer so no thread — including the session teardown that kills the shell child — can be panicked by a log line after parent death.

## Verification

- RED: anchor + startup-race tests failed exactly as BUG-004 predicts (pty-server survived parent SIGKILL indefinitely); idle/SIGTERM pins passed at RED and are documented as regression pins.
- GREEN gate: `npm test` exit 0 — unit 234/234 (27 files, includes the 4 new watchdog tests), e2e 13/13 spec files (hygiene, pty-backend, tab-isolation, wrap-and-dock, restore-redock all green). `cargo test --release` 7/7. `cargo clippy` clean. No flakes encountered; no leaked test processes (verified via pgrep after runs).

## User Testing

- Open a terminal in a real vault, then `pkill -9 Obsidian`. Both the pty-server PID and its shell child should vanish within ~5 seconds — no more immortal orphans. (Pairs naturally with Phase 1's relaunch check: the same pkill run covers both.)
- Leave a terminal idle for a long stretch with Obsidian open — it must still be alive and responsive when you come back.
- Note: orphans created before this fix are not retroactively cleaned; kill any old `bin/pty-server` processes by hand once.

## Required Manual Verification

- **True `pkill -9 Obsidian` orphan check (MT-013):** the wdio harness cannot kill its own host app; automated coverage kills a wrapper parent process instead. Steps and expectations in `MORNING-UAT.md`.
- **Hours-scale idle survival:** the automated pin covers a bounded idle window (seconds); "survives indefinitely" beyond that is a long-running-stability judgment (testing-approach Level 3). In `MORNING-UAT.md`.

## Notes for downstream phases

Pushed to the meta-plan's Phase 3 entry ("Notes from Phase 2"): the `Shutdown` seam is unchanged (watchdog is a new trigger source only); the broken-stderr panic discovery constrains any teardown rework (keep trigger-before-log and the `BestEffortStderr` writer); `ws_sink.send` stall (BUG-002's target) deliberately untouched; the new standalone WS-speaking vitest harness is reusable for AC3-style latency runs without wdio.
