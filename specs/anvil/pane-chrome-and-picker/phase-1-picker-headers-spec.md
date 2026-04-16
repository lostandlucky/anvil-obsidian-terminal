# Phase 1: Picker Section Header Polish — Spec

Meta-plan reference: [meta-plan.md](./meta-plan.md) Phase 1 (lines 47–64). FI-010 reference: `specs/anvil/future-ideas-backlog.md` lines 70–81.

## Objective

Section headers in the profile picker (`"Launch new"`, `"Attach to tmux session"`) become visually unambiguous as labels rather than selectable rows, AND structurally cease to be selectable items at all — they are decorative DOM siblings of the suggestion list, not entries in it. The header-as-selectable failure mode is impossible by construction, not by recovery.

## Diagnostic Flags Against the Meta-Plan

- **Goldilocks ✓** — phase goal is 3 sentences; success criteria are outcomes.
- **Substitution ✓** — two genuine approaches existed; user picked Option B.
- **Discovery ✓** — Option B requires a small spike (D3) to pick the section-label DOM injection hook.
- **⚠️ Meta-plan claim is incorrect:** the constraint *"`styles.css` is single-line minified ... Phase 1 inherits the choice between adding a pretty-print build step or accepting hand-edit pain"* (meta-plan line 32) is wrong. `src/styles.css` already exists as readable source (20 lines, hand-authored), and `esbuild.config.mjs:67–73` already bundles + minifies it into the deployed `styles.css`. **The "build step vs hand-edit" decision is not a real fork.** Phase 1 just authors new rules in `src/styles.css`. Recommend the meta-plan be corrected separately; this spec proceeds without that decision.

## Decisions

### D1. Header rendering approach **[RESOLVED → Option B]**

Drop `kind: "header"` from `getSuggestions` entirely. Render section labels as decorated DOM inserted into `suggestion-container` as siblings positioned before the first item of each section. Mirrors Obsidian's command palette. Headers are not `PickerItem`s in the suggestion list — arrow navigation skips them by construction; mouse cannot select them (they are not `.suggestion-item` elements).

Rationale: structurally correct over smaller-diff. FI-010 flags this as preferred.

### D2. Header presence in the `PickerItem` union **[RESOLVED → removed]**

`kind: "header"` is removed from the `PickerItem` discriminated union. `picker-items.ts` is restructured to expose section grouping as a first-class data shape (e.g., `PickerSection { label, items }`), and the modal flattens sections for `getSuggestions` while retaining section metadata for label-DOM injection.

The `case "header": this.open()` branch in `onChooseSuggestion` disappears with the union narrowing; TypeScript exhaustiveness will enforce its removal.

### D3. Section-label DOM injection hook **[OPEN — resolve during exec spike]**

Three plausible insertion points; executing agent picks during a brief spike (≤30 min):

1. **Override `SuggestModal.updateSuggestions`.** Undocumented but stable surface. Call `super.updateSuggestions(...)`, then walk the freshly-rendered `suggestion-container` children and inject section-label DOM at the right positions using section metadata captured from the most recent `getSuggestions` call. Cleanest hook if it exists in 1.12.7.
2. **`MutationObserver` on `suggestion-container`.** Standard Web API (always available). React to child-list mutations and insert/remove section labels accordingly. More defensive against Obsidian internals changing, but more code and harder to reason about.
3. **Override `renderSuggestion` to prepend section-label DOM when rendering the first item of a section.** Reads the cleanest at the call site, but breaks the SuggestModal contract (each `renderSuggestion` call should produce one suggestion item, not a label-plus-item composite). Risk of layout/interaction bugs from siblings nested under `.suggestion-item`.

The agent should prototype option 1 first. If `updateSuggestions` is not an extensible hook in Obsidian 1.12.7 (the pinned test binary), fall back to option 2. Option 3 is only a last resort.

Whichever is chosen, the hook MUST follow R7 (feature-detect + graceful-degrade).

## Requirements

R1. **Header rows are visually distinguishable from selectable rows** using Obsidian theme tokens (`--text-muted`, `--text-faint`, `--background-secondary`, etc.) — not hardcoded colors. Distinguishability survives light/dark theme toggle.

