# Manual Test Checklist

Tests that can't be meaningfully automated and must be run by a human against a real Obsidian install. Run the relevant section at the end of each phase and before every release. Record the date, result, and any notes so regressions and flakiness are visible over time.

Companion to `testing-approach.md` — that doc explains *how* we test, this one tracks *what was run by hand and when*.

## How to use this doc

- Each test has a stable ID (`MT-###`). Never renumber — if a test is retired, strike it but keep the row.
- Each time a test is run, add a row to its "Run log" with the date, Obsidian version, plugin version/commit, result, and any notes.
- If a test fails, open an issue / task referenced in the notes column. Don't just leave a ❌ with no follow-up.
- When a test graduates to automated coverage, mark it `Automated on YYYY-MM-DD` at the top of its entry and stop adding run rows.
- New manual tests get added as we find things the harness can't do honestly. Append them; don't renumber.

---

## Phase 2b — PTY backend and real shell

### MT-001: vim renders and handles input
**What:** Open the terminal, run `vim /tmp/mt001.txt`, type text, save, quit. Verify screen redraws cleanly, cursor tracks, Esc/`:wq` works.
**Why manual:** Full-screen TUI redraw is not meaningfully assertable through the xterm.js DOM in an e2e test.

| Date | Obsidian | Plugin | Result | Notes |
|---|---|---|---|---|
| 2026-04-14 | 1.12.7 | phase-2b | ✅ | Session handoff confirmed pass |

### MT-002: Ctrl-C interrupts a running process
**What:** Run `sleep 30`, press Ctrl-C, verify prompt returns immediately and exit code reflects SIGINT.
**Why manual:** Signal delivery through the PTY chain is easier to eyeball than to assert.

| Date | Obsidian | Plugin | Result | Notes |
|---|---|---|---|---|
| 2026-04-14 | 1.12.7 | phase-2b | ✅ | Session handoff confirmed pass |

### MT-003: Resize reflows the shell
**What:** Run `tput cols; tput lines`, resize the Obsidian window, run it again. Verify shell sees the new dimensions and that any running TUI reflows correctly.
**Why manual:** `onResize` has a double-fit quirk deferred to Phase 4; behavior is easier to judge visually.

| Date | Obsidian | Plugin | Result | Notes |
|---|---|---|---|---|
| 2026-04-14 | 1.12.7 | phase-2b | ✅ | Session handoff confirmed pass |

### MT-004: Shell cleanup on view close
**What:** Open terminal, note the shell PID, close the view, verify the PID is gone (`ps -p <pid>`). Repeat for several shells to rule out leaks.
**Why manual:** Process lifecycle assertions against the host OS are out of scope for the in-Obsidian e2e harness.

| Date | Obsidian | Plugin | Result | Notes |
|---|---|---|---|---|
| 2026-04-14 | 1.12.7 | phase-2b | ✅ | Session handoff confirmed pass |

---

## Phase 3 — Placement, profile picker, multi-instance

### MT-005: Bottom dock lands below editor area
**What:** Fresh workspace, one note open. Open terminal. Verify it appears as a full-width pane below the editor, native resize handle works, editor is not squished into a sidebar.
**Why manual:** Visual layout correctness is painful to assert in code and easy to eyeball.

| Date | Obsidian | Plugin | Result | Notes |
|---|---|---|---|---|
| 2026-04-14 | 1.12.7 | phase-3 `fe70d71` | ✅ | Terminal mounts as full-width pane below editor area as expected. |

### MT-006: rootSplit direction restores on close
**What:** Before opening terminal, note the `rootSplit` direction (should be `vertical`). Open terminal. Close terminal. Verify direction is back to `vertical` and layout is visibly unchanged.
**Why manual:** Covered by an e2e test too, but worth eyeballing on every Obsidian version bump since the API is undocumented.

| Date | Obsidian | Plugin | Result | Notes |
|---|---|---|---|---|
| 2026-04-14 | 1.12.7 | phase-3 `fe70d71` | ❌ STANDING REGRESSION — tracked as [FI-002](future-ideas-backlog.md) | Pre-existing vertical splits flatten on terminal open (expected per D1) but **do not visually restore on close** — children stay as rows even though `rootSplit.direction` property is set back. E2e has a blind spot: `bottom-dock.e2e.ts` only checks the direction property on an empty workspace, never exercises pre-existing splits. Decision: keep MT-006 as a standing manual regression, fix alongside [FI-002](future-ideas-backlog.md) when that's picked up. Related Phase 4 polish items surfaced during this run: [FI-003](future-ideas-backlog.md) (close affordance), [FI-004](future-ideas-backlog.md) (height persistence), [FI-005](future-ideas-backlog.md) (session persistence). |

