# Future Ideas Backlog

Ideas that came up during planning or execution but were deliberately deferred. Not a TODO list — more of a "we saw it, made a call, and moved on" record. Revisit when a phase is looking for small wins, or when one of these blocks something real.

Rules:
- Each entry has a stable ID so conversations can reference it (`FI-###`).
- Feature entries record *value we hope to achieve*, *what's in scope*, and *open design questions*. Not a spec.
- Older problem-shaped entries use *what / why deferred / when to reconsider* and may be reframed when they get promoted into active features.
- When an item is fixed or closed (invalid, superseded, no-longer-relevant), remove it from this file. Git history is the audit trail. Don't renumber the survivors.
- If an item is picked up by an active feature, leave it in place with a forward-pointer note (e.g. *"Now scope of FI-XXX"*) until the feature lands, then remove.
- Append only when adding new items; don't renumber.
- Entries may link *out* to docs, specs, source, and commits. Docs never link *in* to this file — see `docs/DOCUMENTATION_STANDARDS.md` → `## Linking and cross-references` for the reasoning.

---

## FI-012: Wrap-and-dock — avoid the flatten entirely by nesting existing children
**What:** Instead of flipping `rootSplit.direction` on dock open (which flattens pre-existing columns into rows), wrap all existing rootSplit children into a new intermediate `WorkspaceSplit` with the original direction, then set rootSplit to horizontal, and add the terminal as a sibling of the wrapper. Result: columns stay as columns inside the wrapper, terminal docks below as a full-width row. No flatten at all.

**Proof of concept:** Confirmed during Phase 3 manual testing on 2026-04-16. With rootSplit already horizontal (terminal docked), the user clicked "Split" on a note — Obsidian's own split command automatically created a nested vertical `WorkspaceSplit` wrapper, giving exactly the desired layout: two note columns side-by-side on top, full-width terminal below. Screenshot captured. Obsidian already knows how to create and manage these nested splits; the question is what internal API call triggers the wrapping and whether we can invoke it programmatically.

**Investigation needed:** Determine how to programmatically create a `WorkspaceSplit` and reparent existing children into it. Candidates: `rootSplit.createSplit()`, manual child reparenting via the workspace internals, or reverse-engineering what `workspace:split-vertical` does under the hood. A short spike against the Obsidian 1.12.7 binary should surface the API.

**On close:** Move children back from wrapper to rootSplit, remove the empty wrapper, restore rootSplit direction. Inverse of the open path.

**Why deferred:** Current "flip blindly" approach works and was accepted (MT-007: "jarring but acceptable" for the always-on-terminal use case). This improvement eliminates the "jarring" entirely, which is strictly better UX, but requires an API investigation spike that's out of scope for Phase 3.5's tight focus on the keyboard fix.

**When to reconsider:** Worth sequencing near or alongside FI-014 (tabbed terminal pane) — both involve wrapping the terminal in a container under rootSplit, and a single design pass could answer both problems with one structural change. Don't start FI-012 in isolation if FI-014 is imminent.

**Origin:** Phase 3 manual testing follow-up discussion, 2026-04-16.

## FI-005: Persistent terminal session across close/reopen
**What:** Closing the terminal leaf kills the shell PTY and drops all scrollback/history. Reopening yields a fresh shell. A "hide instead of close" mode — or a tmux-backed persistence layer — would let the user detach the dock visually without losing their session.

**Why deferred:** Correct v1 behavior (close = detach leaf = kill child). tmux attach already covers the "I want persistence" use case from a different angle. But for non-tmux users it's a real papercut.

**When to reconsider:** Might motivate a "toggle dock visibility" command distinct from "close terminal." Candidate for promotion into a value-framed feature when dogfooding shows users losing work.

**Origin:** Phase 3 manual testing, 2026-04-14.

