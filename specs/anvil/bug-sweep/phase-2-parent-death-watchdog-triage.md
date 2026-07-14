# Phase Triage: Phase 2 — Parent-death watchdog (BUG-004)

**Date:** 2026-07-14
**Recommendation:** B (Brief + Execute) — architectural direction is pre-approved in the meta-plan (kqueue `EVFILT_PROC | NOTE_EXIT` watch on the parent PID, per `known-bugs.md` BUG-004 fix path 1, with the `libc` pin exception pre-cleared); remaining decisions are implementation-shape. Run `/phase-exec Phase 2` — it produces a one-page implementation brief before the RED check (sign-off auto-resolved under the overnight autonomy contract).

## Context

Phase 1 (restore-path redock, BUG-001) landed GREEN on `autopilot/bug-sweep-2026-07-14`. Phase 2 fixes BUG-004: `pty-server` orphans survive `pkill -9 Obsidian` indefinitely because nothing tells the binary its parent died — and the fix must **never** reap a live-but-quiet session (user-named outcome: no timeout-based reaping of any kind). Phase 3 will build on this phase's landed shutdown path.

## Phase Assessment

| Dimension | Signal | Notes |
|-----------|--------|-------|
| Scope | Medium-low | `pty-server/src/main.rs` (~30–50 lines: watchdog + race check), `pty-server/Cargo.toml` + `Cargo.lock` (add `libc` — pre-approved; pin `=0.2.185`, already in the lockfile transitively), one new standalone kill-the-parent test, plus bookkeeping (`known-bugs.md`, `manual-test-checklist.md` MT-013, MORNING-UAT). ~5–7 files, small edits each. |
| Decisions | Few (implementation-shape) | Watchdog vehicle (detached OS thread blocking in `kevent()` vs tokio task on an `AsyncFd`-wrapped kqueue fd — constrained by the "must not hold the runtime alive" risk flag); race sequencing (register watch, then re-check `getppid()` — parent may die before registration); what fires (`shutdown.trigger()` reuses the existing sticky `Shutdown` seam, named by fix path 1); test harness location (vitest spawning the release binary — existing pattern — vs new cargo-test infra); bounded encoding of "idle session survives indefinitely". No fork needs human input. |
| Novelty | Mixed | First unsafe Rust + raw libc/kqueue in the codebase — but a well-known ~30-line macOS pattern. The `Shutdown` seam, the signal-handler task it mirrors, and vitest-tests-that-shell-out (`orphan-pty-server-smoke.test.ts`) all exist. Standalone process-level testing of pty-server has precedent (`smoke-test.py`) but no automated harness yet. |
| Reversibility | Easy | `libc` addition is explicitly pre-approved in the meta-plan's shared constraints (NOT a park item) and already in the lockfile transitively. Everything else is internal binary behavior; plain revertible commits. Phase 3 coupling is via the already-well-defined `Shutdown` seam. |
| Testability | High | Anchor test named by the meta-plan: wrapper process spawns pty-server and dies — no wdio needed. RED = pty-server survives wrapper death; GREEN = exits within a few seconds, shell child included, zero orphans. Idle-survival is assertable over a bounded window; hygiene suites guard the normal close paths. |

**Diagnostic:** Goldilocks ✓ | Substitution ✗-by-design (kqueue path is a user-pre-approved constraint; meta-plan self-check marks it "not a re-litigable fork" — substitute only if unworkable, and log why) | Discovery ✓ (registration-vs-already-dead race, runtime-lifetime interaction, and harness shape need real probing — probing that belongs to execution, not a spec that would relocate it)

## Why Brief + Execute, not the others

**Not A (Just Execute).** The Rust diff is small, but it's the codebase's first unsafe code, with a named race (parent dies before the watch is installed → must re-check PPID after registering), a named operational trap (watchdog must not hold the tokio runtime alive or block shutdown paths that already work), a negative requirement that must be encoded deliberately (no timeout-based reaping of any kind — an absence, easy to violate accidentally with a "helpful" idle guard), and brand-new standalone-test harness surface. A one-page brief naming those seams is cheap insurance against execution-time re-derivation.

**Not C (Spec + TDD).** The discriminator fails three ways: tests can't encode "no timeout-based reaping of any kind" (absence-of-mechanism is a construction constraint enforced by the brief and review, only bounded-window-testable); the registration race window can't be deterministically exercised by a red→green cycle (it needs code-level sequencing the brief pins down); and the harness-shape choice (vitest wrapper vs cargo test) precedes any sensible test stub. The architectural pointer lives upstream — the brief carries it to the executor.

**Not D (Phase Spec).** No genuine fork needs human deliberation: the user pre-approved the kqueue path and the `libc` dependency in-session, and the meta-plan records both as constraints. A Decisions table would re-litigate resolved questions; under the unattended contract, D would stall the pipeline for a sign-off with nothing to decide.

**Not E / not `/phase-prototype`.** Single subsystem, single chosen shape. The one risky area (kqueue race + runtime lifetime) is embedded in the phase's own RED/GREEN cycle; a throwaway probe would duplicate the anchor test. The meta-plan already prescribes the escape hatch if kqueue proves unworkable (substitute and log why).

Mode note: no `lean` token was passed; this is the full-ceremony call (lean would not change it).

## Context health

New session for exec (standard for the autopilot pipeline — each step runs fresh). Everything the executor needs is in: this triage, the meta-plan Phase 2 block + shared constraints (the `libc` exception lives there), `known-bugs.md` BUG-004, `testing-approach.md` (mandatory pre-test read), `pty-server/src/main.rs` (the `Shutdown` seam and signal-handler task the watchdog mirrors), and `tests/unit/orphan-pty-server-smoke.test.ts` (vitest-shells-out pattern).

## Open at session boundary

- `libc` addition is **pre-approved** — do not park it. Pin exact (`=0.2.185`, matching the lockfile) like every other dep.
- MT-013's "≤5s — launchd reaps orphans" expectation is empirically false and must be corrected as part of done; a true `pkill -9 Obsidian` orphan check stays manual → exec adds it to MORNING-UAT "Manual verification" (it dovetails with Phase 1's MT-016 pkill entry already queued there).
- Phase 3 (SIGTERM latency) builds on this phase's landed shutdown path — the completion report should note anything Phase 3 needs to know about changes to the `Shutdown`/session-loop structure.
- Live-box orphans (unit smoke reported 4 during Phase 1) are pre-fix artifacts; the fix only helps future spawns. Leave them — killing live processes is out of scope for the phase.
- 9 open Dependabot PRs remain deliberately OUT (meta-plan park-bar; already in MORNING-UAT).
- Untracked `tests/e2e/.diagnostic/` predates this run — leave it alone.