### MT-007: Multi-column main area flatten + restore (UAT — flatten tradeoff judgment)
**What:** This is the test that decides whether the "flatten" default is actually acceptable or whether we need an escape hatch in Phase 4. Run it deliberately and record a subjective judgment, not just pass/fail.

**Trigger steps to reproduce the flatten:**
1. Fresh Obsidian window, sidebars in whatever state you normally use.
2. Open a note in the main editor area (note A).
3. Right-click note A's tab → **Split right** (or drag note B's tab to the right edge of note A). You should now see two notes side-by-side as columns in the main area.
4. Optionally repeat once more so you have **three** columns — worth seeing how a heavier layout flattens.
5. Observe the current layout carefully (take a mental snapshot or a screenshot).
6. Run the "Open terminal" command (or click the ribbon icon).
7. Observe: the side-by-side columns should now be **stacked as rows** (top-to-bottom), with the terminal appearing as a full-width row at the bottom.
8. Try typing in the terminal, scrolling one of the stacked editors, resizing the terminal dock vertically.
9. Close the terminal (close its leaf, or re-run the toggle command).
10. Observe: the columns should restore to their original side-by-side layout.

**What to judge (fill into Notes):**
- Does the flatten feel jarring, mildly annoying, or basically fine?
- Is the restore clean, or does it leave anything subtly different (focus, scroll position, which column was active)?
- Would you actually use this in a real multi-column workflow, or would you rather the terminal bail out to a different placement when columns exist?
- Any visible flicker, layout jump, or ordering surprise (e.g., the note you expected on top ends up on the bottom)?

**Why manual:** The test is subjective UX judgment, not a binary assertion. We want your actual reaction to the flatten — the code side can verify geometry, only you can decide if it feels right.

| Date | Obsidian | Plugin | Result | Notes |
|---|---|---|---|---|
| 2026-04-14 | 1.12.7 | phase-3 `fe70d71` | ✅ (subjective pass — D7 holds for the target user) | **Jarring but acceptable.** Flatten feels visually abrupt but tolerable. The restore gap ([FI-002](future-ideas-backlog.md)) does not break the use case for this plugin's intended audience — users who keep the terminal open continuously (e.g. running Claude Code alongside notes). For that workflow, the terminal placement is the priority and splits are secondary. Explicit rejection: do NOT add a bail-out-when-columns-exist escape hatch — terminal placement should win over note layout for this user archetype. D7 (flip blindly) stays. |

### MT-008: Drag a note tab onto the terminal dock
**What:** With terminal docked, drag a note tab from an editor tab group and drop it onto the terminal's container. Observe: does Obsidian wrap the terminal into a mixed tab group? Does the drop get rejected? Record the actual behavior.
**Why manual:** HTML5 drag-and-drop does not fire from WebDriver's synthetic mouse events. A JS-injection test can simulate the end-state but not the real drag interaction.

| Date | Obsidian | Plugin | Result | Notes |
|---|---|---|---|---|
| 2026-04-14 | 1.12.7 | phase-3 `fe70d71` | ✅ (no pollution) + unexpected win | Obsidian refuses to merge a note tab INTO the terminal leaf — no mixed tab group. Dropping a note directly onto the terminal pane swaps the two panes' positions (the note takes the dock slot, the terminal takes the note's slot). Dropping a note "beside" the terminal forces the terminal into a vertical split with the note as a sibling — which is actually desirable and gives a layout we thought we'd need to build explicitly later. **Limitation:** the terminal leaf itself cannot be dragged to reposition — no draggable handle. Logged as [FI-006](future-ideas-backlog.md) (draggable terminal leaf). |

### MT-009: Profile picker — first-time use and overall feel (UAT)
**What:** This is the UAT for the profile picker itself. The picker is the front door to the plugin — it's how you choose between "launch a fresh shell" and "attach to an existing tmux session," and it's how you pick *which* shell or *which* session. Run this test to see how it feels before you've learned it, then again after.