## FI-011: Windows (and Linux) compatibility — keyboard model collapses, needs a commands-to-skip-shell list
**What:** The plugin is explicitly macOS arm64 only today per `CLAUDE.md`, and cross-platform is deferred. When the project does take on Windows (and Linux), the Phase 3.5 D1 keyboard model won't carry over cleanly — it assumes macOS's Cmd/Ctrl separation, which doesn't exist on Windows or Linux. The fix isn't a small tweak; it's a redesign of the "who owns this key?" contract.

**Why the Phase 3.5 model can't just be ported:**

On macOS, Cmd (host-app modifier) and Ctrl (shell modifier) are separated by OS convention. `Cmd-C` = copy in apps, `Ctrl-C` = SIGINT in terminals, and these worlds don't collide because macOS users learn them as different keys from day one. Phase 3.5's asymmetric D1 model (drop Cmd registrations entirely, let Ctrl reach the shell) works because it rides that pre-existing separation and gives each modifier to its natural owner.

On Windows and Linux, there's no separation. **Both Obsidian and the shell want Ctrl**, because Ctrl is the only meta-modifier those platforms use. `Ctrl-C` is *both* the shell SIGINT and Obsidian's copy / command-palette root. `Ctrl-W`, `Ctrl-P`, `Ctrl-R`, `Ctrl-K` all have meanings in both worlds. You cannot naively drop our swallow without destroying the shell, and you cannot keep the swallow without destroying Obsidian's command palette.

**What real cross-platform terminal apps do:**

1. **Windows Terminal** — reserves `Ctrl-Shift-X` for its own chrome (new tab, split pane, etc.) and lets plain `Ctrl-X` fall through to the shell. The meta modifier is widened by one key.
2. **VS Code integrated terminal** — ships a setting called `terminal.integrated.commandsToSkipShell` that's explicitly the list of Ctrl bindings the terminal will NOT eat. Default gives `Ctrl-C` to the shell, and they have a separate setting `terminal.integrated.copyOnSelection` so selection-based copy still works without stealing Ctrl-C. Context-sensitive, user-configurable.
3. **Windows `conhost`/`cmd.exe` historically** — gave Ctrl to the shell, used no meta-modifiers of its own, and the user lived with no quick-copy. Terrible UX; nobody uses it voluntarily now.
4. **ConEmu, Cmder, Alacritty on Windows** — mostly follow Windows Terminal's "add Shift to the meta" pattern.

**The three honest options for the cross-platform redesign:**

- **Option W-A: Ctrl goes to the shell.** Obsidian's Ctrl-P, Ctrl-W, Ctrl-K, etc. do NOT fire while the terminal is focused. User must rebind those to `Ctrl-Shift-X` variants or use the Obsidian ribbon / mouse. Matches shell-user expectation, follows the macOS D1 spirit, but costs Obsidian's keyboard quickness.
- **Option W-B: Ctrl goes to Obsidian.** The shell never sees Ctrl. Terminal is effectively broken for any serious use. Nobody actually does this.
- **Option W-C (recommended): Context-sensitive, user-configurable.** Emulate VS Code's "commands to skip shell" list. Ship sensible defaults (`Ctrl-C`, `Ctrl-W`, `Ctrl-R`, `Ctrl-U`, `Ctrl-L`, `Ctrl-D`, the standard shell vocabulary) that route to the shell, and let everything else fall through to Obsidian. Users can edit the list in settings. Most work, best result. Also generalises cleanly back to macOS: the macOS variant is just "default commands-to-skip-list = all Ctrl keys, all Cmd keys never on the skip list," which is exactly Phase 3.5's D1 model.

**Why deferred:** Project scope is explicitly macOS-only until further notice (`CLAUDE.md` → Key Decisions). PTY backend, shell discovery, and dock placement all carry additional macOS assumptions beyond the keyboard model — cross-platform is a whole-phase undertaking, not a patch.

**When to reconsider:** Whenever cross-platform support re-enters the meta-plan. At that point, the Phase 3.5 keyboard fix will need to be revisited as part of the keyboard-model redesign — probably as a single slice inside whatever "cross-platform adaptation" phase ends up owning the port. Don't reopen it until then.

