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
VAULT="${VAULT:-/tmp/terminal-plugin-test-vault}"
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

exec npx obsidian-launcher launch \
  --version "$OBSIDIAN_VERSION" \
  --installer "$OBSIDIAN_VERSION" \
  --cache "$REPO/.obsidian-cache" \
  --plugin "$REPO" \
  "$VAULT"
