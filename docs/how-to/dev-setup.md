# How to set up a dev loop

You want to edit the plugin source and see your changes inside Obsidian without re-copying files every time.

## Prerequisites

- macOS arm64 (see [ADR 0001](../adr/0001-macos-arm64-only.md))
- Node 20+ and `npm`
- A throwaway Obsidian vault. **Do not use your real vault.** The plugin has only been validated against the e2e fixture vault.

## Steps

1. **Clone and install dependencies.**

   ```bash
   git clone <this repo> obsidian-terminal-plugin
   cd obsidian-terminal-plugin
   npm install
   ```

2. **Build once to produce `main.js` and `styles.css`.**

   ```bash
   npm run build
   ```

3. **Pick a launch path.** There are two options.

   **Option A — `scripts/dev-launch.sh` (recommended).** This launches a sandboxed Obsidian against a disposable scratch vault with the plugin already installed. It uses the same pinned 1.12.7 binary the e2e suite uses, with its own `user-data-dir`, so your real Obsidian can be running at the same time.

   ```bash
   scripts/dev-launch.sh
   ```

   The first run downloads and caches the Obsidian binary under `.obsidian-cache/`. Subsequent runs are fast. To skip the rebuild step:

   ```bash
   scripts/dev-launch.sh --no-build
   ```

   To use your own scratch vault instead of `/tmp/terminal-plugin-test-vault`:

   ```bash
   VAULT=~/dev/scratch-vault scripts/dev-launch.sh
   ```

   **Option B — symlink into an existing throwaway vault.** Use this if you already have a vault you're testing against and want it to pick up rebuilds.

   ```bash
   mkdir -p /path/to/throwaway-vault/.obsidian/plugins
   ln -s "$(pwd)" /path/to/throwaway-vault/.obsidian/plugins/obsidian-terminal-plugin
   ```

   Then enable the plugin in Obsidian: Settings → Community plugins → toggle **Terminal** on.

4. **Run the watch build in a second terminal.**

   ```bash
   npm run dev
   ```

   This rebuilds `main.js` on every source change. Obsidian does not automatically reload plugins — after a rebuild, disable and re-enable the plugin in Settings → Community plugins, or use the Obsidian "Reload app without saving" command (if you have the hotkey set up).

## Verifying the loop works

After enabling the plugin in your throwaway vault:

1. Cmd-P → **Open terminal**. A pane should appear running your real shell at the vault root.
2. Type `pwd` to confirm the cwd, then `echo $SHELL` to confirm which shell launched.
3. Edit something visible — for example, change a label in `src/view/TerminalView.ts` or the error prefix in `src/pty/pty-backend.ts`.
4. Wait for `npm run dev` to finish rebuilding (it's fast, sub-second).
5. Reload the plugin and reopen the terminal. Your edit should be visible.

If step 5 doesn't show your change, the most likely cause is that Obsidian is still holding the old `main.js` — disable and re-enable the plugin, or quit and relaunch the vault.

## Related

- [How to install the built artifacts into a vault](manual-install.md)
- [How to run the tests](run-tests.md)