**What the macOS-only plugin should do about this today:** Nothing in the code. The macOS-only fix is the right fix for the macOS-only plugin. This entry exists so the next person to tackle cross-platform doesn't hit the scope rewrite cold and have to rediscover the design.

**Origin:** Phase 3.5 planning conversation, 2026-04-15.

## FI-010: Picker section headers render indistinguishably from selectable rows
**What:** `ProfilePickerModal` renders "Launch new" and "Attach to tmux session" as `kind: "header"` PickerItems in the same `SuggestModal` list as the actual selectable rows. Visually they look identical to the shell and session rows, and arrow-key navigation lands on them (the `onChooseSuggestion` handler routes header picks to `this.open()` as a reset, which is a hack). Users can't tell at a glance which rows are interactive.

**Why deferred:** Functional; cosmetic + discoverability polish. The underlying data model already tags headers distinctly, so the fix is isolated to `renderSuggestion` + CSS + arrow-key skip logic.

**Fix candidates:**
1. CSS in `styles.css`: give `.anvil-picker-header` a muted background, smaller font, uppercase section-label styling, and `pointer-events: none` on hover so it doesn't look clickable. Pair with an arrow-navigation hook that skips header rows (Obsidian's chooser exposes `chooser.setSelectedItem` — we can increment past headers).
2. **Preferred:** drop header items from `getSuggestions` entirely and render section labels as decorated DOM inserted into the `suggestion-container` as a sibling of each section's first item. Mirrors how Obsidian's own command palette handles section grouping. More invasive but correct.

**When to reconsider:** UX polish, or sooner if a first-time user gets confused picking the wrong row. Not blocking v1 usability.

**Origin:** Phase 3 manual testing, MT-009 Part C, 2026-04-14.

## FI-014: Terminal as a tabbed pane — native Obsidian chrome, not a chromeless dock
**Value we hope to achieve:** The terminal feels like any other Obsidian pane. You close it with the native X, drag it via its tab to reposition, split it with the `...` menu, rename it, and the visual chrome plays nicely with Obsidian's own editor chrome — no overlay collisions, no "where's the close button?", no lost geometry after a reopen. Today the terminal sits naked under `rootSplit` with no tab strip and no chrome of its own, so users discover the limits one by one (no close affordance, no drag handle, Obsidian's editor status overlay covering the bottom row of terminal text, default-height reset on every reopen). The frame is the feature — wrap the terminal in a proper tab container and the absent affordances stop being absent, because they come from Obsidian natively.

**What this includes (absorbs content previously in FI-003, FI-004, FI-006, FI-013):**

- **Native close affordance.** Today the terminal lives directly under `rootSplit` with no tab strip, so there's no X button and the view header's `...` menu is empty. Closing requires clicking the header (not the terminal body) and pressing Cmd-W — not discoverable. A tab strip gives the close X for free, along with the native right-click "Close" / "Close others" / "Close to the right" menu.
- **Native drag-to-reposition.** Today the terminal leaf has no grab handle. Users can drag notes onto the terminal's sibling slot and Obsidian splits vertically (MT-008 unexpected win — keep this behavior), but they can't proactively reposition the terminal itself. A tab is the natural drag target, and native Obsidian tab dragging routes through workspace APIs rather than raw HTML5 DnD — which sidesteps the Electron DnD flakiness called out in `testing-approach.md`.
- **Native height persistence.** Today the dock reopens at a fixed default height every time; manual resizes don't survive close/reopen. Normal tab groups inside `rootSplit` remember their geometry; a tab-hosted terminal inherits that.
- **Displacement of Obsidian's editor status overlay.** Today, when a note is open above the docked terminal, Obsidian renders a floating status widget (`0 backlinks / ✏ 0 words / 0 characters / sync indicator`) in the bottom-right of the editor pane. That overlay extends *past* the editor pane's geometric bottom and visually covers the last visible row of terminal text. It's a "us" problem, not an Obsidian problem: Obsidian assumes the bottom of the editor pane sits over editor whitespace, and the overshoot is fine when there's whitespace below; our terminal packs tight to the edge, so the overshoot lands on terminal text. A tab-framed terminal occupies vertical space differently (tab strip at the top, optional status bar at the bottom) and naturally displaces the overlay.

