# Meta-Plan: Bug Sweep — Restore, Lifecycle, Latency, First-Fit

**Created:** 2026-07-14 · **Branch:** `autopilot/bug-sweep-2026-07-14` · **Mode:** unattended (`/phase-autopilot`, autonomy contract applies)

Fixes the four confirmed defects in [`../known-bugs.md`](../known-bugs.md). Each phase's detailed symptom, repro, root-cause analysis, and candidate fix paths live there — this plan does not duplicate them. Phases are ordered by daily pain (user-stated), not by dependency.

## Dependency map

- Phases 1, 2, and 4 are independent of each other.
- Phase 3 edits the same pty-server shutdown path as Phase 2 — run it **after** Phase 2 and build on its landed state.
- Execution is serial regardless (autopilot contract).

## Shared constraints

- **Read `specs/anvil/testing-approach.md` before writing any tests** (project rule).
- **No dependency changes.** The e2e harness (`wdio-obsidian-service` + pinned Obsidian binary) stays pinned; the 9 open Dependabot PRs are deliberately OUT of this batch (park-bar) and go to the morning queue. Exception, pre-approved by the user in-session: Phase 2 may add `libc` to `pty-server/Cargo.toml` — it is already in the lockfile transitively; pin exact like the other deps.
- **Undocumented Obsidian APIs** (rootSplit internals, `createLeafInParent`, layout tree) are always feature-detected with graceful degradation — existing pattern in `src/main.ts` / `src/dock/wrap-and-dock.ts`.
- **Bug bookkeeping is part of done:** on fix, remove the bug's entry from `known-bugs.md` (its stated convention) and update `manual-test-checklist.md` where a scenario changes (e.g. MT-013's "≤5s orphan" expectation, MT-016 restore).
- Commit cadence per git-checkpoints (commit at every green); macOS arm64 only.

## Explicit boundaries (OUT)

- Dependabot/dependency sweep (morning queue).
- FI-005 persistent sessions (surviving restarts) — restored terminals still spawn fresh shells; that is by design in v1.
- Cross-platform support, community plugin store, any new features.

---

## Phase 1 — Restore-path redock (BUG-001)

**Goal.** A terminal that was open at quit comes back **bottom-docked** on relaunch — the user never sees it parked as a sibling tab next to their notes, never has to close-and-reopen it, and focus lands somewhere sane. The redock must not fight the user (no firing mid-drag, no repeated re-docking after they deliberately move the leaf). USER-NAMED REQUIREMENT, part of GREEN: since the harness can't do a real quit-relaunch, invent a faithful in-process simulation of workspace serialize→restore (e.g. capture layout JSON → detach leaves → rehydrate via `changeLayout()`) and assert dock placement and natural tab behavior through it.

**Depends on:** nothing.

**Success criteria.**
- Simulated-restore e2e: after rehydrating a saved layout containing a terminal leaf, the terminal ends up bottom-docked with its tab strip intact and a working shell; no misplaced-tab flash the user must clean up.
- A user-initiated leaf move is respected (no redock loop); pane-resize drags are never interrupted.
- Existing wrap/unwrap suites (`fi-012-wrap-and-dock.e2e.ts`, container-view) stay green.
- Manual-test-checklist gains/updates a true quit-relaunch entry (MT-016 family) — manual, excluded from GREEN, listed in MORNING-UAT.

**Risk flags.** Undocumented workspace internals across Obsidian versions; `layout-change` reentrancy (the empty-sibling reconciler already runs there); the latent "Loading workspace…" hang noted in BUG-001 — if the simulation resurfaces it, that's a find, not a blocker: park with evidence. Distinguishing "Obsidian restored the leaf wrong" from "user dragged it there on purpose" may need a once-per-layout-ready gate.

## Phase 2 — Parent-death watchdog (BUG-004)

**Goal.** `pty-server` exits promptly and cleanly when its parent dies without warning (force-quit, crash, OOM), and **never** exits because a live session is quiet — no timeout-based reaping of any kind (user-named outcome: cleanup must stop killing real sessions; only true orphans die). Recommended path is pre-approved: kqueue watch on the parent PID (`EVFILT_PROC | NOTE_EXIT`) per known-bugs.md — substitute only if it proves unworkable, and log why.

