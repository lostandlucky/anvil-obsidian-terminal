#!/usr/bin/env bash
#
# Launch the sandboxed Obsidian test binary against a throwaway vault with
# this plugin installed, for interactive user testing.
#
# Uses obsidian-launcher (shipped with wdio-obsidian-service) which already
# knows how to:
#   - spin up a fully isolated user-data-dir so it doesn't collide with the
#     running /Applications/Obsidian.app
#   - point the installer binary at the correct cached asar
#   - install the plugin into a sandboxed vault
#
# Isolation guarantees:
#   - Uses the pinned Obsidian 1.12.7 binary + asar from .obsidian-cache/,
#     same bytes the e2e harness already validates.
#   - Vault defaults to /tmp so it's disposable. Override with VAULT=...
#   - Your real Obsidian can be running at the same time — separate
#     user-data-dir means zero interference.
#
# Usage:
#   scripts/dev-launch.sh                 # build + launch
#   scripts/dev-launch.sh --no-build
#   VAULT=~/dev/scratch-vault scripts/dev-launch.sh

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="${VAULT:-/tmp/anvil-test-vault}"
OBSIDIAN_VERSION="1.12.7"

cd "$REPO"

if [[ "${1:-}" != "--no-build" ]]; then
  echo "==> building plugin"
  npm run build
fi

if [[ ! -d "$VAULT" ]]; then
  echo "==> creating scratch vault at $VAULT"
  mkdir -p "$VAULT/.obsidian"
  echo '{}' > "$VAULT/.obsidian/app.json"
fi

echo "==> launching Obsidian $OBSIDIAN_VERSION against $VAULT"
echo "    plugin will be installed from: $REPO"
echo "    Cmd-P → \"Open terminal\" to try it"
echo ""

# obsidian-launcher only copies main.js / manifest.json / styles.css into the
# vault's plugin dir — it does not know about bin/pty-server. Mirror the wdio
# conf's "before" hook by copying the binary into place after the launcher
# has had a moment to install the rest. Same failure pattern recorded in the
# phase-2b completion notes under "Bumps".
PLUGIN_DEST="$VAULT/.obsidian/plugins/anvil-obsidian-terminal"
(
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if [[ -f "$PLUGIN_DEST/main.js" ]]; then
      cp -R "$REPO/bin" "$PLUGIN_DEST/"
      echo "==> copied bin/pty-server into $PLUGIN_DEST"
      exit 0
    fi
    sleep 0.5
  done
  echo "!! bin/pty-server copy skipped: $PLUGIN_DEST/main.js never appeared" >&2
) &

# When launched as a child of `npm run`, npm injects npm_config_* env vars
# into the process. Those leak through Obsidian into PTY-spawned shells, where
# `.zshrc` integrations like nvm trip on them ("nvm is not compatible with
# npm_config_prefix"). Scrub them so the dev terminal sees the same env a
# normal Obsidian launch would.
unset npm_config_prefix npm_config_globalconfig npm_config_userconfig \
      npm_config_cache npm_config_init_module npm_config_local_prefix \
      npm_config_node_gyp npm_command npm_lifecycle_event \
      npm_lifecycle_script npm_package_json npm_package_name \
      npm_package_version npm_execpath INIT_CWD

exec npx obsidian-launcher launch \
  --version "$OBSIDIAN_VERSION" \
  --installer "$OBSIDIAN_VERSION" \
  --cache "$REPO/.obsidian-cache" \
  --plugin "$REPO" \
  "$VAULT"
