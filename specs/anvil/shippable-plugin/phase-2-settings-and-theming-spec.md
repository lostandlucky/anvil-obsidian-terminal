# Phase Spec: Phase 2 — Settings & Theming

## Objective

The terminal visually belongs inside Obsidian (FI-016) AND users get a real Settings tab that exposes the meaningful configuration knobs (FI-015), including font handling that closes the nerd-font gap (FI-021). Theming ships first inside the phase so the settings tab has a theming model to expose overrides for; the existing settings infrastructure (`src/settings/`, already wired for `preserveTmuxDimensions`) extends to cover font, tmux naming, and theme overrides, plus the long-overdue plumbing of `preserveTmuxDimensions` into the actual tmux attach spawn path.

## Decisions for Review

These need a resolution before exec proceeds. Auto-resolved per the overnight orchestrator's policy.

### D1: Theme change detection mechanism

When the user switches Obsidian theme (light ↔ dark, or applies a community theme), the terminal needs to re-read CSS variables and re-render. Three plausible mechanisms.

| Option | Notes |
|---|---|
| `workspace.on("css-change", …)` | Documented Obsidian event. Fires on any CSS reload — theme switch, snippet change. May be over-broad (fires on snippet edits too) but cheap to handle. |
| `MutationObserver` on `document.body.classList` | Watches `theme-light` / `theme-dark` toggles directly. Misses community-theme CSS-only changes. |
| Polling | Worst option. Don't. |

**[RESOLVED]** — Use **`workspace.on("css-change", …)`**. Documented API, no observer lifecycle, theme + snippet covered. Over-broad fires are cheap (read CSS var → update theme → fit). Falls back to `MutationObserver` on `body` if the event doesn't exist on the pinned binary (feature-detect pattern, same as the four other undocumented APIs already in production).

### D2: ANSI 16-color palette source

xterm's theme object includes 16 ANSI slots (`black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white` × 2 for normal + bright). These don't have direct Obsidian CSS-variable analogs.

| Option | Notes |
|---|---|
| Adopt Obsidian accent variables (`--color-red`, `--color-green`, etc.) | Available since Obsidian 1.5 as standard variables. Coherent with the rest of Obsidian's palette. May not have all 16 slots; missing slots fall back to xterm defaults. |
| Ship a fixed palette (Solarized Dark) | Predictable. Familiar to terminal users. Doesn't follow the user's Obsidian theme. |
| Ship a fixed palette + expose override | Best of both. Default to Solarized Dark for non-default themes; users override per shell. |

**[RESOLVED]** — Use **Obsidian accent variables when present, fall back to a curated terminal palette when not** (`--color-red` → ANSI red, etc.). The fallback palette is a "nice default" — Solarized Dark is a safe pick. Theme overrides land in the settings tab (D5), not exposed per-shell. Keeps the model simple: derive from Obsidian where we can, fall back where we can't, override globally when the derived value is wrong.

### D3: Font-family default stack

Today: `"var(--font-monospace), Menlo, Monaco, 'Courier New', monospace"` (xterm-host.ts:18-19). FI-021 wants nerd-font glyphs to render when a nerd-font is installed.

| Option | Notes |
|---|---|
| Keep current stack | Preserves Obsidian's `--font-monospace` as primary. Users with nerd-fonts only get glyphs if `--font-monospace` happens to point at one. |
| Prepend common nerd-fonts | `"'MesloLGS NF', 'FiraCode Nerd Font', 'JetBrainsMono Nerd Font', var(--font-monospace), Menlo, Monaco, 'Courier New', monospace"`. Users who installed any nerd-font get glyphs without configuration. Users without one fall through to Obsidian's font. |
| Make settings-only | Force the user to set the font in settings. Most users won't, ship a worse default. |

**[RESOLVED]** — **Prepend common nerd-fonts.** Default value of the new `fontFamily` setting is the prepended stack; users can override via settings. Nerd-font users get glyphs immediately; non-nerd-font users get current behavior.

### D4: Tmux session naming format

Today tmux assigns integer names (`0`, `1`, `2`) automatically. FI-015 lists several format options.

**[RESOLVED]** — Ship two options for now: **`integer`** (current behavior, default) and **`obsidian-N`** (auto-incrementing prefix). Defer timestamp/template-string formats to a future FI; over-flexibility risks the YAGNI cliff. Persist the chosen format in settings; tmux `new-session -s <name>` is invoked with the formatted name when `new-tmux` is selected. If the name collides with an existing session, fall through to tmux's default integer assignment (don't fail).

### D5: Theme override exposure

FI-015 lists "theme overrides if FI-016 ships a configurable model" as in-scope. The risk is exposing too many knobs (16 ANSI + background + foreground + cursor + selection = lots of knobs).

