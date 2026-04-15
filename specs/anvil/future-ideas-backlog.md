# Future Ideas Backlog

Ideas that came up during planning or execution but were deliberately deferred. Not a TODO list — more of a "we saw it, made a call, and moved on" record. Revisit when a phase is looking for small wins, or when one of these blocks something real.

Rules:
- Each entry has a stable ID so conversations can reference it (`FI-###`).
- Each entry records *what*, *why deferred*, and *when to reconsider*. Not a spec.
- If an item is picked up, move it to the relevant phase spec and strike it here (keep the row for history).
- Append only; don't renumber.

---

## FI-002: rootSplit children reorientation on dock close
**What:** When the bottom dock closes, restore not just `rootSplit.direction` but the visual layout of pre-existing children. Today `setDirection(original)` flips the property back without reorienting the children that were flattened on open, so a workspace that started with `[Note A | Note B]` columns stays stuck as `[Note A / Note B]` rows after the terminal closes. New splits after close behave correctly (the direction property is right), but existing splits don't reflow.

**Why deferred:** Surfaced at the end of Phase 3 via MT-006 manual test. Fix needs investigation — the `identity16/obsidian-terminal` reference we copied either has the same bug or has children-reorientation logic we missed. The proper fix also needs a stronger e2e: pre-split the workspace, snapshot layout, open+close terminal, assert the layout matches. `tests/e2e/bottom-dock.e2e.ts` currently does a property-only check against an empty workspace, which is why this slipped through.

**Workaround today:** Users can manually re-split after closing the terminal. Not great, but bounded.

**When to reconsider:** Phase 4 polish, or sooner if a dogfooding user with a real multi-column workflow finds it intolerable. Treat MT-006 as a standing manual regression until the fix ships.

**Origin:** Phase 3 manual testing, 2026-04-14. User found it immediately on the first real multi-column test.

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
