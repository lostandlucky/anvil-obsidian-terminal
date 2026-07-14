# Phase Triage: Phase 3 — SIGTERM latency under WS flood (BUG-002)

**Date:** 2026-07-14
**Recommendation:** C (Spec + TDD) — the phase's outcome is a directly measurable latency budget with an already-built standalone harness pattern, and every constraint that tests can't encode is already written down upstream (meta-plan "Notes from Phase 2", `known-bugs.md` BUG-002). The failing tests below ARE the spec. Run `/phase-exec Phase 3` (Mode B; no brief step — this artifact carries the test plan).

## Context

Phase 2 (parent-death watchdog, BUG-004) landed GREEN on `autopilot/bug-sweep-2026-07-14` and deliberately left the session loop's `ws_sink.send().await` stall untouched. Phase 3 closes BUG-002: SIGTERM lands and `shutdown.trigger()` fires immediately, but the session loop can't observe it while parked inside an in-flight send to a dead/slow WebSocket peer, producing a 1–3s exit tail under output flood. Phase 3 builds on Phase 2's landed state (same shutdown path) — this is the only ordering constraint in the sweep.

## Phase Assessment

| Dimension | Signal | Notes |
|-----------|--------|-------|
| Scope | Medium-low | `pty-server/src/main.rs` `handle_client` session loop (the `select!` at ~line 380 and teardown at ~467), one new latency test file in `tests/unit/` (reuses the `parent-death-watchdog.test.ts` harness pattern), `tests/e2e/phase-3-hygiene.e2e.ts` AC3 budget (conditional), bookkeeping (`known-bugs.md`, completion report, MORNING-UAT). ~5–6 files. |
| Decisions | Some (implementation-level) | Which of BUG-002's three fix paths: (1) force-close the sink on shutdown so in-flight sends fail fast, (2) dedicated writer task + bounded channel, (3) pre-send `is_set()` check (insufficient alone — can't unblock an in-flight await). All internal to the binary, all reversible, and the anchor test is identical under any of them. The 3s→1s budget decision is pre-resolved by the meta-plan's own rule: empirically stable over ≥10 mixed-load runs → tighten; not stable → keep 3s and record the distribution. No fork needs human input. |
| Novelty | Pattern | Session-loop rework inside one 483-line binary; writer-task/bounded-channel and sink-close are standard tokio shapes. The standalone WS-speaking vitest harness exists (Phase 2). The genuinely subtle part — select/sink semantics under backpressure — is exactly what the RED test exercises, so the risk lives inside the TDD cycle, not ahead of it. |
| Reversibility | Easy | No dependency changes (tokio/futures-util already present), no protocol change (clean-exit protocol must stay byte-identical — pinned below), plain revertible commits. Nothing downstream depends on Phase 3's internals. |
| Testability | High | Latency is end-to-end assertable from vitest: spawn binary, flood, kill peer, SIGTERM, clock the exit. The documented repro (BUG-002) is deterministic enough that RED is reachable on demand; Phase 2's constraints are transitively guarded by the existing watchdog suite (its anchor runs with a dead parent and broken stderr). |

**Diagnostic:** Goldilocks ✓ (outcome + budget rule in 4 sentences, no tactical detail) | Substitution ✓ (three genuinely different fix paths — the approach is correctly deferred to this phase) | Discovery ✓ — but the probing (does force-close reach a sink owned by the session loop? how does tungstenite behave when the peer stops reading vs closes?) belongs to the RED/GREEN cycle; a spec would just relocate execution work and reformat `known-bugs.md`.

## Why Spec + TDD, not the others

**Not A (Just Execute).** The phase carries a measurement protocol, not just a code change: ≥10 mixed-load runs, a recorded latency distribution, and a budget decision made on that basis ("needs a measured basis, not one lucky run" — meta-plan risk flag). Left unnamed, an executor can green one lucky run and call it done. The test list below encodes the protocol so GREEN means what the meta-plan means.

**Not B (Brief + Execute).** The discriminator fails in C's favor: the test stubs make complete sense before the fix-path choice is made — the flood-latency anchor, slow-peer variant, and clean-exit pin are identical under all three candidate paths, so a red→green cycle plus the existing pins produces the right architecture on its own. The upstream pointers a brief would carry already exist in writing (meta-plan "Notes from Phase 2" names the seam, the panic trap, and the harness; `known-bugs.md` names the fix paths with tradeoffs); a brief would be a third restatement of the same page. Contrast Phase 2, which earned B because its harness shape was itself undecided and its central requirement ("no timeout-based reaping of any kind") was an untestable absence.

