# Anvil: Obsidian Terminal

A real system terminal embedded inside Obsidian, built primarily for running Claude Code and other agent CLIs next to your notes. The end goal is a workspace where you can keep notes, run shells, and reattach to tmux without ever leaving the vault — VS Code's bottom terminal pane, docked in Obsidian.

*Anvil* is the name; *Obsidian Terminal* is the subtitle. The repo is `anvil-obsidian-terminal` so it's still findable on a repo list.

## What this is

**The vision.** Open a terminal inside Obsidian. Pick a shell from a profile picker (zsh, bash, anything else you've configured). Reattach to a running tmux session if you have one. Run several terminals as tabs in a single dock that sits alongside your notes. Real PTYs running real shells, not a fake widget.

**Today.** xterm.js rendering inside a single Obsidian `ItemView` that hosts N terminal tabs (plugin-drawn tab strip, per-tab close X, `+` affordance on the right), wired to real PTY-backed shells via a sidecar Rust binary (`bin/pty-server`). Cmd-P → **Open terminal** opens the profile picker; pick a shell (or reattach to a tmux session) and a tab appears running it at the vault root, with working `vim`, `htop`, Ctrl-C, resize, and ANSI colors. Opening the terminal when two notes are side-by-side keeps them side-by-side (the terminal docks below them as a full-width row). See [docs/reference/architecture.md](docs/reference/architecture.md) for the full system map, [docs/reference/terminal-container-view.md](docs/reference/terminal-container-view.md) for the container view's public surface, [docs/reference/pty-backend.md](docs/reference/pty-backend.md) for the backend, and [ADR 0003](docs/adr/0003-pty-backend.md) for why the backend is a separate Rust binary.

**Who it's for.** Obsidian users on macOS Apple silicon who want a real terminal inside their vault and are willing to build the plugin from source. There is no community plugin store entry — see [ADR 0002](docs/adr/0002-manual-install-only.md). If that doesn't describe you, this isn't useful yet.

> **Platform:** Validated only on **macOS arm64**. The code has no platform checks today, but nothing else has been tested. See [ADR 0001](docs/adr/0001-macos-arm64-only.md).

## What you need

- macOS on Apple silicon
- Obsidian 1.5.0 or newer (1.12.x recommended — that's what the e2e suite runs against)
- Node 20+ and `npm`
- A throwaway Obsidian vault to test in. **Do not install into your real vault yet.**

## From zero to a running terminal pane

1. **Clone and install.**

   ```bash
   git clone <this repo> anvil-obsidian-terminal
   cd anvil-obsidian-terminal
   npm install
   ```

2. **Build the plugin.**

   ```bash
   npm run build
   ```

   This produces `main.js`, `styles.css`, and `bin/pty-server` (the Rust binary, compiled from the sibling `pty-server/` cargo package). Those, plus the existing `manifest.json`, are the plugin.

3. **Install into a throwaway vault.** Pick (or create) a vault you don't care about — for example `/tmp/test-vault`. Then copy the plugin files **and the `bin/` directory** into the vault's plugin folder:

   ```bash
   PLUGIN_DIR=/tmp/test-vault/.obsidian/plugins/anvil-obsidian-terminal
   mkdir -p "$PLUGIN_DIR"
   cp main.js manifest.json styles.css "$PLUGIN_DIR/"
   cp -R bin "$PLUGIN_DIR/"
   ```

   The `bin/pty-server` binary is the PTY backend — without it the terminal pane will fail to start. If macOS Gatekeeper blocks it on first launch, run `xattr -d com.apple.quarantine "$PLUGIN_DIR/bin/pty-server"` and reopen the pane. The build script strips the quarantine bit on the in-repo copy automatically; `cp` can re-attach it on the destination.

   Or, if you want edits to flow through without re-copying, see [docs/how-to/dev-setup.md](docs/how-to/dev-setup.md) for the symlink and dev-launch flow.

4. **Enable the plugin.** Open the throwaway vault in Obsidian. Settings → Community plugins → enable community plugins if you haven't → toggle **Terminal** on. (You may need to restart the vault if it doesn't show up.)

5. **Open a terminal.** Cmd-P → **Open terminal**. The profile picker appears listing the shells on your machine (and any running tmux sessions). Pick one — a new tab appears in the terminal dock running that shell at the vault root. Hit the `+` on the right of the tab strip to open another.

6. **Try it.** Run a few real commands:

   ```text
   pwd
   ls
   echo $SHELL
   vim
   ```

   `pwd` should print the vault root. `vim` should take over the pane and exit cleanly with `:q`. Ctrl-C interrupts a running command. Drag the divider between the notes area and the terminal to resize — `tput cols` reflects the new width.

That's it. If any of those steps misbehave, see the troubleshooting notes at the bottom of [docs/how-to/manual-install.md](docs/how-to/manual-install.md).

## Where to go next

- **You want to hack on the plugin** → [docs/how-to/dev-setup.md](docs/how-to/dev-setup.md)
- **You want to install the built artifacts into a vault** → [docs/how-to/manual-install.md](docs/how-to/manual-install.md)
- **You want to run the tests** → [docs/how-to/run-tests.md](docs/how-to/run-tests.md)
- **Your terminal unexpectedly closed or got replaced** → [docs/explanations/third-party-plugin-compatibility.md](docs/explanations/third-party-plugin-compatibility.md)
- **You want to know why a decision was made** → [docs/adr/](docs/adr/)
- **You want to know how docs work in this repo** → [docs/DOCUMENTATION_STANDARDS.md](docs/DOCUMENTATION_STANDARDS.md)

## Known limits

- No codesigning on the `pty-server` binary — fresh installs may need a one-shot `xattr -d com.apple.quarantine` on the copied binary. See [ADR 0003](docs/adr/0003-pty-backend.md).
- Terminal tabs don't survive an Obsidian restart. Closing and reopening Obsidian gives you a fresh blank terminal (if the container was open before close) or no terminal (if it wasn't) — the specific tabs you had open, their shells, and their cwd are not persisted. VS Code behaves the same way.
- Other plugins can close the terminal. Certain third-party plugins (Mononote, Hover Editor, and anything else that globally re-routes workspace leaves) can replace Anvil's terminal pane with something else, killing every shell inside it. Obsidian's plugin API offers no way to block this. See [docs/explanations/third-party-plugin-compatibility.md](docs/explanations/third-party-plugin-compatibility.md).
- No popout support. Dragging the terminal into its own Obsidian window isn't supported; the PTY is bound to the main window's renderer process.
- macOS arm64 only. See [ADR 0001](docs/adr/0001-macos-arm64-only.md).
- Manual install only. No community plugin store submission. See [ADR 0002](docs/adr/0002-manual-install-only.md).
