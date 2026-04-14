# Phase 3 Spec: Profile Picker, Session Management + Multi-Instance

## Objective

Ship the VS Code-style terminal experience: a profile picker that discovers shells and tmux sessions, the ability to launch or attach to those sessions, multiple concurrent terminal instances docked as a bottom panel in the Obsidian workspace, and a settings surface for the user-configurable parts. This is the phase where the plugin's user-facing shape stabilizes.

## Decisions for review

All major decisions were resolved during the planning session on 2026-04-14. Executing agent: treat `[RESOLVED]` items as settled; don't re-open them unless a requirement turns out to be structurally impossible.

### D1: Terminal placement → bottom dock via `rootSplit` direction flip **[RESOLVED]**
The terminal docks as a full-width panel at the bottom of the main editor area, using the `identity16/obsidian-terminal` pattern: save `app.workspace.rootSplit.direction`, mutate it to `'horizontal'`, `createLeafInParent(rootSplit, rootSplit.children.length)`, restore the direction when the last terminal closes. Feature-detect `setDirection` and `createLeafInParent` (both undocumented API) and degrade gracefully to `workspace.getLeaf('split', 'horizontal')` if they change. Flip blindly — no multi-column detection. MT-007 will surface if the flatten behavior becomes unacceptable.

### D2: Shell discovery strategy → hybrid **[RESOLVED]**
Combine `$SHELL`, a hardcoded well-known-shells probe list (`bash`, `zsh`, `fish`, `nu`, `sh`), and a user-editable list from settings. Probe candidates against the filesystem and common paths (`/bin`, `/usr/bin`, `/opt/homebrew/bin`, etc.); include only entries that exist. No shell binaries are bundled with the plugin.

### D3: tmux attach sizing → pane wins by default, setting to flip **[RESOLVED]**
On attach, resize the tmux session to match the pane's dimensions (default). Expose a boolean setting "Preserve tmux session dimensions on attach" — when enabled, attach without resizing.

### D4: Profile picker shape → Obsidian modal with two sections **[RESOLVED]**
Modal with text filter at the top, scrollable list below, split into:
1. **Launch new** — one row per discovered shell, plus a "New tmux session" row *if tmux is installed at all* (regardless of existing session count).
2. **Attach to tmux session** — one row per currently-running tmux session. Hidden entirely when tmux is missing or has zero sessions.

Default selection is the user's default shell. Arrow keys navigate, typing filters, Enter picks, Esc cancels.

### D5: Launch another default terminal from view header → `ItemView.addAction` plus icon **[RESOLVED]**
Each `TerminalView` registers a plus-icon action in its view header via `addAction`. Clicking opens a new terminal running the default shell in a new leaf, bypassing the picker entirely. Same endpoint the picker's default-shell row resolves to.

### D6: New tmux session naming → tmux auto-assigned **[RESOLVED]**
Fresh tmux sessions launched via the picker use tmux's default auto-assigned naming (integers). Configurable naming is tracked as FI-001 in `future-ideas-backlog.md`.

### D7: Dock fallback when main area has multiple columns → flip blindly **[RESOLVED]**
No detection, no notice, no fallback path. The `rootSplit` flip reorients the user's columns into rows while the terminal is docked and restores on close. MT-007 is the explicit UAT gate for whether this stays acceptable.

### D8: Tab-group isolation → verify with tests, no code unless needed **[RESOLVED]**
Do not ship pin-based or monkey-patch-based isolation in v1. Instead, add an end-of-phase verification suite (see AC2) that asserts the bottom-docked terminal is not polluted by file-open commands. Only add isolation code if a regression surfaces.

### D9: Settings schema → Obsidian standard plugin settings API **[RESOLVED]**
Use `loadData()` / `saveData()` with a typed settings interface. Register a `PluginSettingTab`. Minimum schema for this phase:
- `defaultShell: string` — resolved path of the shell to launch by default
- `userShellList: string[]` — user-added shell paths to include in discovery
- `preserveTmuxDimensions: boolean` — D3's toggle, defaults to `false` (pane wins)

