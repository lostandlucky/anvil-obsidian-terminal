# Phase 4 Implementation Brief — First-fit cell measurement (BUG-003)

**Date:** 2026-07-14 · **Triage:** `phase-4-first-fit-measurement-triage.md` (Recommendation B) · **Mode:** B (code tests)

## Architectural shape

- **New pure module `src/terminal/settle-fit.ts`** — a one-shot scheduler: given injected deps (`fontsReady` promise supplier, `requestFrame`, settle callback), it invokes the callback once after font flow settles (fonts ready, then two frames — belt-and-braces for the one-frame layout lag), with a cancel path for disposal. No DOM or obsidian imports; Level-1 unit-testable, same pattern as `fit-coalescer.ts`.
- **`XtermHost.mount()`** keeps the synchronous first fit exactly as-is (the PROMPT_EOL_MARK coupling: `TerminalContainerView.addTab` reads `host.terminal.cols/rows` synchronously right after `mount()` for the PTY spawn dims) and *additionally* schedules a corrective settle-fit. The corrective pass must:
  1. Force a char-size re-measure via feature-detected `terminal._core._charSizeService.measure()`. This is the load-bearing discovery of this brief: `FitAddon.fit()`/`proposeDimensions()` read the render service's **cached** cell dims, so at unchanged container size a corrective `fit()` alone recomputes the same wrong cols and silently no-ops. (`measure()` → char-size-change event → renderer `handleResize` updates dims synchronously — only when metrics actually changed.)
  2. Then call the coalescer-bypassing direct `fit.fit()` (the container dims are unchanged, so `tryFitForDimensions` would suppress it).
  - Guarded by a disposed flag set in `dispose()`.
- **Steady-state churn guard is carried by xterm itself**, not the coalescer: `measure()` fires no event when metrics are unchanged; `fit()` only calls `terminal.resize` when proposed cols/rows differ; `onResize` only fires on an actual resize. So when the bundled font is absent or already flowed, the corrective pass is a zero-event no-op.
- **No changes** to `main.ts`, `TerminalContainerView.ts`, coalescer, or `PtyBackend` (its `resize()` pre-open is already readyState-guarded). The "surgical" per-host relayout broadcast (BUG-003 fix path 3) is not needed.

## Anchor test

`tests/e2e/bug-003-first-fit.e2e.ts` (e2e — unit tests cannot call `mount()`; xterm's `open()` needs real layout, per `xterm-host.test.ts`):

1. **Stale-metrics anchor (the RED carrier).** Register a probe `FontFace` under a unique family with a lazily-loading source (`local('Menlo'), local('Monaco')`), assert it is still `unloaded` at open-start; set plugin `fontFamily` to `'<probe>', Georgia`; open the terminal — mount's synchronous fit measures Georgia fallback metrics, and the measurement itself triggers the probe load (this *is* the BUG-003 mechanism, amplified: registered-but-not-flowed at fit time). Wait for `face.status === "loaded"` + `document.fonts.ready` + a settle window; assert the terminal's reported cols equal a fresh public `fit()`'s cols. RED: off by tens of cols. GREEN: the corrective settle-fit already reconciled them.
   - Fallback if `local()` sources misbehave in the harness: a `url(data:...)`-sourced FontFace built from a system font file — URL sources also load lazily by spec.
2. **Steady-state pin.** Default settings (bundled font registered at plugin onload, long settled), open a terminal, attach an `onResize` counter immediately after open, wait past the settle window; assert zero resize events and stable cols. Passes at RED; at GREEN it pins "no added SIGWINCH churn" / "no behavior change when the bundled font is absent/already loaded" (both cases have `fonts.ready` resolved and metrics unchanged — same no-op path).

Unit: `src/terminal/settle-fit.test.ts` — invokes the callback exactly once after fontsReady + both frames; never invokes after cancel; no timers/polling.

## Tooling traps

- `fit()` without re-measure is a silent no-op at unchanged container size (see above) — do not "simplify" the corrective pass down to a bare `fit()`.
- xterm option setters short-circuit same-value writes (`OptionsService`), so `options.fontFamily = current` does NOT force a re-measure. The private seam is the only vehicle; wrap it in the repo's feature-detect convention (`undocumented-api-surface.test.ts` pins guard + call site for such surfaces) and degrade to a bare `fit()` if absent.
- `_core`/`_charSizeService`/`measure` all survive in the shipped xterm dist (verified; FitAddon itself relies on `_core._renderService`).
- e2e settings mutation (`plugin.updateSettings`) persists into the fixture-vault session — restore `fontFamily` and `document.fonts.delete` the probe face in `afterEach`.
- Single-spec e2e runs during the loop: `npm run build && npx wdio run ./wdio.conf.mts --spec tests/e2e/bug-003-first-fit.e2e.ts` (build first — the harness copies `bin/pty-server` + the woff2 into the sandboxed vault).

## Existing-test audit

- `src/terminal/xterm-host.test.ts` — never calls `mount()`; stays green.
- `src/terminal/fit-coalescer.test.ts` — module untouched; stays green.
- Glyph/theming/visual e2e suites (`nerd-font-glyphs*.e2e.ts`, `phase-2-theming.e2e.ts`) — bundled font settles before any terminal opens, corrective pass no-ops; stay green (confirmed at GREEN gate).
- Hygiene / restore-redock / container-view e2e — mount gains an async no-op pass, no resize churn; stay green.

## Doc surfaces

- `docs/reference/architecture.md`, `docs/reference/terminal-container-view.md`, `docs/adr/0006-workspace-container.md` (mention fit/coalescer flow) — touch only if the described contract changes; the coalescer contract is unchanged.
- Bookkeeping (part of done): remove BUG-003 from `specs/anvil/known-bugs.md`; add the cold-install first-paint step to `specs/anvil/manual-test-checklist.md` (new MT-018); MORNING-UAT manual item for the true cold-install check.

## TDD ordering

1. `settle-fit` unit RED → module GREEN → commit.
2. e2e RED probe: stale-metrics anchor fails for the right reason (also confirms/falsifies the font-flow root cause in the harness — if the probe can't go stale, re-aim per triage); steady-state pin passes.
3. Wire settle-fit into `mount()` (+ disposed flag) → anchor GREEN → commit.
4. Full-suite GREEN gate → bookkeeping + completion report → commit.
