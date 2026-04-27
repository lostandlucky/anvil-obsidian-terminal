# Phase Complete: Phase 1 — Grooming

**Mode:** Code Tests (Mode B) with Mode A audit-summary sub-checks
**Cycles:** 1 (clean pass)
**Status:** GREEN — 9 of 9 acceptance criteria met

## Deliverables

- `src/terminal/fit-coalescer.ts` (new) — pure module that decides when a fit is genuinely needed
- `src/terminal/fit-coalescer.test.ts` (new) — 7 unit tests, includes regression pin for FI-019
- `src/terminal/xterm-host.ts` (modified) — routes mount-time and ResizeObserver fits through the coalescer
- `tests/unit/dependabot-config.test.ts` (new) — 9 unit tests asserting AC3 structure
- `tests/unit/dependency-pins.test.ts` (new) — 5 unit tests pinning AC1/AC2 posture
- `tests/unit/undocumented-api-surface.test.ts` (new) — 6 unit tests for AC4/R5 source-surface presence
- `.github/dependabot.yml` (modified) — adds Cargo entry pointing at `/pty-server`

Total new tests: 27. Pre-phase baseline 97 passing → post-phase 124 passing.

## Audit Summary (R8 — phase-1-grooming dep findings as data)

### D1 — `wdio-obsidian-service` pin posture

- **Pinned at:** `3.0.2` (devDependencies, both `wdio-obsidian-service` and `wdio-obsidian-reporter`)
- **Upstream stable:** `3.0.2` (verified via `npm view wdio-obsidian-service version` on 2026-04-27)
- **Lag:** none — already current
- **Action:** **HOLD.** No bump needed. Dependabot is configured to surface future bumps as PRs via the existing `wdio` group in `.github/dependabot.yml`.

### D2 — Obsidian test binary pin posture

**Important nuance the spec under-specified.** The pinned version actually lives in **two places**, not one:

1. `package.json` `devDependencies.obsidian: 1.12.3` — TypeScript declarations package only (build-time API surface). Used by `tsc` for type-checking against Obsidian's API.
2. `wdio.conf.mts` — `browserVersion: "1.12.7"`, `installerVersion: "1.12.7"`. This is the actual Obsidian binary that `wdio-obsidian-service` downloads and runs the e2e suite against.

- **Test binary version:** `1.12.7`
- **Current Obsidian stable:** `1.12.7` (via `https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest`)
- **Lag:** 0 minors, 0 patches — at upstream stable.
- **Typings package version:** `1.12.3` (4 patches behind stable; no functional impact, only type-completeness)
- **Action:** **HOLD on both.** Test binary is already at upstream stable. The `1.12.3` typings package can ride future Dependabot npm bumps; tracker for downstream phases noted below.

### D3 — Cargo Dependabot

- **Before:** No `cargo` entry in `.github/dependabot.yml`. Phase 2a notes flagged this as overdue.
- **After:** Cargo entry added pointing at `/pty-server`, weekly cadence, `dependencies` label, single `cargo` group catching `*`. Mirrors the `wdio` grouping pattern from the npm entry.
- **First-PR verification:** Will surface organically next Monday when Dependabot runs against the new config. If no PR materializes by 2026-05-04, Steve checks `.github/dependabot.yml` is parsed by GitHub (Repo → Insights → Dependency graph → Dependabot).

### D4 — Resize double-fit treatment