**Not D (Phase Spec).** No fork needs human deliberation: all three fix paths are internal and reversible, the meta-plan deliberately deferred the choice to this phase, and the one decision with user-visible effect (the AC3 budget) comes with a stated decision rule. A Decisions table would manufacture ceremony around questions the executor can settle with data.

**Not E / not `/phase-prototype`.** Single subsystem, and the open question is "how to unblock the chosen seam," not "which shape." The flood test IS the probe; a throwaway prototype would duplicate the anchor test.

Mode note: no `lean` token was passed; this is the full-ceremony call.

## Key tests to write first (the spec)

New file, `tests/unit/sigterm-latency.test.ts`, reusing the `parent-death-watchdog.test.ts` pattern (cargo-builds the release binary in `beforeAll`, speaks the WS protocol with Node's global `WebSocket`):

1. **Flood + dead-peer anchor (RED expected).** Start a session, run a flood (`yes`), `socket.close()` from JS (the documented repro), send SIGTERM, assert the pty-server process AND its shell child are gone within the tightened budget (target ≤1s). Today this should reproduce BUG-002's 1–3s tail at least intermittently.
2. **Flood + slow-peer variant (RED expected).** Peer stays connected but stops reading (pause the socket / never consume), so kernel buffers fill and `ws_sink.send().await` parks indefinitely — the deterministic blocked-await case that defeats fix path 3 alone. SIGTERM must still exit within budget.
3. **Repeated-run stability (drives the budget decision).** ≥10 iterations across the mixed variants above at the tightened budget. Record the measured distribution in the completion report. Per the meta-plan rule: stable → tighten AC3 in `phase-3-hygiene.e2e.ts` from 3s toward 1s; not stable → AC3 keeps 3s and `known-bugs.md` BUG-002 is amended with the new numbers instead of removed (an acceptable outcome — log it).
4. **Clean-exit protocol pin (new — currently unpinned at the WS level).** Normal child exit (`exit 0`) still delivers the Exit message (with status) followed by the WS Close frame. The teardown block at the end of `handle_client` must survive the rework; no existing test asserts this from the protocol side.
5. **Existing pins that must stay green:** the parent-death-watchdog suite ×4 (its anchor transitively guards trigger-before-log + `BestEffortStderr` — it runs with a dead parent and broken stderr), hygiene e2e AC3 (budget touched only per #3), full unit + e2e at the phase GREEN gate.

**Constraints already recorded upstream (pointers, not restatement):** keep the sticky `Shutdown` seam (meta-plan "Notes from Phase 2" — the watchdog and signal handler are trigger sources into it); a log line must never be able to kill an exit path (trigger-before-log + `BestEffortStderr`, `pty-server/src/main.rs` doc comments); no dependency changes (meta-plan shared constraints — none of the fix paths need any); read `specs/anvil/testing-approach.md` before writing tests (project rule).

## Context health

New session for exec (standard for the autopilot pipeline — each step runs fresh). Everything the executor needs: this triage, the meta-plan Phase 3 block + "Notes from Phase 2" + shared constraints, `known-bugs.md` BUG-002 (root cause + fix paths), `pty-server/src/main.rs` (session loop + teardown), `tests/unit/parent-death-watchdog.test.ts` (harness pattern), `tests/e2e/phase-3-hygiene.e2e.ts` AC3 (budget + repro shape), `specs/anvil/testing-approach.md`.

## Open at session boundary

- The AC3 budget decision is executor-resolvable via the meta-plan's stated rule — a [RESOLVED-AUTO] data call, not a park item. Whatever the outcome, the measured distribution goes in the completion report.
- Partial closure is a sanctioned outcome: if the tail shrinks but sub-second isn't stable, amend BUG-002 with the new empirical numbers rather than removing it, and keep AC3 at 3s.
- The watchdog suite's own SIGTERM pin currently budgets 3s; if AC3 tightens, consider aligning it (executor's call, cheap either way).
- Latency tests are host-load sensitive: on a full-run failure, follow the flake-triage protocol — re-run only the failed test in isolation, never the full suite.
- 9 open Dependabot PRs remain deliberately OUT (meta-plan park-bar; already in MORNING-UAT). Untracked `tests/e2e/.diagnostic/` predates this run — leave it alone.