Phase 4 expands this; don't over-build the schema now.

### D10: Bottom dock lifecycle ownership → dedicated module, not `main.ts` **[RESOLVED]**
Executing agent chooses the module name and location. Constraint: `main.ts` should import and call it, not contain the implementation. Steve prefers modular code.

### D11: Failure mode rendering → inline red ANSI, reused from Phase 2b **[RESOLVED]**
All new error paths render to the affected terminal's xterm using `\r\n\x1b[31m[message]\x1b[0m\r\n`. No modals. No Obsidian Notices. Error cases to cover at minimum: "profile not found", "tmux session vanished", "cannot create bottom dock".

### D12: Dependency maintenance kickoff check → skipped this phase **[RESOLVED]**
Phase 2b landed 2026-04-14 and Phase 3 begins the same day. Skip the Dependabot PR scan and Obsidian binary audit; revisit at the start of Phase 4.

## Requirements

- The plugin MUST offer a profile picker modal triggered by an "Open terminal" command, listing shells the user can launch and tmux sessions the user can attach to.
- The picker MUST distinguish "launch new" from "attach to existing" as two visually separated sections with explicit headers.
- The picker's list MUST be filterable by typing, navigable with arrow keys, committed with Enter, and dismissed with Esc.
- Shell discovery MUST combine `$SHELL`, a hardcoded well-known-shells probe list, and a user-configurable list from settings, returning only shells that actually exist on disk.
- tmux session discovery MUST execute `tmux list-sessions` (or equivalent) and handle three cases cleanly: tmux missing, tmux installed with zero sessions, tmux installed with ≥1 session.
- When tmux is installed, the picker MUST offer a "New tmux session" option in the Launch new section, regardless of how many sessions already exist.
- When tmux is absent, no tmux-related rows MUST appear in the picker — neither "New tmux session" in Launch new, nor the Attach section.
- Attaching to a tmux session MUST, by default, resize the session to match the pane's current dimensions. A settings toggle MUST allow preserving the session's existing dimensions instead.
- Opening a terminal MUST place the new leaf as a full-width bottom panel in the main editor area via the `rootSplit` horizontal-flip technique described in D1.
- Closing the last terminal leaf MUST restore the original `rootSplit` direction so the user's main-area layout returns to its prior state.
- The bottom dock implementation MUST feature-detect its undocumented API dependencies (`setDirection`, `createLeafInParent`) and degrade gracefully — falling back to a standard horizontal split — if those calls are unavailable.
- Each `TerminalView` MUST expose a plus-icon action in its view header that opens a new terminal running the default shell, bypassing the picker.
- Multiple terminal instances MUST run concurrently as independent leaves. Closing one MUST NOT affect any other.
- The plugin MUST register a `PluginSettingTab` covering at minimum: default shell selection (resolved from discovery), user-added shell list, and the tmux preserve-dimensions toggle.
- The plugin MUST surface error conditions in the affected terminal using the inline red ANSI pattern from Phase 2b. New error surfaces MUST NOT use modals or Notices.
- The phase MUST deliver an automated verification suite covering tab-group isolation across every file-open entry point that WebDriver can drive cleanly, plus a JS-injection-based drop simulation.
- The phase MUST NOT widen the `TerminalBackend` interface beyond what the multi-instance and profile work strictly require.
- The bottom-dock lifecycle code MUST live in its own module, not inside `main.ts`.

## Acceptance criteria

- **AC1:** `npm run test:unit` passes with new unit coverage for: shell discovery (including filesystem probing), tmux discovery (all three states), and multi-instance isolation via `MockBackend`.
- **AC2:** `npm run test:e2e` passes with new e2e coverage for:
  - Bottom dock geometry: opening a terminal produces a full-width leaf at the bottom of `rootSplit`; closing it restores the original direction.
  - Tab-group isolation across scriptable entry points: quick switcher, file explorer click, Cmd-click on an internal link, `workspace.openLinkText` programmatic opens, and split commands. In each case, opening a note while the terminal is focused MUST NOT replace or sibling-into the terminal leaf.
  - JS-injection drop simulation: dispatching a synthetic HTML5 `drop` event with a `DataTransfer` payload onto the terminal's container MUST NOT produce a mixed tab group containing the terminal and a note.
