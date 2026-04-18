# Meta-Plan: Pane Chrome and Picker Polish

## Context

Phase 4 of `specs/anvil/meta-plan.md` was superseded on 2026-04-16, with its scope decomposed into FI-014 through FI-020 in `future-ideas-backlog.md`. The supersession note explicitly promised "a fresh meta-plan will rescope the remaining work." This is one such meta-plan — picking up a focused slice of three features that all shape what the user *sees* sitting above the PTY core: the picker modal (FI-010), the terminal pane chrome (FI-014), and the structural workspace behavior that makes the chrome possible (FI-012).

The other supersession-derived features (FI-015 settings, FI-016 theming, FI-017 release, FI-018 process hygiene, FI-019 resize, FI-020 dep cadence) are explicitly out of scope here; they get their own meta-plans when their turn comes.

**Filing:** Recommend a new subfolder `specs/anvil/pane-chrome-and-picker/` per the standard `_shared/artifact-organization.md` pattern, rather than the flat layout the original meta-plan used. The original `meta-plan.md` stays where it is for historical context.

## Scope

**IN:**
- FI-010 — picker section headers render distinguishably and don't get arrow-key-selected
- FI-012 — bottom-dock open no longer flattens existing rootSplit columns
- FI-014 — terminal gains native Obsidian pane chrome (close X, drag handle, height persistence, editor-status-overlay displacement) AND multiple terminals open as tabs in the same shared container rather than as separate sibling panes

**OUT:**
- FI-015 settings tab (the FI-014 design questions surface future settings — defer them)
- FI-016 terminal theming
- FI-017 release packaging
- FI-018 process-hygiene audit
- FI-019 resize double-fit
- FI-020 dependency maintenance (handled per `CLAUDE.md` cadence, not as a phase here)
- FI-005 persistent sessions across close/reopen
- FI-011 cross-platform redesign

## Shared Constraints

- **Undocumented Obsidian APIs need feature-detect + graceful-degrade.** Three already exist in production: `rootSplit.setDirection`, `workspace.createLeafInParent`, `SuggestModal.chooser.setSelectedItem`. Anything new from Phase 2's spike (`WorkspaceTabs`, `rootSplit.createSplit`, etc.) joins that set. The canonical pattern is `src/dock/bottom-dock.ts:47–63` — try, detect, fall back without crashing.
- **`TerminalBackend` interface MUST NOT be widened.** Per-view config flows through `TerminalView.setState`/`getState` with a typed launch spec — confirmed-working pattern across Phases 2b/3/3.5. New chrome must respect this seam.
- **CSS authoring goes in `src/styles.css`.** That file is the hand-authored source. `esbuild.config.mjs:67–73` bundles xterm's CSS in front of it and minifies the result into the deployed `styles.css` at the repo root. Don't hand-edit the deployed file — it'll be overwritten on next build.
- **macOS arm64 only.** Same as the parent meta-plan.

## Dependency Map

```
Phase 1 (picker polish) ──── independent ─────────────┐
                                                       ├── done
Phase 2 (workspace container spike) → Phase 3 (impl) ──┘
```

Phase 1 is fully independent of 2 and 3 — different file, different surface, different mental model. Run before, after, or in parallel. Phases 2 and 3 are strictly sequential: Phase 2 decides *how* the structural rewrite works; Phase 3 implements the chosen design. Bundling them risks committing to an approach before the API spike resolves.

---

## Phase 1: Picker Section Header Polish

**Goal:** Users can tell at a glance which rows in the profile picker are interactive and which are section labels. Arrow-key navigation skips header rows, so the "user accidentally lands on a header" failure mode disappears at the input layer rather than being recovered from at the action layer. The "header pick re-opens the modal as a reset" hack in `onChooseSuggestion` is removed as unreachable code. The picker stops surprising first-time users.

**Dependencies:** None.

**Success criteria:**
- Section headers ("Launch new", "Attach to tmux session") are visually distinguishable from selectable rows
- Arrow-key navigation does not land on header rows
- `onChooseSuggestion` no longer needs the header → `this.open()` reset path
- No regression in existing picker e2e tests (`tests/e2e/picker.e2e.ts`)
- Manual test confirms a first-time user reads headers as labels, not options

**Risk flags:**
- FI-010 lists two viable approaches (CSS-only with arrow-skip hook, vs. restructured DOM with section labels emitted as siblings) — phase spec must pick one
- `chooser.setSelectedItem` is already used for default-shell pre-select (`profile-picker.ts:51-52`); the arrow-skip mechanism may want to ride the same API surface
- styles.css minification choice (build step vs. hand-edit) lands in Phase 1 by virtue of being first