**Depends on:** nothing.

**Success criteria.**
- Kill-the-parent test (pty-server is testable standalone — a wrapper process that spawns it and dies covers this without wdio): pty-server exits within a few seconds of parent death, shell child included, zero orphans.
- Long-idle live session with parent alive survives indefinitely.
- Normal close paths (tab close, plugin disable, Obsidian quit) behave exactly as before; hygiene suites stay green.
- `known-bugs.md` BUG-004 removed; MT-013 expectation corrected.

**Risk flags.** Unsafe Rust + raw kqueue: get the registration-vs-already-dead race right (parent may die before the watch is installed — must check PPID after registering). Watchdog must not hold the tokio runtime alive or block shutdown paths that already work.

## Phase 3 — SIGTERM latency under WS flood (BUG-002)

**Goal.** SIGTERM-to-exit stays sub-second even while pty-server is flooding output to a dead or slow WebSocket peer, removing the 1–3s tail. If empirically stable across repeated runs, tighten the AC3 e2e budget back from 3s toward 1s; if not stable, keep 3s and record the measured distribution.

**Depends on:** Phase 2 (same shutdown code; build on its landed state).

**Success criteria.**
- Repeated AC3-style runs (≥10, mixed load) green at the tightened budget with the measured latency recorded in the completion report.
- No regression in clean-exit protocol behavior (exit message + WS close still delivered on normal child exit).
- `known-bugs.md` BUG-002 removed (or amended with new empirical numbers if only partially closed — that outcome is acceptable, log it).

**Risk flags.** tokio select/sink semantics under backpressure are subtle; flake sensitivity to host load means the budget decision needs a measured basis, not one lucky run.

**Notes from Phase 2 (landed 2026-07-14).**
- The `Shutdown` seam is unchanged — the parent-death watchdog is just a new trigger *source* (detached kevent thread in `main.rs`); rework the session loop freely, but keep the seam.
- Load-bearing discovery: once the parent dies, the piped stderr is broken, and tracing-subscriber's write-error fallback (`eprintln!`) **panics the logging thread**. The subscriber now writes via `BestEffortStderr` (swallows write errors), and all shutdown paths trigger BEFORE logging. Any Phase 3 teardown rework must preserve both properties — a log line must never be able to kill the exit path.
- The session loop's `ws_sink.send().await` stall (BUG-002's target) was deliberately untouched.
- Reusable harness: `tests/unit/parent-death-watchdog.test.ts` builds the release binary via cargo in `beforeAll` and speaks the WS protocol from vitest with Node's global `WebSocket` — AC3-style repeated latency runs can reuse this pattern without wdio.

## Phase 4 — First-fit cell measurement (BUG-003)

**Goal.** The very first terminal open in a fresh vault reports correct cols/rows on first paint, so full-width TUIs (claude's welcome card) lay out correctly with no mid-word wrap and no user-resize needed to self-heal. No added SIGWINCH churn on the steady-state path (the fit-coalescer already dedupes identical measurements).

**Depends on:** nothing.

**Success criteria.**
- A test that reproduces the stale-metrics first fit (mount before font flow) goes from RED to GREEN: first-reported cols equal a settled post-font-flow fit.
- No behavior change when the bundled font is absent/already loaded; theming and glyph suites stay green.
- `known-bugs.md` BUG-003 removed; cold-install checklist step updated.

**Risk flags.** `document.fonts.ready` timing inside the wdio-launched Obsidian may differ from production; the fix must not reintroduce the mount-order prompt bug (PROMPT_EOL_MARK regression documented in `TerminalContainerView.addTab`).

---

## Self-check (recorded)

- **Goldilocks/Substitution/Discovery:** each phase states outcomes in 2-5 sentences; approach is deferred except where the user pre-approved a path in-session (Phase 2 kqueue — noted as constraint, not re-litigable fork). Each phase still requires real investigation (workspace internals probe, kqueue race, sink backpressure, font-flow timing).
- **Stability:** a surprise in any phase doesn't invalidate the others' descriptions; only Phase 3 rebases on Phase 2's code.
- **Independence:** phases 1/2/4 can reorder freely; the 2→3 ordering is the only constraint.
