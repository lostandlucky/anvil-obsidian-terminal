# Phase 1 Spec — Glyph rendering: WebGL renderer + bundled symbol font

> **Meta-plan revision required.** The meta-plan (`./meta-plan.md`) lists "DOM → canvas" with WebGL marked OUT. Pre-spec research surfaced that `@xterm/addon-canvas` was removed entirely in xterm.js v6.0.0 — and the plugin is on `@xterm/xterm@6.0.0`. The user's decision: switch to `@xterm/addon-webgl` 0.19.x. After spec approval, the meta-plan needs a follow-up edit so its IN/OUT lists reflect WebGL-not-canvas. The transparency + atlas-invalidation concerns that originally rejected WebGL turned out to be defused by current addon docs (atlas auto-rebuilds on font/theme change) and Obsidian's opaque main window (Electron only clips alpha against transparent host windows). New burden: WebGL context-loss handling.

## Objective

Ship two coupled changes together: (1) bundle Symbols Nerd Font Mono into the plugin distribution and load it via CSS `@font-face` + `unicode-range` so PUA-codepoint glyphs render without the user installing any nerd-font; (2) switch the xterm renderer from the silent DOM fallback to `@xterm/addon-webgl` 0.19.x, which makes pixel-sampling visual tests possible and delivers a 2-5× paint speedup. Verified by a new visual e2e that asserts the bundled font is what's actually painting.

## Decisions for review

