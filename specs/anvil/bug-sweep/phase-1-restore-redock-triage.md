# Phase Triage: Phase 1 — Restore-path redock (BUG-001)

**Date:** 2026-07-14
**Recommendation:** B (Brief + Execute) — architectural direction is already set by `known-bugs.md` BUG-001's suggested fix path plus the meta-plan's user-named simulation requirement; remaining decisions are implementation-shape. Run `/phase-exec Phase 1` — it produces a one-page implementation brief before the RED check (sign-off auto-resolved under the overnight autonomy contract).

## Context

Bug-sweep meta-plan (`meta-plan.md`) just landed on `autopilot/bug-sweep-2026-07-14`; Phase 1 fixes BUG-001 (terminal restores as a sibling tab instead of bottom-docked after quit-relaunch). Triage runs unattended as the first step of the overnight autopilot.

## Phase Assessment

| Dimension | Signal | Notes |
|-----------|--------|-------|
| Scope | Medium | `src/main.ts` (restore reconciler + once-per-layout-ready gate), likely `src/dock/wrap-and-dock.ts` (redock an *existing* leaf — `openWithWrap` currently assumes the container leaf isn't allocated yet), new e2e spec + serialize→restore simulation helper, plus bookkeeping (`known-bugs.md`, `manual-test-checklist.md`, MORNING-UAT). ~4–7 files. |
| Decisions | Some (implementation-level) | Redock mechanism (move the restored leaf into the docked slot vs early detach + re-run the existing open path — both invisible-to-user variants are allowed; fresh shell is fine per OUT/FI-005), gate shape for restore-vs-deliberate-user-move, where detection logic lives (pure module → unit-testable walk vs inline). No fork needs human input: `known-bugs.md` BUG-001 "Suggested fix path" names reconcile-on-`layout-change` gated on `layoutReady`, once per restore. |
| Novelty | Mixed | Wrap-and-dock machinery, feature-detection pattern, `layout-change` reconcilers, and wdio `browser.executeAsync` layout-surgery patterns all exist. New territory: `changeLayout()`/`getLayout()` are used nowhere in the repo — the simulated restore is genuinely new harness surface. |
| Reversibility | Easy | Plugin-internal behavior; no deps, no schema, no public API. Plain revertible commits. |
| Testability | High | The anchor test is named by the phase itself (simulated-restore e2e is part of GREEN). RED = rehydrated layout leaves the terminal as a sibling tab; GREEN = bottom-docked, tab strip intact, working shell, no redock loop after a deliberate move. Existing suites (`fi-012-wrap-and-dock.e2e.ts`, container-view) guard regressions. |

**Diagnostic:** Goldilocks ✓ | Substitution ✓ (several viable redock/gate shapes — approach correctly deferred) | Discovery ✓ (real probing of `changeLayout()` rehydration and reconciler reentrancy required; that probing belongs to execution, not to a spec that would merely relocate it)

## Why Brief + Execute, not the others

**Not A (Just Execute).** Medium scope with three named operational traps — `layout-change` reentrancy (both `reconcileWrap` and `reconcileEmptySibling` already run there, the latter with its own reentrancy flag), the no-fire-mid-drag requirement, and the latent "Loading workspace…" hang (park-with-evidence if resurfaced). Plus brand-new harness surface. Just Execute would spend execution tokens re-deriving structure a one-page brief makes explicit.

**Not C (Spec + TDD).** The discriminator fails: a red→green cycle alone can't specify the simulation harness itself — whether capture-layout→detach→`changeLayout()` faithfully reproduces the restore path is a probe question the tests can't encode for themselves. The architectural pointer lives upstream (known-bugs.md fix path + meta-plan risk flags); the executor needs those seams named before the RED check, which is exactly what the exec-time brief does.

**Not D (Phase Spec).** No genuine architectural fork needs human deliberation — the user already named the outcome (bottom-docked on restore, no fighting the user) and the test approach (in-process serialize→restore simulation) as requirements. A Decisions table would be ceremony over resolved questions. Under the unattended contract, D would also stall the pipeline for a sign-off with nothing to decide.

**Not E / not `/phase-prototype`.** The one uncertain area (simulation faithfulness) is embedded in the phase's own RED step; a separate throwaway probe would duplicate the e2e work, and the meta-plan already prescribes the response if the simulation resurfaces the hang (find, not blocker — park with evidence).

Mode note: no `lean` token was passed; this is the full-ceremony call (lean would not change it).

## Context health

New session for exec (standard for the autopilot pipeline — each step runs fresh). Everything the executor needs is in: this triage, the meta-plan Phase 1 block, `known-bugs.md` BUG-001, `testing-approach.md` (mandatory pre-test read), and the existing `fi-012-wrap-and-dock.e2e.ts` patterns.

## Open at session boundary

- MT-016-family true quit-relaunch checklist entry is manual-only — exec must add it to `manual-test-checklist.md` and list it in MORNING-UAT under "Manual verification" (excluded from GREEN).
- 9 open Dependabot PRs are deliberately OUT of this batch (meta-plan park-bar; morning queue).
- Untracked `tests/e2e/.diagnostic/` predates this run — leave it alone.
- Latent "Loading workspace…" hang: if the simulation resurfaces it, park with evidence per meta-plan risk flags; do not treat as a Phase 1 blocker.
