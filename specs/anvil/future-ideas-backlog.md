# Future Ideas Backlog

Ideas that came up during planning or execution but were deliberately deferred. Not a TODO list — more of a "we saw it, made a call, and moved on" record. Revisit when a phase is looking for small wins, or when one of these blocks something real.

Rules:
- Each entry has a stable ID so conversations can reference it (`FI-###`).
- Each entry records *what*, *why deferred*, and *when to reconsider*. Not a spec.
- If an item is picked up, move it to the relevant phase spec and strike it here (keep the row for history).
- Append only; don't renumber.

---

## ~~FI-002: rootSplit children reorientation on dock close~~ — CLOSED, INVALID
**What was reported:** When the bottom dock closes, pre-existing children stay as rows instead of restoring to columns.

**What actually happens:** The restore DOES work. Pre-existing columns flatten to rows while the terminal is docked (expected per D1/D7), and return to side-by-side columns when the terminal closes. The original MT-006 finding was a miscommunication: the user was asking about the flatten-while-open behavior (which is expected and already covered by MT-007's subjective acceptance), not about the restore being broken. Confirmed by the user on 2026-04-16.

**Why the e2e kept passing:** Because there was no bug. The `bottom-dock.e2e.ts` pre-split restore test passes because the restore genuinely works.

**Origin:** Phase 3 manual testing, 2026-04-14. Closed 2026-04-16 after clarification.

## FI-012: Wrap-and-dock — avoid the flatten entirely by nesting existing children
**What:** Instead of flipping `rootSplit.direction` on dock open (which flattens pre-existing columns into rows), wrap all existing rootSplit children into a new intermediate `WorkspaceSplit` with the original direction, then set rootSplit to horizontal, and add the terminal as a sibling of the wrapper. Result: columns stay as columns inside the wrapper, terminal docks below as a full-width row. No flatten at all.

**Proof of concept:** Confirmed during Phase 3 manual testing on 2026-04-16. With rootSplit already horizontal (terminal docked), the user clicked "Split" on a note — Obsidian's own split command automatically created a nested vertical `WorkspaceSplit` wrapper, giving exactly the desired layout: two note columns side-by-side on top, full-width terminal below. Screenshot captured. Obsidian already knows how to create and manage these nested splits; the question is what internal API call triggers the wrapping and whether we can invoke it programmatically.

**Investigation needed:** Determine how to programmatically create a `WorkspaceSplit` and reparent existing children into it. Candidates: `rootSplit.createSplit()`, manual child reparenting via the workspace internals, or reverse-engineering what `workspace:split-vertical` does under the hood. A short spike against the Obsidian 1.12.7 binary should surface the API.

**On close:** Move children back from wrapper to rootSplit, remove the empty wrapper, restore rootSplit direction. Inverse of the open path.

**Why deferred:** Current "flip blindly" approach works and was accepted (MT-007: "jarring but acceptable" for the always-on-terminal use case). This improvement eliminates the "jarring" entirely, which is strictly better UX, but requires an API investigation spike that's out of scope for Phase 3.5's tight focus on FI-007.

**When to reconsider:** Phase 4 polish, specifically alongside FI-003 (close affordance) and FI-004 (height persistence) — the three together would make the dock feel production-grade.

**Origin:** Phase 3 manual testing follow-up discussion, 2026-04-16.

## FI-003: Close affordance on bottom dock leaf
**What:** The terminal view lives directly under `rootSplit` with no tab strip, so it has no X button or visible close option. The view header's `...` menu is also empty. Closing the dock requires clicking the header (not the terminal body), then Cmd-W. Needs a dedicated close button or a `...`-menu item so the close path is discoverable.

**Why deferred:** Cosmetic + discoverability polish, not a blocker for v1. Keyboard close works once you know the trick.

**When to reconsider:** Phase 4 polish pass, or sooner if a user asks "how do I close the terminal" unprompted.

**Origin:** Phase 3 manual testing, 2026-04-14.

## FI-004: Terminal dock height persistence
**What:** The terminal dock reopens at a fixed default height every time — manual resizes don't persist across close/reopen. Save the last-used height to plugin data and restore it on next open.

**Why deferred:** v1 behavior treats each dock open as fresh. Persistence is a small-effort polish but wasn't spec'd.

**When to reconsider:** Phase 4, alongside the settings surface growth.

**Origin:** Phase 3 manual testing, 2026-04-14.

## FI-005: Persistent terminal session across close/reopen
**What:** Closing the terminal leaf kills the shell PTY and drops all scrollback/history. Reopening yields a fresh shell. A "hide instead of close" mode — or a tmux-backed persistence layer — would let the user detach the dock visually without losing their session.

**Why deferred:** Correct v1 behavior (close = detach leaf = kill child). tmux attach already covers the "I want persistence" use case from a different angle. But for non-tmux users it's a real papercut.

**When to reconsider:** Phase 4 or later. Might motivate a "toggle dock visibility" command distinct from "close terminal."

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

**When to reconsider:** Whenever cross-platform support re-enters the meta-plan. At that point, Phase 3.5's FI-007 fix will need to be revisited as part of the keyboard-model redesign — probably as a single slice inside whatever "cross-platform adaptation" phase ends up owning the port. Don't reopen it until then.

**What Phase 3.5 should do about this today:** Nothing in the code. The macOS-only fix is the right fix for the macOS-only plugin. This entry exists so the next person to tackle cross-platform doesn't hit the scope rewrite cold and have to rediscover the design.

**Origin:** Phase 3.5 planning conversation, 2026-04-15.

## FI-010: Picker section headers render indistinguishably from selectable rows
**What:** `ProfilePickerModal` renders "Launch new" and "Attach to tmux session" as `kind: "header"` PickerItems in the same `SuggestModal` list as the actual selectable rows. Visually they look identical to the shell and session rows, and arrow-key navigation lands on them (the `onChooseSuggestion` handler routes header picks to `this.open()` as a reset, which is a hack). Users can't tell at a glance which rows are interactive.

**Why deferred:** Functional; cosmetic + discoverability polish. The underlying data model already tags headers distinctly, so the fix is isolated to `renderSuggestion` + CSS + arrow-key skip logic.

**Fix candidates:**
1. CSS in `styles.css`: give `.anvil-picker-header` a muted background, smaller font, uppercase section-label styling, and `pointer-events: none` on hover so it doesn't look clickable. Pair with an arrow-navigation hook that skips header rows (Obsidian's chooser exposes `chooser.setSelectedItem` — we can increment past headers).
2. **Preferred:** drop header items from `getSuggestions` entirely and render section labels as decorated DOM inserted into the `suggestion-container` as a sibling of each section's first item. Mirrors how Obsidian's own command palette handles section grouping. More invasive but correct.

