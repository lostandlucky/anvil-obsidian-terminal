#!/usr/bin/env bash
#
# Phase 3 / FI-017: locally build and package a release zip for the
# Anvil Obsidian Terminal plugin. macOS arm64 only.
#
# Usage:
#   scripts/release.sh [--version X.Y.Z] [--no-build] [--no-tag] [--out DIR]
#
# Outputs:
#   <out>/anvil-obsidian-terminal-v<version>.zip
#   <out>/anvil-obsidian-terminal-v<version>.zip.sha256
#   git tag v<version> (local — never pushed)
#
# Layout inside the zip (verified by tests/unit/release-script.test.ts):
#   manifest.json
#   main.js
#   styles.css
#   bin/pty-server     (executable bit set)
#
# This script never runs `git push`. Publication (pushing the tag, drafting
# a GitHub release, uploading the zip) is a deliberate manual step Steve
# takes after auditing the local artifacts. See docs/install.md.
#
# TODO: when an Apple Developer account becomes available, hook codesign +
# notarytool calls in here, then re-zip the signed binary. Phase 3 D1
# explicitly defers this; the xattr workaround in docs/install.md is the
# current install UX.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

VERSION_OVERRIDE=""
DO_BUILD=1
DO_TAG=1
OUT_DIR="$REPO_ROOT"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION_OVERRIDE="$2"
      shift 2
      ;;
    --no-build)
      DO_BUILD=0
      shift
      ;;
    --no-tag)
      DO_TAG=0
      shift
      ;;
    --out)
      OUT_DIR="$2"
      shift 2
      ;;
    --help|-h)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *)
      echo "release.sh: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

mkdir -p "$OUT_DIR"

# --- bump manifest.json version if requested -------------------------------

if [[ -n "$VERSION_OVERRIDE" ]]; then
  if ! [[ "$VERSION_OVERRIDE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "release.sh: --version must be X.Y.Z (got $VERSION_OVERRIDE)" >&2
    exit 2
  fi
  # Use node to do a type-safe edit of manifest.json — avoids sed
  # platform quirks and JSON-formatting drift.
  node -e "
    const fs = require('fs');
    const p = 'manifest.json';
    const m = JSON.parse(fs.readFileSync(p, 'utf-8'));
    m.version = '$VERSION_OVERRIDE';
    fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n');
  "
fi

VERSION="$(node -e "console.log(require('./manifest.json').version)")"
ARTIFACT_NAME="anvil-obsidian-terminal-v${VERSION}"
ZIP_PATH="${OUT_DIR%/}/${ARTIFACT_NAME}.zip"
SHA_PATH="${ZIP_PATH}.sha256"

# --- build (optional skip for tests) ---------------------------------------

if [[ "$DO_BUILD" -eq 1 ]]; then
  echo "[release] building production bundle (npm run build)..."
  npm run build
fi

# --- assemble staging directory --------------------------------------------

STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

PLUGIN_STAGE="$STAGE_DIR/$ARTIFACT_NAME"
mkdir -p "$PLUGIN_STAGE/bin"

for f in manifest.json main.js styles.css; do
  if [[ ! -f "$f" ]]; then
    echo "release.sh: required artifact missing: $f (run npm run build first)" >&2
    exit 1
  fi
  cp "$f" "$PLUGIN_STAGE/$f"
done

if [[ ! -f bin/pty-server ]]; then
  echo "release.sh: bin/pty-server is missing (run npm run build first)" >&2
  exit 1
fi
cp bin/pty-server "$PLUGIN_STAGE/bin/pty-server"
chmod 0755 "$PLUGIN_STAGE/bin/pty-server"

# --- zip --------------------------------------------------------------------

rm -f "$ZIP_PATH"
( cd "$STAGE_DIR/$ARTIFACT_NAME" && zip -r -X "$ZIP_PATH" . > /dev/null )

# --- sha256 -----------------------------------------------------------------

if command -v shasum >/dev/null 2>&1; then
  ( cd "$(dirname "$ZIP_PATH")" && shasum -a 256 "$(basename "$ZIP_PATH")" > "$SHA_PATH" )
else
  ( cd "$(dirname "$ZIP_PATH")" && sha256sum "$(basename "$ZIP_PATH")" > "$SHA_PATH" )
fi

echo "[release] built $ZIP_PATH"
echo "[release] sha256:"
cat "$SHA_PATH"

# --- local tag (no push) ----------------------------------------------------

if [[ "$DO_TAG" -eq 1 ]]; then
  TAG="v${VERSION}"
  if git rev-parse --quiet --verify "refs/tags/${TAG}" >/dev/null; then
    echo "[release] local tag $TAG already exists; leaving as-is"
  else
    git tag "$TAG"
    echo "[release] created local tag $TAG (NOT pushed)"
  fi
fi

echo "[release] DONE. Nothing has been pushed to a remote."
echo "[release] Next: review the zip, then publish manually per docs/install.md."
