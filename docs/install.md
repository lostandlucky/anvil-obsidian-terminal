# Install Anvil: Obsidian Terminal from a release

You downloaded a release zip from GitHub and want to put it into an Obsidian vault. This is the install path for non-developer users — no `npm install`, no `cargo build`, no source clone. Just unzip, place the files, run one shell command, enable the plugin.

If you want to build from source instead, see [`how-to/manual-install.md`](how-to/manual-install.md).

## Prerequisites

- macOS on Apple silicon. The plugin is validated only on **macOS arm64** ([ADR 0001](adr/0001-macos-arm64-only.md)). It will not work on Intel macs, Linux, or Windows.
- Obsidian 1.5.0 or newer. Anvil is tested against 1.12.7.
- A terminal (Terminal.app, iTerm, or any other) for one `xattr` command.
- A vault you can install plugins into. Community plugins must already be enabled in that vault, or you can enable them as part of step 5.

## What you're installing

The release zip contains exactly five entries — verified by an automated test before each release:

```
manifest.json                       plugin metadata
main.js                             bundled plugin JavaScript
styles.css                          plugin CSS
bin/pty-server                      the Rust PTY backend (executable)
fonts/SymbolsNerdFontMono.woff2     bundled symbol font for terminal glyphs
```

The plugin itself is the JS + CSS. The `bin/pty-server` binary is what actually owns each pseudoterminal — without it, opening a terminal in the plugin will surface a clear notice pointing back at this doc. The bundled woff2 ships a Nerd Font symbol set so glyphs render correctly even on machines that don't have a Nerd Font installed system-wide.

## Steps

### 1. Download the release

Go to the GitHub Releases page for `anvil-obsidian-terminal`. Download the asset named:

```
anvil-obsidian-terminal-v<version>.zip
```

A `anvil-obsidian-terminal-v<version>.zip.sha256` file lives next to it. If you want to verify the download:

```bash
shasum -a 256 anvil-obsidian-terminal-v0.1.0.zip
# Compare against the .sha256 file's contents.
```

### 2. Find your vault's plugin folder

Every Obsidian vault has a hidden `.obsidian/` directory at its root, and plugins live under `.obsidian/plugins/<plugin-id>/`. The plugin id is `anvil-obsidian-terminal`.

```bash
VAULT="/path/to/your/vault"
PLUGIN_DIR="$VAULT/.obsidian/plugins/anvil-obsidian-terminal"
mkdir -p "$PLUGIN_DIR"
```

Replace `/path/to/your/vault` with the real path. If you're not sure: in Obsidian, Settings → About → "Open vault folder."

> **Recommendation for your first install:** use a throwaway vault first. The plugin runs real shells and a sidecar binary; verify it works for you in an empty vault before introducing it to a vault with notes you care about.

### 3. Unzip into the plugin folder

```bash
unzip -o anvil-obsidian-terminal-v0.1.0.zip -d "$PLUGIN_DIR"
```

After this, `$PLUGIN_DIR` should contain exactly:

```
manifest.json
main.js
styles.css
bin/pty-server
fonts/SymbolsNerdFontMono.woff2
```

If your unzipper flattened `bin/` or `fonts/` (some GUI extractors do), the plugin will not find the binary at startup or will fall back to system fonts for glyphs. Re-extract from the command line with `unzip -o` as shown above — the directories must be preserved.

### 4. Strip the macOS quarantine bit

macOS attaches a quarantine attribute to any binary downloaded from the internet, including binaries inside zip files. This is Gatekeeper's way of saying "this came from outside, prove it's safe." Anvil's `pty-server` binary is not codesigned (yet — see [ADR future]), so the operating system will block it from running.

Run this one command to remove the quarantine bit from the bundled binary:

```bash
xattr -d com.apple.quarantine "$PLUGIN_DIR/bin/pty-server"
```

Expected outcome: no output, exit code 0. (If the attribute wasn't there for some reason, `xattr` prints `No such xattr: com.apple.quarantine` — that's harmless.)

