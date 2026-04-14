# Obsidian Terminal Plugin

A real system terminal embedded inside Obsidian. The end goal is a workspace where you can keep notes, run shells, and reattach to tmux without ever leaving the vault — VS Code's terminal pane, living next to your notes.

## What this is

**The vision.** Open a terminal pane in any Obsidian split. Pick a shell from a profile picker (zsh, bash, anything else you've configured). Reattach to a running tmux session if you have one. Run multiple terminal panes side by side. Real PTYs running real shells, not a fake widget.

**Today (Phase 1).** xterm.js rendering inside an Obsidian `ItemView`, with an in-process mock REPL standing in for the real shell. Cmd-P → **Open terminal** opens the pane. You can type four commands (`help`, `echo`, `clear`, `colors`) and watch ANSI rendering work. The PTY backend, profile picker, multi-instance isolation, and tmux attach are all still ahead. See [docs/reference/architecture.md](docs/reference/architecture.md) for the full system map and what exists today vs. what's deferred.

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
   git clone <this repo> obsidian-terminal-plugin
   cd obsidian-terminal-plugin
   npm install
   ```

2. **Build the plugin.**

   ```bash
   npm run build
   ```

   This produces `main.js` and `styles.css` at the repo root, alongside the existing `manifest.json`. Those three files are the plugin.

3. **Install into a throwaway vault.** Pick (or create) a vault you don't care about — for example `/tmp/test-vault`. Then copy or symlink the three files into the vault's plugin folder:

   ```bash
   mkdir -p /tmp/test-vault/.obsidian/plugins/obsidian-terminal-plugin
   cp main.js manifest.json styles.css \
      /tmp/test-vault/.obsidian/plugins/obsidian-terminal-plugin/
   ```

   Or, if you want edits to flow through without re-copying, see [docs/how-to/dev-setup.md](docs/how-to/dev-setup.md) for the symlink and dev-launch flow.

4. **Enable the plugin.** Open the throwaway vault in Obsidian. Settings → Community plugins → enable community plugins if you haven't → toggle **Terminal** on. (You may need to restart the vault if it doesn't show up.)

5. **Open a terminal.** Cmd-P → **Open terminal**. A new pane appears with a cyan welcome banner and a green `mock>` prompt.

6. **Try it.** Type:

   ```text
   help
   echo hello world
   colors
   clear
   ```

   `help` lists the four mock commands. `colors` prints styled text so you can confirm ANSI rendering works. `clear` clears the buffer.

That's it. If any of those steps misbehave, see the troubleshooting notes at the bottom of [docs/how-to/manual-install.md](docs/how-to/manual-install.md).

## Where to go next

- **You want to hack on the plugin** → [docs/how-to/dev-setup.md](docs/how-to/dev-setup.md)
- **You want to install the built artifacts into a vault** → [docs/how-to/manual-install.md](docs/how-to/manual-install.md)
- **You want to run the tests** → [docs/how-to/run-tests.md](docs/how-to/run-tests.md)
- **You want to know why a decision was made** → [docs/adr/](docs/adr/)
- **You want to know how docs work in this repo** → [docs/DOCUMENTATION_STANDARDS.md](docs/DOCUMENTATION_STANDARDS.md)

## Known limits

- No real shell yet — the REPL is in-process and understands four commands. Phase 2.
- No settings tab. Nothing is configurable.
- No multi-instance isolation guarantees. You can open more than one terminal pane, but it hasn't been stress-tested.
- macOS arm64 only. See ADR 0001.
- Manual install only. No community plugin store submission. See ADR 0002.
