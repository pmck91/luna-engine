#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'The initial package target is Linux x86_64.' >&2
  exit 1
fi
npm --prefix web run build
cargo build --release --workspace
mkdir -p dist
LUNA_PACKAGE_STAGE=$(mktemp -d dist/.luna-package.XXXXXX)
trap 'rm -rf "$LUNA_PACKAGE_STAGE"' EXIT
LUNA_PACKAGE_ROOT=$LUNA_PACKAGE_STAGE/luna-engine-linux-x86_64
mkdir -p "$LUNA_PACKAGE_ROOT"
cp target/release/luna target/release/luna-editor "$LUNA_PACKAGE_ROOT/"
cp README.md "$LUNA_PACKAGE_ROOT/"
cp -R docs spec "$LUNA_PACKAGE_ROOT/"
mkdir -p "$LUNA_PACKAGE_ROOT/examples"
cp examples/locked-study.luna "$LUNA_PACKAGE_ROOT/examples/"
cp examples/README.md "$LUNA_PACKAGE_ROOT/examples/"
cp -R examples/locked-study "$LUNA_PACKAGE_ROOT/examples/"
cp examples/packing-study.luna "$LUNA_PACKAGE_ROOT/examples/"
cp -R examples/packing-study "$LUNA_PACKAGE_ROOT/examples/"
cp examples/parser-gallery.luna "$LUNA_PACKAGE_ROOT/examples/"
cp -R examples/parser-gallery "$LUNA_PACKAGE_ROOT/examples/"
find "$LUNA_PACKAGE_ROOT" -name '.luna-write.lock' -delete
tar -czf dist/luna-engine-linux-x86_64.tar.gz -C "$LUNA_PACKAGE_STAGE" luna-engine-linux-x86_64
sha256sum dist/luna-engine-linux-x86_64.tar.gz > dist/luna-engine-linux-x86_64.tar.gz.sha256
echo "Package: dist/luna-engine-linux-x86_64.tar.gz"
