# Phase 2 — Lessons for Phase 3

Companion to [phase-2-completion-report.md](phase-2-completion-report.md) and [ADR 0006](../../docs/adr/0006-workspace-container.md). This doc is for the developer (probably future-us) starting Phase 3. Everything here is load-bearing; don't skip.

## The mental model

**One leaf. N xterms inside. Plugin-owned chrome.**

The terminal dock is ONE Obsidian `WorkspaceLeaf` with a dedicated view type (something like `anvil-terminal-container-view`). That leaf is a **direct child of `workspace.rootSplit`** — not inside a `WorkspaceTabs` wrapper. Inside the leaf, the plugin manages N xterm instances with its own DOM: a tab-list selector on one side, a content pane showing the active xterm on the other.

There is nothing Obsidian-native about the tabs inside the container. They do not appear in Obsidian's tab strip. They don't participate in Obsidian's drag-between-tab-groups gesture. They don't get Obsidian's right-click tab menu. They are *our* tabs — DOM we draw, behavior we define, affordances we implement.

## Vocabulary — read this carefully

The word "tabs" is about to become ambiguous in your code. Pick one convention and enforce it at review time:

- **In-container tabs** (ours): the N entries in our tab-list selector. Each holds one xterm + one PTY. Switching between them is DOM display-toggling.
- **Obsidian tabs** (theirs): `WorkspaceTabs` — Obsidian's tab-group wrapper. **Our container does NOT live inside a `WorkspaceTabs`.** Every time you see "tab" in code that's ambiguous about which kind, flag it.

Naming suggestions: `TerminalTab` for our data type; never let the words "tab" or "tab group" refer to a `WorkspaceLeaf` or `WorkspaceTabs` in this codebase.

## Why we don't use Obsidian tabs

Short version: `WorkspaceTabs` is not typed. Any leaf can be added to any tab group at runtime via `openLinkText("tab")` or similar. If our container lived inside one, Obsidian would let users land a note as a sibling of the terminal — the terminal leaf stays, but gets hidden behind the note tab. We tested this (R8b) and watched it fail on our first pass. Placing the container as a direct `rootSplit` child removes the "adjacent slot" attack surface entirely.

Full rationale, including the four candidates (R1–R4) we rejected: [ADR 0006](../../docs/adr/0006-workspace-container.md).

## The load-bearing properties

Phase 3 implementation MUST preserve three properties. Drop any of them and an R8 probe goes red:

