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

## Phase 3 — Release-readiness (FI-018 + FI-017)
- **Status:** GREEN
- **Cycles:** 1 (clean pass)
- **Mode:** Hybrid — Mode B for executable ACs, Mode A for documentation ACs
- **Subagent rollup:** All 17 ACs met. Hygiene audit: 3 e2e + 2 unit tests cover the automatable scenarios (plugin reload mid-session, multi-terminal abnormal exit, close-while-active, dispose lifecycle). 4 manual hygiene rows added to `manual-test-checklist.md` as MT-013…MT-016 (force-quit, OS-kill of pty-server, hung shell, crash recovery). NO leaks discovered — `PtyBackend.close()` already implements the contract correctly. Release: `release.sh` produced `anvil-obsidian-terminal-v0.1.0.zip` (1.1MB, 4 files: manifest + main.js + styles.css + bin/pty-server with exec bit) with SHA256 sidecar. Startup-time missing-binary notice wired via Obsidian `Notice` API. `docs/install.md` walks a non-developer through download → unzip → xattr → enable. README updated with "Install (release)" section. **Local tag `v0.1.0` exists; no `git push` was run.** Test count 183 → 206 unit (+23), 9 → 10 e2e spec files. One minor naming drift caught: spec referenced `BinaryClient.close()` but the codebase has `PtyBackend` owning the websocket directly — tests landed on `PtyBackend` as the right seam.
- **Manual verification carryover:** 6 items — MT-013 (force-quit), MT-014 (OS-kill pty-server), MT-015 (hung shell), MT-016 (crash recovery), the cold-install-in-clean-vault smoke, and the GitHub publish steps. All explicit in the completion report.
- **Decisions auto-resolved:** 4 (D1 xattr workaround documented, D2 ship bin/ in zip with startup-time check, D3 hygiene split 3 e2e + 2 unit + 4 manual, D4 vX.Y.Z tag + named zip).
- **Pre-audit subagent digest:** all Sound. ACs covered with the Manual hygiene rows and AC5/AC6 documentation correctly routed to Mode A.
- **Open Dependabot PR carried to morning:** `typescript 6.0.2 → 6.0.3` flagged but not merged (no-push policy).

---

## Final State (all phases GREEN)

- **Branch:** `yolo/phase-4-overnight-2026-04-27` (25 commits ahead of main, not pushed)
- **Local tag:** `v0.1.0`
- **Release artifact:** `anvil-obsidian-terminal-v0.1.0.zip` + `.sha256` sidecar at repo root (gitignored)
- **Test totals:** 206 unit + 10 e2e spec files (all green)
- **Build:** `npm run build` clean, `cargo build --release` clean
- **Manual verifications waiting for morning audit:** 1 from Phase 2 (nerd-font visual) + 6 from Phase 3 (4 hygiene + cold-install + publish steps)
- **No `git push`** was run during exec.
