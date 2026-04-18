# Phase 2 Complete — Workspace Container Spike (Parts 1 + 2)

**Mode:** Hybrid (Part 1 Qualitative for prototype+ADR authoring; Part 2 Code Tests for automated R8 probes)
**Cycles:** 2 executed (Part 1 → Part 2), with one mid-Part-2 redesign cycle after R8b went red on first run
**Status:** GREEN — ADR 0006 Accepted, all 5 R8 probes automated and passing

## Deliverables

**New files:**

- `docs/adr/0006-workspace-container.md` — ADR, Accepted
- `docs/explanations/third-party-plugin-compatibility.md` — new Diátaxis Explanation for the R8e residual, mid-execution addition when the user asked for user-facing documentation beyond the ADR
- `specs/anvil/pane-chrome-and-picker/phase-2-workspace-container-part-2-spec.md` — Part 2 spec authored mid-session when the spike's discovery landscape shifted
- `specs/anvil/pane-chrome-and-picker/phase-2-prototype/` — throwaway prototype plugin:
  - `manifest.json`, `main.ts`, `container-view.ts`, `styles.css`, `build.mjs`, `README.md`, `probes.ts`
  - `r8.e2e.ts` — 5 automated R8 probes
  - `demo.e2e.ts` — walkthrough spec with long pauses for human-in-the-loop review
- `wdio.proto.conf.mts` — dedicated wdio config scoped to the prototype specs

**Modified files:**

- `README.md` — new `## Known limits` bullet + `## Where to go next` link pointing at the third-party compatibility Explanation
- `package.json` — new `test:e2e:proto` script; defaults unchanged

**Not modified (AC discipline held):**

- `git diff main -- src/` is empty (Part 1 AC10)
- `git diff main -- tests/e2e/` is empty (Part 2 D6)

## Key discoveries

Three findings from the Part 2 automated probes that weren't visible from the Part 1 research alone:

1. **Leaf placement is the load-bearing R8b/c/d mitigation, not any per-view signal.** The original prototype used `workspace.getLeaf("split", "horizontal")`, which nests the container inside a new `WorkspaceTabs`. That gave `openLinkText("tab")` an adjacent sibling slot and broke R8b. Swapping to `workspace.createLeafInParent(rootSplit, index)` — the pattern the main plugin already uses via `src/dock/bottom-dock.ts` — places the container directly under `rootSplit` with no tab-group wrapper, and R8b went green. R8c and R8d are also carried by this property.
2. **`view.navigation = false` is the single load-bearing R8a mitigation.** With placement correct, flipping navigation to `true` turns R8a red (default-mode `openLinkText` reuses the container leaf for the note). Flipping it back to `false` turns R8a green.
3. **`setPinned(true)` is redundant and was dropped.** The Part 1 prototype carried it as belt-and-suspenders. The AC6 bite-check with `navigation = false` in place and setPinned removed left all five probes green. Final design drops setPinned entirely, removing one undocumented-API dependency from Phase 3.

## Probe results (Obsidian 1.12.7)

| Probe | Result | Carried by |
|---|---|---|
| R8a `openLinkText(false)` | PASS | `view.navigation = false` |
| R8b `openLinkText("tab")` | PASS | placement (`createLeafInParent` → rootSplit) |
| R8c `openLinkText("split")` | PASS | placement |
| R8d synthetic HTML5 drop | PASS | no drop handler on `.anvil-proto-container` |
| R8e explicit `setViewState` clobber | PASS (regression-pin) | documented residual — not blockable within sanctioned API |

## User Testing

1. **Read ADR 0006.** Verify the Consequences section undersells nothing. In particular: the "Harder" R8e bullet honestly names that `view.navigation = false` doesn't block explicit `setViewState`. The bite-check evidence is plain.
2. **Read `docs/explanations/third-party-plugin-compatibility.md`.** This is new user-facing documentation. Check that the symptom description, plugin list, and "what to do" steps are useful to a real user hitting the clobber. Push back on tone if it reads too technical.
3. **Run the probes.** From repo root:

   ```bash
   cd specs/anvil/pane-chrome-and-picker/phase-2-prototype && node build.mjs
   cd -
   npm run test:e2e:proto
   ```

   Expect 5 R8 tests green in ~1.5s (plus ~87s of `demo.e2e.ts` walkthrough — low priority to separate).
