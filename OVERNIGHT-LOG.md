# Overnight Autopilot Log — bug-sweep — 2026-07-14

Meta-plan: `specs/anvil/bug-sweep/meta-plan.md` · Branch: `autopilot/bug-sweep-2026-07-14` · Contract: unattended, decide-and-log reversible forks, park irreversible ones.

## Phase: Phase 1 — Restore-path redock (BUG-001) — triage

- Ran `/phase-triage` unattended (skill loaded from disk at `~/.claude/skills/dev-workflow/skills/phase-triage/SKILL.md`; not registered with the Skill tool in this session — proceeded from the on-disk copy).
- [RESOLVED-AUTO] Plan-mode entry and present-for-sign-off steps skipped per autonomy contract; triage artifact written directly.
- Recommendation: **B — Brief + Execute** (`specs/anvil/bug-sweep/phase-1-restore-redock-triage.md`). Direction already set by known-bugs.md BUG-001 fix path + meta-plan's user-named simulated-restore requirement; remaining decisions are implementation-shape. Next: `/phase-exec Phase 1`.
- [RESOLVED-AUTO] Artifact slug `phase-1-restore-redock-triage.md` derived from meta-plan phase title.
- Per-commit tier: unit suite green (223/223, 25 files). Unit smoke reported 4 orphaned pty-servers in the live vault — BUG-004 evidence, out of Phase 1 scope, left alone.
- Nothing parked; no irreversible forks encountered.

## Phase: Phase 1 — Restore-path redock (BUG-001) — exec  [GREEN]

