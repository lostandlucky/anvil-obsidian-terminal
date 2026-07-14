# Phase Triage: Phase 4 — First-fit cell measurement (BUG-003)

**Date:** 2026-07-14
**Recommendation:** B (Brief + Execute) — architectural direction is already set by `known-bugs.md` BUG-003's ranked fix paths (all three are variants of "make a corrective fit happen after font flow settles"); remaining decisions are implementation-shape (which corrective-fit vehicle, how the RED repro forces pre-font-flow mount in the harness). Run `/phase-exec Phase 4` — it produces a one-page implementation brief before the RED check (sign-off auto-resolved under the overnight autonomy contract).

## Context

Phases 1–3 landed GREEN on `autopilot/bug-sweep-2026-07-14`; Phase 4 is independent (Phase 3 left no downstream notes — different subsystem). BUG-003: the very first terminal open in a fresh vault fits against pre-font-flow cell metrics, reporting cols off by 1–2, so claude-code's welcome card hard-wraps mid-word until the first user resize self-heals it.

## Phase Assessment

| Dimension | Signal | Notes |
|-----------|--------|-------|
| Scope | Medium-low | `src/terminal/xterm-host.ts` (mount-path corrective fit), possibly `src/main.ts` / `src/view/TerminalContainerView.ts` (only if the "surgical" per-host relayout path is needed), new e2e spec (stale-metrics repro + settled-cols assertion), possible unit pin near the coalescer, bookkeeping (`known-bugs.md`, `manual-test-checklist.md` cold-install step, MORNING-UAT). ~5–7 files. |
| Decisions | Some (implementation-level) | Which fix path — but path 1 *as written* ("replace the immediate `fit()` with `document.fonts.ready.then(fit)`") is constrained out by the mount-order requirement: `PtyBackend` spawns with `host.terminal.cols/rows` read synchronously right after `host.mount()` (`TerminalContainerView.addTab`, ~lines 295–302), and deferring the first fit re-creates the mid-startup SIGWINCH / PROMPT_EOL_MARK regression documented right there. So the fix is additive — keep the synchronous mount fit, add a corrective settle-fit (paths 2/3 shape). Harness level is also a real choice: unit tests cannot call `mount()` (xterm's `open()` needs real layout — documented in `xterm-host.test.ts`), so the anchor lives at e2e. No fork needs human input. |
| Novelty | Mixed | e2e harness, glyph/theming suites (`nerd-font-glyphs*.e2e.ts`, `phase-2-theming.e2e.ts`), fit-coalescer, and the addTab mount flow all exist. New territory: deterministically reproducing "mount before font flow" inside wdio-launched Obsidian — meta-plan risk-flags that `document.fonts.ready` timing there may differ from production, and the production repro needed a cold-install vault with no saved pane width. |
| Reversibility | Easy | Plugin-internal behavior; no deps, no protocol, no schema, no public API. Plain revertible commits. |
| Testability | High for GREEN, harder for RED | GREEN is directly assertable (first-reported cols == settled post-font-flow cols; steady-state resize-message count unchanged). RED is the crux: the repro must create the stale-metrics condition on demand. The root cause is *suspected* (font-flow one-frame lag), so RED doubles as root-cause confirmation. |

**Diagnostic:** Goldilocks ✓ (3-sentence goal + criteria, no tactics) | Substitution ✓ (three ranked fix paths plus harness variants — approach correctly deferred) | Discovery ✓ — but the probing (font-flow timing in wdio, corrective-fit vehicle) belongs to the RED/GREEN cycle, not to a spec that would merely relocate it.

## Why Brief + Execute, not the others

**Not A (Just Execute).** The likely diff is small, but two cross-file traps need naming before RED: (1) the PROMPT_EOL_MARK coupling — the backend's spawn dims are read synchronously after mount, so the initial fit must stay synchronous and the fix must be additive; (2) the coalescer keys on *container* dimensions (`fit-coalescer.ts`), so a corrective fit at unchanged container size is suppressed unless it goes through the coalescer-bypassing public `fit()` — and the "no added SIGWINCH churn" criterion is then carried by xterm's own cols/rows-level resize dedup, not the coalescer. Plus a brand-new harness question. Just Execute would re-derive all of this at execution time.

**Not C (Spec + TDD).** The discriminator fails in B's favor: the RED test's own shape is the undecided part — how to force a pre-font-flow mount inside wdio-Obsidian, and at what level (unit is off the table since `mount()` needs real layout). Whether the repro faithfully reproduces the cold-install condition is a probe question the tests can't encode for themselves — same rationale that put Phases 1 and 2 at B. Contrast Phase 3 (C), where the harness pattern already existed and the test stubs were fully specified before any fix-path choice.

**Not D (Phase Spec).** No fork needs human deliberation: all candidate paths are internal and reversible, the user-named outcome (correct first-paint layout, no steady-state churn) is already baked into the meta-plan goal, and the one path that's actually ruled out is ruled out by a documented in-repo constraint, not by taste. Under the unattended contract, D would stall the pipeline with nothing to decide.

**Not E / not `/phase-prototype`.** Single subsystem; the uncertain area (font-flow timing in the harness) is embedded in the phase's own RED step — a throwaway probe would duplicate the anchor test.

Mode note: no `lean` token was passed; this is the full-ceremony call (lean would not change it).

## Context health

New session for exec (standard for the autopilot pipeline — each step runs fresh). Everything the executor needs: this triage, the meta-plan Phase 4 block + shared constraints, `known-bugs.md` BUG-003 (root cause + ranked fix paths), `src/terminal/xterm-host.ts` (mount/fit/coalescer wiring), `src/view/TerminalContainerView.ts` addTab (mount-order comment + spawn-dims coupling), `src/terminal/bundled-font.ts` + `src/main.ts` `registerBundledFont` (font registration timing), `specs/anvil/testing-approach.md` (mandatory pre-test read), and the glyph/theming e2e suites as regression pins.

## Open at session boundary

- True cold-install verification (fresh vault, run `claude`, welcome card lays out with no mid-word wrap on first paint) is Level-3 manual — exec must update the cold-install checklist step and add it to MORNING-UAT "Manual verification" (excluded from GREEN).
- Root cause is *suspected*, not confirmed. If RED probing falsifies the font-flow theory (e.g. the driver turns out to be initial pane geometry rather than font metrics), that's a find: re-aim within phase scope if the fix stays internal and cheap; otherwise park with evidence per the autonomy contract.
- "No behavior change when the bundled font is absent/already loaded" is a named success criterion — the brief should give it an explicit test or pin, not leave it implied.
- 9 open Dependabot PRs remain deliberately OUT (meta-plan park-bar; already in MORNING-UAT). Untracked `tests/e2e/.diagnostic/` predates this run — leave it alone.
