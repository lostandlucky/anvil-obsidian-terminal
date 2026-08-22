# Meta-Plan: Stability Overhaul — Sessions That Don't Die

**Created:** 2026-08-22 · **Pipeline:** `/phase-meta` → `/phase-triage` → `/phase-spec` → `/phase-exec`

Triggered by a real incident (2026-08-22): macOS sleep/wake → Chromium's network service killed the loopback WebSocket (`ERR_NETWORK_CHANGED`) → pty-server's kill-on-close policy killed the shell → no reconnect exists → frozen pane. The user's directive: don't quick-fix the transport — assess where the project actually stands and make it *super stable*. Benchmark named by the user: iTerm/cmux sessions, which never die on sleep.

**Hard requirement (user-named):** terminal sessions survive macOS sleep/wake. This is Phase 3's exit criterion, not an open question.

Evidence base: a two-agent sweep of the full project history and runtime architecture, recorded in [`sweep-findings.md`](./sweep-findings.md). Fragility items are cited as **F1–F14** throughout; their file:line detail lives there, not here. The cmux lesson (user open to copying it): cmux is native Swift on libghostty — PTY in-process, no network hop, session lifetime owned outside the fragile layer. Lessons transfer; AGPL Swift code doesn't. Note cmux sessions also die on app quit — iTerm parity, not tmux persistence, is the bar.

Organizing principle: **make the ground trustworthy → invert session ownership → make the path to the session unkillable → kill silent failure as a house style.** Phase 2 precedes the reconnect work because of F8: reconnecting to today's server yields a *fresh shell wearing a recovered face* — the server needs a session model before the client gets reconnect logic.

## Dependency map

