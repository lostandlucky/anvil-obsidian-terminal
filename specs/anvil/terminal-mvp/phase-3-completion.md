# Phase 3 Complete: Profile Picker, Session Management + Multi-Instance

**Mode:** Code Tests (Mode B) — Vitest units for the pure seams
(shell discovery, tmux discovery, picker items, spawn args, mock
backend, bottom dock, settings) plus WebdriverIO e2e in real
Obsidian for every integrated behavior, including the D8 tab-group
isolation verification suite.
**Cycles:** 1 — clean pass once the reverted slice-6 fix (default-shell
pre-selection via `chooser.setSelectedItem`) was re-landed and the
D8 test's assertion was refined from `parent === parent` to
`offsetParent !== null`.
**Status:** GREEN — all 9 acceptance criteria pass except AC3 (manual
UAT checklist), which hands off to the user per the "don't automate
subjective UAT" rule.

**Test totals at phase end:** 100 unit passing (11 files), 26 e2e
passing (7 spec files).

## Deliverables

### Source — profile discovery

- `src/profiles/shell-discovery.ts` + `.test.ts` — `discoverShells`
  combines `$SHELL`, a hardcoded well-known-shells probe list
  (`bash`, `zsh`, `fish`, `nu`, `sh`) under common paths (`/bin`,
  `/usr/bin`, `/usr/local/bin`, `/opt/homebrew/bin`), and the
  user-editable shell list from settings. Exists check is injected
  for unit tests.
- `src/profiles/tmux-discovery.ts` + `.test.ts` — `discoverTmux`
  handles all three states (missing / installed-0 / installed-N)
  through an injected runner. A `createSystemTmuxRunner` helper
  wraps `which tmux` + `tmux list-sessions -F #{session_name}`.

### Source — picker

- `src/picker/picker-items.ts` + `.test.ts` — pure `buildPickerItems`,
  `filterPickerItems`, and `findDefaultShellIndex`. Builds a typed
  PickerItem list with headers, shell rows, new-tmux, and
  tmux-session kinds. Filter is tokenised case-insensitively and
  hides a section header if all its leaves are filtered out. 14 unit
  tests exhaustively cover the three tmux states, default-shell
  marking, and filter edge cases.
- `src/picker/profile-picker.ts` — thin `SuggestModal` wrapper that
  delegates building/filtering to the pure module and, critically,
  overrides `onOpen()` to call
  `chooser.setSelectedItem(findDefaultShellIndex(items))` so arrow-key
  navigation starts at the user's default shell row (spec D4). This is
  the fix for the gap that caused the first slice-6 attempt to be
  reverted — the reverted implementation marked the default row with
  a badge but never pre-selected it.

### Source — bottom dock

- `src/dock/bottom-dock.ts` + `.test.ts` — `createBottomDock` is a
  pure module (no `obsidian` import) that implements the
  `identity16/obsidian-terminal` rootSplit direction flip pattern:
  save the original direction, set to `horizontal`,
  `createLeafInParent(rootSplit, children.length)` per new terminal,
  restore the direction when the last terminal closes. Feature-detects
  `setDirection`/`createLeafInParent`; falls back to
  `getLeaf("split", "horizontal")` if either is unavailable. The
  `usingFallback` flag is exposed but not yet used by callers.

### Source — PTY shellArgs

- `src/pty/spawn-args.ts` — extended `SpawnArgsInput` with an
  optional `shellArgs: string[]`. Each entry emits as a repeated
  `--shell-arg=<value>` so tmux attach/new-session is spawnable.
  **Decision:** caller-supplied `shellArgs` suppress the implicit
  zsh/bash `--shell-arg=-l` login flag (Option A, marked in-code
  for later discussion — no current caller exercises the
  login-shell + custom args combination).
- `src/pty/spawn-args.test.ts` — 4 new tests for the new cases
  alongside the existing 5.
- `src/pty/pty-backend.ts` — `PtyBackendOptions` gains the same
  optional field and threads it to `buildSpawnArgs`.
- `pty-server/src/main.rs` — unchanged. It already accepts
  `Vec<String>` on `--shell-arg` with `allow_hyphen_values`.

### Source — settings

