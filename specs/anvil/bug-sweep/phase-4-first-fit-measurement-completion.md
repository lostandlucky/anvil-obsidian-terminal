# Phase Complete: Phase 4 — First-fit cell measurement (BUG-003)

**Mode:** Code Tests (Mode B, Brief + Execute per triage)
**Cycles:** 1 (clean pass)
**Status:** GREEN

## Deliverables

- `src/terminal/settle-fit.ts` — new pure one-shot scheduler: fontsReady → two frames → corrective pass; cancellable; silent degradation on fonts API failure. (`src/terminal/settle-fit.test.ts`, 5 unit tests.)
- `src/terminal/xterm-host.ts` — `mount()` keeps the synchronous first fit (PTY spawn dims are read right after mount — PROMPT_EOL_MARK coupling) and additionally schedules the corrective settle pass: forced char-size re-measure via feature-detected `_core._charSizeService.measure()`, then the coalescer-bypassing direct `fit.fit()`. `dispose()` cancels a pending pass.
- `tests/e2e/bug-003-first-fit.e2e.ts` — anchor (slow-served probe FontFace ahead of Georgia; mount mid-load measures stale fallback metrics; first-reported cols must equal a settled post-font-flow fit) + steady-state pin (settled fonts ⇒ zero resize events, stable cols).
- `tests/unit/undocumented-api-surface.test.ts` — new vendor block pinning the xterm private seam (referenced + feature-detected).
- Bookkeeping: BUG-003 removed from `specs/anvil/known-bugs.md` (no open bugs remain); MT-018 cold-install first-paint step added to `specs/anvil/manual-test-checklist.md`.

## Root cause (confirmed at RED)

The suspected font-flow theory held, with a sharper mechanism than the bug entry guessed: the mount-time fit measures cell metrics before the layout engine has flowed a late-arriving FontFace, **and** `FitAddon.fit()`/`proposeDimensions()` read the render service's *cached* cell dims — so at unchanged container size every later fit recomputes the same stale cols and silently no-ops. That is why only a real container resize (which re-measures via `_afterResize`) self-healed. RED demonstrated it amplified: reported cols 50 (Georgia fallback) vs settled 83 (probe font), reconciled only by a forced re-measure. Consequence recorded for posterity: BUG-003 fix paths 1 and 2 as written in the bug entry (bare deferred/double `fit()`) could never have worked.

## GREEN gate

- Unit: 244/244 (29 files).
- E2E: 14/14 spec files — includes the new `bug-003-first-fit.e2e.ts` (2/2) and the named regression suites (`nerd-font-glyphs*.e2e.ts`, `phase-2-theming.e2e.ts`) green.
- No flakes encountered; no cargo tier (no Rust touched).

## User Testing

- Cold-install first paint (MT-018): fresh vault, zip install, open terminal, run `claude` with no prior divider touch — the welcome card should lay out cleanly on the first try. This was the user-visible symptom of BUG-003.
- Everyday feel: normal terminal opens in your dogfooding vault should be indistinguishable from before — no flicker, no reflow on idle, no prompt `%` marks on startup.

## Required Manual Verification

- **True cold-install verification (MT-018)** — fresh vault with no saved workspace/pane state, zip-installed plugin, real `claude` binary, visual judgment of the welcome card's first paint. The harness cannot honestly reproduce cold vault state or judge the card visually; the automated anchor covers the mechanism (stale metrics at mount), not the production condition end-to-end.

## Notes for downstream phases

None — this was the last phase of the bug-sweep meta-plan; the epic is complete. For future work touching fit/measurement: the xterm private seam (`_core._charSizeService`) is pinned statically in `undocumented-api-surface.test.ts` and exercised at runtime by the bug-003 e2e — an xterm upgrade that moves it will fail both, and the fix degrades to pre-fix behavior (never crashes).