**When to reconsider:** Phase 4 UX polish, or sooner if a first-time user gets confused picking the wrong row. Not blocking v1 usability.

**Origin:** Phase 3 manual testing, MT-009 Part C, 2026-04-14.

## FI-008: tmux-discovery dynamic `import("child_process")` silently broken — FIXED MID-PHASE-3
**What:** `createSystemTmuxRunner` in `src/profiles/tmux-discovery.ts` used `await import("child_process")` inside its `which` and `listSessions` methods. Under esbuild's CommonJS output with `child_process` marked external (via `...builtins`), the dynamic import did not actually return the node module — the returned object's `.spawn` was not a callable. `which tmux` silently failed, returning null, so the picker always reported `installed: false` and never rendered tmux rows, even on machines where tmux was fully installed and on PATH.

**How it was caught:** Manual test MT-009 Part B on 2026-04-14. User had just `brew install tmux`'d on a machine where tmux was definitely resolvable and the Obsidian process PATH included `/opt/homebrew/bin`, yet the picker still showed only shells.

**Fix:** Switched to a static `import { spawn } from "child_process"` at the top of `tmux-discovery.ts`, matching `pty-backend.ts`. No unit test change needed — the pure tests inject a `TmuxRunner` fake and never hit the system path, which is why this bug was invisible to Vitest.