4. **Install the prototype in a real vault** (not required, but the prototype's `README.md` walks through it). Open two terminal tabs, switch between them, type in each, confirm state survives switches. Try the `openLinkText` modes by Cmd-clicking wikilinks in other leaves while the container is focused.
5. **Manually reproduce R8e with a real third-party plugin** (see Required Manual Verification below).
6. **Clean-removal sanity.** Delete `wdio.proto.conf.mts`, the `test:e2e:proto` line in `package.json`, and the entire `specs/anvil/pane-chrome-and-picker/phase-2-prototype/` directory. Run `npm run build && npm run test`. Everything should pass unchanged — proves Part 2 left no foot-holds in the default flow.

## Required Manual Verification

Carried forward verbatim from Part 1's Step 3 unautomatable list, with Part 2 context applied.

1. **R8e against a real third-party plugin.** The automated R8e probe synthesizes the clobber via `leaf.setViewState` in DevTools-equivalent JS. Reproducing it with a real offender (Mononote, Hover Editor) confirms the user-facing documentation describes reality. Install one of those plugins into your test vault, open the prototype container, trigger the plugin's heuristic, and confirm the container is clobbered the way `docs/explanations/third-party-plugin-compatibility.md` describes.
2. **ADR decision defensibility.** Subjective — read the ADR end-to-end. Does the Consequences section undersell any tradeoff? Does "why only Rank 3" feel convincing with the research note citation? If yes, the ADR stands. If no, edit.
3. **User-facing doc readability.** Subjective — does `docs/explanations/third-party-plugin-compatibility.md` read as useful to a user hitting the symptom, or does it feel like dev-audience prose smuggled under a user-facing heading?
4. **Completion report readable by next session.** Subjective — can the next session pick up Phase 3 from this report without re-deriving anything material?

## Notes for downstream phases

**For Phase 3 (the container actually ships in `src/`):**

- **Leaf placement: use `createLeafInParent(rootSplit, rootSplit.children.length)` with feature-detect + fallback.** This is the load-bearing R8b/c/d mitigation. The main plugin's `src/dock/bottom-dock.ts:44–77` already has the pattern to mirror. Do **not** use `workspace.getLeaf("split", "horizontal")` — it nests the container in a `WorkspaceTabs` and reopens R8b/c/d. If the feature-detect falls back to `getLeaf("split")` on an older Obsidian, emit a one-time console warning that the isolation is degraded.
- **Set `view.navigation = false` on the container class.** Single load-bearing R8a mitigation. Documented since 0.15.1, no feature-detect needed (minAppVersion is 1.5.0).
- **Do not call `setPinned(true)`.** The ADR records why it was tried and dropped. If a future maintainer reaches for it, they should read the ADR's "was tried and dropped" paragraph first.
- **Integration seam.** `src/main.ts:159–170` (`getDock()`). Phase 3's `getDock()` returns the container leaf (creating it if absent). `openTerminalWithSpec(spec)` calls `container.addTab(spec)` rather than `dock.openLeaf() + setViewState`. `BottomDock` collapses to single-leaf; `reconcileDock` becomes "is the container open? yes/no."
- **Tab state serialization.** Obsidian's layout-save restores the container leaf but not the N tabs inside. Phase 3 needs `getState() / setState()` on the container view to serialize tab specs (shell, cwd, shellArgs) and restore them in order. FI-005 (cross-session scrollback persistence) is the larger problem; Phase 3 only owes "open with 2 saved tabs = get 2 tabs back."
- **`+` affordance location.** Pick one — view-header action OR tab-strip `+`. The prototype kept both because it didn't matter. The tab-strip `+` is VS Code-natural; the view-header action is Obsidian-natural.
- **Drag-drop on tab headers.** Out of Phase 2 scope. If Phase 3 wants it (VS Code ships `cd <path>` on file-drop into terminal), attach `dragover`/`drop` to the tab-strip DOM.
- **FI-012 relationship.** Independent. Rank 3 does not subsume FI-012 (wrap-and-dock). Phase 3 should still consider them together because both touch rootSplit structure, but neither blocks the other.
- **Update `docs/explanations/third-party-plugin-compatibility.md` when Rank 3 ships.** The doc currently hedges with "once the multi-terminal container ships" in a couple of places because it went live during the Phase 2 spike. After Phase 3, those hedges can go.
- **Delete the throwaway.** `wdio.proto.conf.mts`, `test:e2e:proto` script, and `specs/anvil/pane-chrome-and-picker/phase-2-prototype/` are deletable as one unit once Phase 3 has its own R8 coverage in `tests/e2e/`. Don't leave them rotting.

**For the meta-plan and the backlog:**

- FI-014 is unblocked for Phase 3 work.
- FI-012 remains in the backlog as currently scoped.
- The R8e residual is now first-class documentation (`docs/explanations/third-party-plugin-compatibility.md`); if user reports surface specific plugin conflicts, extend that doc's list.

**For the dependency maintenance check:**

- No Dependabot/Renovate PRs consumed this session. Phase 3 kickoff should reinspect per CLAUDE.md's dependency-maintenance protocol.

## Spec boundary violations worth naming

1. **Part 2 spec D6 said `package.json` was out-of-scope for `src/` and `tests/e2e/` only.** I added a `test:e2e:proto` script, which the spec intended (`"new test:e2e:proto npm script in package.json"` per R2). Aligned.
2. **Part 2 spec did not anticipate dropping `setPinned(true)`.** The AC6 bite-check was scoped to flipping `view.navigation`; the user's "investigate which mitigation is load-bearing" ask extended the scope mid-execution. Decision recorded in ADR. No spec rewrite needed — the finding is stronger than the spec predicted.
3. **User-facing compat doc.** Not in any Part 2 AC. Added mid-execution on user request. Scope extension is documented in this report's Deliverables.

## Next command

`/phase-triage [next phase]` — the meta-plan's next entry. Phase 3 is next; it is large enough that a spec is warranted.
