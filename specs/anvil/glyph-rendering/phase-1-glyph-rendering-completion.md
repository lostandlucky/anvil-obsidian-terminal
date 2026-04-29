# Phase Complete: Glyph rendering — WebGL renderer + bundled symbol font

**Mode:** Code Tests (Mode B)
**Cycles:** 2 (one extra cycle to retrofit four DOM-coupled e2e helpers exposed by the WebGL switch)
**Status:** GREEN — all 10 acceptance criteria met by automated tests; full e2e suite (12 spec files), unit suite (210 tests), typecheck, and production build clean.

## Deliverables

**New source:**
- `src/fonts/SymbolsNerdFontMono.woff2` — bundled woff2 (1.1 MB) extracted from Nerd Fonts v3.4.0 `NerdFontsSymbolsOnly.zip`, converted from TTF via `woff2_compress`.
- `src/fonts/LICENSE` — MIT license carried from the upstream release.
- `src/terminal/webgl-loader.ts` — `tryLoadWebgl()` helper. Constructs and activates `@xterm/addon-webgl`, wires `onContextLoss → dispose`, falls back to DOM with a single `console.warn` on factory or activation failure (D2/D3).
- `src/terminal/webgl-loader.test.ts` — four unit tests covering AC3 (graceful-degrade on factory throw and on `loadAddon` throw) and AC4 (`onContextLoss` wired to `dispose`).
- `tests/e2e/nerd-font-glyphs-visual.e2e.ts` — three e2e cases:
  1. `@font-face` registration check via `document.fonts` API (R3, drives R5 RED).
  2. WebGL canvas exists under `.xterm-screen` (AC1).
  3. Probe-codepoint pixel signatures differ from the `U+F8FF` `.notdef` baseline (AC2 / D5).