**[RESOLVED]** — Expose **two override knobs in this phase**: a "Background mode" toggle (transparent ↔ solid; today it's hardcoded transparent at `#00000000`) and a "Use Obsidian accents for ANSI palette" toggle (default on; off uses the Solarized fallback wholesale). Per-color overrides are deferred — they need a color-picker UI that's bigger than this phase. The model in `src/settings/settings.ts` should leave room for per-color overrides as future fields without breaking the schema (use a typed `themeOverrides?: { ansi?: Partial<AnsiPalette> }` shape).

## Requirements

- **R1.** The terminal background, foreground, and cursor colors derive from Obsidian CSS variables at xterm mount time. Specifically: `--background-primary` → background, `--text-normal` → foreground, `--text-accent` (or fallback) → cursor.
- **R2.** When the active Obsidian theme changes (light ↔ dark, community theme applied), the running terminals re-read CSS variables and re-apply theme without requiring plugin reload.
- **R3.** xterm's 16-color ANSI palette is sourced from Obsidian's `--color-*` variables when present (red, green, yellow, blue, magenta, cyan), with curated Solarized-Dark fallbacks for any slot Obsidian doesn't expose. The "Use Obsidian accents" setting (D5) toggles whether ANSI slots derive from Obsidian (default) or use the Solarized fallback wholesale.
- **R4.** A new `fontFamily` setting (string) and `fontSize` setting (number, default 13) exist in `AnvilSettings` and round-trip through `loadData`/`saveData`. Default `fontFamily` is the nerd-font-prepended stack from D3.
- **R5.** A new `tmuxSessionNameFormat` setting (`"integer"` | `"obsidian-prefix"`) exists in `AnvilSettings` with default `"integer"`. When `"obsidian-prefix"` is selected, `new-tmux` from the picker invokes `tmux new-session -s obsidian-<N>` with `<N>` auto-incremented from existing-session count.
- **R6.** A new `themeOverrides` setting field (typed shape) exists in `AnvilSettings` with two booleans: `solidBackground` (default false) and `useObsidianAccents` (default true). The schema leaves room for a future `themeOverrides.ansi` per-color override map without breaking the `normalizeSettings` contract.
- **R7.** `preserveTmuxDimensions` is plumbed into the tmux attach spawn path — when enabled, the `tmux attach-session -t <name>` invocation gets `-x <cols> -y <rows>` appended, where cols/rows come from the host's current pane dimensions (read off `xtermHost.terminal.cols`/`rows`). This closes the Phase 3 gap.
- **R8.** The Settings tab (`src/settings/settings-tab.ts`) gains UI rows for: font family, font size, tmux session name format, solidBackground toggle, useObsidianAccents toggle. Existing rows (default shell, additional shells, preserveTmuxDimensions) stay unchanged in behavior; only their position in the tab may shift.
- **R9.** The xterm-host module accepts theme+font configuration via constructor or factory parameters — no new methods on the `TerminalBackend` interface (constraint MUST NOT be widened, per `_shared`).
- **R10.** Settings changes that affect the running terminal (font, theme overrides) propagate to open terminals. Either: terminals re-render on settings change, OR a "settings changes apply on next terminal" notice is shown explicitly. Pick whichever matches the existing settings-change pattern in this codebase; don't introduce a new event surface.
- **R11.** Nerd-font glyphs render correctly. Concretely: when the test fixture sets `fontFamily: "'MesloLGS NF', monospace"` and the test environment has a nerd-font installed (or a synthetic glyph-coverage stub), terminals correctly position and render U+E000–U+F8FF Private Use Area glyphs in their assigned cells. (Closes FI-021.)
- **R12.** All existing unit + e2e tests stay green.
- **R13.** The pre-Phase-1 fit-coalescer pattern is respected: theme/font changes that shift xterm cell metrics call `xtermHost.fit()` directly (the public method bypasses the coalescer's dimension-equality short-circuit), per Phase 1's downstream notes.

## Acceptance Criteria

- **AC1.** Opening a terminal in default Obsidian dark theme produces a terminal whose background visibly matches the editor pane background and whose foreground visibly matches editor text — no hardcoded `#e0e0e0` against a dark Obsidian theme. Verified by reading `xtermHost.terminal.options.theme` after mount and asserting it equals derived values.
- **AC2.** Switching from default dark to default light theme (via Obsidian's appearance settings) re-renders the open terminal's background and foreground without plugin reload. Verified by an e2e test: open terminal → switch theme → assert `terminal.options.theme.background` changed.
- **AC3.** With `useObsidianAccents: true` (default), the ANSI red slot equals the value of `--color-red` (computed-style read from a test container). With `useObsidianAccents: false`, the ANSI red slot equals the Solarized Dark red (`#dc322f`).
- **AC4.** `AnvilSettings` includes new fields `fontFamily`, `fontSize`, `tmuxSessionNameFormat`, `themeOverrides.solidBackground`, `themeOverrides.useObsidianAccents`. `normalizeSettings` correctly handles missing/invalid types with sane defaults.
- **AC5.** The settings tab renders all new controls. Each control updates the underlying setting via `host.updateSettings(...)` and persists through `saveData`. Verified by unit tests against a mock `SettingsTabHost`.
- **AC6.** With `preserveTmuxDimensions: true`, attaching to a tmux session invokes `tmux attach-session -t <name> -x <cols> -y <rows>` (where cols/rows match the current pane). With `preserveTmuxDimensions: false`, the invocation is `tmux attach-session -t <name>` (no `-x`/`-y`). Verified by a unit test against the spawn-args construction.
- **AC7.** With `tmuxSessionNameFormat: "obsidian-prefix"`, picking "Launch new tmux session" invokes `tmux new-session -s obsidian-<N>` with `<N>` correctly incremented from existing-sessions count. With `"integer"` default, the existing behavior (no `-s` flag) holds.
- **AC8.** Default `fontFamily` includes nerd-font names ahead of `var(--font-monospace)`. Setting a non-default `fontFamily` propagates to xterm's `terminal.options.fontFamily` after mount.
- **AC9.** A unit test asserts that an xterm instance configured with `fontFamily: "'MesloLGS NF', monospace"` correctly receives the font family on its `terminal.options.fontFamily`. (Visual glyph rendering can't be unit-tested without a real font; the User Testing section covers visual verification.)
- **AC10.** `npm run build` exits clean.
- **AC11.** `npm run test:unit` exits clean — including the new tests for AC1–AC9.
- **AC12.** `npm run test:e2e` exits clean — at minimum AC2's theme-switch e2e is covered.
- **AC13.** No new method on `TerminalBackend` (interface in `src/pty/`); xterm-host configuration flows through factory params or via `xtermHost.applyTheme(theme)`.

## User Testing

What Steve should try after Phase 2 GREEN:

1. **Open the Settings tab** (Settings → Anvil Terminal). Confirm the new rows: font family, font size, tmux session name format, solid-background toggle, use-Obsidian-accents toggle. Existing rows (default shell, additional shells, preserve-tmux-dimensions) still present.
2. **Open a terminal in default dark theme.** Confirm the terminal background is the editor background (not pure black), foreground is editor text color (not gray-on-black). The terminal should look visibly cohesive with the editor pane next to it.
3. **Switch to default light theme** (Obsidian → Settings → Appearance → Light). The open terminal's colors should flip to light without reloading the plugin.
4. **Run something that emits ANSI color codes** (e.g., `ls --color=auto`, `git status`). Confirm reds, greens, yellows match Obsidian's `--color-*` palette.
5. **Toggle "Use Obsidian accents"** off. Re-run the same colored command — colors should now be Solarized Dark instead of Obsidian-accent-derived.
6. **Toggle "Solid background"** on. Background goes from transparent (current) to opaque. Useful for users who find the transparency distracting.
7. **Set font family to a nerd-font you have installed** (e.g., `MesloLGS NF`). Run `claude` (or any prompt with nerd-font glyphs). The icons should render as icons, not strange characters. (FI-021 verification.)
8. **Toggle "Preserve tmux session dimensions"** on. Attach to an existing tmux session that has a different size than your current pane. The session should retain its dimensions; without the toggle it should shrink/grow to match the pane.
9. **Set tmux session name format to "obsidian-prefix"**. Use the picker to "Launch new tmux session" twice; sessions should be named `obsidian-0`, `obsidian-1` rather than `0`, `1`.

## Boundaries

- **Out:** Per-color ANSI overrides via UI (deferred to a future FI; the schema leaves room).
- **Out:** Bundling nerd-fonts in the plugin (artifact size cost not justified for this phase; users install their own).
- **Out:** Settings export/import or settings reset-to-default UI.
- **Out:** Any work on FI-018 (process hygiene) or FI-017 (release packaging) — those are Phase 3.
- **Out:** Cross-platform skip-list (FI-011) — schema may carve a future home, no UI.
- **Out:** "Hide Anvil chrome" toggle (a separate FI; not in this phase's scope).
- **Out:** Migrating existing terminals to a new theme model — applying theme to *running* terminals is in scope (R10), but rebuilding terminals from scratch on settings change is not required.

## Sources

- `src/settings/settings.ts` — current settings shape; extend here
- `src/settings/settings-tab.ts` — current tab UI; extend here
- `src/settings/settings.test.ts` — pattern for normalizeSettings tests
- `src/terminal/xterm-host.ts:16-27` — current hardcoded theme + font (this is what the phase replaces with derived values)
- `src/terminal/fit-coalescer.ts` — Phase 1 module; theme work that shifts cell metrics must call `xtermHost.fit()` directly per Phase 1 downstream note
- `src/main.ts:140-160` — picker action dispatch; tmux args constructed inline (R5/R7 modify here)
- `src/main.ts:166-174` — `openTerminalWithSpec` (R7 reads pane dims from this layer or below)
- `src/pty/` — `TerminalBackend` interface (constraint: do NOT widen)
- `specs/anvil/future-ideas-backlog.md` — FI-015, FI-016, FI-021 bodies
- `specs/anvil/shippable-plugin/phase-1-grooming-completion.md` — Phase 1 downstream notes (test-binary vs typings split, fit-coalescer dimension-equality semantics)
- `specs/anvil/testing-approach.md` — read before adding new tests
- Obsidian docs (CSS variables): `https://docs.obsidian.md/Reference/CSS+variables`
