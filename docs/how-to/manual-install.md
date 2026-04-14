# How to install the plugin into a vault

You have a built copy of the plugin and want to put it into an Obsidian vault by hand. There is no community plugin store entry — see [ADR 0002](../adr/0002-manual-install-only.md).

## Prerequisites

- macOS arm64 (see [ADR 0001](../adr/0001-macos-arm64-only.md))
- A built plugin: `main.js`, `manifest.json`, `styles.css`, and `bin/pty-server` at the repo root. If those don't exist, run `npm install && npm run build` first.
- A throwaway vault. **Do not install into your real vault.** The plugin has only been validated against the fixture vault under `tests/e2e/fixtures/vault/`.

## Steps

1. **Locate the vault's plugin folder.** Every Obsidian vault has a hidden `.obsidian` folder at its root. Plugins live under `.obsidian/plugins/<plugin-id>/`.

   ```bash
   VAULT=/path/to/throwaway-vault
   mkdir -p "$VAULT/.obsidian/plugins/anvil-obsidian-terminal"
   ```

   The folder name must match the plugin id in `manifest.json`, which is `anvil-obsidian-terminal`.

2. **Copy the plugin files and the `bin/` directory in.**

   ```bash
   PLUGIN_DIR="$VAULT/.obsidian/plugins/anvil-obsidian-terminal"
   cp main.js manifest.json styles.css "$PLUGIN_DIR/"
   cp -R bin "$PLUGIN_DIR/"
   ```

   `bin/pty-server` is the Rust binary that owns the actual PTY — the plugin will fail to start a terminal without it. Everything else (`node_modules`, `src/`, `package.json`) stays in the source repo.

3. **Enable the plugin.** Open the vault in Obsidian.

   - If you've never used a community plugin in this vault: Settings → Community plugins → **Turn on community plugins**.
   - Then, in the same Settings page, find **Terminal** in the installed plugins list and toggle it on.
   - If **Terminal** does not appear in the list, fully quit and reopen the vault.

4. **Open a terminal.** Cmd-P → **Open terminal**. A pane should appear running your real shell, with its prompt (zsh `%`, bash `$`, …) at the vault root. Type `pwd` and `echo $SHELL` to confirm input is wired up.

## Updating an existing install

Re-run step 2 to copy the new build over. Then in Obsidian, disable and re-enable the plugin to force a reload — Obsidian does not pick up file changes on its own.

## Troubleshooting

- **The plugin doesn't appear under Community plugins.** Check that the folder is named exactly `anvil-obsidian-terminal` (matching the id in `manifest.json`) and that the three plugin files plus the `bin/` directory are inside it. Then quit and relaunch the vault.
- **The pane opens but immediately shows a red `[pty-backend] ...` line.** macOS Gatekeeper has quarantined the `pty-server` binary. Strip the quarantine bit once with:
  ```bash
  xattr -d com.apple.quarantine "$PLUGIN_DIR/bin/pty-server"
  ```
  Then close and reopen the terminal pane. The build script strips the quarantine bit on the in-repo copy automatically; `cp` re-attaches it on the destination.
- **The pane opens blank or the buffer never shows the prompt.** Open the developer console (Cmd-Option-I) and check for errors. The most likely causes are a missing `styles.css` (leaves xterm unstyled and invisible against the background) or a missing `bin/pty-server` (the backend can't start).
- **Cmd-P opens the Obsidian command palette while the terminal is focused.** That means the hotkey guard isn't engaging — usually because focus is on the pane chrome, not the xterm textarea. Click inside the terminal buffer and try again.

## Related

- [How to set up a dev loop](dev-setup.md) for symlink-based installs that flow rebuilds through automatically.
