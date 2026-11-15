#!/bin/sh
# Builds design/icon.icns from design/icon.png (1024 px, rendered from loadout-app-icon.svg).
# The set leaves out the 16 px and 32 px 1x images: with them, macOS 26 and later draw the icon
# shrunk on a light plate at small sizes (Finder, Dock). Focus's icon set has the same gap.
set -e
cd "$(dirname "$0")"
set_dir=$(mktemp -d)/icon.iconset
mkdir -p "$set_dir"
for size in 16 32 128 256 512; do
  double=$((size * 2))
  if [ "$size" -ge 128 ]; then
    sips -z "$size" "$size" icon.png --out "$set_dir/icon_${size}x${size}.png" >/dev/null
  fi
  sips -z "$double" "$double" icon.png --out "$set_dir/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$set_dir" -o icon.icns