**Follow-up test coverage gap:** We had no end-to-end coverage that exercised the real `createSystemTmuxRunner` against an actual shell, in either unit or e2e form. Consider a lightweight integration test that stubs `child_process.spawn` at the module level and asserts `createSystemTmuxRunner()` produces the expected shape against known fake process output.

**Origin:** Phase 3 manual testing, MT-009 Part B, 2026-04-14. Fixed in-session before completing the remaining manual tests.

## FI-009: TerminalView launch spec needed a pending-map because `setState` vs `onOpen` order is undefined — FIXED MID-PHASE-3
**What:** Slice 8 wired per-leaf launch specs through `leaf.setViewState({state: {shell, shellArgs, cwd}})`, and `TerminalView.setState` dutifully stored the parsed fields into a `launchState` field for `onOpen` to read when it constructed the `PtyBackend`. In practice, Obsidian's view lifecycle does not guarantee `setState` fires before `onOpen`. For the tmux-new-session case specifically, `onOpen` ran with an empty `launchState`, fell through to `detectShell()`, and launched the user's default `zsh` instead of spawning `tmux new-session`. Every terminal looked like a plain shell regardless of what the picker dispatched.

**How it was caught:** Same MT-009 Part B test run as FI-008. After fixing tmux-discovery, "New tmux session" still produced a normal zsh prompt with no tmux server running (`tmux display-message` reported "error connecting to /private/tmp/tmux-501/default"). Root cause narrowed down to the `setState` / `onOpen` ordering assumption.

**Fix:** Added a `pendingSpecs: WeakMap<WorkspaceLeaf, TerminalLaunchSpec>` field on the plugin. `openTerminalWithSpec` populates the map **synchronously** before calling `leaf.setViewState`, and `TerminalView.onOpen` consumes from it (via `plugin.consumePendingSpec(this.leaf)`) as its first source of truth. Persisted layouts still fall back to `launchState` from `setState`, and bare opens still fall back to `detectShell()`.

**Follow-up test coverage gap:** E2e should assert that `new-tmux` dispatches really do start tmux, not just open a terminal. The existing `picker.e2e.ts` only verifies the modal renders — it doesn't follow through on a selection and verify the resulting backend's shell/argv. This is exactly the category of bug that slipped through: unit tests covered the pure dispatch logic, e2e covered "command opens modal", but nobody covered "picker selection → correct backend spawn". Write an e2e that executes the picker programmatically, dispatches a known choice, and asserts the running pty-server's argv matches.

**Origin:** Phase 3 manual testing, MT-009 Part B, 2026-04-14. Fixed in-session.

## FI-007: Ctrl-C (and other Ctrl-modifier keys) blocked from reaching the PTY — SEVERE, Phase 3.5
**What:** Real physical Ctrl-C keypresses do not reach the PTY. The terminal never echoes `^C`, no SIGINT is sent, running processes can't be interrupted from the keyboard. Typing plain letters works, so the xterm.js input path is not broken — only Ctrl-modifier keys are blocked.

**Root cause (hypothesis to validate during fix):** `TerminalView.onOpen` registers a catch-all scope that swallows every `["Ctrl", ...]` / `["Ctrl", "Shift", ...]` / etc. combination via `scope.register([...mods], null, () => false)`. Obsidian's keymap system listens for keydown events in the **capture phase** on `document`. When the user presses Ctrl-C inside the focused xterm textarea, the event fires at document capture first, Obsidian's scope handler matches it and returns `false` (handled), which triggers `preventDefault + stopPropagation`. The event never reaches xterm's own keydown listener on the textarea, so xterm never writes `\x03` to the PTY via `backend.write`. The fix needs to let xterm process the key first (so it can emit the control byte) while still preventing Obsidian's global hotkeys from firing.

