# Phase 3 FI-012 Spike Findings

**Date:** 2026-04-18
**Outcome:** **FI-012 IN.** Recipe is viable against pinned Obsidian 1.12.7 and implementable in Phase 3.
**Evidence:** `tests/e2e/fi-012-spike.e2e.ts` — PROBE 11 passes both multi-child and single-child scenarios with clean forward + reverse paths.

## The problem

Today's `src/dock/bottom-dock.ts` opens the terminal container by flipping `rootSplit.direction = "horizontal"` and appending a leaf. If the user had two notes side-by-side (`rootSplit.direction = "vertical"`), the flip flattens them into a top/bottom stack — the "jarring" experience MT-007 accepted as a known limit.

FI-012's goal: **preserve the existing layout** by wrapping rootSplit's current children in a nested `WorkspaceSplit(originalDirection)` before flipping rootSplit to horizontal and docking the terminal as a full-width row.

## The recipe (HIJACK via createLeafBySplit)

Fresh-construct of a `WorkspaceSplit` via reflection (`new WsSplitClass(workspace)`) **fails** — the constructor leaves `containerEl` undocumented-but-required-but-uninitialized, and `insertChild` trips on `insertBefore` with a non-Node arg.

Working approach: let Obsidian build a wrapper for us via `createLeafBySplit`, then repurpose it.

```
// Forward: openWithWrap() returns a handle, or null if no wrap needed
function openWithWrap(): { wrapper, originalDirection } | null {
  const originalDirection = rootSplit.direction ?? "vertical"
  if (rootSplit.children.length < 2) return null   // single child: no wrap

  const pivotLeaf = <any leaf inside rootSplit>
  const perpDir = originalDirection === "vertical" ? "horizontal" : "vertical"
  const scratchLeaf = workspace.createLeafBySplit(pivotLeaf, perpDir)
  // Obsidian now has: rootSplit → [wrapper(perpDir, [pivotTabs, scratchTabs]), ...other rs siblings]
  const wrapper = pivotLeaf.parent.parent   // climb: leaf → tabs → wrapper

  // Move remaining rs siblings INTO wrapper BEFORE detaching scratch,
  // so wrapper always has >= 2 children (avoids auto-collapse on 1-child)
  for (sibling of rootSplit.children.filter(c => c !== wrapper)) {
    rootSplit.removeChild(sibling)
    wrapper.insertChild(wrapper.children.length, sibling)   // (index, child)
  }

  scratchLeaf.detach()                // wrapper still has >= 2 real children
  wrapper.setDirection(originalDirection)
  rootSplit.setDirection("horizontal")
  wrapper.allowSingleChild = true     // prevents collapse during unwind

  return { wrapper, originalDirection }
}

// Reverse: closeWithUnwrap(handle)
function closeWithUnwrap(h) {
  if (h === null) return   // standard single-child path handled by BottomDock
  for (k of [...h.wrapper.children]) {
    h.wrapper.removeChild(k)
    rootSplit.insertChild(rootSplit.children.length, k)
  }
  if (h.wrapper.parent === rootSplit) rootSplit.removeChild(h.wrapper)
  rootSplit.setDirection(h.originalDirection)
}
```

## Key API findings

**Public, typed (stable):**
- `workspace.createLeafBySplit(leaf, direction)` — builds a new nested WorkspaceSplit around leaf's tabgroup when direction is perpendicular to parent. Returns the new leaf; wrapper is `pivot.parent.parent`.
- `workspace.createLeafInParent(parent, index)` — already used in `src/dock/bottom-dock.ts`.

**Undocumented (internal prototypes, must feature-detect):**
- `split.insertChild(index, child)` — **args are (index, child), NOT (child, index)**. Clamps out-of-range index to append.
- `split.removeChild(child)` — detaches and auto-collapses if remaining child count drops to 1 unless `allowSingleChild === true`.
- `split.setDirection("horizontal" | "vertical")` — already feature-detected in `src/dock/bottom-dock.ts:47-63`.
- `split.allowSingleChild: boolean` — runtime flag. Set to `true` on the wrapper after forward recipe to prevent collapse during reverse.

**Source of `insertChild` (verbatim from 1.12.7 bundle):**
```js
function(e, t) {
  var n = this, i = n.workspace, r = n.autoManageDOM, o = n.containerEl, a = n.children;
  (e < 0 || e >= a.length) && (e = a.length);
  var s = a[e], l = s ? s.containerEl : null;
  if (a.splice(e, 0, t), r) {
    var c = t.containerEl;
    o.insertBefore(c, l)
  }
  t.setParent(this);
  i.onLayoutChange(this)
}
```

