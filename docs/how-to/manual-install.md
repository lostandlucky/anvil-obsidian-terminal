# How to install the plugin into a vault

You have a built copy of the plugin and want to put it into an Obsidian vault by hand. There is no community plugin store entry — see [ADR 0002](../adr/0002-manual-install-only.md).

## Prerequisites

- macOS arm64 (see [ADR 0001](../adr/0001-macos-arm64-only.md))
- A built plugin: `main.js`, `manifest.json`, and `styles.css` at the repo root. If those don't exist, run `npm install && npm run build` first.
- A throwaway vault. **Do not install into your real vault.** Phase 1 has only been validated against the fixture vault under `tests/e2e/fixtures/vault/`.

## Steps

1. **Locate the vault's plugin folder.** Every Obsidian vault has a hidden `.obsidian` folder at its root. Plugins live under `.obsidian/plugins/<plugin-id>/`.

   ```bash
   VAULT=/path/to/throwaway-vault
   mkdir -p "$VAULT/.obsidian/plugins/obsidian-terminal-plugin"
   ```

   The folder name must match the plugin id in `manifest.json`, which is `obsidian-terminal-plugin`.

2. **Copy the three plugin files in.**

   ```bash
   cp main.js manifest.json styles.css \
      "$VAULT/.obsidian/plugins/obsidian-terminal-plugin/"
   ```

   Those three files are the entire plugin. There is nothing else to copy — `node_modules`, `src/`, `package.json` etc. all stay in the source repo.

3. **Enable the plugin.** Open the vault in Obsidian.

   - If you've never used a community plugin in this vault: Settings → Community plugins → **Turn on community plugins**.
   - Then, in the same Settings page, find **Terminal** in the installed plugins list and toggle it on.
   - If **Terminal** does not appear in the list, fully quit and reopen the vault.

4. **Open a terminal.** Cmd-P → **Open terminal**. A pane should appear with a cyan welcome banner and a green `mock>` prompt. Type `help` to confirm input is wired up.

## Updating an existing install

Re-run step 2 to copy the new build over. Then in Obsidian, disable and re-enable the plugin to force a reload — Obsidian does not pick up file changes on its own.

## Troubleshooting

- **The plugin doesn't appear under Community plugins.** Check that the folder is named exactly `obsidian-terminal-plugin` (matching the id in `manifest.json`) and that all three files are inside it. Then quit and relaunch the vault.
- **The pane opens blank or the buffer never shows the prompt.** Open the developer console (Cmd-Option-I) and check for errors. The most likely cause is a missing `styles.css`, which leaves xterm unstyled and the buffer invisible against the background.
- **Cmd-P opens the Obsidian command palette while the terminal is focused.** That means the hotkey guard isn't engaging — usually because focus is on the pane chrome, not the xterm textarea. Click inside the terminal buffer and try again.

## Related

- [How to set up a dev loop](dev-setup.md) for symlink-based installs that flow rebuilds through automatically.