**Why it slipped through:**
- `tests/e2e/pty-backend.e2e.ts:135` — "Ctrl-C interrupts a long-running program" test **does not use the keyboard pipeline**. It calls `backend.write("\x03")` directly, verifying only the byte → PTY → SIGINT half of the path. A comment in the test even admits: *"Tests the backend → PTY → signal path without depending on browser.keys' modifier handling, which is unreliable across WebDriver versions."* That was a Phase 2b shortcut that shipped a false-positive test.
- `tests/e2e/plugin.e2e.ts` — "Ctrl-C does NOT leak to Obsidian" test dispatches a synthetic `KeyboardEvent` on the xterm textarea and asserts a document-level probe doesn't see it. It verifies the scope swallow works but **never asserts that xterm actually received the keydown first**. The test only covered half the contract.
- `manual-test-checklist.md` MT-002 is marked ✅ for Phase 2b but the mark was almost certainly never end-to-end verified with a real keypress against a running process. Honest re-check required.

**Severity:** Showstopper for real use. A terminal that can't SIGINT is unusable for the plugin's core use case (running Claude Code, shell commands that might hang, any iterative debugging workflow).

**Bundled discovery from MT-009 Part C:** Cmd-P also doesn't work inside the terminal — same catch-all scope blocks the command palette. This clarifies the correct fix model:
- **Cmd-modified keys** should fall through to Obsidian (command palette, tab switching, split commands, etc. — the shell almost never wants Cmd).
- **Ctrl-modified keys** should reach the shell (SIGINT, word-delete, Ctrl-R history search, vim/htop/less bindings, Claude Code's Ctrl-R continuation, etc. — Obsidian's Ctrl bindings are rare on macOS and can be overridden per-user).
The current Phase 2b scope was symmetric (`Mod` and `Ctrl` both swallowed) which broke both paths. The fix should be asymmetric.

**Plan (Phase 3.5 slice):**
1. Add failing e2e tests:
   - `browser.keys(["Control", "c"])` after starting `sleep 30`, assert the shell prompt returns — the genuine keyboard path for SIGINT.
   - `browser.keys(["Meta", "p"])` while focused inside the terminal, assert Obsidian's command palette modal opens.
2. Update `plugin.e2e.ts`'s "doesn't leak to Obsidian" test: the "doesn't leak" contract is wrong in spirit — we want **Ctrl** keys to not leak, but **Cmd** keys should leak. Rename + split into two tests that assert the correct per-modifier behavior and actually verify xterm received the keydown in the Ctrl case.
3. Fix `TerminalView`'s scope handling:
   - Drop the `Mod` (Cmd) registrations from the terminal scope entirely — let them fall through to Obsidian normally.
   - Keep `Ctrl`-modifier registrations, but instead of returning `false` from a no-op handler (which preventDefault/stopPropagation at capture phase and hides the event from xterm), install a narrow container-level capture listener that calls `stopPropagation` (so Obsidian's document-level handler doesn't see it) without `preventDefault` (so xterm still processes in target phase).
   - Or: remove the Obsidian scope entirely and rely on xterm's own `preventDefault` — but verify Obsidian's handler runs in bubble phase first via an empirical test.
4. Re-verify MT-002 honestly and unmark the Phase 2b ✅ if it never actually worked.

**When:** Immediately after Phase 3's remaining manual tests (MT-009 tmux path + MT-010) complete. User will `brew install tmux`, finish those, then we cut a Phase 3.5 slice for this.

**Origin:** Phase 3 manual testing, MT-012, 2026-04-14.

## FI-006: Draggable terminal leaf
**What:** The terminal leaf itself can't be grabbed and dragged around. Note tabs can be dragged onto the terminal's sibling slot and that correctly puts the terminal into a vertical split (unexpected win found during MT-008), but the terminal has no draggable handle of its own, so the user can't proactively reposition it. Add a drag affordance (the header bar should be the grab target) so users can explicitly move the terminal between dock positions / split modes.

