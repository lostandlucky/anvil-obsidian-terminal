# Implementation Brief: Phase 1 — Restore-path redock (BUG-001)

**Date:** 2026-07-14 · **Triage:** `phase-1-restore-redock-triage.md` (Recommendation B) · **Sign-off:** auto-approved per autonomy contract.

Spec surface: meta-plan Phase 1 block + `../known-bugs.md` BUG-001. This brief names seams only; the TDD cycle resolves the rest.

## Architectural shape

- **New pure module `src/dock/restore-redock.ts`** — no `obsidian` import (boundary rule). Exports a stray-classification function: given the current terminal leaves, the main root, a `getRoot` accessor, and an `isPluginPlaced` predicate, returns the leaves that were rehydrated by Obsidian rather than placed by the plugin this session, filtered to the main window. Unit-tested.
- **`TerminalPlugin` (src/main.ts)** gains:
  - a `WeakSet<WorkspaceLeaf>` of plugin-placed leaves — `getOrCreateContainerView` adds every leaf it allocates. This is the "restore vs deliberate user move" gate: in-window drags preserve leaf identity, so a moved leaf stays known and is never fought; rehydration (app relaunch, `changeLayout`) creates fresh leaf objects, which are unknown.
  - `reconcileRestore()` — runs from the existing `layout-change` handler plus `workspace.onLayoutReady` (real-relaunch path: plugin loads before layout restore). Guards: reentrancy flag (same pattern as `insertingEmptySibling`), `layoutReady` gate, strays marked into the WeakSet *before* redock so a failed redock can never loop.
- **Redock mechanism:** detach the stray leaves, then re-run the existing `openDefaultTerminal()` path (wrap-and-dock, empty-sibling reconciler, height restore all come for free). Fresh shell is fine per meta-plan OUT/FI-005. Chosen over "move the existing leaf" because it reuses the battle-tested open path and sidesteps deferred-view states on restored background leaves.
- All APIs used in production here are documented in the pinned typings (`rootSplit`, `layoutReady`, `onLayoutReady`, `getRoot`) — no new undocumented surface; `undocumented-api-surface.test.ts` needs no extension. `getLayout`/`changeLayout` (also documented) are used by the test harness only.

## Anchor test

`tests/e2e/bug-001-restore-redock.e2e.ts` (Level 2, real Obsidian):

1. **Simulated serialize→restore (the user-named GREEN requirement):** open note + docked terminal → capture `workspace.getLayout()` → `disablePlugin` + `enablePlugin` (resets plugin in-memory state — faithful to a relaunch where the WeakSet/wrapHandle are fresh) → `changeLayout(saved)` → assert: exactly one terminal leaf, bottom-docked under a horizontal rootSplit, not sharing a tabs group with the note, tab strip present, shell produces output. A second variant rehydrates a layout where the terminal sits as a *sibling tab next to the note* — the exact shape a real relaunch produces per BUG-001 — guaranteeing an honest RED regardless of how faithful `changeLayout` round-tripping turns out to be (probe at RED decides which variant carries the assertion weight).
2. **User-move respected:** with a plugin-placed docked terminal, surgically move the leaf into the note's tabs group (leaf identity preserved, as a real drag does), fire `layout-change` twice → leaf stays put, no redock loop.

## Tooling / operational traps

- `layout-change` reentrancy: `reconcileWrap` + `reconcileEmptySibling` already run there; detaching strays re-triggers the event synchronously. Reentrancy flag mandatory. An unmarked-stray bug = infinite redock loop that kills/spawns shells — mark-before-redock is load-bearing.
- Stale `wrapHandle` across `changeLayout` in the *test*: the disable/enable step exists precisely to reset it; don't simulate restore against a live plugin instance.
- Latent "Loading workspace…" hang (known-bugs BUG-001): if the simulation resurfaces it — park with evidence, not a blocker.
- wdio: no pointer drags (testing-approach); drive layout via `browser.execute` workspace calls; `waitUntil` with DOM predicates, no bare sleeps.

## Existing-test audit

- `fi-012-wrap-and-dock.e2e.ts` — stays green: reconciler ignores plugin-placed leaves; its manual `trigger("layout-change")` finds no strays.
- `container-view.e2e.ts` — stays green: all opens go through plugin paths (leaves marked); its layout-change triggers are no-ops for the reconciler.
- `phase-3-hygiene.e2e.ts` AC1 disable/enable — stays green: no terminal leaves exist at re-enable.
- `tab-isolation.e2e.ts` R8e — stays green: converting the container leaf to markdown removes it from `getLeavesOfType`.
- `tests/unit/undocumented-api-surface.test.ts` — stays green (no guard removals, no new undocumented calls).

## Doc surfaces

- `specs/anvil/known-bugs.md` (remove BUG-001 on fix)
- `specs/anvil/manual-test-checklist.md` (MT-016 expectation: restored terminal is bottom-docked)
- `MORNING-UAT.md` (manual quit-relaunch verification)

## TDD ordering hint

1. Unit: stray-classification module red → green → commit.
2. e2e RED probe: run the anchor spec, record how `getLayout→changeLayout` actually rehydrates the docked layout; pick the assertion-bearing variant with evidence.
3. Wire `reconcileRestore` + WeakSet marking; anchor spec green → commit.
4. User-move regression pin green (its failure mode is validated at the unit level — the `isPluginPlaced` filter) → commit.
5. Bookkeeping (known-bugs, MT-016, MORNING-UAT) + full-suite GREEN gate → completion report.
