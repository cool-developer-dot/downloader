#!/bin/sh
# Builds the store ZIPs of the VidoraX Bridge extension into extensions/vidorax-bridge/dist/.
#   bash extensions/vidorax-bridge/package.sh
set -eu

DIR=$(cd "$(dirname "$0")" && pwd)
VERSION=$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' "$DIR/manifest.json" | head -n 1)
[ -n "$VERSION" ] || { echo "package.sh: no version in manifest.json" >&2; exit 1; }
OUT="$DIR/dist"
mkdir -p "$OUT"
FILES="manifest.json background.js popup.html popup.mjs popup.css lib icons"

rm -f "$OUT/vidorax-bridge-$VERSION.zip" "$OUT/vidorax-bridge-$VERSION-firefox.zip"
# shellcheck disable=SC2086 # FILES is a fixed list of names to split
(cd "$DIR" && zip -qr -X "$OUT/vidorax-bridge-$VERSION.zip" $FILES)
# Firefox gets the same files; a separate name keeps the AMO upload apart from the Chrome/Edge one.
cp "$OUT/vidorax-bridge-$VERSION.zip" "$OUT/vidorax-bridge-$VERSION-firefox.zip"
echo "Wrote $OUT/vidorax-bridge-$VERSION.zip (Chrome Web Store, Edge Add-ons)"
echo "Wrote $OUT/vidorax-bridge-$VERSION-firefox.zip (Firefox AMO)"
