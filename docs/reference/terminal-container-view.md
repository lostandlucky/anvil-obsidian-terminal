# Terminal container view

The Obsidian `ItemView` subclass that hosts the plugin's terminal tabs. One instance per workspace; it owns the tab strip, one xterm pane per tab, and the glue that wires each pane to a [`PtyBackend`](./pty-backend.md). Defined in [`src/view/TerminalContainerView.ts`](../../src/view/TerminalContainerView.ts).

## What it is

A single `ItemView` that multiplexes N terminal tabs within one workspace leaf. Each tab owns its own [`XtermHost`](../../src/terminal/xterm-host.ts) and [`TerminalBackend`](../../src/pty/terminal-backend.ts); only one pane is visible at a time, and inactive panes stay DOM-mounted so their xterm and PTY keep running across switches. The view sits at the bottom of `rootSplit` and is placed there by [`createWrapAndDock`](../../src/dock/wrap-and-dock.ts) — see [ADR 0006](../adr/0006-workspace-container.md) for the container-shape decision and [ADR 0007](../adr/0007-fi-012-wrap-and-dock.md) for the dock placement mechanism. For the surrounding system map, see [architecture.md](./architecture.md).

`navigation = false` is set on every instance. This tells Obsidian's leaf-picker to skip the container when routing default-mode markdown opens, so `openLinkText` and similar flows do not replace the terminal's content. The property is load-bearing; see [ADR 0006](../adr/0006-workspace-container.md).

## View type

```typescript
export const TERMINAL_CONTAINER_VIEW_TYPE = "anvil-terminal-container-view";
```

Registered in `src/main.ts` via `plugin.registerView(TERMINAL_CONTAINER_VIEW_TYPE, (leaf) => new TerminalContainerView(leaf, this))`. Used as the `type` in `leaf.setViewState({ type })` and as the argument to `workspace.getLeavesOfType` and `workspace.detachLeavesOfType`.

## What it exposes

### Types

```typescript
export interface TerminalTabSpec {
  shell: string;
  shellArgs?: string[];
  cwd?: string;
}
```

Consumed by `addTab`. `shell` is the absolute path of the executable to spawn. `shellArgs` is forwarded as `--shell-arg` entries to the PTY binary. `cwd` defaults to the vault root when absent.

### Methods

```typescript
getViewType(): string
```

Returns `TERMINAL_CONTAINER_VIEW_TYPE`.

```typescript
getDisplayText(): string
```

Returns `"Terminal"`. Used by Obsidian for the tab label.

```typescript
getIcon(): string
```

Returns `"terminal-square"`. Used by Obsidian for the leaf icon.

```typescript
async addTab(spec: TerminalTabSpec): Promise<string>
```

Creates a new tab. Builds the DOM chrome (tab button, close X, pane), mounts a fresh `XtermHost` into the pane, constructs a `PtyBackend` with the host's initial `cols`/`rows`, wires host↔backend data and resize, awaits `backend.start()`, and calls `switchTab` with the new tab id. Returns the tab id (format: `tab-N` where N is a monotonic per-view counter). Returns the empty string if the view's chrome has not been built yet. Backend start failures are written into the xterm buffer as a red ANSI line; they do not reject.

```typescript
switchTab(id: string): void
```

Makes the named tab active. Sets `display: block` on the incoming pane and `display: none` on the others, toggles `is-active` on the tab buttons, and on the next animation frame calls `host.fit()` then `host.focus()` on the incoming tab. No-op if `id` is not a known tab.

```typescript
async closeTab(id: string): Promise<void>
```

Removes a tab. Awaits `backend.close()`, disposes the `XtermHost`, detaches the tab button and pane from the DOM, and splices the tab out of the internal list. If the closed tab was active, picks the tab at the same index (or the previous one) as the new active tab and calls `switchTab` on it. If no tabs remain, calls `this.leaf.detach()` — the view tears itself down. No-op if `id` is not a known tab. Backend close errors and host dispose errors are swallowed.

```typescript
getTabIds(): string[]
```

Returns the current tab ids in insertion order.

```typescript
getActiveTabId(): string | null
```

Returns the active tab id, or `null` if no tab is active.

```typescript
getActiveHost(): XtermHost | null
```