**Open design questions:**

- **Tab container vs. hand-rolled chrome.** Cleanest path: wrap the terminal leaf in a real Obsidian `WorkspaceTabs` container so it inherits every tab affordance natively. Alternative: hand-roll a header strip and status bar as custom view chrome. Tabs are strictly more native but require reverse-engineering the `WorkspaceTabs` API (undocumented, similar drift risk as `rootSplit.setDirection`). Custom chrome has no drift risk but re-implements every affordance by hand. Decide during a design spike.
- **Status bar at the bottom, in addition to or instead of?** Even with tabs at the top, a status bar at the bottom is worth considering — natural home for *current shell / cwd / tmux session name*, pushes the xterm render area up by its own height for cleaner overlay displacement, and is a place to surface things like [FI-020](#)-style degraded-mode indicators. tmux's own green status line still renders inside the xterm buffer at row N-1; two stacked status rows is OK if they convey different information (ours = plugin chrome, tmux's = inside-the-session state), but worth a deliberate spacing/contrast pass before shipping.
- **Multiple terminals in one tab group.** If the container is a real `WorkspaceTabs`, the plus-icon "New terminal" action could add a new tab to the same group rather than a sibling leaf under rootSplit. This changes the multi-instance UX from "stack of side-by-side panes" to "one pane with multiple tabs" — possibly better, worth prototyping.
- **Where does the `New terminal` plus action live?** Today it's in Obsidian's view header via `addAction`. With native tabs, it could stay there, move to our tab group's `+` slot, or appear only as a right-click tab option. Users who learned the current location may be surprised by a move.
- **Interaction with FI-012 (wrap-and-dock).** FI-012 wants to nest pre-existing rootSplit children inside a wrapper so they don't flatten when the terminal opens. FI-014's tab container does similar structural work (both wrap the terminal inside a new container under rootSplit). A single design spike probably answers both — sequence them together.
- **Alternative fixes for the overlay collision that we're NOT picking.** For the record: (1) CSS bottom padding on `.obsidian-terminal-view` sized to clear Obsidian's overlay is cheapest but the magic number rots and the padding is wasted vertical space when no note is open; (2) reaching into Obsidian's internal status overlay API to move or hide it is too invasive and drift-prone. Both were considered and rejected in favor of tab-based chrome that displaces the overlay structurally.

**Origin:** Feature-consolidation pass 2026-04-16, lifting content from FI-003 (Phase 3 manual testing, 2026-04-14), FI-004 (Phase 3 manual testing, 2026-04-14), FI-006 (Phase 3 manual testing, MT-008, 2026-04-14), and FI-013 (Phase 3.5 user smoke check, 2026-04-16). The four items surfaced independently during dogfooding and each read as isolated polish; grouping them surfaced the shared root cause — the terminal has no chrome of its own — and pointed at a single unifying feature (tab-style presence) that answers them all.

## FI-015: User-configurable plugin surface — a real Settings tab
**Value we hope to achieve:** Users shape the plugin to their workflow without editing code or raw plugin data. The shell they prefer, the additional shells installed in non-standard paths, the tmux dimension behavior on attach, the terminal theme, eventually the cross-platform Ctrl skip-list — all live behind a native Obsidian Settings tab where users expect them to be. Today the plugin hardcodes its opinionated defaults and hides even the one setting it does persist (`preserveTmuxDimensions` round-trips through `saveData` but never reaches the spawn path — a known Phase 3 gap). The first real user-configurable surface is the difference between "someone's tool" and "the user's tool."

**Initial scope candidates:**
- **Default shell selection + additional shells list.** Today the shell list comes from hardcoded discovery in `src/profiles/shell-discovery.ts`. Users with shells in non-standard paths can't extend it without editing code.
- **`preserveTmuxDimensions` toggle plumbed into the tmux attach spawn path.** The toggle round-trips through `saveData` today but `main.ts:openPicker`'s spawn-args construction never reads it — a known Phase 3 gap.
- **Theme overrides** if FI-016 ships a configurable model.
- **Tmux session naming format** (absorbs the previous FI-001). Today tmux assigns integer names (`0`, `1`, `2`) automatically when the picker launches a fresh session. The setting could let users pick a format — fixed prefix (`obsidian-1`, `obsidian-2`), timestamp (`obsidian-2026-04-14-17-32`), user-prompted at launch, or a template string with placeholders. Polish that matters once users have multiple sessions and want to find them later.
- **Future home for FI-011's cross-platform skip-list** when cross-platform support lands.
- **"Hide Anvil chrome" toggle** if FI-014 ships chrome some users want minimal.

**Constraints:**
- `TerminalBackend` interface MUST NOT be widened to plumb settings — use `TerminalView.setState`/`getState` with a typed launch spec, the working pattern from Phase 3.
- The `usingFallback` flag on `createBottomDock` is exposed but unused; settings work could surface it as a degraded-mode indicator, or remove it if it stays unused.

**Origin:** Original Phase 4 goal in the (now-superseded) meta-plan; Phase 3 wiring gap on `preserveTmuxDimensions`; feature-consolidation pass 2026-04-16. Tmux naming content lifted from FI-001 (Phase 3 planning, 2026-04-14) on 2026-04-16.

## FI-016: Visual cohesion — the terminal wears the user's Obsidian theme
**Value we hope to achieve:** The terminal looks like it belongs inside Obsidian. Dark mode, light mode, community themes — whatever the user has set, the terminal follows, and colors shift live when the theme changes (no restart, no jarring hardcoded grey against a customized note editor). Today `src/terminal/xterm-host.ts` paints a near-transparent background with hardcoded grey foreground and ignores Obsidian's CSS variables entirely — which is visually off in any non-default theme, even dark mode. Cohesion with the host app is the kind of thing users don't name but feel immediately.

**Scope:**
- Read Obsidian's CSS variables (`--background-primary`, `--text-normal`, and the accent palette) at xterm mount
- Map to xterm's `theme` object
- Re-render on theme change — trigger via Obsidian's `css-change` workspace event, a `MutationObserver` on `document.documentElement`, or polling on theme-class change (decide during implementation)

**Open design questions:**
- **ANSI 16-color palette.** Adopt Obsidian's accent colors, or pick a sensible terminal default (Solarized, Gruvbox, etc.) and let users override via FI-015?
- **Custom user themes.** Out of scope for this feature, but design the override surface so FI-015 settings can plumb per-user overrides later.

**Origin:** Original Phase 4 goal in the (now-superseded) meta-plan; Phase 2b "theme integration" note; feature-consolidation pass 2026-04-16.

## FI-017: Shippable release — anyone can install and run this
**Value we hope to achieve:** Someone with a GitHub link downloads a release, drops it into their plugins folder, enables it in Obsidian, and has a working terminal immediately. No `xattr` incantations to strip quarantine bits, no `cargo build --release`, no manual binary shuffling to get `bin/pty-server` alongside `main.js`. The plugin transitions from a dev-env artifact into a thing that has actual users.

**Open design questions:**

- **Codesigning.** Ship a signed and notarized `pty-server` binary (best UX, requires an Apple Developer account + notarization pipeline), OR document the `xattr -d com.apple.quarantine` workaround prominently in install docs (worst UX), OR auto-strip the quarantine bit on first run (gray area — works but feels sketchy).
- **Bundle layout.** `obsidian-launcher`'s default install path only copies `main.js` / `manifest.json` / `styles.css`; the Rust binary needs to travel alongside. Either verify Obsidian places `bin/pty-server` correctly after install (and pin that behavior as a test) or build a runtime fetch/extract fallback on first use.
- **Cargo dependency hygiene.** Dependabot/Renovate against `pty-server/Cargo.toml` still not set up per Phase 2a notes — should precede the first release.
- **Cross-platform.** Deliberately out of scope (FI-011) — this feature ships macOS arm64 only.

**Documentation pattern:** Strong candidate for an Explanation + ADR pair, mirroring the keyboard-handling pattern. The model has enough non-trivial moving parts (release artifact layout, Obsidian's plugin install behavior, macOS quarantine, runtime spawn fallback) that an ADR alone won't carry it. ADR records the decision; an Explanation under `docs/explanations/` walks the reader through the model.

**Origin:** Original Phase 4 goal in the (now-superseded) meta-plan; Phase 2a/2b notes; feature-consolidation pass 2026-04-16.

## FI-018: Trustworthy process hygiene — nothing leaks, ever
**Value we hope to achieve:** The user opens terminals, closes tabs, toggles the plugin, reloads Obsidian, force-quits Obsidian mid-session, comes back tomorrow — and at no point has a stale `pty-server` process, orphaned shell, or detached tmux client been quietly consuming resources. Today the happy paths are verified (closing a view kills the shell; disabling the plugin kills running `pty-server` instances) but the long tail is not. The feature is "we *know* this is clean" rather than "we hope this is clean" — a prerequisite for anyone other than Steve running this on their machine.

**Scope:**
- Audit cleanup under force-quit, plugin reload mid-session, Obsidian crash, `pty-server` crash, hung shells, and multi-terminal scenarios where one exits abnormally
- Add targeted fixes for any leak discovered
- Extend the Phase 2b e2e cleanup tests to cover the long tail where automatable; document the remaining manual-only scenarios in `manual-test-checklist.md`

**Origin:** Original Phase 4 success criterion ("no orphaned processes under any close/unload/quit scenario") in the (now-superseded) meta-plan; feature-consolidation pass 2026-04-16.

## FI-019: Clean resize — no double-fit, no layout flicker
**Value we hope to achieve:** Resizing the terminal pane reflows the xterm buffer exactly once — no visible double-fit jitter, no unnecessary work on every resize event. Today `TerminalView.onResize` triggers an xterm fit twice in some scenarios (flagged in Phase 1 notes, deliberately deferred in Phase 2b, still unaddressed). Small but visible polish; the kind of thing users notice in daily dogfooding even if they don't name it.

**Scope:** Identify the redundant fit call, remove it or document why it's load-bearing, and add a regression test if the fix turns out to be non-obvious.

**Origin:** Phase 1 notes; Phase 2b deferred; feature-consolidation pass 2026-04-16.

## FI-020: Current, audited dependencies — keep the harness in step with reality
**Value we hope to achieve:** The pinned tooling (`wdio-obsidian-service`, the Obsidian test binary, Cargo dependencies of `pty-server`) stays close enough to current upstream that the tests reflect real user conditions, not a frozen snapshot from pin-time. `CLAUDE.md` mandates checking at every phase kickoff and at minimum monthly; the cadence was agreed but the first audit pass has been deferred twice (Phase 3, Phase 3.5). This is the overdue kickoff; once done, the recurring cadence in `CLAUDE.md` takes over and this doesn't need its own backlog entry anymore.

**Scope:**
- `wdio-obsidian-service` version vs. current upstream — review changelog, bump or defer deliberately
- Obsidian test binary version vs. current Obsidian stable — aim for ~1 minor version of stable, lagging slightly is fine
- Set up Dependabot or Renovate against `pty-server/Cargo.toml` (still not configured per Phase 2a notes)
- Audit Obsidian internal API drift since the test binary was pinned. Three undocumented APIs live in production: `rootSplit.setDirection` and `workspace.createLeafInParent` have feature-detect fallbacks; `SuggestModal.chooser.setSelectedItem` silently degrades if it ever disappears.

**Origin:** `CLAUDE.md` cadence rule; Phase 3 deferral; Phase 3.5 notes; feature-consolidation pass 2026-04-16.