If you skip this step, the plugin's first attempt to spawn a terminal will fail with a red `[pty-backend] failed to spawn pty-server: ...` line, and the binary will not run.

### 5. Enable the plugin in Obsidian

Open the vault in Obsidian.

- Settings → **Community plugins**.
- If you haven't enabled community plugins in this vault yet, click **Turn on community plugins**.
- Find **Terminal** ("Anvil: Obsidian Terminal" in some places) in the list of installed plugins. Toggle it on.

Expected outcome: no error notices. If the plugin doesn't appear, fully quit and reopen the vault — Obsidian doesn't always discover newly-installed plugin folders without a restart.

### 6. Open a terminal

`Cmd-P` → **Open terminal**.

A profile picker modal appears listing the shells on your machine (and any running tmux sessions). Pick one. A pane appears at the bottom of the workspace running that shell at your vault root.

Expected outcomes:
- The shell prints its prompt (`%`, `$`, etc.).
- Typing in the pane sends keystrokes to the shell.
- `pwd` prints the vault root.
- `Cmd-W` closes the terminal pane.

If any of these misbehave, see Troubleshooting below.

## Troubleshooting

### "pty-server binary not found" notice on plugin enable

The plugin checks for `bin/pty-server` at startup. If it's missing, you'll see a 10-second notice: *"Anvil Terminal: pty-server binary not found. See docs/install.md for setup instructions."*

This means either:
- The unzip step flattened the `bin/` directory. Re-extract from the command line with `unzip -o` (see step 3).
- The `bin/pty-server` file is present but not at the path the plugin expects. Confirm with:

  ```bash
  ls -l "$PLUGIN_DIR/bin/pty-server"
  ```

  The file should exist and be at least 2MB in size.

### Red `[pty-backend] failed to spawn pty-server` line in the terminal pane

The binary is on disk but macOS Gatekeeper is blocking it. Run the `xattr` command from step 4 and reopen the terminal pane.

### `Operation not permitted` when running `xattr`

Some sandboxed shells (notably Apple's "Allow Terminal Full Disk Access" path) need permission to modify quarantine attributes. Open System Settings → Privacy & Security → Full Disk Access and add Terminal (or your terminal of choice). Then re-run the `xattr` command.

### The plugin doesn't appear in Settings → Community plugins

- Check the folder name is exactly `anvil-obsidian-terminal` (matching the `id` in `manifest.json`).
- Confirm `manifest.json` is at the top of `$PLUGIN_DIR`, not nested inside another folder.
- Quit and relaunch the vault.

### Cmd-P opens the Obsidian command palette while my terminal is focused

Click inside the terminal buffer first to make sure focus is on the xterm textarea, not the pane chrome. The plugin's keyboard model gives `Cmd-*` to Obsidian and `Ctrl-*` to the shell, deliberately, per [ADR 0004](adr/0004-keyboard-handling-asymmetric-cmd-ctrl.md).

## Updating to a newer release

Re-run steps 1, 3, 4. The unzip step overwrites the existing files; the `xattr` step needs to run again because the new binary will be quarantined just like the old one was.

After updating, in Obsidian: Settings → Community plugins → toggle **Terminal** off and back on. Obsidian doesn't pick up file changes on its own.

## What does NOT happen during install

Because the plugin is install-by-hand only ([ADR 0002](adr/0002-manual-install-only.md)), there are some things you might expect from other plugins that won't happen here:

- **No auto-update.** New releases land on GitHub; you re-run the install steps to upgrade.
- **No community plugin store entry.** You won't find this in Obsidian's in-app browse list.
- **No telemetry, no crash reporting, no remote checks.** The plugin runs entirely on your machine.

## Related

- [ADR 0001 — macOS arm64 only](adr/0001-macos-arm64-only.md)
- [ADR 0002 — Manual install only](adr/0002-manual-install-only.md)
- [ADR 0003 — PTY backend rationale](adr/0003-pty-backend.md)
- [How to set up a dev loop](how-to/dev-setup.md) — for users who want to build from source instead