**Why deferred:** Discovered during Phase 3 manual testing. The existing note-drag-onto-sibling path covers the most important case (vertical split on demand), so it's polish, not a blocker.

**When to reconsider:** Phase 4, once the placement model is being dogfooded and users want more control over layout.

**Origin:** Phase 3 manual testing, MT-008, 2026-04-14.

## FI-001: Configurable tmux session naming
**What:** When launching a fresh tmux session via the profile picker, let users configure the session name format instead of relying on tmux's auto-assigned integer names. Candidates: fixed prefix (`obsidian-1`, `obsidian-2`), timestamp (`obsidian-2026-04-14-17-32`), user-prompted, template string with placeholders.

**Why deferred:** Phase 3 ships with tmux auto-assigned names because it's zero code and "just works" for the first-use case. Naming is a polish item that matters more once users have many sessions and want to find them later.

**When to reconsider:** When Steve (or a user) complains about tmux session names being unhelpful, or when tmux session management grows a "rename" or "list with metadata" feature. Likely Phase 4 settings work or later.

**Origin:** Phase 3 planning session, 2026-04-14.

## FI-013: Obsidian editor status overlay covers terminal's bottom line
**What:** When a note is open in the editor area above the docked terminal, Obsidian renders a floating status overlay in the bottom-right corner of the editor pane (`0 backlinks / ✏ 0 words / 0 characters / sync indicator`). That overlay extends down past the editor pane's geometric bottom and visually covers the **last visible row** of terminal text below it. Typing wraps fine because xterm itself sees the full pane height — only the rendering is occluded. With no note open, the overlay disappears and the terminal looks correct.

**Why this is a us problem, not an Obsidian problem:** Obsidian assumes the bottom of the editor pane is over content the user is actively editing — letting the overlay extend slightly past the geometric bottom is fine when there's editor whitespace below. Our terminal is rendered tightly to the pane bottom (xterm rows pack right up against the edge), so the overlay's overshoot lands on top of the last terminal row instead of empty space.

**Fix candidates:**
1. **Bottom padding on `.obsidian-terminal-view`.** Reserve ~24–32px at the bottom of the terminal container via CSS, sized to clear Obsidian's overlay. Cheapest, but the magic number will rot if Obsidian's overlay grows or moves, and the padding is wasted vertical space when no note is open. Could be conditioned on whether the editor pane is a sibling, but that's brittle layout introspection.
2. **Anvil status bar at the bottom of the terminal.** Render our own thin status row at the bottom of the terminal pane (e.g. shell name + cwd, or session info for tmux). Pushes xterm's render area up by the status bar's height, so Obsidian's overlay lands on our chrome instead of terminal text. Doubles as a place for future affordances ([FI-003](future-ideas-backlog.md) close button, profile/session label, sync state). **Tmux interaction:** tmux ships its own green status line at row N-1 by default — stacking would mean two status rows, ours from the plugin (chrome) and tmux's from inside the PTY (content). Probably fine because they convey different information (ours = Obsidian/plugin chrome, tmux's = inside-the-session state), but worth a deliberate look at the spacing/contrast before shipping.
3. **Move/hide the Obsidian overlay when a terminal is the bottom dock.** Reach into Obsidian's status overlay via internal API and either suppress it or shift it up while the dock is open. Most invasive, depends on undocumented internals, easiest to break on Obsidian updates. Probably not worth it.

**Why deferred:** Cosmetic — typed input, scrollback, and shell behavior are all unaffected. The user can also scroll up one line to see the obscured row. Not a blocker for v1 use; lands naturally with Phase 4 polish.

**When to reconsider:** Phase 4 polish, alongside [FI-003](future-ideas-backlog.md) (close affordance) and [FI-004](future-ideas-backlog.md) (height persistence). If we go with candidate 2 (status bar) it likely absorbs FI-003's close button as well — worth deciding both together.

**Origin:** Phase 3.5 user manual smoke check, 2026-04-16. Screenshot in conversation.
