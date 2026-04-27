# Shippable-Plugin Overnight Orchestration Log

Branch: `yolo/phase-4-overnight-2026-04-27`. Started 2026-04-27 evening.

## Phase 1 — Grooming (FI-020 + FI-019)
- **Status:** GREEN
- **Cycles:** 1 (clean pass)
- **Subagent rollup:** All 9 ACs met. wdio-obsidian-service held at 3.0.2 (current upstream). Obsidian test binary held at 1.12.7 (exactly current stable; spec-error caught: binary version lives in `wdio.conf.mts`, not `package.json`'s `obsidian` field which is just typings — Phase 2 noted). Cargo Dependabot entry added at `.github/dependabot.yml`. Four undocumented Obsidian APIs re-verified (added `createLeafBySplit` per ADR-0007). Double-fit removed via new `fit-coalescer` module with regression test. 27 new unit tests, 8/8 e2e green, cargo build clean. Downstream notes pushed into meta-plan's Phase 2 entry.
- **Manual verification carryover:** 0 items. All ACs automatable.
- **Decisions auto-resolved:** 4 (D1 hold pin, D2 hold binary + spec-error correction, D3 add Cargo Dependabot, D4 remove double-fit).
- **Pre-audit subagent digest:** test-shortcut-hunter — 4 stubs, all Sound except `undocumented-api-surface.test.ts` acceptably-Suspect (intentional implementation-pinning). test-coverage-gap-detector — 9/9 ACs Covered.

## Phase 2 — Settings & Theming (FI-016 + FI-015 + FI-021)
- **Status:** GREEN
- **Cycles:** 1 (clean pass)
- **Subagent rollup:** All 13 ACs met. Theme derives from Obsidian CSS vars (`--background-primary`, `--text-normal`, `--color-*`); falls back to Solarized Dark when accents missing or toggle off. Live theme-switch handler via `workspace.on("css-change", ...)` with MutationObserver fallback. Settings tab gains font family, font size, tmux session naming, solid-background toggle, use-Obsidian-accents toggle. preserveTmuxDimensions finally plumbed into the spawn path. obsidian-prefix tmux naming added. Nerd-font-prepended default font stack closes FI-021. Two minor in-flight corrections (settings-tab driven through pure spec layer because `obsidian` is types-only; e2e two-arg expect form not supported). Architecture invariants held: `TerminalBackend` interface untouched; fit-coalescer pattern respected; CSS authoring confined to `src/styles.css`. Test count 124 → 183 unit (+59), 8 → 9 e2e spec files. Downstream notes pushed into meta-plan's Phase 3 entry.
- **Manual verification carryover:** 1 item — AC9 visual nerd-font glyph rendering (requires a real installed nerd-font; covered by User Testing #7).
- **Decisions auto-resolved:** 5 (D1 css-change event, D2 Obsidian-accents-with-Solarized-fallback, D3 nerd-font-prepended stack, D4 integer + obsidian-prefix only, D5 two-toggle theme overrides with future-extensible schema).
- **Pre-audit subagent digest:** test-shortcut-hunter — all Sound. test-coverage-gap-detector — all 13 ACs Covered (AC9 routed to Manual per Auto/Mixed/Manual split).
