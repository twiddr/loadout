#!/bin/sh
# Renders the DMG window background into build/ with the repository's own Electron.
set -e
cd "$(dirname "$0")/../.."
scratch="$(mktemp -d)"
./node_modules/.bin/electron --user-data-dir="$scratch" design/dmg/render.mjs
rm -rf "$scratch"