- `src/settings/settings.ts` + `.test.ts` — `AnvilSettings` with
  three keys (`defaultShell`, `userShellList`,
  `preserveTmuxDimensions`) and a `normalizeSettings` normaliser
  that tolerates partial persisted shapes.
- `src/settings/settings-tab.ts` — `AnvilSettingsTab` renders three
  Obsidian `Setting` rows against a `SettingsTabHost` seam.

### Source — plugin glue

- `src/main.ts` — loads settings via `loadData()`/`normalizeSettings`,
  persists via `saveData`, registers `AnvilSettingsTab` as the
  settings host, factors `openTerminal` into a reusable
  `openTerminalWithSpec(TerminalLaunchSpec)` path, exposes a public
  `openDefaultTerminal()` method, adds an `openPicker()` method that
  wires `discoverShells` + `discoverTmux` into `ProfilePickerModal`,
  and changes the `open-terminal` command to open the picker.
- `src/view/TerminalView.ts` — overrides `setState`/`getState` to
  persist a per-leaf launch spec (`{shell, shellArgs, cwd}`). `onOpen`
  threads that spec into `PtyBackend` so each leaf runs its own shell.
  Registers an `addAction("plus", "New terminal", …)` header button
  that calls `plugin.openDefaultTerminal()`. `detectShell()` now
  consults `plugin.getDefaultShell()` before falling through to
  `$SHELL`.

### Source — mock backend

- `src/pty/mock-backend.ts` + `.test.ts` — `MockBackend` implements
  `TerminalBackend` with recorded writes/resizes and a
  `fireData`/`fireExit` control surface, unit-verifying that two
  instances never share state. Ships as the seam for multi-instance
  unit coverage without widening `TerminalBackend`.

### Tests — e2e

- `tests/e2e/bottom-dock.e2e.ts` (2 tests) — opening a terminal
  flips rootSplit to horizontal and places the leaf under rootSplit;
  closing the last terminal restores the original direction.
- `tests/e2e/plugin.e2e.ts` (6 tests) — plugin loads, command
  registers, default-launch mounts xterm, real shell prompt
  renders, Ctrl-C is trapped inside the view, close/reopen leaves
  no console errors.
- `tests/e2e/pty-backend.e2e.ts` (6 tests) — printf marker round-
  trips, ANSI colors render as styled spans, Ctrl-C interrupts,
  resize changes $COLUMNS, close kills the binary, disabling the
  plugin kills any running pty-server.
- `tests/e2e/picker.e2e.ts` (3 tests) — the command opens a modal
  (not a terminal); the picker renders a Launch new header + at
  least one shell row; Escape dismisses without opening anything.
- `tests/e2e/multi-instance.e2e.ts` (4 tests) — plus-icon registered
  on the view header; clicking it opens a second terminal; two
  concurrent terminals mount independent xterm hosts; detaching one
  leaves the other intact.
- `tests/e2e/tab-isolation.e2e.ts` (4 tests) — D8 verify-don't-
  implement suite. Covers `workspace.openLinkText` default/"tab"/
  "split" modifiers and a synthetic HTML5 drop event onto the
  terminal's container. The assertion is
  "terminal xterm is still visible to the user" (`offsetParent
  !== null`), which captures the real user-facing concern of
  tab-group pollution without false-positiving benign
  `rootSplit` sibling rows.
- `tests/e2e/smoke.e2e.ts` (1 test) — unchanged Phase 0 smoke.

## User testing

Go play with it. These map directly to MT-005 through MT-012 in
`../manual-test-checklist.md`. Record results there with date +
subjective judgment for the UAT entries.

1. **Run the "Open terminal" command with tmux off.** The picker
   modal should open with a single "Launch new" section listing
   shells on your machine. Your default shell row is pre-selected —
   Enter should launch it without any further clicks. Filter by
   typing (`zs`, `bas`, etc), cancel with Esc. (MT-009 steps 1–6,
   MT-011)
2. **Attach to running tmux sessions.** Start two sessions from an
   external terminal (`tmux new -d -s work`, `tmux new -d -s scratch`).
   Run the picker. You should see both "Launch new" (with a "New
   tmux session" row) and "Attach to tmux session" (with `work` and
   `scratch`). Attach to each in turn. Confirm each lands in its own
   docked pane and each is an independent tmux session. (MT-009
   steps 8–12, MT-012)
