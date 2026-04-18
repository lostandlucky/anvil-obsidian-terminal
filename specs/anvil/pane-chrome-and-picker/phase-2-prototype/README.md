# Phase 2 Spike Prototype — Workspace Container (Rank 3)

**Throwaway.** This is a spike for the Phase 2 workspace container design. It is not in the main plugin's esbuild input, is not imported by production code, and is not meant to ship. See `specs/anvil/pane-chrome-and-picker/phase-2-workspace-container-spike-spec.md` for scope and `docs/adr/0006-workspace-container.md` for the decision it informs.

## What it does

Registers a single Obsidian view type — `anvil-prototype-container-view` — implemented by `PrototypeContainerView extends ItemView`. One leaf of this view hosts N xterm instances inside one DOM subtree, switched by a vertical side-tab selector on the left. Each tab runs a live shell through the same `pty-server` binary the main plugin ships.

The point of the prototype is to prove that:

1. Multiple terminals can live inside one leaf without their DOM or state being disposed on tab switch (AC5, AC6).
2. Obsidian's leaf-picker heuristic (quick-switcher, `openLinkText`, drag-drop) does not land foreign content inside the terminal container (R8a/b/c/d).
3. A third-party plugin's `leaf.setViewState({type:"markdown"})` does not silently clobber the terminal container (R8e) — mitigated via `setPinned(true)` and `view.navigation = false`.

## Prerequisites

- The main `anvil-obsidian-terminal` plugin is installed in the target vault. **The prototype does not ship its own `pty-server` binary** — it reuses the one from the main plugin at `<vault>/.obsidian/plugins/anvil-obsidian-terminal/bin/pty-server`. If the main plugin isn't built, the prototype's terminals will fail to start with a red `[failed to start pty-server: ...]` line.
- `npm install` has been run at the repo root (so `@xterm/xterm`, `@xterm/addon-fit`, and `esbuild` are available in `node_modules`).

## Build

From this directory:

```bash
node build.mjs           # one-shot
node build.mjs --watch   # watch mode
```

Emits `main.js` next to `manifest.json` and `styles.css`. These three files are the Obsidian plugin bundle.

## Install into a vault

Symlink the prototype directory into your test vault's plugins folder:

```bash
ln -s "$(pwd)" ~/Vaultnacious-v2/.obsidian/plugins/anvil-prototype-container
```

(Adjust the vault path.) Then in Obsidian: **Settings → Community plugins → Installed plugins → enable "Anvil Prototype: Workspace Container (Phase 2 spike)"**. You may need to reload Obsidian once after the symlink is created.

## Run

- **Open the container:** Cmd-P → `Anvil Prototype: Open terminal container`. The container opens as a horizontally-split leaf at the bottom. One terminal tab is created automatically.
- **Add more tabs:** Click the `+` action in the view header, or Cmd-P → `Anvil Prototype: Add terminal tab to active container`.
- **Switch tabs:** Click any entry in the vertical list on the left. The clicked terminal becomes visible; the others are hidden (display: none) but kept mounted — their xterm state and PTY survive the switch.

## Manual verification

### AC5 — two or more terminals in one leaf, switchable

1. Open the container (one tab appears).
2. Add a second tab — two entries now show in the left side-tab list.
3. Click between them — the content area swaps without flashing a new leaf. Only one `.anvil-proto-container` exists in the DOM (verify with DevTools → Elements → search).

### AC6 — xterm state survives at least 3 switches

1. In Terminal 1: run `ls` and note the output.
2. Switch to Terminal 2, then back to Terminal 1. Scrollback + cursor position still there.
3. Repeat 3 more switches. State stays.
4. Optional: `yes` in Terminal 1, switch away for 10s, switch back — output continued streaming while the tab was hidden.

### R8a/b/c/d/e — see `probes.ts`

Open DevTools (Ctrl-Shift-I on mac), paste the helper block from `probes.ts`, then paste each R8 probe one at a time. Each prints `[R8] <name>: PASS|FAIL — <detail>`.

Interpretation:

- **R8a/b/c** should PASS: the note lands outside the container, the xterm stays visible.
- **R8d** should PASS: synthetic drop does not materialize a markdown view inside `.anvil-proto-container`.
- **R8e** documents the residual risk. The prototype's mitigations (`setPinned(true)` + `view.navigation = false`) do **not** block an explicit `setViewState` call. This probe is expected to show whether the clobber happens silently or visibly; the ADR records which mitigation the plugin relies on and what remains exposed.

### Manual R8e with a real third-party plugin (optional)

Install a plugin that aggressively re-routes views — Mononote (`github.com/dy-sh/obsidian-mononote`) or Hover Editor are good candidates — and confirm the terminal container is not clobbered when the plugin's heuristics fire.

The user-facing framing of this risk, the known-plugin list, and "what to do when the terminal disappears" live in [`docs/explanations/third-party-plugin-compatibility.md`](../../../../docs/explanations/third-party-plugin-compatibility.md). Keep that doc as the single source of truth; probe results here are verification against its claims.

## Teardown

```bash
# Disable the plugin in Obsidian first.
rm ~/Vaultnacious-v2/.obsidian/plugins/anvil-prototype-container
# Remove build output (optional):
rm main.js
```

The prototype directory itself stays in-repo as documentation of the spike; the symlink is what makes it a live plugin.
