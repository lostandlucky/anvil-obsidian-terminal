# Phase 3 — Workspace Container Implementation: Completion Report

**Mode:** Code Tests (Mode B)
**Cycles:** 2 (initial pass green on 14/17; one tight loop on AC6/AC8/AC15 wording). AC8 subsequently **rescoped** post-merge — see "Post-merge rescope" below.
**Status:** GREEN — 16/16 Phase 3 e2e tests pass (AC8 dropped, was 17), full suite (unit + e2e) green.

Parent spec: [phase-3-workspace-container-spec.md](phase-3-workspace-container-spec.md).

## Deliverables

### Production code
- `src/view/TerminalContainerView.ts` — new ItemView hosting N xterm tabs in one leaf. `view.navigation = false`; plugin-drawn chrome (tab strip with per-tab close, reserved bottom buffer); `addTab` / `switchTab` / `closeTab` / `getTabIds` / `getActiveTabId` / `getActiveHost` / `getActiveBackend`; ResizeObserver on `leaf.containerEl` persists container height across close/reopen. On view reconstruction (restart, workspace-plugin, popout), `onOpen` creates one blank tab unless the plugin signalled via `isExpectingManualTab()` that it will supply the spec itself.
- `src/dock/wrap-and-dock.ts` — FI-012 wrap-and-dock module. `createWrapAndDock({ workspace, rootSplit })` returns `openWithWrap()` / `closeWithUnwrap(handle)`. Feature-detects `createLeafBySplit` + `insertChild` + `removeChild` + `setDirection`; absence falls through to today's flat-dock behaviour.
- `src/main.ts` — registers only the container view; `openTerminalWithSpec` + `openDefaultTerminal` target `container.addTab(spec)`. `getOrCreateContainerView` orchestrates `openWithWrap` + `allocateContainerLeaf` (`createLeafInParent` with `getLeaf("split", "horizontal")` fallback emitting `window.__anvilFallbackWarned = true` + `console.warn`). `reconcileWrap` listens for `layout-change` and calls `closeWithUnwrap` when the container leaf disappears.
- `src/styles.css` — new rules for `.anvil-terminal-container-view` / `-tabstrip` / `-tab` / `-tab-close` / `-content` / `-pane` / `-bottom-buffer` using Obsidian theme tokens only. Legacy `.obsidian-terminal-view` rules removed.

### Tests
- `tests/e2e/container-view.e2e.ts` (AC1-7, AC10, AC16) — 9 tests.
- `tests/e2e/fi-012-wrap-and-dock.e2e.ts` (AC15) — 2 tests.
- `tests/e2e/tab-isolation.e2e.ts` (AC9, R8a–R8e) — 5 tests.
- `tests/e2e/container-persistence.e2e.ts` deleted post-merge — see "Post-merge rescope".
- Existing specs (`pty-backend.e2e.ts`, `picker.e2e.ts`, `plugin.e2e.ts`, `keyboard-passthrough.e2e.ts`) retargeted to the container view's DOM + added `getActiveHost` / `getActiveBackend` accessor.

### Deletions
- `src/view/TerminalView.ts`, `src/dock/bottom-dock.ts` + `bottom-dock.test.ts`
- `tests/e2e/bottom-dock.e2e.ts`, `tests/e2e/multi-instance.e2e.ts` (both pinned the legacy single-leaf / multi-sibling shape)
- `tests/e2e/fi-012-spike.e2e.ts`, `wdio.proto.conf.mts`, `specs/anvil/pane-chrome-and-picker/phase-2-prototype/` (AC12)

### Doc changes
- `docs/explanations/third-party-plugin-compatibility.md` — hedges ("once the multi-terminal container ships") stripped; `obsidian-terminal-view` body-copy references replaced with `anvil-terminal-container-view` (AC14).

## User Testing

Per the spec's User Testing section — all manual items to run against the dev build installed in an Obsidian vault:

