# 0007. FI-012 wrap-and-dock via `createLeafBySplit` hijack

- **Status:** Accepted
- **Date:** 2026-04-18

## Context

Before Phase 3, opening the terminal called `BottomDock.openLeaf` (`src/dock/bottom-dock.ts:44–77`), which flipped `rootSplit.direction = "horizontal"` and appended the terminal as a direct child of rootSplit. When the user had two notes open side-by-side (`rootSplit.direction = "vertical"`), that flip flattened the columns into a vertical stack — the MT-007 "jarring but acceptable" behavior.

FI-012 in the backlog proposed preserving the original layout by nesting the existing rootSplit children inside a new intermediate `WorkspaceSplit(originalDirection)` before flipping rootSplit to horizontal and docking the terminal as a full-width sibling of that wrapper. The Phase 3 spec (`specs/anvil/pane-chrome-and-picker/phase-3-workspace-container-spec.md`) made FI-012 IN-with-kill-switch: it ships in Phase 3 if a ≤1-day API-investigation spike finds a reliable, feature-detectable path against the pinned Obsidian 1.12.7 test binary; otherwise it drops back to the backlog.

The spike ran on 2026-04-18 (full findings in `specs/anvil/pane-chrome-and-picker/phase-3-fi-012-spike-findings.md`; the final probe landed in `tests/e2e/fi-012-spike.e2e.ts` as a two-scenario reference). A working path surfaced. FI-012 is IN.

## Decision

Adopt the **HIJACK via `createLeafBySplit`** recipe. Use Obsidian's public `workspace.createLeafBySplit(leaf, perpendicularDir)` to force Obsidian to construct a fully DOM-wired `WorkspaceSplit` around a pivot leaf's tab group. Reparent rootSplit's other children INTO that wrapper via the undocumented `rootSplit.removeChild` / `wrapper.insertChild(index, child)` methods. Detach the scratch leaf, flip the wrapper's direction back to the original rootSplit direction, flip rootSplit to horizontal, dock the terminal container via the existing `createLeafInParent` path. Set `wrapper.allowSingleChild = true` to keep the wrapper alive during the reverse path. On close: drain children back to rootSplit, remove the wrapper, restore rootSplit direction.

The alternative — constructing a fresh `WorkspaceSplit` via reflection on rootSplit's prototype chain (`new WsSplitClass(workspace)`) — was proven unworkable during the spike: the constructor leaves `containerEl` undefined, and the first `insertChild` call trips with `Cannot read properties of undefined (reading 'containerEl')`. Two-or-three-arg constructor variants weren't explored exhaustively; the hijack path sidesteps the problem by letting Obsidian own construction.

**Load-bearing facts for the impl** — these are the trap doors the spike found:

- `split.insertChild(e, t)` has signature `(index, child)`, **not** `(child, index)`. Passing them reversed silently crashes with a Blink `insertBefore` type error because `t.containerEl` resolves to `undefined` on a number primitive. Verified against the 1.12.7 bundle source.
- `split.removeChild(child)` auto-collapses the split when the remaining child count drops to 1 unless `this.allowSingleChild === true`. The forward recipe must reparent siblings INTO the wrapper before detaching the scratch leaf, so the wrapper never hits 1 child. The reverse recipe must set `allowSingleChild = true` before draining, so children can be removed one at a time without triggering the collapse promotion.
- The wrapper's identity is `pivotLeaf.parent.parent` after the hijack call — three levels down: `WorkspaceLeaf` → `WorkspaceTabs` → new `WorkspaceSplit`.

**Feature-detect predicates** — gate the wrap path on all four:

```ts
const canWrap =
  typeof workspace.createLeafBySplit === "function" &&   // public, typed, stable
  typeof rootSplit.insertChild === "function" &&         // undocumented
  typeof rootSplit.removeChild === "function" &&         // undocumented
  typeof rootSplit.setDirection === "function";          // undocumented, already used
```

Any predicate missing → degrade to today's flat `BottomDock` path. Log one-time console warning `"[anvil] rootSplit wrap unavailable; degrading to flat dock (FI-012 disabled this session)"`. Terminal still opens, columns still flatten, behavior matches MT-007.

Context: [phase-3 spec](../../specs/anvil/pane-chrome-and-picker/phase-3-workspace-container-spec.md), [spike findings](../../specs/anvil/pane-chrome-and-picker/phase-3-fi-012-spike-findings.md), [ADR 0006](./0006-workspace-container.md) (the container-view decision FI-012 wraps around).

## Consequences

**Easier:**

- Side-by-side note layouts survive opening the terminal. Closing the terminal restores the original layout exactly. Proven by spike PROBE 11 forward + reverse against two representative scenarios (multi-child wrap, single-child passthrough).
- Single-child rootSplit (one note or one empty leaf) passes through the wrap recipe with `openWithWrap() → null` and uses the unchanged flat `BottomDock` path. No behavior change for the common "one thing open" case.
- The recipe is bounded to a dedicated module (planned `src/dock/wrap-and-dock.ts`) alongside the existing `bottom-dock.ts` idiom. Feature-detect + graceful-degrade follows the local pattern from `src/dock/bottom-dock.ts:47–63`. A future Obsidian removing any of the four internals silently falls back to today's flatten behavior rather than crashing.
- Adds a third data point for the feature-detect + fallback pattern (alongside `bottom-dock.ts` and `profile-picker.ts`'s `updateSuggestions` override — [ADR 0005](./0005-picker-section-labels-as-decorated-siblings.md)). The shape is increasingly recognizable as a local idiom.

**Harder:**

- Depends on **four** undocumented Obsidian internals per open/close cycle (`insertChild`, `removeChild`, `setDirection`, `allowSingleChild`). Three are methods, one is a runtime flag. The spike verified presence and signatures against the pinned 1.12.7 binary; upgrades to the pinned version need a re-run of the wrap-and-dock e2e coverage before merge.
- `insertChild(index, child)` arg order is **silently fatal** if reversed. The cost of getting it wrong is an `insertBefore` Blink error that looks like a DOM mount failure, not like a wrong-argument error. The impl module must name the args explicitly and not infer from call-site intuition. The 1.12.7 constructor source is dumped in the spike findings doc for reference.
- `allowSingleChild` is a runtime flag Obsidian reads during `removeChild`. If a future Obsidian release removes that branch, the forward recipe still works (wrapper never hits 1 child during open) but the reverse recipe may trigger auto-collapse mid-drain, promoting one child to rootSplit before we explicitly place it. The drain loop needs to be defensive about this: snapshot children upfront, remove each from wrapper first, then always insert into rootSplit whether the wrapper still exists or not.
- Layout save/restore produces clean JSON (proven via `workspace.getLayout()` — spike findings show the exact shape). But Obsidian's restore path won't re-apply `allowSingleChild = true` to a wrapper reconstituted from saved layout. The container view's `onOpen` or wrap-and-dock module needs to re-assert the flag on any wrapper it owns at load time. Easy; not forgettable.
- The alternative construction path (`new WsSplitClass(workspace)`) is dead-ended until someone figures out the full constructor contract. We are locked into the hijack approach; reverting to fresh-construct would require re-opening the container-init story.

**Reversible?** Yes, within a release. The whole recipe lives in a single module consumed by the container view's open/close path. Swapping it for the flat path restores the pre-FI-012 MT-007 behavior in one file. What's not cleanly reversible is the user-facing UX contract — once users depend on "opening the terminal does not flatten my columns," walking that back is a visible regression. If a future Obsidian drops any of the four internals and forces the fallback to activate session-wide, users on that version see the old flatten re-appear with a console warning as the only signal.
