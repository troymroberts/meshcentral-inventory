#!/usr/bin/env bash
# Bash port of scripts/package.ps1: builds dist/MeshCentral-Inventory-<version>.zip with every
# entry under inventory/ and '/' separators (what the MeshCentral plugin loader expects).
set -euo pipefail
project="$(cd "$(dirname "$0")/.." && pwd)"
version="${1:-$(node -p "require('$project/package.json').version")}"
dist="$project/dist"
stage="$(mktemp -d "$dist/.inventory-stage-XXXXXX" 2>/dev/null || { mkdir -p "$dist"; mktemp -d "$dist/.inventory-stage-XXXXXX"; })"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/inventory/lib" "$stage/inventory/views"
cp "$project/inventory.js" "$project/config.json" "$project/README.md" "$project/LICENSE" "$stage/inventory/"
[ -f "$project/NOTICE" ] && cp "$project/NOTICE" "$stage/inventory/"
cp "$project/lib/model.js" "$stage/inventory/lib/"
cp "$project/views/inventory.handlebars" "$stage/inventory/views/"
archive="$dist/MeshCentral-Inventory-$version.zip"
rm -f "$archive"
(cd "$stage" && TZ=UTC find inventory -type f -exec touch -t 202601010000 {} + && find inventory -type f | sort | zip -X -q -9 "$archive" -@)
cp "$archive" "$dist/MeshCentral-Inventory.zip"
mkdir -p "$project/release-assets" && cp "$archive" "$project/release-assets/MeshCentral-Inventory.zip"
echo "$project/release-assets/MeshCentral-Inventory.zip"
echo "$archive"
echo "$dist/MeshCentral-Inventory.zip"
