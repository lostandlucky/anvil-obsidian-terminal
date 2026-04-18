# Third-party plugin compatibility

Obsidian's plugin API does not provide a way for a view to refuse being replaced. If another plugin decides Anvil's terminal pane should become something else — a markdown editor, a hover preview, a Kanban board — Anvil cannot veto it. The terminal gets closed, the shell process is killed, and the scrollback is lost.

This is a limit of Obsidian's API, not a missing feature in Anvil.

## What it looks like

You've got a terminal pane open. You install a plugin, click a link, switch layouts — and suddenly the terminal pane is a markdown editor for a note you didn't expect, or the pane is gone entirely. The shell process is dead. Anything that was running in it (a build, `claude`, `vim`) is interrupted.

`tmux` sessions usually survive because the tmux server is a separate long-running process. The shell that was attached to the session is gone, but you can attach from a fresh terminal and pick up where you left off.

## Why it happens

Every pane in Obsidian is a *leaf* that holds some *view*. A leaf's view type is not locked — any plugin with a reference to the leaf can call `leaf.setViewState({type: "markdown"})` and Obsidian will tear down the current view, construct a markdown view, and install it in the same leaf. Anvil's terminal gets disposed in the process.

Plugins do this for their own reasons, usually routing preferences: *every note opens in one dedicated leaf*, *hover previews live in a reserved slot*, *files with marker X always render as view Y*. The plugin iterates the workspace, picks a leaf that matches its heuristic, and overwrites the leaf's view. If Anvil's terminal leaf matches the heuristic — because it's the most recently active, or it's the only leaf in a particular part of the layout — the terminal gets replaced.

Anvil does what Obsidian's public API allows to avoid being picked:

- Places the terminal leaf directly under `rootSplit`, not inside a `WorkspaceTabs` wrapper. Prevents `openLinkText("tab")` from landing a note adjacent to the terminal.
- Signals `View.navigation = false` on the container view so Obsidian's built-in leaf-picker skips the terminal when routing notes.

None of those help against a plugin that calls `setViewState` directly. That call bypasses the picker. The only defense would be monkey-patching `WorkspaceLeaf.prototype.setViewState` globally to refuse overrides on Anvil's leaves — which Anvil chooses not to do. Globally patching an Obsidian internal in every user's workspace to protect against a narrow set of third-party interactions is a worse tradeoff than documenting the limit.

## Plugins known to have this pattern

Based on the Phase 2 prior-art research (`Programming/Tabbed Containers with Content Isolation - Prior Art.md` in the project vault):

- **Mononote** ([dy-sh/obsidian-mononote](https://github.com/dy-sh/obsidian-mononote)) — enforces one-note-per-tab by iterating leaves and re-routing opens. Its heuristic doesn't check for a file marker, so it can target any leaf including Anvil's.
- **Hover Editor** — manages hover-preview leaves and can restructure the workspace on certain triggers.
- **Kanban plugin** ([obsidian-community/obsidian-kanban](https://github.com/obsidian-community/obsidian-kanban)) — globally patches `setViewState` to coerce files with a `kanban-plugin` frontmatter marker into Kanban view. In normal operation the patch checks its marker before acting, so it shouldn't touch Anvil's leaves — but the patch itself runs on every `setViewState` call, so a bug in the check would put Anvil's leaves in the blast radius.
- **Excalidraw plugin** ([zsviczian/obsidian-excalidraw-plugin](https://github.com/zsviczian/obsidian-excalidraw-plugin)) — same pattern as Kanban, keyed on the `.excalidraw` file extension or matching frontmatter.

Mononote and Hover Editor are the realistic threats. Kanban and Excalidraw are theoretical — their patches filter before acting — but they're in the same class of risk.

This is not exhaustive. Any plugin that calls `setViewState` on leaves it doesn't own, or globally patches `setViewState`, may conflict. If you see the symptom, disable community plugins one at a time and watch for the behavior to stop; the offender is usually whichever was most recently active.

## What to do when the terminal disappears

1. **Reopen it.** `Cmd-P → Open terminal` creates a new leaf with a new shell. The old PTY is gone; there is no recovery of its state.
2. **If it keeps happening**, disable community plugins one at a time until the clobber stops. Report the interaction to the offending plugin — Anvil's view type is `anvil-terminal-container-view`. Plugins that do leaf routing should exclude this view type from their heuristics.
3. **If you need reliable terminal persistence across clobbers**, use `tmux`. A detached tmux session survives as long as its server does. Anvil can attach to an existing session — if the leaf gets replaced, reopen the terminal and reattach.

## Why Anvil doesn't fight this harder

The coercive monkey-patching pattern that Kanban and Excalidraw use works only because those plugins have a distinguishing marker on the content they own — a frontmatter key, a file extension — that lets them filter `setViewState` calls to only rewrite opens of their files. Anvil has no equivalent marker. The terminal has no backing file, no identifier that separates "this leaf should stay a terminal" from any other leaf.

Blocking R8e (the regression-pin label for explicit-`setViewState` clobbers) would require patching Obsidian's global `setViewState` and refusing overrides on every leaf whose current view is one of Anvil's. That patch would run on every `setViewState` call in the user's Obsidian, forever, interfering with plugins Anvil does not own. Weighed against the narrow set of real-world interactions the patch would protect, the cost is too high.

If Obsidian ships a sanctioned way for a view to veto `setViewState`, this document goes stale and Anvil picks up the sanctioned path.

## Related

- [ADR 0006 — Workspace container](../adr/0006-workspace-container.md) — the decision record, including the R8e residual.