| # | Decision | Resolution | Rationale |
|---|---|---|---|
| D1 | Renderer choice | **[RESOLVED] WebGL via `@xterm/addon-webgl` 0.19.x** | Canvas removed in xterm v6; user picked WebGL over DOM-only and over a v5 downgrade. |
| D2 | WebGL graceful-degrade on init failure | **[RESOLVED] Yes — try WebGL, fall back to DOM-default with a console warning if `new WebglAddon()` or `loadAddon` throws.** | Matches the project's feature-detect-then-fallback convention (`src/main.ts:214`, `src/dock/wrap-and-dock.ts:46`). Cheap insurance against macOS Electron edge cases where WebGL is blocked. |
| D3 | Context-loss recovery scope | **[RESOLVED] Dispose-on-loss only for v1.** Wire `addon.onContextLoss(() => addon.dispose())` per docs; the terminal will fall through to DOM rendering after a context loss until the leaf is reopened. Recreate-on-restore is a follow-up FI, not v1 scope. | Restore-on-display requires reasoning about leaf-show events and re-mounting the addon mid-lifecycle, which is enough complexity to warrant its own pass. Dispose-on-loss is the documented minimum and prevents resource leaks. |
| D4 | `@font-face font-display` | **[RESOLVED] `block`** | Terminal output expects stable rendering; tofu-then-swap is uglier than a brief wait. The font is local (bundled, no network), so the wait is short. |
| D5 | Visual-test assertion shape | **[RESOLVED] `.notdef`-signature exclusion + non-background-pixel floor.** Render a guaranteed-unmapped codepoint (e.g. `U+F8FF` Apple-logo PUA, outside Symbols Nerd Font Mono's coverage) into one cell; capture its pixel signature as the negative baseline. For each probe codepoint, assert its cell signature differs from the baseline by more than a threshold AND has non-background pixel count above a floor. | Approach A alone (pixel floor) false-passes on dense `.notdef` rectangles. Approach C (screenshot diff) carries baseline-maintenance forever and is brittle across Skia/CoreText drift. Approach B is self-referential and durable: both samples come from the same canvas/DPR/compositor pass, eliminating platform-render variance. macOS-only project scope removes the cross-platform variance argument against pixel testing. |
| D6 | Font-file path layout | **[RESOLVED] Source: `src/fonts/SymbolsNerdFontMono.woff2`. Shipped: `fonts/SymbolsNerdFontMono.woff2`.** Mirrors the `bin/pty-server` source-to-shipped pattern. CSS reference: `url("./fonts/SymbolsNerdFontMono.woff2")` (relative to the bundled `styles.css`). | One precedent in the repo for a non-JS shipped asset. Reusing the pattern keeps the release-script staging logic uniform. |
| D7 | Visual-test file location | **[RESOLVED] New sibling test file `tests/e2e/nerd-font-glyphs-visual.e2e.ts`.** Existing `tests/e2e/nerd-font-glyphs.e2e.ts` stays as the data-path test; the new file owns pixel-sampling. | Different test concerns (data-path vs render-path), different failure modes, different debugging surfaces. A shared file would muddle both. |

**Genuinely-open decisions remaining for the user before execution:** None. All forks are resolved. The executing agent has direction on every architectural choice.

## Requirements

**R1 — WebGL renderer load.** The plugin must load `@xterm/addon-webgl` for every terminal it opens, after `terminal.open(element)`, with `addon.onContextLoss(() => addon.dispose())` wired. WebGL init failures must fall back to the DOM default with a single console warning (no user-visible error).

**R2 — Bundled font asset.** The plugin distribution must include `fonts/SymbolsNerdFontMono.woff2` alongside `manifest.json`, `main.js`, `styles.css`, and `bin/pty-server`. The release-packaging contract (`scripts/release.sh`, `tests/unit/release-script.test.ts`'s `BUILD_ARTIFACTS`, `wdio.conf.mts`'s test-vault `before` hook) must reflect the new file.

**R3 — `@font-face` declaration.** `src/styles.css` must declare a `@font-face` for "Symbols Nerd Font Mono" sourced from the bundled woff2, with `font-display: block` and a `unicode-range` covering all Nerd Fonts icon blocks (see Sources for the canonical list).

**R4 — Font-family stack update.** The default font-family stack (currently in `src/settings/settings.ts:43-48` and mirrored in `src/terminal/xterm-host.ts:41-46`) must include `'Symbols Nerd Font Mono'` as the lowest-priority entry before `monospace`. The hardcoded-name rule from commit `e20abcd` (no `var()` references) must be respected.

**R5 — Visual e2e (RED → GREEN demonstrated).** A new e2e test at `tests/e2e/nerd-font-glyphs-visual.e2e.ts` must sample WebGL canvas pixels using `getImageData` and assert that probe nerd-font codepoints render distinguishably from a `.notdef` baseline cell, per D5. The RED state must be observed at least once during execution (not just asserted in retrospect) — temporarily remove the `@font-face` declaration or its `unicode-range`, run the test, confirm it fails, restore, confirm GREEN.

**R6 — No theming/data-path regression.** `tests/e2e/phase-2-theming.e2e.ts` (live theme switch via `app.customCss.setTheme`) and `tests/e2e/nerd-font-glyphs.e2e.ts` (data-path codepoint round-trip + cell width + fontFamily contents) must both stay GREEN with no test changes.

**R7 — Font-change refresh path verified.** The existing `refreshThemeAndFont` pathway in `src/view/TerminalContainerView.ts` (~line 110) must still trigger a glyph cache refresh when font family changes. WebGL's atlas auto-rebuilds on `terminal.options.fontFamily = ...` per addon docs; verify via either an extension to `phase-2-theming.e2e.ts` (font-change branch) or a new sibling test. Whichever the agent picks, the assertion is "after applyFontFamily(...), the next render uses the new family."

**R8 — Release-zip layout pinned.** `tests/unit/release-script.test.ts`'s `BUILD_ARTIFACTS` array must enumerate `fonts/SymbolsNerdFontMono.woff2` alongside the existing four entries. Test-driven; failure of this test means the release script forgot to copy the font.

## Acceptance criteria

| AC | Criterion | Verified by |
|---|---|---|
| AC1 | A `<canvas>` element exists under `.xterm` in the rendered DOM at e2e time (`canvasCount > 0`). | Existing `tests/e2e/nerd-font-glyphs.e2e.ts` diagnostic (already coded — currently reports `canvasCount: 0`). After the WebGL switch this number flips. |
| AC2 | Visual e2e samples WebGL canvas pixels and asserts non-`.notdef`, non-empty rendering for ≥6 curated nerd-font codepoints (one per major block: Powerline, Devicons, Octicons, Font Awesome, Codicons, MDI). RED was observed once during execution. | `tests/e2e/nerd-font-glyphs-visual.e2e.ts` (new) |
| AC3 | WebGL init failure falls back to DOM with a single console warning containing the addon name; no user-visible notice, no crash. | Unit-level: pure function returns true/false. Integration-level: harness force-fail by stubbing `WebglAddon` constructor (or accept manual verification if the seam is awkward — agent's call). |
| AC4 | `addon.onContextLoss` is wired to `addon.dispose()`. | Code inspection + a unit test that constructs `XtermHost`, asserts the addon's `onContextLoss` callback was registered to a function that calls `dispose`. |
| AC5 | Release zip includes `fonts/SymbolsNerdFontMono.woff2` with non-zero byte count. | `tests/unit/release-script.test.ts` assertion against the updated `BUILD_ARTIFACTS` array. |
| AC6 | `tests/e2e/phase-2-theming.e2e.ts` GREEN. | Existing test, unchanged. |
| AC7 | `tests/e2e/nerd-font-glyphs.e2e.ts` GREEN. | Existing test, unchanged. |
| AC8 | `npm run test:unit` GREEN. | Full unit suite. |
| AC9 | `npm run test:e2e` GREEN. | Full e2e suite. |
| AC10 | `npm run build` clean. | Build step. |

## User testing

After phase GREEN, in order:

1. **Cold-start a fresh Obsidian session** with the plugin installed via the dev symlink (or fresh release install if you've cut a new zip). Open the terminal. Run `claude --version` then `claude` and observe the prompt — the leading nerd-font glyphs should render as glyphs, not boxes.
2. **A/B against a removed bundle.** Temporarily rename `fonts/SymbolsNerdFontMono.woff2` (or comment out the `@font-face` in built `styles.css`), reload the plugin, observe the glyphs return to tofu. Restore — glyphs return. Confirms the bundle is what's painting, not your installed `MesloLGS Nerd Font Mono`.
3. **Switch theme live.** Settings → Appearance → toggle light/dark while the terminal is open. The terminal should re-render its colors smoothly, glyphs intact. (Regression check for R7.)
4. **Switch font family live.** Open settings, change the font-family setting to a different value (e.g. drop `MesloLGS` to test the fallback chain). The terminal should re-render, cell metrics resettle, glyphs still render correctly.
5. **Run starship or lazygit.** Either should show its powerline / Codicons / MDI glyphs correctly. starship is the highest-value smoke — its prompt routinely uses 4-5 glyph blocks.
6. **Open multiple terminal tabs.** All should pick up the WebGL renderer and the bundled font; no single-instance dependency.
7. **Force a WebGL context loss (optional, low-priority).** Chrome DevTools "Rendering → Emulate WebGL context loss" if accessible, or close/reopen rapidly. The terminal should not crash; subsequent renders may fall back to DOM until the leaf is reopened (D3 dispose-only).

## Boundaries

- **Out:** Recreate-on-restore for WebGL context loss (deferred to follow-up FI per D3).
- **Out:** A user-facing setting to choose renderer or disable the bundled font (FI-015 settings tab).
- **Out:** Bundling additional nerd-font variants beyond Symbols-Only.
- **Out:** Cross-platform polish — macOS arm64 only.
- **Out:** Touching the PTY backend, picker, dock layout, or non-glyph theming code.
- **Out:** Editing `tests/e2e/phase-2-theming.e2e.ts` or `tests/e2e/nerd-font-glyphs.e2e.ts` — they must stay GREEN unchanged. (R7's font-change verification can extend phase-2-theming OR sit in a new sibling — agent's call, but no rewrites of existing assertions.)
- **Out:** Updating the meta-plan IN/OUT lists for the WebGL switch — that's a separate small commit after this spec lands, surfaced in handoff.

## Sources

### Codebase reference points (already mapped, no re-discovery needed)

- `src/terminal/xterm-host.ts` (136 lines) — Terminal instantiation L54–61; FitAddon load L63–64 (model for adding WebglAddon); `applyTheme` L117–118; `applyFontFamily` L120–121; default font stack L41–46.
- `src/view/TerminalContainerView.ts` (436 lines) — `refreshThemeAndFont` L104–119 (calls applyTheme + applyFontFamily + host.fit); `addTab` L281–294 (per-tab terminal creation site).
- `src/settings/settings.ts:43–48` — default font stack mirror, no `var()`.
- `src/styles.css` — currently 155 lines, imports `@xterm/xterm/css/xterm.css` at L1; bundled by esbuild (config L67–73). New `@font-face` lands here.
- `esbuild.config.mjs` — JS bundle L9–35, CSS bundle L67–73, pty-server build L23–34 (model for woff2 staging).
- `scripts/release.sh` L108–121 — staging copy of the four-file layout. Add `fonts/` to the loop.
- `tests/unit/release-script.test.ts:26` — `BUILD_ARTIFACTS` array. Add `"fonts/SymbolsNerdFontMono.woff2"`.
- `wdio.conf.mts` L38–57 — `before` hook copies `bin/pty-server` into the test vault. Add a parallel copy for `fonts/`.
- `tests/e2e/nerd-font-glyphs.e2e.ts` (291 lines) — data-path test, includes the `canvasCount` diagnostic at L167–169 that flips with the WebGL switch. Curated codepoint set (14 codepoints) is the model for the new visual test's probe set.
- `tests/e2e/phase-2-theming.e2e.ts` (126 lines) — theming-refresh regression test. Drives theme via `app.customCss.setTheme(...)`.
- `package.json` — currently has `@xterm/addon-fit@0.11.0`, `@xterm/xterm@6.0.0`. Add `@xterm/addon-webgl@^0.19.0`.

### External references (essential reading for the executor)

- **xterm.js v6.0.0 release notes** — https://github.com/xtermjs/xterm.js/releases — confirms canvas removal, recommends DOM or WebGL.
- **`@xterm/addon-webgl` README** — https://github.com/xtermjs/xterm.js/tree/master/addons/addon-webgl — load pattern, `onContextLoss` requirement, atlas behavior.
- **`@xterm/addon-webgl` npm** — https://www.npmjs.com/package/@xterm/addon-webgl — current version (0.19.0 as of 2026-04-27), peer-dep range.
- **Nerd Fonts wiki — Glyph Sets and Code Points** — https://github.com/ryanoasis/nerd-fonts/wiki/Glyph-Sets-and-Code-Points — canonical block list.

### Canonical `unicode-range` set for Symbols Nerd Font Mono v3.x

Use this exact set in the `@font-face` declaration. FI-022's list was wrong/incomplete in several places (Powerline range was approximate, Font Awesome was truncated, Octicons was truncated, Codicons + Font Logos + Seti-UI + IEC Power were missing entirely, Weather upper bound was wrong, MDI plane needs SMP syntax).

```css
unicode-range:
  /* Box Drawing                */ U+2500-259F,
  /* IEC Power Symbols          */ U+23FB-23FE, U+2B58,
  /* Octicons (BMP outliers)    */ U+2665, U+26A1,
  /* Powerline Extra (sep)      */ U+2630,
  /* Heavy Angle Brackets       */ U+276C-2771,
  /* Pomicons                   */ U+E000-E00A,
  /* Powerline + Powerline Extra*/ U+E0A0-E0D7,
  /* Font Awesome Extension     */ U+E200-E2A9,
  /* Weather                    */ U+E300-E3E3,
  /* Seti-UI + Custom           */ U+E5FA-E6B7,
  /* Devicons                   */ U+E700-E8EF,
  /* Codicons                   */ U+EA60-EC1E,
  /* Font Awesome (legacy area) */ U+ED00-EF2F,
  /* Font Awesome (main)        */ U+F000-F2FF,
  /* Font Logos                 */ U+F300-F381,
  /* Octicons + Material overlap*/ U+F400-FD46,
  /* Material Design (SMP)      */ U+F0001-F1AF0;
```

### Visual-test pixel-sampling notes (from research)

- DPR matters: multiply cell coords by `window.devicePixelRatio` before `getImageData` (×2 on Retina).
- Sample the **center** of each cell (~10×20px), not the full bounding box — avoids inter-cell antialiasing bleed and shrinks the data array 5-10×.
- `.notdef` baseline codepoint suggestion: `U+F8FF` (Apple-logo PUA). Confirmed outside Symbols Nerd Font Mono coverage per the canonical block list above.
- WebGL `getImageData` works but is slow; sample minimal regions.

### Where to obtain the woff2

- Symbols Nerd Font Mono "Symbols-only" variant: download from https://github.com/ryanoasis/nerd-fonts/releases (latest v3.x release, asset name like `NerdFontsSymbolsOnly.zip`). Extract `SymbolsNerdFontMono-Regular.ttf` (or `.woff2` if shipped — otherwise convert via `woff2_compress`). License: MIT. Include LICENSE alongside the woff2 if not already present in the asset directory.