1. **One terminal** — `Cmd-P → Open terminal`. Confirm: single container pane with one tab, `+` action in the view-header, close X on the tab, empty bottom buffer strip visible. Type a command, confirm output.
2. **Second terminal via view-header `+`** — click `+`. Second tab opens with fresh shell. Switch by clicking tabs. PTYs isolated.
3. **Background work survives switch** — `yes` (or `ping localhost`) in tab 2, switch to tab 1, wait, switch back. Output has continued, scrollback intact.
4. **Close one tab** — click X on tab 1. Only tab 1 closes.
5. **Close last tab / container** — close final tab. Container detaches. `Cmd-P → Open terminal` → container reappears.
6. **Restart behaviour** — open 2 tabs, quit and reopen Obsidian. Container returns with one blank terminal (not two, not the prior shells). Separately: close the container before quitting → container should not be present on reopen.
7. **Isolation against notes** — with terminal open, open a note via Cmd-click wikilink, quick switcher, Cmd-Shift-click split. Container is never replaced, never sibling-into'd.
7a. **No-overlap across themes (AC7 manual leg)** — see Required Manual Verification below.
7b. **FI-012 wrap-and-dock feel** — open two notes side-by-side, open the terminal. Notes stay side-by-side, terminal docks full-width below. Close the terminal — layout restores.
8. **Native drag** — see Required Manual Verification below.
9. **Third-party clobber (optional)** — see Required Manual Verification below.

## Required Manual Verification

These acceptance criteria cannot be fully covered by automation — ship gates rely on a human reading the UI.

1. **AC7 no-overlap across themes/heights/notes (ship-blocker)** — the automated bounding-box leg covers a single theme / height / note. Sweep: at least light + dark + one community theme; at least two container heights (short ~200px, tall ~600px); at least two notes (one with many backlinks so the overlay badge is wide, one with few). The editor status overlay (floating backlinks / word-count / sync badge) MUST NOT visually clip into the xterm viewport in any combination. If it does in any cell of the matrix, the build does not ship.
2. **User Testing 8 — native drag** — drag the container leaf via Obsidian's view-header grab. Obsidian-native repositioning should still work at the leaf level. Per `specs/anvil/testing-approach.md`, Electron drag-and-drop is too flaky to automate; this stays manual.
3. **User Testing 9 (optional) — third-party clobber** — with Mononote or Hover Editor installed in a real vault, reproduce the R8e clobber pattern. Confirm `docs/explanations/third-party-plugin-compatibility.md` still matches the observed behaviour. Optional because R8e is regression-pinned via `tests/e2e/tab-isolation.e2e.ts` at the API level.

## Notes for downstream phases

- **Height persistence mechanism is load-bearing on Obsidian internals.** `leaf.containerEl` inline `flex` / `height` is respected only for single-child rootSplits. With siblings, Obsidian's workspace-split layout engine overrides inline CSS via its own `recomputeChildrenDimensions` path — the production code sets `leaf.dimension` + sibling dimensions directly and calls `recomputeChildrenDimensions`. `setDimension(px)` is a noop in 1.12.7 (the method exists but does not write the field). If Obsidian's internals change here, AC6 regresses first. Consider a settings-level "preferred height" as a fallback input.

- **`window.__anvilFallbackWarned` is production-visible by design.** The flag went into production (not test-only) so a future settings surface can show "running in degraded mode" without re-parsing console logs. If the fallback path is ever deleted, delete the flag with it.

- **`addTab` awaits `backend.start()` before revealing the tab.** This mirrors the Phase 2 prototype's ordering and is load-bearing: mounting the xterm on a hidden pane yields degenerate cols/rows, and a late SIGWINCH during shell startup leaves zsh flagging every subsequent prompt with `%` (PROMPT_EOL_MARK). An earlier fire-and-forget variant was tried to satisfy AC8 (layout save/restore) — AC8 was subsequently dropped; see "Post-merge rescope".

- **Test contract drift caught during GREEN:** the Session 1 RED stubs assumed `createLeafInParent` produces a tabs-wrapper around the container leaf (AC15 forward), but the spike findings document the shape as a *direct* `container-leaf` child of rootSplit. The production assertion was relaxed to "container leaf is under rootSplit" via `getLeavesOfType` + parent-chain walk. Future FI work that changes the leaf-allocation path should update this assertion too, not the other way around.

- **`TerminalBackend` interface held.** Per CLAUDE.md: no widening. Container reuses `PtyBackend` and `XtermHost` as-is.

- **Vocabulary enforcement**: `TerminalTab` is the in-container data type. Nothing in `src/` uses "tab" to mean `WorkspaceTabs` or `WorkspaceLeaf`. Code review gate for future changes.