- **AC3:** MT-005 through MT-012 in `manual-test-checklist.md` are all run against a real Obsidian 1.12.7+ install and recorded with date, result, and notes. At minimum, MT-007 (flatten UAT) and MT-009 (picker UAT) MUST be acknowledged with a subjective judgment — not just ✅/❌.
- **AC4:** No regressions in the existing Phase 2b test suite. All prior unit + e2e tests continue to pass.
- **AC5:** `npm run build` compiles cleanly, copies the `pty-server` binary, and the built plugin loads in Obsidian without errors.
- **AC6:** Settings tab appears in Obsidian's community plugins section, lists the three schema keys, and persists changes across an Obsidian restart.
- **AC7:** Two terminals running against different tmux sessions can coexist in separate docked panes. Closing one leaves the other untouched (shell, scrollback, dimensions).
- **AC8:** After closing all terminal leaves, `app.workspace.rootSplit.direction` equals its pre-open value. This is asserted in the e2e suite, not only eyeballed.
- **AC9:** On a machine where tmux is uninstalled, the picker renders only the Launch new section with shells — no tmux rows anywhere, no errors, no notices.

## User testing

The executing agent should hand these off as a "go play with it" list at phase handoff. Most map directly to entries in `manual-test-checklist.md`.

1. **Pick a shell from the picker.** Run the "Open terminal" command with tmux off. Walk through the Launch new section — pick your default, cancel, filter by typing, pick a non-default. Does it feel like Obsidian's quick switcher? (MT-009 steps 1–6)
2. **Attach to running tmux sessions.** From an external terminal, start two tmux sessions (`tmux new -d -s work`, `tmux new -d -s scratch`). Run the picker. Confirm both sections appear, filter by name, attach to each. Verify they're independent docked panes. (MT-009 steps 8–12, MT-012)
3. **Open a new terminal via the plus icon.** With a terminal docked, click the plus icon in the view header. Confirm a second terminal opens in a new leaf running the default shell with no picker friction. Verify it lands in the bottom dock area, not elsewhere.
4. **Judge the flatten behavior.** Open two notes side-by-side in the main area (split right). Toggle the terminal. Observe the columns stack into rows. Type in the terminal, scroll one of the stacked editors, close the terminal, watch the columns return. Fill in MT-007's "what to judge" section honestly — this is the gate for whether D7 holds. (MT-007)
5. **Verify tab-group isolation.** With a terminal focused, open notes via quick switcher, file explorer, Cmd-click on an internal link, and a split command. Confirm the terminal leaf is never replaced or siblinged into. Try dragging a note tab physically onto the terminal dock and record what happens. (MT-008, plus the e2e suite)
6. **Flip the tmux resize setting.** Open a tmux session at a known size from outside Obsidian. Attach via the picker with the default setting — verify tmux resized to match the pane. Open plugin settings, flip "Preserve tmux session dimensions on attach", detach, re-attach. Verify dimensions are now preserved. (MT-010)
7. **Verify graceful degradation.** Launch Obsidian from a shell where tmux isn't on `PATH` (or uninstall tmux temporarily). Open the picker. Confirm no tmux rows appear anywhere — no error, no notice, no broken modal. (MT-011)

## Boundaries

Explicitly **not** in Phase 3 scope. These are Phase 4 or out-of-scope entirely.