Returns the [`XtermHost`](../../src/terminal/xterm-host.ts) for the active tab, or `null`. Exposed for diagnostics and for e2e tests that reach into the xterm instance.

```typescript
getActiveBackend(): TerminalBackend | null
```

Returns the [`TerminalBackend`](../../src/pty/terminal-backend.ts) for the active tab, or `null`. Production call sites read `childPid()` through this seam; see [`PtyBackend.childPid`](./pty-backend.md).

```typescript
onResize(): void
```

Override of `ItemView.onResize`. Calls `fit()` on the active tab's host. No-op if there is no active tab.

### Fields

```typescript
public navigation = false
```

Instructs Obsidian's leaf-picker to skip this view when routing default markdown opens. Flipping this to `true` breaks the single-leaf guarantee the container depends on — see [ADR 0006](../adr/0006-workspace-container.md).

## DOM contract

The view owns the chrome below. CSS in [`src/styles.css`](../../src/styles.css) targets these class names, and e2e selectors in [`tests/e2e/container-view.e2e.ts`](../../tests/e2e/container-view.e2e.ts) assert on them. External code that relies on these names is depending on the contract.

| Class | Purpose |
|---|---|
| `.anvil-terminal-container-view` | Root element, mounted on `containerEl.children[1]`. |
| `.anvil-terminal-tabstrip` | Outer tab strip. Direct children: `.anvil-terminal-tab-list`, `.anvil-terminal-tab-add`. |
| `.anvil-terminal-tab-list` | Inner flex row holding the N tab buttons. |
| `.anvil-terminal-tab-add` | Persistent rightmost sibling of the tab list — the `+` affordance. `aria-label="New terminal"`. |
| `.anvil-terminal-tab` | Individual tab button. Gains `is-active` when its tab is active. |
| `.anvil-terminal-tab-label` | Text label inside a tab button. |
| `.anvil-terminal-tab-close` | Per-tab close X. `aria-label="Close tab"`. |
| `.anvil-terminal-content` | Wrapper around the per-tab panes. Positioned relative; panes are absolutely positioned inside it. |
| `.anvil-terminal-pane` | One per tab. Only the active pane has `display: block`; others are `display: none`. |
| `.anvil-terminal-bottom-buffer` | Reserved chrome strip at the bottom. Empty, non-zero height. Shields the xterm viewport from Obsidian's editor status overlay. |

## Inputs and outputs

**Inputs.** `addTab(spec)` is the sole entry point for creating terminals; every `TerminalTabSpec` supplied becomes one PTY-backed tab. The constructor takes the `WorkspaceLeaf` from Obsidian and a `HostPlugin` reference it uses to resolve the default shell (`getDefaultShell`), read and persist the container's last height (`getLastContainerHeight`, `setLastContainerHeight`), and detect whether the plugin will supply the first tab itself on reconstruction (`isExpectingManualTab`). All three accessors are optional.

**Outputs.** The view emits no plugin-level events. Observation happens through the inspection methods (`getTabIds`, `getActiveTabId`, `getActiveHost`, `getActiveBackend`) and through the DOM contract above.

## What it does not do

- **Does not persist tabs across Obsidian restart.** The view does not override `getState`/`setState` — `TerminalTabSpec` values are not serialized. On reconstruction (app restart, workspace-plugin layout switch, popout) callers get one default tab, not the prior tab set. See [ADR 0006](../adr/0006-workspace-container.md) for the rationale.
- **Does not own PTY processes directly.** Each tab's PTY lifecycle is delegated to a `PtyBackend`; the view only calls `start`, `write`, `resize`, `close` and subscribes to `onData`/`onExit`. See [`pty-backend.md`](./pty-backend.md).
- **Does not split across windows.** There is no popout or multi-window support; `this.leaf.detach()` is the only teardown path the view initiates.
- **Does not pick shells.** The default spec is resolved from `HostPlugin.getDefaultShell()` or `process.env.SHELL`, falling back to `/bin/zsh`. Profile selection happens upstream in `src/main.ts` and [`src/picker/profile-picker.ts`](../../src/picker/profile-picker.ts).
- **Does not coordinate multiple container views.** Only one container leaf is expected per workspace; `src/main.ts` enforces that by reusing any existing leaf in `getOrCreateContainerView`.
