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