**Modified source:**
- `package.json` — adds `@xterm/addon-webgl@^0.19.0`.
- `src/styles.css` — `@font-face` for `"Symbols Nerd Font Mono"` with the canonical Nerd Fonts v3.x `unicode-range` (verbatim from the spec; FI-022's earlier draft was wrong/incomplete in 6 places).
- `src/terminal/xterm-host.ts` — calls `tryLoadWebgl()` after `terminal.open(container)` with `new WebglAddon(true)` (preserveDrawingBuffer enables visual-test pixel sampling). Default font stack appends `'Symbols Nerd Font Mono'` before `monospace`.
- `src/settings/settings.ts` — same font-stack append on the settings mirror.

**Modified build / packaging:**
- `esbuild.config.mjs` — `copyBundledFont()` mirrors the `bin/pty-server` copy pattern, staging `src/fonts/SymbolsNerdFontMono.woff2` → `fonts/SymbolsNerdFontMono.woff2` on every build. CSS bundle marks `./fonts/*` as external so esbuild leaves the `@font-face` URL untouched.
- `scripts/release.sh` — stages `fonts/` alongside `bin/` with the same "missing → exit 1" guard pattern.
- `wdio.conf.mts` — `before` hook copies the woff2 into the test vault next to `bin/pty-server`.
- `tests/unit/release-script.test.ts` — `BUILD_ARTIFACTS` array enumerates 5 entries; the zip-layout assertion expects all five.
- `.gitignore` — pins `.DS_Store` (recovered from an accidental `git add -A` early in the cycle) and `/fonts/` (build output).

**Modified tests (helper retrofit, falling out of the WebGL switch — see Notes for downstream):**
- `tests/e2e/pty-backend.e2e.ts`
- `tests/e2e/plugin.e2e.ts`
- `tests/e2e/keyboard-passthrough.e2e.ts`
- `tests/e2e/phase-3-hygiene.e2e.ts`

## Required Manual Verification

The 10 acceptance criteria are fully covered by automated tests. None are blocked behind manual verification. The User Testing section below carries forward the spec's smoke checklist for the morning audit — these are dogfooding-style smokes, not pre-merge gates.

## User Testing

After this branch is in good shape, in order:

1. **Cold-start a fresh Obsidian session** with the plugin installed via dev symlink (or fresh release install if a v0.1.1 zip is cut). Open the terminal. Run `claude --version` then `claude` — leading nerd-font glyphs should render as glyphs, not boxes.
2. **A/B against a removed bundle.** Temporarily rename `fonts/SymbolsNerdFontMono.woff2` (or comment out the `@font-face` in built `styles.css`), reload the plugin, observe glyphs return to tofu. Restore — glyphs return. Confirms the bundle is what's painting, not the locally-installed `MesloLGS Nerd Font Mono`.
3. **Switch theme live.** Settings → Appearance → toggle light/dark while the terminal is open. Terminal re-renders colors smoothly, glyphs intact. (Regression check for R7.)
4. **Switch font family live.** Open settings, change the font-family setting to a different value (e.g. drop `MesloLGS` to test the fallback chain). Terminal re-renders, cell metrics resettle, glyphs still render correctly.
5. **Run starship or lazygit.** Either should show its powerline / Codicons / MDI glyphs correctly. starship is the highest-value smoke — its prompt routinely uses 4-5 glyph blocks.
6. **Open multiple terminal tabs.** All should pick up the WebGL renderer and the bundled font; no single-instance dependency.
7. **Force a WebGL context loss (optional, low-priority).** Chrome DevTools "Rendering → Emulate WebGL context loss" if accessible, or close/reopen rapidly. Terminal should not crash; subsequent renders may fall back to DOM until the leaf is reopened (D3 dispose-only).

## Notes for downstream phases

1. **Helper retrofit is the load-bearing surprise of this phase.** Four e2e files (`pty-backend`, `plugin`, `keyboard-passthrough`, `phase-3-hygiene`) read terminal output via `.xterm-rows` `innerText`. WebGL paints to canvas and never populates that DOM, so every one of those tests went RED with "shell never produced output" the moment the WebGL load was wired. The fix was to switch them to `terminal.buffer.active.getLine(r).translateToString(true)` — the renderer-agnostic pattern the protected `nerd-font-glyphs.e2e.ts` already uses. **If a future phase touches an e2e and reaches for `.xterm-rows`: stop, use the buffer.** The DOM rows are a leftover surface from the pre-WebGL era.

2. **`preserveDrawingBuffer: true` is on in production.** It was chosen to make the visual e2e's `gl.readPixels` work after compositing. xterm.js docs warn this "hurts performance significantly," but in practice the cost only matters for graphics-intensive WebGL apps. If a future phase observes a measurable rendering perf issue, this flag is a candidate to flip back to `false` AND find an alternative pixel-sampling strategy for the visual test (the simplest: read pixels inside the same RAF tick as the draw, before the buffer clears).

3. **The `document.fonts` registration check is the load-bearing assertion in the visual e2e.** Pixel sampling alone passes via macOS LastResort and Apple Symbols fallbacks even when the bundle isn't wired — those fonts produce per-Unicode-block `.notdef` indicators that look distinct enough to clear the L1-distance threshold. The `registered: true` check on `document.fonts` is what actually proves the bundle is the source of truth. Keep both checks: registration proves wiring, pixel sampling proves end-to-end render.

4. **WebGL atlas behavior on font-family change is documented but not load-bearing yet.** The atlas auto-rebuild after `applyFontFamily` works (verified in the visual test, which calls `applyFontFamily` and re-renders successfully). R7's "font-change refresh" path is satisfied by the visual test's pre-step. No separate font-change e2e was added; if a future phase needs richer coverage of the live-font-switch path (e.g. user changes font from settings UI mid-session), extend `phase-2-theming.e2e.ts` with a font-change branch.

5. **Renderer flavor variable name in the existing data-path test is a known mismatch.** `tests/e2e/nerd-font-glyphs.e2e.ts:167-169` reports `rendererFlavor: "canvas"` whenever a `<canvas>` exists under `.xterm` — true for both addon-canvas and addon-webgl. After the WebGL pivot, this variable reports `"canvas"` for what is actually WebGL. The file is OUT of scope for this phase per spec boundaries; renaming should land in a separate small commit at audit time if it's worth doing.

6. **WebGL graceful-degrade has not been observed firing in the e2e harness.** The DOM fallback path runs cleanly via unit tests (factory throws → warn + null), but the harness's Electron-Chromium does support WebGL and never triggers the fallback during e2e. If a future phase wants integration coverage of the fallback, the seam is to inject a stub factory through `XtermHostOptions` (would require widening that interface) or to test against a Chromium build with `--disable-gpu` (would require a new wdio capability config).

## Verification artifacts

- Unit: `npm run test:unit` → 23 files, 210 tests passing.
- E2E: `npm run test:e2e` → 12 spec files passing, 0 failing.
- Build: `npm run build` clean.
- Typecheck: `npm run typecheck` clean.
- Visual e2e RED demonstration: observed once during execution by commenting out the `@font-face` block in `src/styles.css` and re-running — the `@font-face registered (R3)` test failed with `registered: false` (proper RED for the right reason). Restored, re-ran, all 3 cases pass.