R2. **Section header DOM is NOT a `.suggestion-item`.** It does not match the selector Obsidian uses for navigation/selection. Arrow Up/Down therefore cannot land on it; mouse click cannot select it. This is the structural property the whole approach is built around — assert it.

R3. **Arrow Up/Down keyboard navigation only visits selectable rows.** Verified by AC2; achieved by R2 by construction. Wrap behavior at start/end of list mirrors current `SuggestModal` behavior — don't invent new wrap semantics.

R4. **Mouse click on a section label is a no-op.** It does not invoke `onChoose`, does not close the modal, does not select anything. Achieved by R2 + (defensively) `pointer-events: none` on the label DOM.

R5. **The `case "header": this.open()` reset hack is removed.** No replacement; the case ceases to exist when `kind: "header"` leaves the union.

R6. **Filter behavior preserves section semantics.** Typing a query that matches no items in a section MUST hide that section's label too. Implementation has section-aware filtering (replaces the current "hide empty section header" branch in `picker-items.ts:64–104`). Sections with at least one matching item show the label; sections with zero matches hide the label.

R7. **Any new undocumented Obsidian API surface uses the feature-detect + graceful-degrade pattern** from `src/dock/bottom-dock.ts:47–63`. Specifically: if the chosen D3 hook fails (e.g., `updateSuggestions` is not overridable in a future Obsidian version), the picker MUST still open and remain usable. Acceptable degradation: section labels don't render at all; selectable items still render in order. Picker MUST NOT throw or hang.

R8. **No regression in existing picker e2e tests** (`tests/e2e/picker.e2e.ts`): default-shell pre-select, new-tmux row presence, new-tmux dispatch, "Launch new" header text rendering somewhere in the modal, Escape dismissal. Note: the existing test that asserts `.anvil-picker-header` contains the text "Launch new" (lines 76–82) still passes because the new section-label DOM should keep the same class.

R9. **Data model exposes sections as a first-class shape.** `picker-items.ts` exports a section-aware builder (e.g., `buildPickerSections(...)`) and a section-aware filter. The modal consumes sections, flattens for `getSuggestions`, retains section metadata for label injection. The `kind: "header"` variant is removed from the `PickerItem` union.

## Acceptance Criteria

AC1. **No suggestion-item ever has the header class.** E2E test: open the picker; assert that no element matches both `.suggestion-item` AND `.anvil-picker-header`. (Structural property — proves R2.)

AC2. **Arrow navigation visits only selectable rows.** E2E test: with shells + at least one tmux session present, programmatic `ArrowDown` keypresses from the first selectable row reach every selectable row in order. After each keypress, the `.is-selected` element MUST also have `.anvil-picker-shell`, `.anvil-picker-new-tmux`, or `.anvil-picker-tmux-session` — never `.anvil-picker-header`.

AC3. **Section labels are visually distinguishable.** E2E test: a `.anvil-picker-header` element's computed style differs from a `.anvil-picker-shell` element's computed style on at least one of `color`, `font-weight`, `font-size`, `text-transform`, `opacity`, or `background-color`. Asserts visual distinguishability without pinning specific values.

AC4. **Click on header is a no-op.** E2E test: synthetic mouse click on a `.anvil-picker-header` element does not invoke the `onChoose` callback, does not close the modal, does not advance `.is-selected`.

AC5. **Section labels appear above their sections.** E2E test: in the rendered DOM order inside `suggestion-container`, the `.anvil-picker-header` for "Launch new" appears immediately before the first `.anvil-picker-shell`. Same for "Attach to tmux session" and the first `.anvil-picker-tmux-session` (when tmux present and sessions exist).

AC6. **Section-aware filter hides empty sections.** E2E test: type a query that matches at least one shell but no tmux session names. The "Launch new" header remains visible above the matching shell row(s); the "Attach to tmux session" header is absent from the DOM (or has zero rendered children in its section).

AC7. **`onChooseSuggestion` no longer references `"header"`.** Source check: the `onChooseSuggestion` switch in `profile-picker.ts` does not contain a `case "header"` branch. (Mechanical — proves D2/R5.)