1. **Placement.** `workspace.createLeafInParent(workspace.rootSplit, workspace.rootSplit.children.length)`. The container leaf is appended as a direct child of `rootSplit`. Flip `rootSplit.direction = "horizontal"` on open so the container lands below existing leaves rather than beside them. Pattern to mirror: `src/dock/bottom-dock.ts:44–77`. Feature-detect `createLeafInParent` (it's undocumented); on fallback, degrade to `workspace.getLeaf("split", "horizontal")` and log one console warning. The fallback reopens R8b/c/d — the container still functions but isolation is reduced.

2. **`view.navigation = false`** on the container class. Documented since Obsidian 0.15.1; no feature-detect needed (`minAppVersion` is 1.5.0). Without it, default-mode `openLinkText` reuses the container leaf for a markdown open — R8a goes red.

3. **xterm survival across switches.** Never dispose an xterm on tab switch. Toggle `display: none` on the parent content pane. The PTY keeps running, scrollback persists, cursor position persists. This is the single most important UX property of the container — break it and tabs feel like they're throwing away work every time you click one.

**Do NOT call `setPinned(true)`.** Proven redundant in Phase 2's bite-check. Future-you may look this up and reach for it; the ADR records why it was dropped.

## Clean-code guidance for Phase 3

Things I would flag in code review:

- **Separate concerns.** Container view owns DOM chrome (tab strip, layout, switching). Per-tab holder owns xterm + PTY lifecycle, disposable independently. No cross-tab state outside the container's registry.
- **Single `switchTab` method.** All of: mark incoming tab active, toggle `display`, call `host.fit()`, call `host.focus()`, update the active-tab pointer. Not scattered across three handlers.
- **Reuse `PtyBackend` and `XtermHost`.** They work. Don't refactor them as part of this phase. The container is new; PTY wiring is not.
- **Don't import from the prototype.** `specs/anvil/pane-chrome-and-picker/phase-2-prototype/` is being deleted. Port ideas, not code.
- **Persistence: `getState` / `setState` on the container.** Serialize `{ tabs: Array<{shell, cwd, shellArgs}> }`. Deserialize in order, creating each tab sequentially. FI-005 (cross-session scrollback persistence) is larger and separate.
- **Don't break the existing single-terminal path until the new one is proven.** Suggested migration: register both `TerminalView` and the new container view in the same `onload`. Cut over `openTerminalWithSpec` in a targeted PR once the container passes e2e. Delete the old `TerminalView` in a follow-up PR so the migration is bisectable.
- **Tests first.** Port R8a–e from `specs/anvil/pane-chrome-and-picker/phase-2-prototype/r8.e2e.ts` into `tests/e2e/tab-isolation.e2e.ts` (rewritten for the container view type) **before** deleting the prototype. Keep the prototype as a reference until production coverage is green; then clean-cut both in one PR.
- **Feature-detect + fallback is local idiom.** See `src/dock/bottom-dock.ts:44–63`. Wrap the `createLeafInParent` call, log ONE warning on fallback, never throw. Do not build a more elaborate mechanism.
- **Chrome styling lives in `src/styles.css`.** Hand-authored. Use Obsidian theme tokens (`--background-secondary`, `--text-muted`, etc.) so light/dark modes work without extra effort. No hardcoded colors. No magic numbers — if you need a size, wire it to a theme variable or at least name the constant.
- **`+` affordance placement is a real choice.** The prototype kept both a view-header action and a tab-strip `+`. Phase 3's phase spec picks one and deletes the other. Tab-strip `+` is the VS Code-natural location; view-header action is the Obsidian-natural location. Both are defensible.

## What Phase 3 owes to the doc set

- **Update `docs/explanations/third-party-plugin-compatibility.md`.** It currently hedges with "once the multi-terminal container ships" in a couple of places; strip the hedges and update the view-type name from `obsidian-terminal-view` to the container's view type.
- **Extend `tests/e2e/tab-isolation.e2e.ts`** with R8a–e for the container view type. The probes are portable from Phase 2.
- **Delete the throwaway** — `wdio.proto.conf.mts`, the `test:e2e:proto` script in `package.json`, and the entire `specs/anvil/pane-chrome-and-picker/phase-2-prototype/` directory — as the final step of Phase 3. One clean PR.
- **If Phase 3 surfaces a surprise that supplements or supersedes ADR 0006** (unlikely, but possible), write a new ADR — don't edit 0006 — and cross-link.

## Questions you might ask

- **"Can we add Obsidian-native tab features later?"** Only if Obsidian ships a typed-tab-group API. Until then, no. The Jan 2026 forum thread requesting such an API is referenced in ADR 0006 and the prior-art research note; when that thread closes with a sanctioned API, revisit.
- **"What about dragging a tab to a new Obsidian window?"** Not supported in Phase 3. Our tabs are internal; dragging them across workspaces would require re-implementing Obsidian's cross-window leaf-drag as our own logic. FI-follow-up if dogfooding asks for it.
- **"What about Mononote / Hover Editor clobbering the container?"** Documented in `docs/explanations/third-party-plugin-compatibility.md`. No fix in Phase 3. Detection-and-recovery via `workspace.on("layout-change")` is an optional future FI — don't build it speculatively.
- **"Does the container need a settings-tab entry?"** FI-015 is out of scope for this meta-plan. Don't open that door.
