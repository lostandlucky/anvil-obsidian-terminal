#!/usr/bin/env bash
#
# Launch the sandboxed Obsidian test binary against a throwaway vault with
# this plugin symlinked in, for interactive user testing.
#
# Isolation guarantees:
#   - Uses the pinned Obsidian 1.12.7 binary from .obsidian-cache/, not
#     /Applications/Obsidian.app — same bytes the e2e harness validates
#     against, so nothing new to audit.
#   - Vault lives under /tmp by default, so it's disposable. Override with
#     VAULT=/some/path if you want a persistent scratch vault.
#   - Plugin is symlinked in, so edits + rebuild show up on next reload
#     without reinstalling.
#
# Usage:
#   scripts/dev-launch.sh           # build, launch
#   scripts/dev-launch.sh --no-build
#   VAULT=~/dev/scratch-vault scripts/dev-launch.sh

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="${VAULT:-/tmp/terminal-plugin-test-vault}"
BINARY="$REPO/.obsidian-cache/obsidian-installer/darwin-arm64/Obsidian-1.12.7/Contents/MacOS/Obsidian"
PLUGIN_ID="obsidian-terminal-plugin"

if [[ ! -x "$BINARY" ]]; then
  echo "error: sandboxed Obsidian binary not found at:"
  echo "  $BINARY"
  echo ""
  echo "Run 'npm run test:e2e' once to populate .obsidian-cache/, then retry."
  exit 1
fi

if [[ "${1:-}" != "--no-build" ]]; then
  echo "==> building plugin"
  (cd "$REPO" && npm run build)
fi

mkdir -p "$VAULT/.obsidian/plugins"

LINK="$VAULT/.obsidian/plugins/$PLUGIN_ID"
if [[ -L "$LINK" ]]; then
  current="$(readlink "$LINK")"
  if [[ "$current" != "$REPO" ]]; then
    echo "==> updating stale plugin symlink"
    rm "$LINK"
    ln -s "$REPO" "$LINK"
  fi
elif [[ -e "$LINK" ]]; then
  echo "error: $LINK exists and is not a symlink; refusing to overwrite"
  exit 1
else
  echo "==> symlinking plugin into $VAULT"
  ln -s "$REPO" "$LINK"
fi

# Enable the plugin on first launch so you don't have to click through
# Settings → Community plugins → enable each time. Safe to re-run.
COMMUNITY="$VAULT/.obsidian/community-plugins.json"
if [[ ! -f "$COMMUNITY" ]] || ! grep -q "\"$PLUGIN_ID\"" "$COMMUNITY" 2>/dev/null; then
  echo "==> enabling $PLUGIN_ID in $COMMUNITY"
  echo "[\"$PLUGIN_ID\"]" > "$COMMUNITY"
fi

# Suppress the "restricted mode" / trust-vault prompt.
APP_JSON="$VAULT/.obsidian/app.json"
if [[ ! -f "$APP_JSON" ]]; then
  echo '{}' > "$APP_JSON"
fi

echo "==> launching Obsidian against $VAULT"
echo "    Cmd-P → \"Open terminal\" to try the plugin"
exec "$BINARY" "$VAULT"