- **`getActiveHost` / `getActiveBackend` are a small public surface on the view.** They exist because e2e tests that formerly peeked at the old view's private fields needed an equivalent path. Future production features (settings UI, diagnostics command) can use them rather than reaching into private state again.

## Commits

- `beeb192` — PR1 additive: container view + wrap-and-dock + main.ts retarget.
- `19794c9` — PR2 subtractive: delete legacy view + bottom-dock + stale e2e + doc hedges.
- `0c0f16d` — final: delete fi-012 spike artifacts (AC12).
- (post-merge) — AC8 rescope: drop tab-spec persistence; see below.

## Post-merge rescope: AC8 dropped

During dogfooding after the spike artifacts landed, a zsh regression surfaced — `PROMPT_EOL_MARK` (the reverse-video `%`) was showing before every prompt, not just the first. Root cause was the fire-and-forget `backend.start()` inside `addTab`: the shell's initial SIGWINCH landed mid-startup and the PTY's line-mode ended up such that bare `\n` didn't return the cursor to column 0. The prototype didn't have this bug because it awaited `backend.start()` before revealing the tab.

The fire-and-forget ordering existed *only* to satisfy AC8 — `workspace.changeLayout()` doesn't fully await our `setState → drainPendingSpecs` chain, so awaiting backend starts during restore would drop tabs from the round-trip.

Decision: **drop AC8 entirely.** Tab-state persistence across restart is a feature VS Code doesn't provide and the user doesn't want. Additionally, our PTY architecture (renderer-bound `pty-server` child + in-window websocket) can't meaningfully preserve shell sessions across any view-reconstruction boundary (restart, popout, workspace-plugin layout switch), so persistence was buying partial fidelity in only the restart case.

Replacement: on view reconstruction, `onOpen` creates **one blank terminal** by default. Plugin signals "I'm supplying the spec" via `isExpectingManualTab()` to suppress this on manual opens. `addTab` returns to the prototype's ordering (mount → await `backend.start()` → switchTab) — the `%` regression is gone.

What was removed:
- `TerminalContainerView`: `setState` (tab-reading path), `getState` (tab-writing path), `getTabSpecs`, `pendingSpecs`, `drainPendingSpecs`, `coerceSpec`, `persistState`, `ensureChrome` (merged back into `onOpen`'s `buildChrome`)
- `tests/e2e/container-persistence.e2e.ts` (the only AC8 test)
- `src/main.ts`: gained `expectingManualTab` flag + `isExpectingManualTab()` accessor around `setViewState`

Documents updated: this report, the phase-3 spec's AC8 + User Testing item 6 + state-serialization section.

## Acceptance criteria coverage

| AC | Verdict | Test |
|---|---|---|
| AC1 — one container leaf on cold open | GREEN | container-view.e2e.ts |
| AC2 — second open adds tab, not sibling leaf | GREEN | container-view.e2e.ts |
| AC3 — xterm survives tab switch | GREEN | container-view.e2e.ts |
| AC4 — close tab disposes that tab only | GREEN | container-view.e2e.ts |
| AC5 — close X visible + clickable | GREEN | container-view.e2e.ts |
| AC6 — height persists across close/reopen | GREEN | container-view.e2e.ts |
| AC7 — editor overlay does not intersect xterm viewport (automated leg) | GREEN | container-view.e2e.ts |
| AC7 — multi-theme sweep | MANUAL | Required Manual Verification #1 |
| AC8 — (rescoped post-merge, was layout save/restore) | DROPPED | see "Post-merge rescope" |
| AC9 — all 5 R8 probes green | GREEN | tab-isolation.e2e.ts |
| AC10 — feature-detect fallback + single warning | GREEN | container-view.e2e.ts |
| AC11 — `npm run build && npm run test` green | GREEN | CI-shaped local run |
| AC12 — spike artifacts deleted | GREEN | commit `0c0f16d` |
| AC13 — old view type not referenced from src/ | GREEN | grep verified |
| AC14 — doc hedges stripped | GREEN | commit `19794c9` |
| AC15 — FI-012 forward + reverse | GREEN | fi-012-wrap-and-dock.e2e.ts |
| AC16 — bottom buffer visible, empty, non-zero height | GREEN | container-view.e2e.ts |