- **Before:** `src/terminal/xterm-host.ts` called `fit.fit()` once during `mount()` and again from the first ResizeObserver fire on the same initial container observation. Visible flicker, deferred since Phase 1 of terminal-mvp.
- **After:** New `src/terminal/fit-coalescer.ts` module records last-fit dimensions and returns `false` for redundant calls. `mount()` now passes container dimensions through the coalescer; ResizeObserver fires extract `entry.contentRect` and route the same way. The initial-observation fire (matching mount's dimensions) is suppressed; genuine resizes still flow through.
- **Action:** **REMOVED with regression test.** 7 tests in `fit-coalescer.test.ts` pin the new behavior; the regression test (`regression pin for FI-019 double-fit: mount + immediate observer fire = 1 fit`) explicitly captures the failure mode.

### R4 / R5 — Undocumented Obsidian API re-verification

| API | Call sites | Feature-detect / guard | Static surface test | Runtime e2e exercise |
|---|---|---|---|---|
| `rootSplit.setDirection` | `src/main.ts:216`, `src/dock/wrap-and-dock.ts:92,93,128` | `typeof === "function"` in both files | `undocumented-api-surface.test.ts` | container-view.e2e + fi-012-wrap-and-dock.e2e exercise dock-open paths |
| `workspace.createLeafInParent` | `src/main.ts:214,221,271` | `typeof === "function"` | same | container-view.e2e exercises container allocation |
| `SuggestModal.chooser.setSelectedItem` | `src/picker/profile-picker.ts:72` | optional-chaining (`chooser?.setSelectedItem?.(…)`) | same | picker.e2e covers "default shell row is pre-selected via chooser.selectedItem on picker open" |
| `workspace.createLeafBySplit` (R5) | `src/dock/wrap-and-dock.ts:78` | `typeof === "function"` in `canWrap()` | same | fi-012-wrap-and-dock.e2e exercises the wrap path |

For each:
- **API present (yes/no):** Yes — all four pass against pinned binary v1.12.7. Confirmed by full e2e suite passing (8/8 spec files green).
- **Behavior matches production assumption (yes/no):** Yes — every call site has at least one e2e test that traverses it; all green.
- **Action taken:** None required. No drift detected. Surface tests pin the source side; e2e suite covers the runtime side.

## User Testing

What Steve should try when verifying Phase 1 GREEN by hand:

1. **Open and resize a terminal pane.** Drag the splitter or the Obsidian window. Resize should reflow xterm cleanly with no visible flicker on the first paint after mount. (FI-019 — the fix this phase shipped.)
2. **Reload the plugin from settings.** Open a terminal, disable + re-enable the plugin. New terminal opens cleanly; existing PTY processes go away cleanly. (Hygiene check, P3 will deepen this.)
3. **Open `.github/dependabot.yml`.** Confirm the Cargo entry is present and groups updates the way the npm entry does. (FI-020 / D3.)
4. **Spot-check a tmux attach.** Confirms `SuggestModal.chooser.setSelectedItem` still pre-selects the default shell. (R4 verification.)

## Required Manual Verification

None — all acceptance criteria are automatable and were automatically verified. The user-testing items above are confidence checks against the live plugin, not gaps in automated coverage.

## Acceptance Criteria Roll-Up

| AC | Status | Verified by |
|---|---|---|
| AC1 — wdio pin recorded | GREEN | `dependency-pins.test.ts`, audit-summary above |
| AC2 — Obsidian binary pin recorded with lag | GREEN | `dependency-pins.test.ts`, audit-summary D2 |
| AC3 — `.github/dependabot.yml` parses + cargo entry | GREEN | `dependabot-config.test.ts` (9/9) |
| AC4 — Re-verify 4 undocumented APIs | GREEN | `undocumented-api-surface.test.ts` (6/6) + audit-summary table |
| AC5 — Resize double-fit removed with regression test | GREEN | `fit-coalescer.test.ts` (7/7) |
| AC6 — `npm run build` clean | GREEN | Verified: ran clean, esbuild + cargo |
| AC7 — `npm run test:unit` clean | GREEN | 124/124 passing |
| AC8 — `npm run test:e2e` clean | GREEN | 8/8 spec files passing |
| AC9 — `cargo build --release` clean | GREEN | Verified: ran clean from `pty-server/` |

## Notes for downstream phases

- **Test-binary vs. typings split.** D2's spec said "pinned at `1.12.3` in `package.json` `obsidian` field (used by `wdio-obsidian-service` for the test-environment Obsidian app)." That's not quite right — the test binary version lives in `wdio.conf.mts`'s `browserVersion`/`installerVersion`, not in `package.json`. Phase 2's settings work doesn't touch this, but Phase 3's release packaging may want to align the typings package with the test binary version (bump `obsidian` typings 1.12.3 → 1.12.7) so build-time types match what runs in e2e. Treat as a small sub-task of Phase 3, not a separate FI.
- **Cargo Dependabot first-PR check.** The new entry won't be exercised until Dependabot runs against it. If no Cargo PR appears by ~2026-05-04 (one weekly cadence later), Phase 2 should debug the YAML parse before assuming the entry is live. GitHub renders Dependabot config errors at Repo → Insights → Dependency graph → Dependabot.
- **Resize coalescer is dimension-equality based.** The coalescer compares `width`/`height` exactly — sub-pixel changes still trigger a fit, which is correct for genuine resizes. If Phase 2's theme work introduces a CSS variable change that shifts cell metrics without a container resize, the terminal won't re-fit on its own. The host still exposes a public `fit()` method that bypasses the coalescer; theme-change handlers should call it directly. (Pattern: read CSS var → apply theme → `xtermHost.fit()`.)
- **Pre-audit-tests subagent flow ran in human mode.** Per orchestrator pre-approval policy, classifier digests for `test-shortcut-hunter` and `test-coverage-gap-detector` were performed inline. All stubs classified Sound or acceptably-Suspect (the static-source-grep tests for AC4 are intentionally implementation-pinned — that's the right level for a "did we keep guarding the API" assertion). All ACs classified Covered. No items moved to Required Manual Verification.
- **`bin/pty-server` is not codesigned.** `esbuild.config.mjs` strips the macOS quarantine bit on every build, but the binary itself is unsigned. Phase 3's release work will pick this up (FI-017).