AC8. **Existing picker e2e tests pass unchanged.** All five tests in `tests/e2e/picker.e2e.ts` still pass without modification (except possibly trivial selector adjustments if the existing "Launch new header" test needs to look for the label outside `.suggestion-item`).

AC9. **Feature-detect graceful degrade.** Test (unit or e2e): if the D3 hook fails or returns no labels, the picker still opens and the suggestion list still renders all selectable items. No throw, no hang.

AC10. **Manual sanity (soft).** Opening the picker reads "headers are labels, rows are buttons" without instruction. Judgment call by user during user testing.

## User Testing

1. **First-look read.** Run `Cmd-Shift-P → Anvil: Open terminal`. Glance at the modal. Do "Launch new" and "Attach to tmux session" read as section labels, or do they still look like things you could pick?
2. **Arrow drill.** Open the picker. Hold Down arrow. Watch the highlight cross from the last shell row into the tmux section — confirm the highlight never sits on a header for a frame.
3. **Reverse drill.** From a tmux session row, hold Up arrow. Same check in reverse.
4. **Mouse poke.** Click directly on "Attach to tmux session" with the mouse. Modal should stay open, no terminal should launch, no flicker, no selection change.
5. **Filter — section hide.** Type `zsh` (or any query that matches shells but no tmux session names). The "Attach to tmux session" label should disappear; "Launch new" stays. Backspace; "Attach to tmux session" returns.
6. **Filter — both sections.** Type a query that matches in both sections (e.g., a substring shared by a shell name and a session name). Both labels remain visible above their respective matching rows.
7. **Theme toggle.** Switch Obsidian to the opposite theme (Settings → Appearance). Reopen picker. Header is still distinguishable.

## Boundaries

- **Out:** FI-012 (workspace flatten on dock open) — Phase 2/3 territory.
- **Out:** FI-014 (terminal pane chrome, multi-terminal tabs) — Phase 2/3 territory.
- **Out:** Settings tab entries for picker behavior — FI-015, separate meta-plan.
- **Out:** Restyling shell rows or tmux session rows beyond what's needed to make headers distinguishable by contrast.
- **Out:** Changing the data shape of `ProfileChoice` or `TerminalBackend` — both are stable contracts (CLAUDE.md / meta-plan constraints).
- **Out:** Generalizing the section-label-injection hook into a reusable abstraction. Use it in this modal only; refactor later if a second use case appears.
- **Out:** Modifying the existing five picker e2e tests except for trivial selector adjustments forced by the structural change. Add new tests; preserve the regression surface.

## Sources

- **Meta-plan:** [meta-plan.md](./meta-plan.md) lines 47–64 (Phase 1 entry)
- **Backlog entry:** `specs/anvil/future-ideas-backlog.md` lines 70–81 (FI-010, both fix candidates — Option B chosen)
- **Current modal:** `src/picker/profile-picker.ts` — `case "header": this.open()` hack at lines 88–90 (to be removed); `chooser.setSelectedItem` at lines 51–52 (still needed for default-shell pre-select, leave alone)
- **Item model + filter (target of restructure):** `src/picker/picker-items.ts` — header `PickerItem` at lines 6–7 (to be removed from union); filter's "hide empty section" logic at lines 64–104 (to be replaced with section-aware filter)
- **Source CSS (authored):** `src/styles.css` — 20 lines, normal authoring; esbuild bundles to `styles.css`. Add `.anvil-picker-header` rules here.
- **Build pipeline:** `esbuild.config.mjs:67–73` — confirms there's no hand-edit pain
- **Feature-detect pattern:** `src/dock/bottom-dock.ts:47–63` — canonical try/detect/fallback shape. Apply same shape to the D3 hook.
- **Existing test surface:** `tests/e2e/picker.e2e.ts` — five tests to preserve; AC1–AC6/AC9 add to this file
- **Testing approach (read before adding tests):** `specs/anvil/testing-approach.md`
- **Reference for the pattern (external):** Obsidian's own command palette (`Cmd-P`) — visual reference for how a SuggestModal-derived component handles section grouping. Source not in this repo; observe behavior in-app.