- Phase 1 → everything (canonical branch, verified baseline, stable harness).
- Phase 2 → Phase 3 (F8 ordering; Phase 3's transport decision is constrained by Phase 2's architecture decision — do not write Phase 3's spec until it lands).
- Phase 3 → Phase 4's visibility surface only.
- Phase 4's F6/F10/F11 cluster depends only on Phase 1 — designated pull-forward buffer if Phase 2 stalls on its architecture spike.

## Shared constraints

- macOS arm64 only (ADR-0001). **Read `specs/anvil/testing-approach.md` before writing any tests** (project rule).
- Every phase lands its own tests at the lowest level that can catch its failure mode; no separate testing phase; each phase leaves the Level-1 vitest harness (which already builds the Rust binary and speaks the protocol) stronger than it found it.
- No-silent-degradation policy applies to all **new** code from Phase 2 onward; Phase 4 retrofits old code.
- Every phase ends daily-drivable — no regressions parked "until the next phase."
- House bookkeeping is part of done: `known-bugs.md`, `manual-test-checklist.md`, `future-ideas-backlog.md` (FI-005/FI-020 closure, stale-entry cleanup) updated in the phase that lands the change.
- Protocol changes update the vitest protocol-speaking tests in lockstep.

## Explicit boundaries (OUT)

- FI-011 cross-platform (Windows/Linux).
- Community plugin store submission; codesigning/notarization pipeline (the quarantine-aware *check* is in scope; a signed binary is a named follow-up).
- New features; performance beyond stability; scrollback persistence beyond what the reattach mechanism provides.
- Obsidian quit-relaunch session survival as a *hard* requirement — it's a Phase 2 decision outcome, in only if the chosen architecture makes it cheap.

---

## Phase 1 — Trusted Baseline (reconcile, verify, re-arm)

**Goal.** The project stands on one canonical branch whose behavior a human has actually witnessed, on a current, audited toolchain. The 80 stranded commits on `autopilot/bug-sweep-2026-07-14` become mainline; the never-run human verification (all 7 MORNING-UAT items, MT-013..018) is executed with results recorded as facts; FI-020 closes (9 Dependabot PRs resolved deliberately, harness and Obsidian pins refreshed, TS major decided). One narrow code exception: fix F1 — the silent-forever port-discovery hang — because a silent hang in the spawn path poisons every test run the rest of the project depends on.

**Depends on:** nothing. **Requires Steve's hands** for the manual test runs.

**Success criteria.**
- One canonical branch; `origin/main` contains the bug-sweep work; Dependabot queue drained (merged or deliberately deferred with reasons).
- Every MT-013..018 and MORNING-UAT item has a recorded human-observed result; new finds (e.g. the latent "Loading workspace…" hang) filed in `known-bugs.md`, not absorbed.
- Full unit + e2e suite green on the updated dependency stack.
- F1 closed: pty-server death during handshake produces a visible error within the timeout, never a silent hang.
- A short baseline note: verified-working vs newly-broken, feeding Phases 2–3.

**Risk flags.** The manual runs are the likeliest place in the whole project to surface a reshaping surprise — that's why they're first. Harness upgrades (wdio 3.2.x, Obsidian 1.13.x) may break e2e infra in ways that look like product bugs; budget for disentangling. TS major may cascade. Branch mechanics (merge vs promote) is a phase decision.

## Phase 2 — Session Ownership Inversion (detach/reattach)

**Goal.** A shell session's lifetime is owned by pty-server, not by any WebSocket connection, view, or renderer. A client connection dying — for any reason — no longer kills the shell; a later connection reattaches to the *same live session*, dimensions renegotiated at attach, with visible continuity. Deliberate teardown (tab close, plugin unload) still kills promptly with zero orphans, and abnormal terminations finally report what actually happened (F9). F4 closes structurally here: no error path can bypass session teardown.

**Flagged decisions for the phase spec (not pre-decided):** custom detach/reattach protocol vs delegating persistence to tmux; server process architecture (per-window child vs longer-lived — which determines whether Obsidian quit-relaunch survival comes cheap); detached-output buffering semantics.

**Depends on:** Phase 1.

**Success criteria.**
- Adversarial Level-1 harness tests: a session running a visible process survives connection death by every means tried; a new connection attaches to the same process with correct dims and continuity evidence — no wdio required.
- Explicit close still exits sub-second with zero orphans; the orphan backstop (BUG-004 watchdog contract) is re-derived for the new architecture.
- All abnormal endings carry real status/signal end-to-end.
- No user-visible behavior change yet — the plugin stays daily-drivable; the payoff wires up in Phase 3.

**Risk flags.** The BUG-004 parent-death watchdog and this phase are in direct tension: a server that must outlive its client redefines "orphan" — getting it wrong either resurrects orphan leaks (F14) or kills live detached sessions. If tmux is chosen, Phase 3 shrinks materially — re-scope before spec'ing it.

## Phase 3 — Resilient Session Path (transport, reconnect, sleep/wake)

**Goal.** The renderer-to-session path no longer has Chromium's network service as an unrecoverable failure mode, and the connection layer detects and recovers from death instead of no-op'ing into a frozen pane (F3, F5). This is where the triggering incident becomes impossible: after sleep/wake, every pane is alive with its same shell, automatically. The testability seams — backend state channel + `restart()`, a backend factory on the view, mock-backend disconnect — land *with* the recovery logic they exist to test. Also closed here: F2 (child stderr drained; Rust logging can never block the server), F13's check half (executable+quarantine-aware preflight with actionable errors), and a minimal honest connection-state UI.

**Flagged decisions for the phase spec:** transport (browser WS + reconnect vs Node socket vs UDS vs stdio — constrained by Phase 2's architecture); disconnected-input semantics (queue vs visibly reject — never silently drop); heartbeat design.

**Depends on:** Phase 2.

**Success criteria.**
- **HARD (user-named):** repeated real macOS sleep/wake cycles — including with a full-screen TUI running — leave every session intact and every pane live with no user action. Verified by a written forcing protocol recorded in the manual checklist (not opportunistic lid-closing), plus a simulated-connection-death e2e via the new seams.
- Killing the connection out from under a live pane → automatic reattach to the same shell.
- Input during a disconnect window is never silently lost.
- Disconnect/recovery UX is unit-testable via the mock backend, below the e2e level.
- Every spawn/handshake failure flavor (missing binary, quarantined, crash-on-start) produces a loud, distinct, user-actionable error.

**Risk flags.** Sleep/wake is an environment-dependent repro — the acceptance test needs a forcing protocol. Reconnect state machines breed exactly the timing races this codebase is prone to; must not re-create F1's shape at a new layer.

## Phase 4 — Nothing Fails Silently (long-tail + visibility)

**Goal.** Silent degradation stops being the house style: every abnormal state in the terminal path is visible to the user and observable to a test. The fragility long-tail closes as a *named, enumerated list* so it can't get lost: F6 (WebGL context loss recovers or visibly downgrades — no more permanent invisible DOM fallback), F7 (undecodable frames counted and surfaced), F10 (all 34 `catch {ignore}` sites triaged: justified-in-place, surfaced, or fixed — the orphan/vanish converters eliminated), F11 (fit/resize edges), F12 (a real quit-and-relaunch test against persisted `workspace.json` — the gap both prior restore bugs slipped through), plus UI rendering of Phase 2's exit fidelity. Ends with a full manual-checklist re-run against the new architecture.

**Depends on:** Phase 3 for the degraded-state surface; the F6/F10/F11 cluster needs only Phase 1 (pull-forward buffer).

**Success criteria.**
- Each enumerated F-item individually closed, or explicitly waived with rationale in the completion report.
- Degraded-state audit: no code path in the terminal stack can leave a pane visually "fine" while functionally dead.
- Full manual checklist re-run green; MORNING-UAT ledger cleared.

**Risk flags.** Grab-bag gravity — the scope survives only as a closed named list. Timebox F10's per-site judgment calls. F6 touches xterm addon internals that renderer changes have silently invalidated before.