**Source of `removeChild` (collapse logic):**
```js
function(e) {
  var t=this, n=t.workspace, i=t.autoManageDOM, r=t.parent, o=t.children;
  if (o.remove(e), e.setParent(null), i && e.containerEl.detach(), r)
    if (1 !== o.length || this.allowSingleChild) {
      if (0 === o.length) return void r.removeChild(this)
    } else {
      var a=o[0];
      o.remove(a); i && a.containerEl.detach(); a.setParent(null);
      var s = r.children.indexOf(this);
      i && r.replaceChild(s, a);
      a.setDimension(this.dimension)
    }
  n.onLayoutChange(this)
}
```

## Why the "fresh-construct" approach failed

Reflected `WorkspaceSplit` class via `Object.getPrototypeOf(...rootSplit proto chain...).constructor`. The constructor signature is `function t(t, n, i)` — workspace, ?, ?. Calling `new cls(workspace)` produces an object with `parent=null, children=[], type="split", direction=null` but **`containerEl` remains undefined** until something (unclear what) initializes it. Subsequent `insertChild` calls fail because `this.containerEl.insertBefore` throws on undefined.

The HIJACK approach sidesteps this entirely — `createLeafBySplit` constructs a fully DOM-wired WorkspaceSplit for us.

## Layout serialize/restore

`workspace.getLayout()` on the wrapped state produces:
```json
{
  "type": "split",
  "direction": "horizontal",
  "children": [
    {
      "type": "split",
      "direction": "vertical",
      "children": [
        { "type": "tabs", "children": [{ "type": "leaf", "state": {...markdown noteA} }] },
        { "type": "tabs", "children": [{ "type": "leaf", "state": {...markdown noteB} }] }
      ]
    },
    { "type": "leaf", "state": { "type": "empty" } }
  ]
}
```

This is the exact FI-012 target shape. Obsidian's built-in layout restore on reload should reconstitute it cleanly — nothing in this tree is non-standard from Obsidian's perspective. Full serialize/restore round-trip verification deferred to Phase 3 production e2e.

## Feature-detect strategy

Gate the wrap path on **all four undocumented predicates present**:
```ts
const canWrap =
  typeof workspace.createLeafBySplit === "function" &&
  typeof rootSplit.insertChild === "function" &&
  typeof rootSplit.removeChild === "function" &&
  typeof rootSplit.setDirection === "function";
```

If any is absent → fall back to today's flat behavior (current `src/dock/bottom-dock.ts:65-83` path). Log one-time console warning `"[anvil] rootSplit wrap unavailable; degrading to flat dock (FI-012 disabled this session)"`. Terminal still opens; columns still flatten; user sees today's MT-007 "jarring but acceptable" behavior.

`wrapper.allowSingleChild = true` is a property assignment, not a method call — no feature-detect needed (property assignment is benign on any object). If the internal collapse logic is removed in a future Obsidian, the flag just becomes a no-op; no regression.

## Risks and mitigations

1. **Undocumented `insertChild`/`removeChild` signatures** — if args swap or behavior changes in a future Obsidian, the wrap path breaks. Mitigation: feature-detect gate + fallback to flat dock. Regression test in e2e catches behavior change against pinned binary.
2. **`allowSingleChild` prevents garbage collection of orphan wrappers** — if our reverse path errors mid-flight leaving wrapper attached, its `allowSingleChild = true` keeps it alive with no children. Mitigation: wrap reverse in try/finally, force-remove wrapper from rootSplit at end regardless.
3. **Auto-collapse during forward recipe** — if a sibling reparent throws, wrapper could be left in an inconsistent state. Mitigation: wrap forward in try/catch; on error, detach scratch + remove any inserted siblings back to rootSplit + remove wrapper.
4. **Layout restore edge cases** — while Obsidian's layout serializer produces standard JSON, the restore might not recreate `allowSingleChild = true` on the wrapper, meaning a restored wrapper could auto-collapse on a subsequent close. Mitigation: on container-view onOpen, walk rootSplit and re-apply `allowSingleChild = true` to any wrapper we own. Or simpler: set `allowSingleChild = true` at the start of `closeWithUnwrap` every time.

## Acceptance criterion AC15 (from spec)

**Passes with FI-012 IN:** with two notes open side-by-side, opening the terminal leaves them side-by-side and docks the container as a full-width row below. Closing restores original layout exactly. Proven by PROBE 11 forward+reverse paths.

## What Phase 3 production code owes

1. Implement `openWithWrap()` / `closeWithUnwrap()` in a new module (`src/dock/wrap-and-dock.ts` or similar). Keep logic pure with feature-detect + fallback local idiom matching `src/dock/bottom-dock.ts:44-77`.
2. Integrate with container view's onOpen (invoke openWithWrap) and onClose (invoke closeWithUnwrap).
3. E2E: port PROBE 11's assertions as `tests/e2e/fi-012-wrap-and-dock.e2e.ts` — multi-child wrap scenario + single-child passthrough + layout serialize/restore round-trip against the real container view.
4. Delete `tests/e2e/fi-012-spike.e2e.ts` (this probe) once the production e2e covers the same ground.
