# 0005. Picker section labels as decorated DOM siblings, not selectable items

- **Status:** Accepted
- **Date:** 2026-04-16

## Context

The profile picker (`Cmd-Shift-P → Anvil: Open terminal`) is built on Obsidian's `SuggestModal`. Sections in the list — "Launch new" above the available shells, "Attach to tmux session" above the detected tmux sessions — were modeled as members of the same `PickerItem` discriminated union as the real rows, with `kind: "header"`. The modal flattened them into the suggestion list like any other item.

That choice let arrow navigation land on a header and let a mouse click fire `onChooseSuggestion` against one. The existing code papered over the first problem with a reset hack (`case "header": this.open()` — close the picker and reopen it on selection), and the second by hoping nobody clicked. It also meant the filter had to special-case "hide empty section header," which grew its own bug surface inside `filterPickerItems`.

FI-010 in the future-ideas backlog framed two fix candidates. Option A kept headers as `PickerItem`s and bolted on `pointer-events: none` plus custom arrow-skip handling — smaller diff, but kept the header-as-selectable failure mode reachable by construction; any future code touching the switch had to remember the special case. Option B removed `kind: "header"` from the union entirely and rendered section labels as decorated DOM siblings of the suggestion list — closer to how Obsidian's own command palette handles section grouping.

## Decision

Use **Option B**. Headers cease to be `PickerItem`s.

- `picker-items.ts` is restructured around a first-class `PickerSection { label, items }` shape. The modal consumes sections for label injection and flattens them into the list `SuggestModal` sees. New exports: `buildPickerSections`, `filterPickerSections`, `flattenSections`, `findDefaultShellFlatIndex`. The old item-union exports are deleted.
- `ProfilePickerModal` overrides `SuggestModal.updateSuggestions`. The override calls `super.updateSuggestions(...)`, then walks `resultContainerEl` children and inserts `.anvil-picker-header` `<div>` siblings before each section's first item. Section metadata is captured from the most recent `getSuggestions` call.
- The override is a reach into undocumented Obsidian surface. `resultContainerEl` is public (since 0.9.20); `updateSuggestions` is not. The hook is feature-detected at module load against `SuggestModal.prototype.updateSuggestions` and wrapped in try/catch around both the `super` call and the injection, following the graceful-degrade pattern from `src/dock/bottom-dock.ts:47–63`. If the method disappears in a future Obsidian, the picker degrades to "no labels, items still render in order" — it does not throw, does not hang.
- Section labels use Obsidian theme tokens only (`--text-faint`, `--background-secondary`, `--font-ui-smaller`, `--font-semibold`). `pointer-events: none` is set on the label DOM defensively — click can't reach `onChoose` anyway because the label is not a `.suggestion-item`, but the CSS makes that explicit at the style layer too.
- The `case "header": this.open()` reset hack is gone. Removing `kind: "header"` from the union made TypeScript's exhaustiveness check strip it automatically.

MutationObserver on `resultContainerEl` was considered as a more defensive alternative (no reach into private API) but rejected as more code and harder to reason about; the `updateSuggestions` override has a narrower contract. Overriding `renderSuggestion` to emit a label-plus-item composite was also rejected — it breaks the `SuggestModal` contract that each call produces one suggestion item, and risks layout bugs from siblings rendered inside `.suggestion-item` containers.

Context: [phase-1 spec](../../specs/anvil/pane-chrome-and-picker/phase-1-picker-headers-spec.md), [completion report](../../specs/anvil/pane-chrome-and-picker/phase-1-completion-report.md), FI-010 in `specs/anvil/future-ideas-backlog.md`.

## Consequences

**Easier:**

- The header-as-selectable failure mode is impossible by construction. Arrow Up/Down cannot land on a header because the label DOM is not a `.suggestion-item`. Mouse click does not fire `onChoose` because the label is not in the chooser's item set. E2E assertions (AC1, AC2, AC4, AC5) lock these properties in place.
- `PickerItem` is a clean three-variant union (`shell`, `new-tmux`, `tmux-session`). `onChooseSuggestion`'s switch is exhaustive over the variants that actually do something, with no synthetic branch that should never fire.
- Filter behavior is section-aware at the data layer. A section with zero matches drops its label as a consequence of the data shape, not as a special case in the render path. The "hide empty section header" branch in the old filter is gone.
- There is now a second data point for the feature-detect + graceful-degrade pattern in this codebase. Paired with the existing `chooser?.setSelectedItem?.()` call inside the picker's default-shell pre-select, the shape of "reach into undocumented SuggestModal surface, but only if it's still there" is recognizable as a local idiom.

**Harder:**

- Adds a second reach into undocumented Obsidian internals. Full method override on `SuggestModal.updateSuggestions` is a bigger commitment than the one-line opportunistic call that already existed. A future Obsidian release renaming or restructuring `updateSuggestions` means the feature-detect catches it and the labels silently disappear — the picker keeps working, but nobody notices the degradation until they glance at the modal.
- `updateSuggestions` is not typed in Obsidian's public API. TypeScript cannot guarantee the signature. Any shift in how Obsidian populates `resultContainerEl` — async child insertion, deferred rendering, intermediate clears — would surface as label-injection bugs rather than type errors. The override assumes a synchronous populate-then-return contract that holds in Obsidian 1.12.7 (the pinned e2e binary) but is not documented to hold forever.
- If a second `SuggestModal`-derived component in the plugin later needs the same pattern, it has to copy this one. The spec boundary forbade generalizing the label-injection hook into a reusable helper on this phase's scope — defer that refactor to the second use case, not the first.

**Reversible?** Mostly. The data-shape change (`PickerSection` as primary, `kind: "header"` out of the union) is a local refactor of `picker-items.ts` and its one consumer. The `updateSuggestions` override is one private method on `ProfilePickerModal` — swapping it for MutationObserver or a different injection hook touches the modal only, not the item model. What's not reversible without a visible regression is the UX contract ("headers read as labels, rows read as buttons"). Walking that back would reintroduce FI-010 and the `case "header"` hack that went with it.
