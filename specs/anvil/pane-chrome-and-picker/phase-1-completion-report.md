# Phase 1 — Completion Report

**Mode:** Code Tests (Mode B)
**Cycles:** 1 (clean pass — RED → GREEN with one test-design pivot, no impl rework)
**Status:** GREEN

## Deliverables

- `src/picker/picker-items.ts` — restructured. `kind: "header"` removed from `PickerItem` union. New first-class `PickerSection { label, items }` shape. New exports: `buildPickerSections`, `filterPickerSections`, `flattenSections`, `findDefaultShellFlatIndex`. Old exports (`buildPickerItems`, `filterPickerItems`, `findDefaultShellIndex`) deleted — they referenced the dead union variant.
- `src/picker/profile-picker.ts` — rewritten. `case "header"` branches removed (TS exhaustiveness enforced this). New `updateSuggestions` override with feature-detect at module load + try/catch around both the super call and the injection. New private `injectSectionLabels()` walks `resultContainerEl` children and inserts `.anvil-picker-header` `<div>` siblings before each section's first item.
- `src/styles.css` — added `.anvil-picker-header` rules. Theme-token-driven (`--text-faint`, `--background-secondary`, `--font-ui-smaller`, `--font-semibold`). `pointer-events: none` defends R4 even though the element is structurally outside `.suggestion-item`.
- `src/picker/picker-items.test.ts` — fully rewritten for the new shape. 17 unit tests (was 15).
- `src/picker/profile-picker-r7.test.ts` — new. 4 source-level assertions covering R7 graceful-degrade structure + AC7 (no `case "header"` branch).
- `tests/e2e/picker.e2e.ts` — 7 new tests appended (AC1, AC2 down, AC2 reverse up, AC3, AC4, AC5, AC6). All 5 original tests preserved unmodified — AC8 satisfied.

## Test results

- **Unit:** 107 passed (12 files). New: 17 picker-items + 4 R7 source assertions = 21 added/rewritten in `src/picker/`.
- **E2E:** 39 passed (8 spec files). Picker file: 13/13 (5 original + 8 new).

## Acceptance criteria coverage

| AC | Covered by | Status |
|----|------------|--------|
| AC1 | `picker.e2e.ts` "no .anvil-picker-header element is also a .suggestion-item" | GREEN |
| AC2 | `picker.e2e.ts` "ArrowDown navigation visits only selectable rows" | GREEN |
| AC2 reverse | `picker.e2e.ts` "ArrowUp navigation visits only selectable rows" | GREEN |
| AC3 | `picker.e2e.ts` "section header computed style differs from a shell row" | GREEN |
| AC4 | `picker.e2e.ts` "clicking on a section header is a no-op" | GREEN |
| AC5 | `picker.e2e.ts` "the Launch new header sits immediately before the first shell row" | GREEN |
| AC6 | `picker.e2e.ts` "a query matching shells but no tmux sessions hides the tmux header" | GREEN |
| AC7 | `profile-picker-r7.test.ts` "does not contain a 'case header' branch" | GREEN |
| AC8 | All 5 existing picker e2e tests pass unmodified | GREEN |
| AC9 | `profile-picker-r7.test.ts` (try/catch source guard) + happy-path suite (no uncaught throws) | GREEN — verified structurally, see "Notes" |
| AC10 | Manual — see Required Manual Verification | Pending user |

## D3 Resolution

**Option 1 chosen: override `SuggestModal.updateSuggestions`.**

Findings: Obsidian's public API exposes `resultContainerEl` (`@since 0.9.20`) but not `updateSuggestions`. The override targets the undocumented surface, with feature-detect at module load against `SuggestModal.prototype.updateSuggestions`. If the method is absent in a future Obsidian version, the override no-ops — picker degrades to "no labels, items still render in order" (R7).

The codebase already has precedent for reaching into SuggestModal internals at `profile-picker.ts:69` (`chooser?.setSelectedItem?.()` for default-shell pre-select), so this is consistent with existing risk posture.

## User Testing

Per the spec (Section "User Testing", steps 1–7). Quick reference:

1. **First-look read.** Cmd-Shift-P → "Anvil: Open terminal". Confirm "Launch new" / "Attach to tmux session" read as labels, not selectable rows.
2. **Arrow drill (down).** Hold Down. Highlight should never sit on a header for a frame.
3. **Reverse drill (up).** Hold Up from a tmux session row. Same property in reverse.
4. **Mouse poke.** Click directly on "Attach to tmux session". Modal stays open, no terminal launches.
5. **Filter — section hide.** Type `zsh`. "Attach to tmux session" label disappears; "Launch new" stays. Backspace; tmux header returns.
6. **Filter — both sections.** Type a substring shared by a shell name and a session name. Both labels remain visible above their matching rows.
7. **Theme toggle.** Settings → Appearance, switch theme. Reopen picker. Header still distinguishable.

Steps 2–6 are also covered by automated e2e (AC2, AC2-reverse, AC4, AC6). Steps 1 and 7 are aesthetic judgment calls — required manual verification (below).

## Required Manual Verification

Two items cannot be reduced to automated checks. The user must verify these by hand before Phase 1 is fully complete:

1. **AC10 / User Testing step 1 — "reads as labels without instruction."** AC3 proves the computed style differs structurally, but the *aesthetic judgment* ("does it actually read as a label, or does it just look broken?") is a human call. Open the picker, glance, confirm.
2. **User Testing step 7 — theme toggle visual survival.** R1 requires distinguishability "survives light/dark theme toggle." The styles use Obsidian theme tokens (no hardcoded colors), so this should hold structurally — but the visual judgment ("still feels like a label, not a regression") needs a human eyeball in both themes.

## Notes for downstream phases

- **D3 hook is feature-detected at module load**, not per-instance. If Obsidian removes `updateSuggestions` mid-session via a hot reload, the picker won't notice — but that's not a real scenario. Per-instance detection would only matter if the prototype mutates between picker openings.
- **`PickerItem` union is now smaller and exhaustive** (3 variants — `shell`, `new-tmux`, `tmux-session`). Any downstream code touching the picker should use `PickerSection` for grouping intent and `flattenSections` when it needs the indexed flat view.
- **The injection helper `injectSectionLabels` is private to `ProfilePickerModal`.** If a Phase 2/3 modal needs the same pattern, do not generalize prematurely — the spec's boundary explicitly excluded that. Copy the pattern at the second use case if and when it appears.
- **Meta-plan correction worth surfacing to the user:** `meta-plan.md:32` claims `styles.css` is single-line minified and Phase 1 inherits a "build step vs hand-edit" choice. This is wrong — `src/styles.css` is the authored source (now 36 lines), and `esbuild.config.mjs` already bundles + minifies it into the deployed `styles.css`. No decision exists. Recommend editing the meta-plan to remove that constraint.
- **Open Dependabot PRs (surfaced at phase kickoff, not addressed):** `typescript` 5.9.3 → 6.0.2, `mocha` 10.8.2 → 11.7.5, `@types/node` 22.10.2 → 25.6.0. All major bumps. None blocked Phase 1. Review deliberately before Phase 2.

## What Phase 1 did NOT do (per Boundaries)

- No FI-012 workspace flatten on dock open (Phase 2/3).
- No FI-014 terminal pane chrome / multi-terminal tabs (Phase 2/3).
- No FI-015 settings-tab entries for picker behavior.
- No restyling of shell or tmux session rows beyond what's needed for header contrast.
- No changes to `ProfileChoice` or `TerminalBackend` shapes.
- No generalized section-label-injection abstraction.
