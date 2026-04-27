# Phase Complete: Phase 2 — Settings & Theming

**Mode:** Code Tests (Mode B), pre-audit-tests
**Cycles:** 1 (clean pass)
**Status:** GREEN — 13 of 13 acceptance criteria met

## Deliverables

- `src/settings/settings.ts` (modified) — new fields: `fontFamily`, `fontSize`, `tmuxSessionNameFormat`, `themeOverrides.{solidBackground,useObsidianAccents}`. `themeOverrides.ansi` carved as future-surface (D5).
- `src/settings/settings.test.ts` (extended) — 16 new unit tests for AC4.
- `src/settings/settings-controls.ts` (new) — pure spec layer for the settings tab, no `obsidian` import.
- `src/settings/settings-tab.test.ts` (new) — 11 unit tests for AC5 against the spec layer.
- `src/settings/settings-tab.ts` (modified) — thin shell that maps spec list to Obsidian's Setting/Toggle/Dropdown API.
- `src/terminal/theme.ts` (new) — `deriveXtermTheme(read, overrides)` pure module. Maps Obsidian CSS vars to xterm `ITheme`. Exports `SOLARIZED_DARK_FALLBACK` (#dc322f red, etc.) and `createElementCssVarReader`.
- `src/terminal/theme.test.ts` (new) — 11 unit tests for AC1/AC3.
- `src/terminal/xterm-host.ts` (modified) — `createXtermHost(options?)` accepts `{ fontFamily, fontSize, theme }`. Adds `applyTheme`, `applyFontFamily`, `applyFontSize` to the `XtermHost` interface.
- `src/terminal/xterm-host.test.ts` (new) — 8 unit tests for AC1/AC8/R10.
- `src/profiles/tmux-args.ts` (new) — pure helpers `buildTmuxAttachArgs`, `buildTmuxNewSessionArgs`, `nextObsidianSessionName`.
- `src/profiles/tmux-args.test.ts` (new) — 10 unit tests for AC6/AC7.
- `src/view/TerminalContainerView.ts` (modified) — addTab derives initial theme from each pane's CSS vars; new `refreshThemeAndFont()` re-derives + reapplies + fits all tabs (R2/R10). Plugin registers as theme-listener via new `registerThemeListener` / `unregisterThemeListener` hooks.
- `src/main.ts` (modified) — picker dispatch now routes through `tmux-args` helpers; subscribes to `workspace.on('css-change', ...)` (with `MutationObserver` on `document.body` class as a fallback per D1); `updateSettings` broadcasts theme/font changes when relevant fields are patched.
- `tests/e2e/phase-2-theming.e2e.ts` (new) — AC2 live theme-switch test.

Total new/extended tests: **59 unit (124 → 183)** + **1 e2e spec file (8 → 9)**.

## Acceptance Criteria Roll-Up

| AC | Status | Verified by |
|---|---|---|
| AC1 — bg/fg/cursor derived from Obsidian CSS vars | GREEN | `theme.test.ts` + `xterm-host.test.ts` `theme accepted at construction` + AC2 e2e baseline read |
| AC2 — theme switch re-renders without reload | GREEN | `phase-2-theming.e2e.ts` |
| AC3 — ANSI palette derives or falls back per `useObsidianAccents` | GREEN | `theme.test.ts` ANSI palette block (5 tests) |
| AC4 — settings shape + normalize defaults | GREEN | `settings.test.ts` (16 new tests) |
| AC5 — settings tab renders new controls + persists | GREEN | `settings-tab.test.ts` against spec layer (11 tests) |
| AC6 — `preserveTmuxDimensions` adds -x/-y | GREEN | `tmux-args.test.ts` `buildTmuxAttachArgs` block |
| AC7 — `obsidian-prefix` increments past existing | GREEN | `tmux-args.test.ts` `buildTmuxNewSessionArgs` block |
| AC8 — default fontFamily prepends nerd fonts; override propagates | GREEN | `xterm-host.test.ts` AC8 block + `settings.test.ts` fontFamily block |
| AC9 — fontFamily option round-trips to terminal.options | GREEN | `xterm-host.test.ts` (visual rendering carried to manual) |
| AC10 — `npm run build` clean | GREEN | Verified locally |
| AC11 — `npm run test:unit` clean | GREEN | 183/183 passing |
| AC12 — `npm run test:e2e` clean | GREEN | 9/9 spec files passing |
| AC13 — no new method on `TerminalBackend` | GREEN | `git diff fd29a8a..HEAD -- src/pty/` is empty |

## User Testing

What Steve should try when verifying Phase 2 GREEN by hand:

1. **Open the Settings tab** (Settings → Anvil Terminal). Confirm eight rows: default shell, additional shells, preserve-tmux-dimensions, font family, font size, tmux session name format (dropdown), solid background toggle, use-Obsidian-accents toggle.
2. **Open a terminal in default dark theme.** Background visibly matches the editor pane background; foreground is editor text color (no hardcoded gray-on-black). The terminal looks visibly cohesive with the editor pane next to it.
3. **Switch to default light theme** (Obsidian → Settings → Appearance → Light). Open terminal's colors flip to light without reloading the plugin.
4. **Run something that emits ANSI color codes** (e.g., `ls --color=auto`, `git status`). Reds/greens/yellows match Obsidian's `--color-*` palette.
5. **Toggle "Use Obsidian accents"** off. Re-run the same colored command — colors are now Solarized Dark instead of Obsidian-accent-derived.
6. **Toggle "Solid background"** on. Background goes from transparent to opaque. Toggle off again, back to transparent.
7. **Set font family to a nerd-font you have installed** (e.g., `MesloLGS NF`). Run `claude` or any tool with nerd-font glyphs. The icons render as icons, not strange characters. (FI-021 / required manual verification.)
8. **Toggle "Preserve tmux session dimensions"** on. Attach to an existing tmux session that has a different size than your current pane. The session retains its dimensions (passes -x/-y); without the toggle it shrinks/grows to match.
9. **Set tmux session name format to "obsidian-prefix"**. Use the picker → Launch new tmux session twice; sessions are named `obsidian-0`, `obsidian-1` rather than `0`, `1`.

## Required Manual Verification

- **AC9 (visual nerd-font glyph rendering).** The unit test pins that `fontFamily: "'MesloLGS NF', monospace"` propagates to `terminal.options.fontFamily`. It cannot assert that U+E000–U+F8FF Private Use Area glyphs visibly render correctly without a real installed nerd font in the test environment. Steve installs a nerd font, sets it in the new font-family setting, runs Claude Code (or any prompt with nerd-font glyphs), and confirms icons render as icons. This is User Testing item 7.

No other AC carries to manual — AC1/AC2/AC3/AC4/AC5/AC6/AC7/AC8/AC10/AC11/AC12/AC13 are all automatable and were automatically verified.

## Notes for downstream phases (Phase 3 — Release-readiness)

- **Typings package bump (carried from Phase 1's note).** `package.json` `obsidian: 1.12.3` is still 4 patches behind the test binary at 1.12.7. Phase 2 didn't trip this — `workspace.on('css-change', ...)` is documented and present on the pinned binary. If Phase 3's release packaging touches new typed APIs that aren't in 1.12.3 typings, bump the typings package then (the test binary doesn't change).
- **Theme propagation breadth.** Phase 2's `broadcastThemeChange` fires on `css-change` plus on settings updates that touch font/themeOverrides. If Phase 3 (process hygiene) adds a "reset settings" command, it should call `updateSettings(...)` rather than mutating `this.settings` directly so the broadcast still fires. The `updateSettings` method is the only sanctioned mutation entry point.
- **Fit-coalescer pattern is now load-bearing.** `refreshThemeAndFont` calls `host.fit()` directly because the coalescer is dimension-equality based. Any future change that shifts xterm cell metrics (e.g., font ligatures toggle, cursor style change) must follow the same pattern: mutate options → call `host.fit()` directly. Don't rely on the ResizeObserver to re-fit after a metric-only change.
- **Per-color ANSI override slot.** `themeOverrides.ansi?: Partial<Record<string, string>>` is reserved future surface (D5). Phase 3 doesn't need it, but if a future FI ships per-color overrides, the schema is already there — `normalizeSettings` carries the field through when it's a string-valued map and drops it silently otherwise. Tests pin both behaviors.
- **`css-change` MutationObserver fallback never triggered in the test harness.** The pinned binary has `workspace.on('css-change', ...)` working; the fallback exists as a safety net for harness/Obsidian-version drift. If Phase 3's release packaging targets older Obsidian (`minAppVersion`), confirm the manifest's `minAppVersion` is consistent with the `css-change` event's introduction.
- **Settings tab spec layer is reusable.** Phase 3's manifest/release work doesn't touch the settings tab, but if a "reset to defaults" or "export settings" button is added, the spec list pattern in `src/settings/settings-controls.ts` is the place — keeps the unit-test split clean (Setting()/ToggleComponent are runtime-only obsidian.js classes, can't be unit-tested).
