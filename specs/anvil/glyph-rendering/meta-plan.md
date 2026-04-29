# Meta-plan: Glyph rendering — WebGL renderer + bundled symbol font

## Context

Tonight's overnight session proved that nerd-font glyphs (Powerline, Devicons, Octicons, etc.) round-trip cleanly through xterm's buffer (`tests/e2e/nerd-font-glyphs.e2e.ts` is green) — but render as tofu in the actual UI because no installed font on the user's system covers the relevant Private Use Area codepoints. The fix is purely a font-coverage problem at render time.

Two coupled pieces of work address it:

1. **FI-022** — bundle Symbols Nerd Font Mono as a CSS `@font-face` with `unicode-range`, so PUA codepoints resolve to a known-good fallback without requiring the user to install anything. (Backlog entry: `../future-ideas-backlog.md` → FI-022.)
2. **xterm renderer DOM → WebGL switch** — load `@xterm/addon-webgl`. Today the plugin loads no renderer addon, so xterm silently falls back to its DOM renderer (`canvasCount: 0` confirmed by tonight's e2e). Canvas-addon was the initial plan, but `@xterm/addon-canvas` was removed in xterm.js v6.0.0 and the plugin is on `@xterm/xterm@6.0.0` — WebGL is the only non-DOM renderer available. Switching to WebGL (a) unblocks pixel-sampling visual tests that can RED on tofu vs glyph, (b) ships a 2-5× paint speedup, and (c) auto-rebuilds its glyph atlas on font/theme changes per the addon docs. The original transparency concern is defused: Electron only clips alpha against transparent host windows, and Obsidian's main window is opaque.

These two pieces share install scope, test scope, and the same files. Shipping the font without the renderer means no real visual test for the bug. Shipping the renderer without the font means a renderer change with no observable user benefit and a fresh regression surface. Bundle them, ship them together, write the test that proves both.

## Scope

**IN:**
- Add a renderer addon to xterm (WebGL via `@xterm/addon-webgl` 0.19.x) and wire its lifecycle into `XtermHost`, including `onContextLoss` disposal and graceful-degrade to DOM on init failure.
- Bundle Symbols Nerd Font Mono (woff2) in the plugin distribution and load it via `@font-face` + `unicode-range` in `src/styles.css`.
- Update the font-family default stack to include the bundled family as the lowest-priority entry (defensive — `unicode-range` should dispatch correctly, but the explicit fallback covers parser edge cases).
- Add a real visual e2e test that samples canvas pixels for a curated codepoint set and asserts non-`.notdef` rendering. Confirm RED → GREEN against the unbundled state at least once during execution.
- Update the release packaging path (`scripts/release.sh`, `tests/unit/release-script.test.ts`'s `BUILD_ARTIFACTS` array, and `wdio.conf.mts`'s test-vault copy step) so the woff2 ships with the plugin and is loadable in e2e.
- Verify no regression in `tests/e2e/phase-2-theming.e2e.ts` (live theme switch) and `tests/e2e/nerd-font-glyphs.e2e.ts` (data-path).

**OUT:**
- Canvas renderer (`@xterm/addon-canvas` was removed in xterm.js v6.0.0 — not an option on the plugin's xterm version).
- A user-facing setting to choose renderer or disable the bundled font (FI-015 settings tab work).
- Cross-platform polish — macOS arm64 only per project scope.
- Bundling additional nerd-font variants beyond Symbols-Only.
- Touching the PTY backend, picker, or dock layout.

## Phases

### Phase 1 — Glyph rendering: WebGL renderer + bundled symbol font

**Goal.** Out-of-the-box, with no user font installation, nerd-font glyphs emitted by Claude Code, starship, lazygit, and similar CLIs render as glyphs (not tofu) inside the plugin's terminal — verified by a visual e2e test that samples canvas pixels and would have failed RED before the font landed. The renderer switches from DOM to WebGL to make pixel sampling possible and to gain the paint-speed improvement; the bundled woff2 is loaded via `@font-face` + `unicode-range` so the user's primary font stack still drives ASCII / Unicode text rendering.

**Dependencies.** None. The shippable-plugin meta-plan (Phases 1-4) has landed on `yolo/phase-4-overnight-2026-04-27`. This phase rides on the existing release pipeline, e2e harness, and theme/font refresh handlers (`refreshThemeAndFont` in `src/view/TerminalContainerView.ts`, `applyTheme` / `applyFontFamily` in `src/terminal/xterm-host.ts`).

**Success criteria.**
- A canvas element exists under `.xterm` in the rendered DOM during e2e (`canvasCount > 0`).
- A new visual e2e samples canvas pixels at expected glyph cells for a curated nerd-font codepoint set; passes with the bundle, fails (RED) without it. This RED state must be observed at least once during execution — not just asserted in retrospect.
- Release zip includes the bundled woff2 in the documented file layout. The pinned `BUILD_ARTIFACTS` test reflects this.
- `tests/e2e/phase-2-theming.e2e.ts` and `tests/e2e/nerd-font-glyphs.e2e.ts` both stay green.
- Manual smoke: open a real Obsidian session, run Claude Code, observe the prompt's nerd-font glyphs render correctly with no installed nerd-font on the system. (Cheapest A/B: temporarily move/rename the user's installed `MesloLGS Nerd Font Mono` to confirm the bundled font is what's actually painting.)

**Risk flags.**
- **`unicode-range` set is a research item.** FI-022 lists candidate blocks (Powerline, Devicons, Octicons, Font Awesome, MDI, Weather, Pomicons). The canonical block list lives in nerd-fonts' source. The phase spec should resolve the range set against the actual Symbols Nerd Font Mono coverage table, not the aspirational FI-022 list — declaring a range the bundled font doesn't cover means the browser tries to load the font for a codepoint it can't render, then falls back, defeating the fix.
- **Conditional vs unconditional WebGL-addon load.** The plugin's established convention for undocumented Obsidian APIs is feature-detect-then-fallback (`src/main.ts:214`, `src/dock/wrap-and-dock.ts:46`). The WebGL addon isn't an undocumented API, but the same caution applies — Electron should always support WebGL, but a graceful-degrade path back to the DOM renderer (on init failure or context loss) is cheap insurance.
- **Theme/font refresh and the WebGL glyph atlas.** xterm's WebGL renderer auto-rebuilds its glyph atlas on `theme` and `fontFamily` change per its docs. `phase-2-theming.e2e.ts` covers theme; the phase spec should add (or extend) a font-change e2e to cover the matching path explicitly.
- **Test pipeline asset copying.** `wdio.conf.mts`'s `before` hook currently copies only `bin/pty-server` into the test vault. The shipped font file lives at a different path; the hook needs an analogous copy for `fonts/` (or whatever the bundle layout decides) or the test will silently fall back to tofu and the visual test will RED for the wrong reason.
- **Artifact size roughly doubles.** Today's `main.js` is ~340KB; adding a ~700KB-1MB woff2 is a real install-footprint jump. Browser lazy-loads the font on first PUA codepoint hit, so users who never trigger one never download it — but the on-disk plugin install grows regardless. Worth a deliberate sign-off, not a surprise.
- **Visual test brittleness.** Pixel-sampling tests can flake under font-rendering subpixel shifts, OS scaling changes, or DPR differences. The phase spec should pick a robust assertion (cell-region non-background pixel count above a floor, or `.notdef`-signature exclusion) rather than exact-pixel match.
- **`font-display` choice.** `block` waits briefly for the font before painting (matches terminal expectation of stable glyphs); `swap` shows tofu briefly then swaps. FI-022 leans toward `block`. Worth a deliberate call in the phase spec.

## Cross-cutting constraints

- **Single phase, single shipping moment.** The renderer switch and the font bundle land together. No partial state is shipped.
- **Release packaging contract.** Any new shipped file must land in: `scripts/release.sh` staging copy, `tests/unit/release-script.test.ts` → `BUILD_ARTIFACTS`, and the e2e fixture copy step in `wdio.conf.mts`. Skipping any of the three breaks something downstream silently.
- **No CSS variables in the font-family stack.** Established by tonight's commit `e20abcd` — xterm.js measures cells via Canvas 2D's `font` property, which doesn't resolve `var(...)`. The lowest-priority bundled-family entry follows the same hardcoded-name rule.
- **Theme application is renderer-agnostic.** `host.applyTheme(theme)` already exists and routes through xterm's `ITheme`, which both DOM and WebGL renderers consume identically. The renderer switch should not need to touch theme code; verify by running `phase-2-theming.e2e.ts` post-switch.

## Open questions to resolve in the phase spec

- Exact `unicode-range` set, derived from Symbols Nerd Font Mono's actual coverage.
- Conditional (feature-detect-then-fallback) vs unconditional WebGL-addon load.
- `font-display: block` vs `swap`.
- Font file path in source tree and shipped layout (`src/fonts/` → `fonts/SymbolsNerdFontMono.woff2`? Other?).
- Visual-test assertion shape (pixel-count floor vs `.notdef`-signature exclusion vs something else).
- Whether to extend `nerd-font-glyphs.e2e.ts` with the visual sampler or write a sibling test file.
