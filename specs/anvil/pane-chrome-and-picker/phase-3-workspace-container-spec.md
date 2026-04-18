# Phase 3 — Workspace Container Implementation

Implements ADR 0006 (Rank 3) into `src/`: one `ItemView` container leaf hosting N xterm instances with plugin-drawn chrome. Phase 2's Parts 1+2 produced the ADR, the prototype, and automated R8 probes; this phase ports the design into production and removes the single-leaf `TerminalView`.

Parent meta-plan: [meta-plan.md](meta-plan.md).
Decision record: [docs/adr/0006-workspace-container.md](../../docs/adr/0006-workspace-container.md).
Load-bearing guidance: [phase-2-lessons.md](phase-2-lessons.md). Read this before writing code.

## Objective

Apply ADR 0006's Rank 3 design to `src/`: replace the single-leaf `TerminalView` with a container `ItemView` that multiplexes N xterm instances inside one leaf, with plugin-drawn chrome (tab strip with per-tab close X, view-header `+` action, reserved empty bottom buffer) and the load-bearing R8 mitigations (`createLeafInParent` placement, `view.navigation = false`). Old `TerminalView` removed by end of phase; throwaway prototype deleted.

## Decisions (resolved 2026-04-17)

1. **FI-012 (rootSplit-flatten fix): IN with kill-switch. [RESOLVED]** Phase 3 begins with a short API-investigation spike — find a reliable way to reparent existing rootSplit children into a new nested `WorkspaceSplit` before docking the container, so side-by-side note columns aren't flattened on open. If the spike surfaces a usable API path against Obsidian 1.12.7, implement FI-012 in Phase 3. If the spike hits a dead end (no sanctioned or reliably feature-detectable API), cut FI-012 from Phase 3, surface the finding explicitly in the completion report, and leave FI-012 in the backlog. Do NOT force a hacky path to keep it in scope — the kill-switch exists to prevent schedule/quality risk from a bad API.

2. **`+` affordance location: view-header action (unchanged from today). [RESOLVED]** The current `addAction("plus", ...)` pattern on the `TerminalView` ports to the container view. The container does NOT add a separate tab-strip `+`. Revisit if dogfooding asks.

3. **Bottom buffer strip: IN as empty chrome. [RESOLVED]** The container reserves a thin strip at its bottom, styled as chrome (same background token as the tab strip / container surround). It holds no content in Phase 3 — its job is geometric: guarantee the xterm render area ends above where Obsidian's editor status overlay can overshoot. Future FI populates it with shell/cwd/tmux info. No-overlap is a hard acceptance criterion (see AC7).

## Requirements

### View class + registration

- New class extending `ItemView`, e.g. `TerminalContainerView`, registered with a stable view type string distinct from `obsidian-terminal-view`.
- `view.navigation = false` on the class (load-bearing R8a mitigation).
- Do NOT set `setPinned(true)`. ADR records why; don't re-add.

### Placement

- Container leaf placed via `workspace.createLeafInParent(rootSplit, rootSplit.children.length)` with `rootSplit.direction = "horizontal"` — mirror the existing idiom at `src/dock/bottom-dock.ts:44–77`.
- Feature-detect `createLeafInParent`; fallback to `workspace.getLeaf("split", "horizontal")` with a one-time console warning noting degraded isolation. Never throw.

### Tab management

- Methods on the container view: `addTab(spec)`, `switchTab(id)`, `closeTab(id)`.
- Tab data shape owns: xterm host, PTY backend, contentEl, tab-strip button/DOM, id, label.
- **Single `switchTab` method** atomically: mark incoming active, toggle `display` across sibling contentEls, call `host.fit()` + `host.focus()` on incoming (inside `requestAnimationFrame`), update active-tab pointer.
- **xterm lifecycle invariant:** never dispose an xterm on tab switch. Only `display: none` on the inactive pane.
- Per-tab close X visible and clickable without keyboard fallback.
- `+` affordance lives in Obsidian's view-header via `addAction("plus", "New terminal", ...)` — same pattern as today's `TerminalView` (`src/view/TerminalView.ts:30–33`). The callback invokes `addTab` on the container. No tab-strip `+`.

### Bottom buffer strip