- Ran `/phase-exec Phase 1 no-audit` unattended from the on-disk skill copy (`~/.claude/skills/dev-workflow/skills/phase-exec/SKILL.md`; not registered with the Skill tool in this session). Triage recommendation B honored: implementation brief written (`specs/anvil/bug-sweep/phase-1-restore-redock-brief.md`), sign-off auto-approved per contract, committed before RED.
- decisions:
  - [RESOLVED-AUTO] Verification mode → Mode B (code tests): executable behavior with a phase-named anchor e2e; pure detection logic split into a unit-tested module per the testing-approach boundary rule.
  - [RESOLVED-AUTO] Redock mechanism fork (move-existing-leaf vs detach + re-run open path) → detach strays and re-run `openDefaultTerminal()` — reuses the battle-tested wrap-and-dock open path, sidesteps deferred-view states on restored background leaves; fresh shell is fine per meta-plan OUT/FI-005.
  - [RESOLVED-AUTO] Restore-vs-user-move gate shape → `WeakSet` of plugin-placed leaves (in-window drags preserve leaf identity → moved leaves stay known and are never fought; rehydration creates fresh leaf objects → strays). Plus `layoutReady` gate, reentrancy flag, mark-before-redock so a failed redock can never loop, and `onLayoutReady` hook for the real relaunch path.
  - [RESOLVED-AUTO] Scope of redock → main-window (rootSplit) leaves only; terminals deliberately parked in popouts/sidebars are left where the user put them. Multiple restored terminals collapse to one docked container with one fresh tab (matches MT-016's documented v1 behavior).
  - [RESOLVED-AUTO] Simulation shape → `getLayout()` → `disablePlugin`+`enablePlugin` (resets plugin memory as a relaunch would) → `changeLayout()`; two variants (faithful roundtrip + crafted sibling-tab layout). RED probe showed the faithful roundtrip reproduces the bug on its own (rootSplit rehydrates `vertical` — dock structure lost in serialization), so both variants carry assertions.
  - [RESOLVED-AUTO] AC2 (no-fight) passes trivially at RED (no reconciler = nothing fights) — kept as a regression pin; its failure mode is validated at the unit level (`isPluginPlaced` filter tests).
  - [RESOLVED-AUTO] Latent "Loading workspace…" hang note preserved by folding into MT-016 as a watch item (known-bugs entry removed on fix per its convention); new MT-017 added for deliberate-move/popout/mid-drag manual checks.
  - [RESOLVED-AUTO] No downstream notes pushed to Phases 2–4 (different subsystems; nothing actionable) — reusable sim-harness pattern recorded in the completion report instead.
- Unautomatable ACs → MORNING-UAT "Manual verification" (excluded from GREEN): true quit-relaunch redock (MT-016), latent-hang watch, real-drag/focus-sanity checks (MT-017).
- result: green, 1 cycle (clean pass), commits b33924d (brief) → 9e8ee06 (unit module) → 1e90794 (fix + e2e) → completion/bookkeeping commit. GREEN gate: unit 230/230, e2e 13/13 spec files (includes `bug-001-restore-redock.e2e.ts` 3/3; `fi-012-wrap-and-dock` and `container-view` regression suites green). No flakes encountered. Latent hang did not resurface.

## Phase: Phase 2 — Parent-death watchdog (BUG-004) — triage

- Ran `/phase-triage` unattended (skill loaded from disk at `~/.claude/skills/dev-workflow/skills/phase-triage/SKILL.md`; not registered with the Skill tool in this session — proceeded from the on-disk copy).
- [RESOLVED-AUTO] Plan-mode entry and present-for-sign-off steps skipped per autonomy contract; triage artifact written directly.
- Recommendation: **B — Brief + Execute** (`specs/anvil/bug-sweep/phase-2-parent-death-watchdog-triage.md`). Direction pre-approved in the meta-plan (kqueue `EVFILT_PROC | NOTE_EXIT` on parent PID, known-bugs.md fix path 1; `libc` pin exception pre-cleared — not a park item). Remaining decisions are implementation-shape: watchdog vehicle (thread vs AsyncFd task), registration-race sequencing, harness location, bounded idle-survival assertion. Next: `/phase-exec Phase 2`.
- [RESOLVED-AUTO] Artifact slug `phase-2-parent-death-watchdog-triage.md` derived from meta-plan phase title.
- Nothing parked; the only dependency touch (`libc`) is explicitly pre-approved in the meta-plan shared constraints.

## Phase: Phase 2 — Parent-death watchdog (BUG-004) — exec  [GREEN]

- Ran `/phase-exec Phase 2 no-audit` unattended from the on-disk skill copy (`~/.claude/skills/dev-workflow/skills/phase-exec/SKILL.md`; not registered with the Skill tool in this session). Triage recommendation B honored: implementation brief written (`specs/anvil/bug-sweep/phase-2-parent-death-watchdog-brief.md`), sign-off auto-approved per contract, committed before RED.
- decisions:
  - [RESOLVED-AUTO] Verification mode → Mode B (code tests): meta-plan names a standalone kill-the-parent anchor test.
  - [RESOLVED-AUTO] Watchdog vehicle fork (detached OS thread blocking in kevent vs tokio AsyncFd task) → detached `std::thread`: invisible to the tokio runtime, cannot hold it alive or delay existing shutdown paths; process exit reaps it.
  - [RESOLVED-AUTO] Race sequencing → `getppid()` at install (≤1 ⇒ trigger), register kevent, re-check `getppid()` after registration, then block; on any ambiguous kqueue failure re-check PPID and go *inactive* if the parent is alive — never reap a live session on a guess (user-named priority ranks orphan risk below false reaping).
  - [RESOLVED-AUTO] Harness fork (vitest shelling out vs new cargo-test infra) → vitest (`tests/unit/parent-death-watchdog.test.ts`), following `orphan-pty-server-smoke.test.ts`; builds the release binary via cargo in `beforeAll` (`bin/pty-server` is gitignored), speaks the WS protocol with Node's global WebSocket so the anchor asserts "shell child included".
  - [RESOLVED-AUTO] "Survives indefinitely" encoded as a bounded idle-window pin (passes at RED, documented as a regression pin against anyone adding timeout reaping) + construction constraint (no timers/polls in the watchdog); hours-scale survival → MORNING-UAT.
  - [RESOLVED-AUTO] Discovery fix scope: anchor stayed red after the kqueue landed — parent death breaks the piped stderr, and tracing-subscriber's `eprintln!` fallback panics the thread holding the trigger (verified via `sample`: watchdog thread gone, event delivered, trigger never ran; production spawn is `stdio:["ignore","pipe","pipe"]`, so real force-quits hit it too). Fixed inside phase scope: trigger-before-log on all death paths + `BestEffortStderr` writer for the subscriber (also protects the session-teardown shell-kill from log-line panics).
- Unautomatable ACs → MORNING-UAT "Manual verification" (excluded from GREEN): true `pkill -9 Obsidian` check (MT-013, dovetails with Phase 1's MT-016 run), hours-scale idle survival.
- Bookkeeping: BUG-004 removed from known-bugs.md (BUG-002 cross-ref updated), MT-013 false "launchd reaps ≤5s" expectation corrected, PROTOCOL.md lifecycle documents parent-death behavior, meta-plan Phase 3 gained "Notes from Phase 2" (Shutdown seam unchanged; broken-stderr panic constrains teardown rework; reusable WS harness).
- result: green, 1 gate cycle (inner TDD loop took two passes — see discovery), commits 52e5811 (brief) → 8808957 (watchdog + tests GREEN) → completion/bookkeeping commit. GREEN gate: unit 234/234 (27 files), e2e 13/13 spec files, `cargo test --release` 7/7, clippy clean. No flakes; no leaked test processes. Live-box orphans predating the fix left alone per triage.

## Phase: Phase 3 — SIGTERM latency under WS flood (BUG-002) — triage

- Ran `/phase-triage` unattended (skill loaded from disk at `~/.claude/skills/dev-workflow/skills/phase-triage/SKILL.md`; not registered with the Skill tool in this session — proceeded from the on-disk copy).
- [RESOLVED-AUTO] Plan-mode entry and present-for-sign-off steps skipped per autonomy contract; triage artifact written directly.
- Recommendation: **C — Spec + TDD** (`specs/anvil/bug-sweep/phase-3-sigterm-latency-triage.md`). The outcome is a directly measurable latency budget with an existing standalone harness pattern (Phase 2's `parent-death-watchdog.test.ts`); the anchor/variant/pin tests are identical under all three candidate fix paths in known-bugs.md, so the tests are the spec. Every constraint tests can't encode is already written upstream (meta-plan "Notes from Phase 2", BUG-002 fix paths) — a brief would be a third restatement. Next: `/phase-exec Phase 3` (Mode B, no brief step; triage carries the test plan).
- [RESOLVED-AUTO] Fix-path choice (force-close sink vs writer-task+bounded-channel vs pre-send check) left to the executor's red→green cycle — all internal, reversible, test-identical; meta-plan deliberately deferred it. Not a park item.
- [RESOLVED-AUTO] AC3 budget decision (tighten 3s→1s vs keep) stays with the executor per the meta-plan's own decision rule (≥10 mixed-load runs, measured distribution in the completion report). Partial closure (amend BUG-002 instead of removing) is a sanctioned outcome.
- [RESOLVED-AUTO] Artifact slug `phase-3-sigterm-latency-triage.md` derived from meta-plan phase title.
- Nothing parked; no dependency or contract surface is touched by any candidate path.