- Theme integration — xterm.js colors following Obsidian light/dark. **Phase 4.**
- Font / Nerd Font rendering for TUI glyphs. **Phase 4.**
- Codesigning / notarizing `pty-server`. **Phase 4.**
- Release packaging — shipping `bin/` in the GitHub artifact. **Phase 4.**
- `onResize` double-fit cleanup. **Phase 4.**
- Cargo Dependabot/Renovate setup. **Phase 4.**
- Dependency maintenance kickoff scan (Dependabot PRs, Obsidian binary version audit). **Phase 4 start.**
- Configurable tmux session naming. **Deferred to FI-001.**
- Widening the `TerminalBackend` interface. **Don't touch unless multi-instance or profile work strictly requires it.**
- Cross-platform support (Linux/Windows). **Out of scope project-wide.**
- Custom shell implementation. **Out of scope project-wide.**
- tmux control mode (pane-level integration). **Out of scope project-wide.**
- Community plugin store submission. **Out of scope project-wide.**
- Adding settings beyond the three in D9. **Keep the schema minimal; Phase 4 expands.**
- Tab-group isolation via pinning, `openLinkText` monkey-patch, or `layout-change` evictor. **Only add if the AC2 suite or MT-008 surfaces a regression.**

## Sources

### In-repo

- `specs/terminal-plugin/meta-plan.md` — Phase 3 section + "Notes from Phase 2b" inside the Phase 3 entry. Pay particular attention to the load-bearing notes about `TerminalBackend`, `TerminalView.detectShell()`, and the inline-red error pattern.
- `specs/terminal-plugin/testing-approach.md` — testing philosophy, harness capabilities and limits.
- `specs/terminal-plugin/manual-test-checklist.md` — MT-005 through MT-012. This is the UAT plan; AC3 and all of User Testing reference it.
- `specs/terminal-plugin/phase-2b-completion.md` — completed deliverables this phase builds on; `PtyBackend` contract.
- `specs/terminal-plugin/phase-2b-plugin-integration-spec.md` — interface seam documentation.
- `specs/terminal-plugin/future-ideas-backlog.md` — FI-001 context for tmux naming.
- `docs/adr/0003-pty-backend.md` — PTY backend architecture decision.
- `CLAUDE.md` — project conventions, dependency-maintenance cadence, manual-install model.

### In-code (read before implementing)

- `src/view/TerminalView.ts` — extends `ItemView`; `detectShell()` is the single hardcoded point to replace/wrap. `addAction` for the plus icon registers here.
- `src/pty/` — `PtyBackend` and the `TerminalBackend` interface. Don't widen.
- `src/main.ts` — plugin entry and command registration. Add new commands here, but keep dock lifecycle out of it.

### In-vault

- `Programming/Obsidian Bottom Panel - Terminal Placement Research.md` — the research note written during Phase 3 planning. Contains the full analysis of the `rootSplit` flip technique, the identity16 reference implementation, the tab-group isolation analysis, and the API-risk assessment. **Read this before touching the bottom dock code.**
- `Programming/Obsidian Terminal Plugin - Technical Design Research.md` — original technical design research.
- `TaskNotes/Tasks/Obsidian Terminal Plugin.md` — project task note.

### External

- [identity16/obsidian-terminal](https://github.com/identity16/obsidian-terminal) — reference implementation for the `rootSplit` flip. Read `src/main.ts` in its entirety before attempting D1.
- [polyipseity/obsidian-terminal](https://github.com/polyipseity/obsidian-terminal) — the big community terminal plugin. Reference for picker UX patterns and shell discovery, even though it doesn't do bottom docking.
- [scambier/obsidian-no-dupe-leaves](https://github.com/scambier/obsidian-no-dupe-leaves) — `openLinkText` interception pattern. Only read if AC2 or MT-008 surfaces a tab-group pollution regression.
- [Obsidian Workspace API](https://docs.obsidian.md/Plugins/User+interface/Workspace) — public API docs.
- [Obsidian ItemView / addAction](https://docs.obsidian.md/Reference/TypeScript+API/ItemView) — for D5's plus-icon action button.
- [Obsidian PluginSettingTab](https://docs.obsidian.md/Plugins/User+interface/Settings) — standard settings API for D9.