---

## Phase 2: Workspace Container Design Spike

**Goal:** Decide the structural approach that delivers FI-012 (no flatten on dock open) and FI-014 (terminal has native pane chrome with multiple terminals as tabs in one shared container) — preferably as a single coordinated change rather than two independent ones. This phase produces a written decision and a throwaway prototype, not shippable code. Central questions to resolve: does wrapping the terminal in its own tab container subsume FI-012's flatten problem naturally, and what is the concrete API path for grouping additional terminals as tabs in that container rather than as sibling leaves?

**Dependencies:** None (independent of Phase 1).

**Success criteria:**
- Decision recorded as an ADR (likely `docs/adr/0005-workspace-container.md`) committing to a specific Obsidian API path, the feature-detect mechanism, and the graceful-degrade fallback
- Concrete answer for how a second terminal launch attaches as a *new tab* in the existing terminal container (not a new sibling pane). Same answer covers the plus-action location — it adds a tab to the same group
- Each remaining FI-014 open design question has a recorded answer — tab container vs. custom chrome; status bar y/n; FI-012 interaction (does tab-wrapping subsume the flatten fix, or is FI-012 still separate?)
- A throwaway prototype proves the chosen API path runs against Obsidian 1.12.7 (the pinned test binary). The prototype must demonstrate at minimum: (1) opening one terminal in a tab container under rootSplit, (2) opening a second terminal as a tab in the same container

**Risk flags:**
- `WorkspaceTabs` is undocumented — the API may not support tab-grouping the way FI-014 needs, forcing a custom-chrome fallback that re-implements tab affordances by hand (ugly but not blocking)
- FI-012's `rootSplit.createSplit()` candidate is unverified; the spike may invalidate the wrap-and-dock approach
- Spike may surface that FI-012 and FI-014 need *different* structural changes — Phase 3's scope would split, but the meta-plan still holds

---

## Phase 3: Workspace Container Implementation

**Goal:** Apply Phase 2's chosen design (see [ADR 0006](../../docs/adr/0006-workspace-container.md) and [phase-2-lessons.md](phase-2-lessons.md)). The terminal dock becomes a single `ItemView` leaf — plugin-owned — hosting N xterm instances with plugin-drawn chrome (tab list, close affordances, `+`). "Tabs" in this phase means *our internal tabs inside one leaf*, not Obsidian `WorkspaceTabs`; the two are structurally different and the ADR explains why Obsidian's isn't available to plugins. Close X, drag affordance (Obsidian's leaf-level view-header drag), height persistence, and editor-status-overlay displacement land as user-visible behavior. The rootSplit-flatten fix (FI-012) remains independent and stays in the backlog for now.

**Dependencies:** Phase 2 complete (ADR accepted, prototype proven).