**What the picker is (so you know what you're judging):**
A modal that pops up in the middle of the Obsidian window when you run the "Open terminal" command. It looks similar to Obsidian's own quick switcher — a text input at the top, a scrollable list of options below. The list has **two visually separated sections**:
1. **Launch new** — one row per shell discovered on your machine (e.g. `zsh`, `bash`, `fish`, plus any you added in settings), plus a "**New tmux session**" row *if tmux is installed at all* (regardless of whether any sessions already exist).
2. **Attach to tmux session** — one row per currently-running tmux session. Only shown if tmux is installed **and** has ≥1 session. Hidden entirely when there's nothing to attach to.

The mental model is "new or existing" rather than "shell or tmux" — existing means tmux (the only thing you can attach to), and new can be either a raw shell or a fresh tmux session.

Typing in the input filters both sections by name. Arrow keys move the selection; Enter picks; Esc cancels.

**Trigger steps:**
1. First, confirm tmux is installed (`which tmux`) and kill any running sessions (`tmux kill-server` — ignore errors if none are running). Run the "Open terminal" command (from command palette, ribbon, or the hotkey you've bound).
2. Observe the picker modal. You should see the "Launch new" section containing your discovered shells **and** a "New tmux session" row. The "Attach to tmux session" section should **not** appear at all (no header, no empty-state row) because there's nothing to attach to.
3. Press Esc to cancel. Nothing should open.
4. Run the command again. Use arrow keys to move selection up and down — verify the highlighted row moves as expected.
5. Type a few characters of a shell name (e.g. `zs`) and verify the list filters.
6. Clear the filter, arrow-select your default shell, and press Enter. Verify a terminal opens in the bottom dock running that shell.
7. Close that terminal. Run the command again and this time select **"New tmux session"** from the Launch new section. Verify a fresh tmux session starts inside the terminal dock — you can confirm by running `tmux display-message -p '#S'` (it should show a default tmux-assigned name, or whatever we decide to name new sessions).
8. Close that terminal. From a regular external terminal, run `tmux new -d -s mt009-a` and `tmux new -d -s mt009-b` to create two named sessions.
9. Run the "Open terminal" command again. This time you should see **both** sections — "Launch new" (still containing shells + "New tmux session") on top, and "Attach to tmux session" below with `mt009-a` and `mt009-b`.
10. Type `mt009` and verify only the attach rows remain.
11. Arrow-select `mt009-a`, press Enter. Verify the terminal opens attached to that session — confirm with `tmux display-message -p '#S'` showing `mt009-a`.
12. Open a second terminal via the command, attach to `mt009-b`, and confirm it's a different session.
13. Run the command once more, type something that matches nothing (e.g. `xyzzy`), verify the list shows an empty state (or at minimum, pressing Enter doesn't pick anything unexpected).
14. Run the command one more time and press Esc to cancel mid-way — confirm no terminal is opened.

**What to judge (fill into Notes):**
- Is the modal easy to find and obvious how to use, without reading any docs?
- Is the two-section layout clear, or do the sections bleed together visually?
- Does filtering feel fast and predictable?
- When tmux isn't running, is the absence of the section obvious or confusing?
- Is there any friction you didn't expect? (wrong default selection, modal size, fuzzy-match weirdness, etc.)
- Would you want any command to **skip** the picker and launch the default shell directly? (Potential Phase 3 polish or Phase 4 setting.)

**Why manual:** Every automated test in the world can verify the list contains the right items, but only you can judge whether the picker actually feels good to use the first time you encounter it.

| Date | Obsidian | Plugin | Result | Notes |
|---|---|---|---|---|
| 2026-04-14 | 1.12.7 | phase-3 `fe70d71` + hotfixes | ✅ shell path + tmux new-session path. Attach path still to come in Part C. | Shell-picker path: picker opens as a quick-switcher-style modal, "Launch new" header + zsh/bash/sh rows, `zsh` marked `(default)`, no Attach section when tmux is absent. **D4 fix confirmed:** opened the picker without touching mouse or arrow keys, pressed Enter immediately, zsh launched — default row is genuinely pre-selected, not just visually badged. Filter works (`zs` narrows). Esc dismisses. **tmux installed, zero sessions:** after `brew install tmux` + relaunching Obsidian, "New tmux session" row appeared under shells as expected, no Attach section. **"New tmux session" launches real tmux:** verified `echo $TMUX` prints a non-empty socket path and `tmux display-message -p '#S'` prints an auto-assigned session name. Two bugs surfaced and fixed mid-test: (1) [FI-008](future-ideas-backlog.md) — tmux-discovery used a dynamic `await import("child_process")` that didn't resolve correctly through esbuild's external-bundle path, so the runner silently returned null and the picker never showed tmux rows even when tmux was on PATH. Fixed by switching to a static import matching `pty-backend.ts`. (2) [FI-009](future-ideas-backlog.md) — `TerminalView.onOpen` read its launch spec from `launchState` populated by `setState`, but Obsidian's view lifecycle does not guarantee `setState` fires before `onOpen`, so the spec was `{}` when the backend started and the view always fell through to `detectShell()` → zsh, regardless of what the picker chose. Fixed by adding a `plugin.pendingSpecs` WeakMap keyed by leaf, set synchronously before `leaf.setViewState`, consumed inside `onOpen`. |

### MT-010: tmux attach preserves or resizes correctly per setting
**What:** Start a tmux session outside Obsidian at a known size. Attach via picker. Verify the default setting (pane wins → tmux resized to match) actually resizes. Flip the setting, detach, re-attach, verify tmux dimensions are now preserved.
**Why manual:** tmux dimension assertions are doable in code but noisy; eyeballing is cheaper.

| Date | Obsidian | Plugin | Result | Notes |
|---|---|---|---|---|
| 2026-04-14 | 1.12.7 | phase-3 `fe70d71` + hotfixes | ⏸️ PARTIAL — resume later in session | **First half verified:** created detached tmux session at `200x50`, attached via Obsidian picker, confirmed the window was resized to match the Obsidian pane ("pane wins" default behavior is correct — setting OFF, session resizes to pane). **Second half deferred:** toggling "Preserve tmux session dimensions on attach" ON and re-attaching was not run — the known Phase 4 gap (setting persisted but not yet consumed by the spawn path) is already tracked in `phase-3-completion.md`. User wants to return to this before closing the session. Gotcha noted: `#{session_width}/#{session_height}` are empty for detached sessions — use `#{window_width}/#{window_height}` from `tmux list-windows -t <name>` to check dimensions without attaching. |

### MT-011: Graceful degradation when tmux is missing
**What:** On a machine without tmux (or with `PATH` mangled to hide it — e.g. launch Obsidian from a shell where `PATH=/usr/bin:/bin` and tmux isn't on it), run the picker. Verify the "Launch new" section shows **only** discovered shells — the "New tmux session" row should **not** appear, and no "Attach to tmux session" section should render either. No error notice, no broken modal.
**Why manual:** Requires environment manipulation the e2e harness doesn't handle cleanly. Also distinguishes between "tmux installed, zero sessions" (New tmux session row should appear) and "tmux not installed at all" (no tmux-related rows anywhere) — a common source of off-by-one UX bugs.

| Date | Obsidian | Plugin | Result | Notes |
|---|---|---|---|---|
| 2026-04-14 | 1.12.7 | phase-3 `fe70d71` | ✅ | `which tmux` returned "command not found" on this machine. Picker opened with only the Launch new section and the three discovered shells (zsh / bash / sh). No "New tmux session" row, no Attach section, no error banner, no Obsidian Notice. Degradation is clean — the picker looks identical to any other tmux-absent machine. |

### MT-012: Multi-instance independence
**What:** Open two terminals. Run a long-running command in one (`tail -f /var/log/system.log`). Type in the other, resize the other, close the other. Verify the first is completely undisturbed.
**Why manual:** Covered by an e2e test against `MockBackend`, but worth verifying with real PTYs too.

| Date | Obsidian | Plugin | Result | Notes |
|---|---|---|---|---|
| 2026-04-14 | 1.12.7 | phase-3 `fe70d71` | ✅ for multi-instance isolation, but **uncovered showstopper** for Ctrl-C → see [FI-007](future-ideas-backlog.md) | Plus-icon opens terminal B alongside terminal A. `echo AAA` / `echo BBB` each only appear in their own pane. `tail -f /var/log/system.log` in A kept streaming undisturbed while typing + running commands in B. Closing B left A running the tail untouched — multi-instance isolation genuinely works. **However:** ran into a cross-cutting severe regression while trying to stop the tail — **Ctrl-C does not reach the PTY from a real keypress**. `^C` is never echoed in any terminal, no SIGINT, processes can't be interrupted from the keyboard. This is not an MT-012 failure (multi-instance is fine) but it invalidates MT-002's Phase 2b ✅ which was never actually verified with a real keypress. Root cause: the `TerminalView` scope intercepts all `Ctrl`-modifier keys in Obsidian's capture-phase document listener before they can reach xterm's textarea keydown handler. Phase 2b e2e cheated by calling `backend.write("\x03")` directly; `plugin.e2e.ts` only verified "Ctrl-C doesn't leak to Obsidian" without also checking "xterm did see it". Tracked as [FI-007](future-ideas-backlog.md). Phase 3.5 fix scheduled after the remaining manual tests complete. |

---

## Template for new entries

```markdown
### MT-###: Short title
**What:** Concrete steps a human runs, written so someone unfamiliar with the phase can execute them.
**Why manual:** One sentence on why this isn't automated (harness limitation, visual judgment, OS-level state, etc.). If the reason ever goes away, graduate it to automated.

| Date | Obsidian | Plugin | Result | Notes |
|---|---|---|---|---|
```