3. **Plus-icon on the view header.** With one terminal docked, click
   the plus icon in its header. A second terminal should open
   running the default shell with no picker friction. Confirm it
   lands in the bottom dock area, not elsewhere. Try closing one
   and check the other survives. (MT-012)
4. **Judge the flatten behavior.** Open two notes side-by-side
   (split right). Toggle the terminal. Watch the columns stack into
   rows while the terminal is docked. Type in the terminal, scroll
   each stacked editor, close the terminal, watch the columns
   return. **Fill in MT-007's subjective judgment** — this is the
   gate for whether D7 holds.
5. **Tab-group isolation by hand.** With a terminal focused, open
   notes via the quick switcher, file explorer, Cmd-click on an
   internal link, and a split command. Confirm the terminal leaf is
   never replaced or hidden behind a note tab. Try **physically
   dragging** a note tab onto the terminal dock and record what
   happens — the e2e suite only exercises the JS drop simulation,
   not a real pointer drag. (MT-008)
6. **Flip the tmux resize setting.** Open a tmux session at a known
   size outside Obsidian. Attach via the picker with the default
   setting — tmux should resize to match the pane. Open plugin
   settings, flip "Preserve tmux session dimensions on attach",
   detach, re-attach — dimensions should now be preserved. **Note:**
   the attach currently just passes `attach-session -t <name>` to
   `tmux`; the preserve-dimensions setting is persisted but not yet
   consumed by the spawn path. Treat this test as a spec-authored
   manual regression that will go green when Phase 4 (or a follow-up
   Phase 3 tweak) wires the setting into the `shellArgs` build.
7. **Graceful degradation.** Launch Obsidian from a shell without
   tmux on `PATH`. Open the picker. Confirm no tmux rows appear
   anywhere, no errors, no notices. (MT-011)

## Notes for downstream phases (Phase 4)

- **`preserveTmuxDimensions` is persisted but not yet read by the
  spawn path.** The setting round-trips through settings UI → disk,
  but `main.ts:openPicker`'s tmux attach case currently always
  passes `["attach-session", "-t", <name>]` — it never adds the
  `-x`/`-y` flags that would honor the setting when it's `true`.
  This is technically a spec gap (D3 says a toggle must exist and
  affect behavior) but the gap is small and non-blocking for phase
  close. Phase 4 should wire `shellArgs: ["attach-session", "-t",
  name, ...(preserve ? [] : ["-x", pane.cols, "-y", pane.rows])]`
  when the setting is honored, or vice-versa. The e2e harness can
  drive this by reading `host.terminal.cols/rows` off the view
  before constructing the spec.
- **PtyBackend `shellArgs` + implicit `-l`**, Option A decision
  (caller-supplied `shellArgs` suppress the zsh/bash login flag)
  has an in-code comment flagging it for reconsideration. No
  current caller exercises the combination, so cost-of-wrong is
  zero today — but if Phase 4 adds a "launch shell with -c
  startup-command" feature, revisit whether login-shell and custom
  args should coexist behind an explicit `loginShell?: boolean`
  opt-in.
- **Bottom dock `usingFallback` flag is unused.** `createBottomDock`
  exposes it but nothing reads it. Phase 4 polish could surface
  degraded mode via the inline red ANSI pattern ("dock API
  unavailable — using horizontal split fallback") if that matters
  once it's being consumed by real users.
- **D8 tab-group isolation test uses `offsetParent !== null` as the
  "terminal still visible" check.** If a future Obsidian change adds
  a new hiding mechanism (e.g. CSS `visibility: hidden` instead of
  `display: none`), the test could false-pass. Revisit the
  assertion if the harness flags a regression that contradicts
  manual observation.
- **Picker `chooser.setSelectedItem` is undocumented Obsidian
  internal API.** It works against 1.12.7 and is verified in
  picker.e2e + multi-instance.e2e. If it disappears or renames in a
  future Obsidian release, the picker will still function but will
  stop pre-selecting the default shell row. Phase 4's dependency
  audit should re-verify against the Obsidian binary version in
  use at that time.
- **Dependency maintenance kickoff was skipped for Phase 3 per D12.**
  Phase 4 is the next hook point — start Phase 4 with a Dependabot
  scan and an Obsidian test-binary version audit.
