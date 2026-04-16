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
- **`styles.css` is single-line minified** (bundled xterm CSS dominates the file). Phase 1 is the first phase to add custom styles since the minification — it inherits the choice between adding a pretty-print build step or accepting hand-edit pain.
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

**Goal:** Apply Phase 2's chosen design. The terminal pane gains the native chrome FI-014 enumerates (close affordance, drag handle, height persistence, editor-status-overlay displacement), opening additional terminals adds them as tabs to the same shared container rather than stacking as sibling panes, and opening the dock with existing horizontal columns no longer flattens them (FI-012). All three FI value statements land as user-visible behavior. The new undocumented-API surface ships with the same feature-detect + graceful-degrade pattern as the existing dock code.

**Dependencies:** Phase 2 complete (ADR accepted, prototype proven).

**Success criteria:**
- Terminal close X is visible and functional without keyboard fallback
- Native drag affordance repositions the terminal pane (or any individual terminal tab within the group)
- Terminal height persists across close/reopen
- Obsidian's editor status overlay no longer overlaps terminal text when a note is open above
- Opening a second terminal adds it as a new tab in the existing terminal container — does NOT create a sibling pane stacked next to or above the existing terminal
- The plus action (today on the view header) opens the new terminal as a tab in the same group
- With existing horizontal note columns, opening the dock leaves columns side-by-side and docks the terminal container below as a full-width row
- E2E coverage of the new container + tab behavior matches the standard set in `testing-approach.md`
- Feature-detect fallbacks degrade to today's flatten-on-flip + sibling-pane behavior if the new APIs disappear in a future Obsidian — never crash

**Risk flags:**
- `tests/e2e/tab-isolation.e2e.ts` may need updating if the container change shifts leaf-isolation semantics
- HTML5 DnD Electron flakiness flagged in `testing-approach.md` — native tab drag is supposed to sidestep it; verify
- Spike-to-impl drift: a throwaway prototype won't have hit every edge case
- A small Phase 3.5-style follow-up may be needed if dogfooding surfaces chrome regressions

---

## Self-Check Notes

**Goldilocks:** Phase goals are 3–5 sentences; success criteria stated as outcomes.
**Substitution:** Each phase has multiple viable means to its end (Phase 1 has two distinct UI approaches; Phase 2's output form is itself a decision; Phase 3's wiring is open).
**Discovery:** Phase specs each need real investigation — Phase 2's investigation IS the phase, Phase 3 can't be planned until Phase 2's ADR exists.
**Stability:** If Phase 2 surprises (e.g., `WorkspaceTabs` unusable), Phase 3's goal still holds — only the means change.
**Independence:** Phase 1 is parallelizable with Phases 2–3. Phases 2 and 3 are sequential by nature.
**Anti-pattern check ("stealing the sub-plan's job"):** No file paths or function signatures in goals; success criteria reference files only as verification anchors. Open design questions are flagged, not pre-answered.
