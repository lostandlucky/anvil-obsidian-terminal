# Anvil: Obsidian Terminal

A real system terminal embedded inside Obsidian, built primarily for running Claude Code and other agent CLIs next to your notes. The end goal is a workspace where you can keep notes, run shells, and reattach to tmux without ever leaving the vault — VS Code's bottom terminal pane, docked in Obsidian.

*Anvil* is the name; *Obsidian Terminal* is the subtitle. The repo is `anvil-obsidian-terminal` so it's still findable on a repo list.

## What this is

**The vision.** Open a terminal pane in any Obsidian split. Pick a shell from a profile picker (zsh, bash, anything else you've configured). Reattach to a running tmux session if you have one. Run multiple terminal panes side by side. Real PTYs running real shells, not a fake widget.

**Today (Phase 2b).** xterm.js rendering inside an Obsidian `ItemView`, wired to a real PTY-backed shell via a sidecar Rust binary (`bin/pty-server`). Cmd-P → **Open terminal** opens a pane running your `$SHELL` (or `/bin/zsh`) at the vault root, with working `vim`, `htop`, Ctrl-C, resize, and ANSI colors. The profile picker, multi-instance isolation, and tmux attach are still ahead. See [docs/reference/architecture.md](docs/reference/architecture.md) for the full system map and what exists today vs. what's deferred, [docs/reference/pty-backend.md](docs/reference/pty-backend.md) for the backend's surface, and [ADR 0003](docs/adr/0003-pty-backend.md) for why the backend is a separate Rust binary.

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

5. **Open a terminal.** Cmd-P → **Open terminal**. A new pane appears running your real shell, with its prompt (zsh `%`, bash `$`, …) at the vault root.

6. **Try it.** Run a few real commands:

   ```text
   pwd
   ls
   echo $SHELL
   vim
   ```

   `pwd` should print the vault root. `vim` should take over the pane and exit cleanly with `:q`. Ctrl-C interrupts a running command. Drag the pane divider to resize — `tput cols` reflects the new width.

That's it. If any of those steps misbehave, see the troubleshooting notes at the bottom of [docs/how-to/manual-install.md](docs/how-to/manual-install.md).

## Where to go next

- **You want to hack on the plugin** → [docs/how-to/dev-setup.md](docs/how-to/dev-setup.md)
- **You want to install the built artifacts into a vault** → [docs/how-to/manual-install.md](docs/how-to/manual-install.md)
- **You want to run the tests** → [docs/how-to/run-tests.md](docs/how-to/run-tests.md)
- **You want to know why a decision was made** → [docs/adr/](docs/adr/)
- **You want to know how docs work in this repo** → [docs/DOCUMENTATION_STANDARDS.md](docs/DOCUMENTATION_STANDARDS.md)

## Known limits

- No profile picker — the shell is hardcoded to `$SHELL` (or `/bin/zsh`), launched at the vault root. Phase 3.
- No codesigning on the `pty-server` binary — fresh installs may need a one-shot `xattr -d com.apple.quarantine` until codesigning lands in Phase 4. See [ADR 0003](docs/adr/0003-pty-backend.md).
- No settings tab. Nothing is configurable.
- No multi-instance isolation guarantees. You can open more than one terminal pane, but it hasn't been stress-tested.
- macOS arm64 only. See ADR 0001.
- Manual install only. No community plugin store submission. See ADR 0002.