**Success criteria:**
- Terminal close X is visible and functional without keyboard fallback (plugin-drawn — we don't get Obsidian's tab-strip close for free since we're not in a `WorkspaceTabs`)
- Terminal pane is repositionable via Obsidian's view-header drag at the leaf level. In-container tab reordering is not required for Phase 3 (FI to follow if dogfooding asks for it)
- Terminal height persists across close/reopen
- Obsidian's editor status overlay no longer overlaps terminal text when a note is open above
- Opening a second terminal adds it as a new in-container tab — does NOT create a sibling Obsidian leaf next to or above the existing terminal
- The `+` action opens a new in-container tab (canonical location — tab strip or view-header action — decided in the phase spec)
- With existing horizontal note columns, opening the dock leaves columns side-by-side and docks the container below as a full-width row (FI-012 remains deferred; this criterion degrades to "dock opens somewhere reasonable" if FI-012 isn't in Phase 3 scope)
- E2E coverage: `tests/e2e/tab-isolation.e2e.ts` rewritten for the container view type, with R8 probes ported from the Phase 2 prototype before the prototype is deleted
- `createLeafInParent` feature-detect ships with a graceful fallback (degraded isolation, one-time console warning) — never crash

**Risk flags:**
- `tests/e2e/tab-isolation.e2e.ts` needs rewriting, not tweaking — it tests the single-terminal `TerminalView` pattern, which the container replaces. Phase 2's `r8.e2e.ts` is the shape to port in.
- HTML5 DnD Electron flakiness (see `testing-approach.md`) still applies if Phase 3 implements cross-tab drag within the container — the prior meta-plan's "native tab drag sidesteps this" assumption is void because we have no `WorkspaceTabs`. Treat in-container drag as out of scope unless the phase spec explicitly pulls it in.
- FI-012 (wrap-and-dock) still unsolved. Phase 3 ships with today's rootSplit-flatten-on-dock behavior intact; the flatten UX remains "jarring but acceptable" per MT-007.
- Spike-to-impl drift: the Phase 2 prototype didn't exercise `getState` / `setState` tab serialization. Phase 3 initially designed it, then dropped it post-merge when it introduced a `PROMPT_EOL_MARK` regression — see `phase-3-workspace-container-completion-report.md` "Post-merge rescope".
- R8e residual (third-party `setViewState` clobber) is documented, not fixed. If dogfooding surfaces user reports, a detect-and-recover FI follows.
- A small Phase 3.5-style follow-up may be needed if dogfooding surfaces chrome regressions.

**Notes from Phase 2 (added 2026-04-17):**

Phase 2's ADR is [docs/adr/0006-workspace-container.md](../../docs/adr/0006-workspace-container.md) (not 0005 as this meta-plan originally predicted — 0005 was taken by picker headers). Full report: [phase-2-completion-report.md](phase-2-completion-report.md). Implementation-grade guidance and clean-code notes live in [phase-2-lessons.md](phase-2-lessons.md) — read that before writing Phase 3's spec. Key load-bearing properties Phase 3 must preserve or knowingly change:

- **Leaf placement: `workspace.createLeafInParent(rootSplit, rootSplit.children.length)` with `rootSplit.direction = "horizontal"`.** Pattern already in `src/dock/bottom-dock.ts:44–77`. This is the load-bearing R8b/c/d mitigation — any shift to `workspace.getLeaf("split", "horizontal")` reopens the sibling-into attack surface. Feature-detect and fall back to `getLeaf("split")` only as a degraded mode; surface a one-time console warning when that happens.
- **Set `view.navigation = false` on the container class.** Load-bearing R8a mitigation. Documented since Obsidian 0.15.1; no feature-detect needed (minAppVersion 1.5.0).
- **Do NOT call `setPinned(true)`.** Tried and dropped — redundant when `navigation = false` is set. The ADR records this so future maintainers don't re-add it by habit.
- **Integration seam is `src/main.ts:159–170`'s `getDock()`.** Phase 3's `getDock()` returns the container leaf (creating it if absent); `openTerminalWithSpec(spec)` calls `container.addTab(spec)` instead of `dock.openLeaf() + setViewState`. `BottomDock` collapses to single-leaf; `reconcileDock` becomes "is the container open?"
- **Tab state serialization — SUPERSEDED.** Original note said Phase 3 owed `getState()`/`setState()` tab serialization. AC8 was dropped post-merge; on view reconstruction, the container shows one blank terminal instead of restoring N tabs. See `phase-3-workspace-container-completion-report.md` "Post-merge rescope".
- **R8e is documented residual, not engineering work.** Third-party plugins calling `leaf.setViewState({type:"markdown"})` on the container leaf can destroy it; no sanctioned API blocks this. User-facing documentation lives at [docs/explanations/third-party-plugin-compatibility.md](../../docs/explanations/third-party-plugin-compatibility.md); update it when Phase 3 ships (it currently hedges with "once the container ships").
- **Throwaway assets to delete when Phase 3 lands:** `wdio.proto.conf.mts`, the `test:e2e:proto` script in `package.json`, and the entire `specs/anvil/pane-chrome-and-picker/phase-2-prototype/` directory. Phase 3 replaces the prototype's R8 coverage with additions to `tests/e2e/tab-isolation.e2e.ts`.
- **FI-012 relationship.** Independent, per the ADR. Phase 3 can ship Rank 3 without solving FI-012's "flatten on dock open" concern; both still benefit from a single structural pass.

---

## Self-Check Notes

**Goldilocks:** Phase goals are 3–5 sentences; success criteria stated as outcomes.
**Substitution:** Each phase has multiple viable means to its end (Phase 1 has two distinct UI approaches; Phase 2's output form is itself a decision; Phase 3's wiring is open).
**Discovery:** Phase specs each need real investigation — Phase 2's investigation IS the phase, Phase 3 can't be planned until Phase 2's ADR exists.
**Stability:** If Phase 2 surprises (e.g., `WorkspaceTabs` unusable), Phase 3's goal still holds — only the means change.
**Independence:** Phase 1 is parallelizable with Phases 2–3. Phases 2 and 3 are sequential by nature.
**Anti-pattern check ("stealing the sub-plan's job"):** No file paths or function signatures in goals; success criteria reference files only as verification anchors. Open design questions are flagged, not pre-answered.