- Container DOM ends with a reserved strip below the xterm mount, styled as chrome with `--background-secondary` (or the equivalent theme token) — same visual weight as the rest of the container frame.
- Empty in Phase 3: no text, no controls. Purely geometric.
- Height chosen so Obsidian's editor status overlay never overshoots into the xterm render area. If a fixed height doesn't reliably clear it across themes, make the height reactive to the overlay's computed bottom. Either is acceptable so long as AC7 holds.
- Not populated with shell/cwd/tmux info in Phase 3 — future FI decides content.

### Integration seam

- `src/main.ts`'s `getDock()` returns the container leaf (creating it if absent). `openTerminalWithSpec(spec)` calls a method on the container view (e.g. `container.addTab(spec)`) rather than `dock.openLeaf()` + `leaf.setViewState`.
- `BottomDock` collapses to single-leaf semantics. `reconcileDock` becomes "is the container leaf open? yes/no."
- `pendingSpecs` WeakMap + `consumePendingSpec` pattern can be retired if `addTab` takes the spec directly.

### Restart behaviour

- Tab specs are NOT persisted across Obsidian close/reopen. Matches VS Code: a restart gives you a fresh terminal, not a replay of your prior session.
- Obsidian's layout save still records that the container leaf existed. On reopen, the container is reconstructed with **one blank terminal** (the plugin's default shell) so the leaf isn't visibly empty. If the container was not open when Obsidian closed, it is not there on reopen.
- Same behaviour applies to all view-reconstruction paths (workspace-plugin layout switch, popout). The PTY architecture cannot meaningfully preserve shell sessions across any of these boundaries — the renderer-bound `pty-server` child process is torn down with the old view.
- FI-005 (cross-session scrollback persistence) remains separate and out of scope.

### Chrome styling

- Hand-authored CSS in `src/styles.css`. Obsidian theme tokens only (`--background-secondary`, `--text-muted`, etc.) — no hardcoded colors, no magic numbers; name or token any size.

### Reuse, don't refactor

- `PtyBackend` and `XtermHost` used as-is. No refactor of either in this phase.
- Port *ideas* from `specs/anvil/pane-chrome-and-picker/phase-2-prototype/container-view.ts`, not code — the prototype is being deleted.

### Vocabulary discipline

- "Tab" in this codebase means in-container tab. Never `WorkspaceTabs`, never `WorkspaceLeaf`. Pick a type name (e.g., `TerminalTab`) and enforce at review.

### Migration strategy

- Register the new container view alongside the old `TerminalView` for the cutover window. Switch `openTerminalWithSpec` to target the container in one PR; delete the old `TerminalView` + view type + `reconcileDock` residue in a follow-up PR so the migration is bisectable. Execution-time detail — agent decides PR granularity, but the container-then-delete sequence is load-bearing.

### E2E coverage

- Rewrite `tests/e2e/tab-isolation.e2e.ts` for the container view type.
- Port R8a–R8e from `specs/anvil/pane-chrome-and-picker/phase-2-prototype/r8.e2e.ts` before deleting the prototype.
- R8e is the regression-pin assertion (explicit `setViewState` clobber replaces the container — documented, not fixed).
- Add coverage for: multi-tab open (one container, N tabs), tab switching preserves idle tab's PTY.

### Documentation updates

- `docs/explanations/third-party-plugin-compatibility.md` — strip the "once the multi-terminal container ships" hedges; replace `obsidian-terminal-view` body-copy references with the new container view type.

### FI-012 spike (gated)

Phase 3 **starts** with an API-investigation spike for FI-012 (wrap-and-dock — prevent rootSplit flatten on open). Time-box ≤ 1 day. Goals:

- Find a reliable, feature-detectable API path to reparent pre-existing rootSplit children into a new nested `WorkspaceSplit` matching the original `rootSplit.direction`, then dock the terminal container as a full-width sibling of that wrapper. On close, reverse: unwrap children back onto rootSplit, remove the empty wrapper, restore direction.
- Candidate APIs named in FI-012 entry (`rootSplit.createSplit()`, manual child reparenting, or reverse-engineering `workspace:split-vertical`'s implementation) — or any other surface that surfaces during investigation.
- Must run green against the pinned Obsidian 1.12.7 test binary.
- Must be feature-detectable with a graceful fallback (today's flip-blindly flatten behavior) if the API is absent.

**If the spike finds a path:** implement FI-012 as part of Phase 3's `BottomDock` work. Acceptance criteria gain AC15 (below).

**If the spike hits a dead end** (no sanctioned API, no reliable feature-detect, or too fragile to ship): cut FI-012 from Phase 3. Record the finding in the Phase 3 completion report with enough detail that a future attempt can pick up where this one stopped. Do NOT force a hacky path to keep it in scope — the kill-switch is the whole point.

## Acceptance criteria

Binary pass/fail outcomes.

1. `app.workspace.getLeavesOfType(CONTAINER_VIEW_TYPE).length === 1` after `openDefaultTerminal()` from a cold workspace.
2. After two consecutive `openDefaultTerminal()` calls, still exactly one container leaf — the second terminal is a tab inside the container, not a sibling leaf.
3. With two tabs open, writing output into the inactive tab's PTY (e.g., `yes` running), then switching tabs and switching back, the output is preserved — xterm was not disposed.
4. Closing one tab disposes that tab's xterm and PTY; other tabs continue functioning.
5. Per-tab close X is visible and clickable without keyboard fallback.
6. Terminal height persists across close/reopen within the same session.
7. **Hard no-overlap.** Obsidian's editor status overlay (backlinks / word-count / sync badge) does NOT visually cover any part of the xterm render area when a note is open above the container. Verified by (a) an e2e bounding-box check comparing the overlay's rendered rect against the `.xterm-viewport` rect — no intersection allowed — and (b) the manual step in User Testing. Non-negotiable: "our text goes behind the overlay" is a ship-blocker, not a cosmetic issue.
8. Restart behaviour: if the container was open when Obsidian closed, reopening Obsidian presents the container with exactly **one** blank terminal (default shell). Tab specs from the prior session are explicitly NOT restored. If the container was not open, it is not present on reopen.
9. All 5 R8 probes (a–e) pass in `tests/e2e/tab-isolation.e2e.ts` against the container view type. R8e is regression-pinned as "replaces the container" — flip indicates ADR 0006's "Harder" section needs revisiting.
10. Feature-detect fallback path: when `workspace.createLeafInParent` is absent, container still opens, single console warning emitted, no crash.
11. `npm run build && npm run test` green.
12. After cleanup PR: `wdio.proto.conf.mts`, `test:e2e:proto` in `package.json`, and `specs/anvil/pane-chrome-and-picker/phase-2-prototype/` are all gone. `npm run test:e2e:proto` no longer exists.
13. After migration complete: `TERMINAL_VIEW_TYPE` and the old `TerminalView` class are not referenced from `src/`. ADRs and completion reports may still mention them — OK.
14. `docs/explanations/third-party-plugin-compatibility.md` no longer contains the strings "once the multi-terminal container ships" or `obsidian-terminal-view` in body copy. Links to ADR / code identifiers elsewhere may remain.
15. **FI-012 (gated on spike outcome).** If the spike finds a usable API: with two notes open side-by-side (horizontal split), opening the terminal leaves them side-by-side and docks the container as a full-width row below. Closing the container restores the original rootSplit layout exactly. If the spike cuts FI-012: the completion report names the dead end, and criterion reverts to "dock opens somewhere reasonable" per meta-plan criterion 7's degraded wording.
16. **Bottom buffer strip is visible and empty.** A reserved strip at the container's bottom, styled as chrome (matches the tab-strip/container surround), contains no text or interactive elements. Height is sufficient to satisfy AC7.

## User testing

1. **One terminal.** `Cmd-P → Open terminal`. Container pane appears with one tab, a `+` action in the container's view-header, a close X on the tab, and the empty bottom buffer strip visible. Type a command, confirm output.
2. **Second terminal via view-header `+`.** Click the `+` in the view-header. A second tab opens with a fresh shell. Switch between tabs by clicking. Type in each — confirm PTYs are isolated.
3. **Background work survives switch.** Run `yes` (or `ping localhost`) in tab 2, switch to tab 1, wait a few seconds, switch back. Output has continued; scrollback and cursor position intact.
4. **Close one tab.** Click X on tab 1. Only tab 1 closes; tab 2 unaffected.
5. **Close last tab / container.** Close the final tab or the container leaf itself. Reopen via `Cmd-P`. Container returns (empty or seeded per container design).
6. **Restart behaviour.** With 2 tabs open, quit and reopen Obsidian. The container returns with exactly one blank terminal (not two, not the prior shells). If you instead close the container before quitting, the container should not be present after reopen.
7. **Isolation against notes.** Open a note via Cmd-click wikilink, `Cmd-P → Quick switcher`, and Cmd-Shift-click (split). Confirm the container is never replaced, never sibling-into'd, and the note opens elsewhere.
7a. **No-overlap check (AC7 manual leg).** With a note open above the terminal, look at the terminal's render area. Obsidian's status overlay (the floating backlinks / word-count / sync badge at the note's bottom-right) must NOT visually cover any xterm text. Try multiple terminal heights, multiple themes (light/dark), and multiple notes (backlink badge counts change width, sync indicator comes and goes). If the overlay ever clips into the xterm viewport, the build doesn't ship.
7b. **Flatten behavior (FI-012).** Open two notes side-by-side (horizontal split). Open the terminal. If FI-012 shipped: the two notes stay side-by-side and the terminal docks below as full width. If FI-012 was cut during the spike: the notes stack vertically — note the behavior and confirm it matches the completion report's "cut, here's why" note.
8. **Native drag.** Drag the container via Obsidian's view-header grab; confirm Obsidian-native repositioning still works at the leaf level.
9. **Third-party clobber (optional, documented residual).** With Mononote or Hover Editor installed, reproduce the R8e clobber pattern and confirm the behavior matches what `docs/explanations/third-party-plugin-compatibility.md` describes.

## Boundaries (NOT in scope)

- **FI-005** (persistent sessions / scrollback across app restart).
- **In-container tab reordering** (drag a tab to reorder). Meta-plan criterion 2 defers; FI-follow if dogfooding asks.
- **Drag-drop `cd <path>` onto the tab strip** (VS Code-style behavior). ADR names the surface; Phase 3 doesn't commit. FI-follow.
- **Cross-window drag** (dragging a tab to a new Obsidian window). Not supported by Rank 3.
- **Populating the bottom buffer with content** (shell/cwd/tmux info). Strip is reserved chrome only in Phase 3. Content is FI-follow.
- **Settings UI for container chrome** (FI-015 territory).
- **Container theming beyond Obsidian tokens** (FI-016 territory).
- **Release packaging** (FI-017).
- **Detection-and-recovery for R8e** (third-party `setViewState` clobber). Documented residual only; no runtime defense. No monkey-patching.
- **Refactor of `PtyBackend` or `XtermHost`.**
- **Changes to picker, shell discovery, tmux integration, or settings modules** unless incidentally required by the integration-seam rewrite.

Note: **FI-012 is IN-scope with a kill-switch** — see the FI-012 spike section in Requirements. If the spike's API investigation dead-ends, FI-012 drops back to the backlog and the completion report names the reason.

## Sources

**Decision records and planning**
- `docs/adr/0006-workspace-container.md` — the decision record. Read all of it.
- `specs/anvil/pane-chrome-and-picker/phase-2-lessons.md` — implementation-grade guidance and clean-code rules. Read before writing code.
- `specs/anvil/pane-chrome-and-picker/phase-2-completion-report.md` — "Notes for downstream phases" section is the authoritative carry-forward.
- `specs/anvil/pane-chrome-and-picker/meta-plan.md` — Phase 3 section with 2026-04-17 notes.
- `specs/anvil/future-ideas-backlog.md` FI-012 entry — spike context (POC observation, candidate APIs, on-close logic).

**Prototype references (port ideas, not code)**
- `specs/anvil/pane-chrome-and-picker/phase-2-prototype/container-view.ts` — Rank 3 prototype.
- `specs/anvil/pane-chrome-and-picker/phase-2-prototype/r8.e2e.ts` — R8 probes to port into production e2e.

**Integration targets**
- `src/main.ts:159–170` — `getDock()` integration seam.
- `src/dock/bottom-dock.ts:44–77` — feature-detect + fallback idiom to mirror.
- `src/view/TerminalView.ts` — current single-terminal view; removed by end of phase.
- `src/terminal/xterm-host.ts` — reuse as-is.
- `src/pty/pty-backend.ts` + `src/pty/terminal-backend.ts` — reuse as-is.
- `tests/e2e/tab-isolation.e2e.ts` — rewrite target.

**Downstream docs**
- `docs/explanations/third-party-plugin-compatibility.md` — hedge strip + view-type rename.
- `specs/anvil/testing-approach.md` — e2e principles, RED/GREEN discipline.

**Constraints from CLAUDE.md**
- Undocumented Obsidian APIs need feature-detect + graceful-degrade.
- `TerminalBackend` interface MUST NOT be widened.
- CSS authoring in `src/styles.css`; deployed `styles.css` is generated.
- macOS arm64 only.
