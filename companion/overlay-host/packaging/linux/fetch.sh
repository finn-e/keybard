#!/usr/bin/env bash
# Download everything build.sh needs into DL, each pinned and checked by SHA-256.
# Files already in DL are checked again and not downloaded twice.
#
#   DL=<downloads> bash companion/overlay-host/packaging/linux/fetch.sh
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
DL=${DL:?set DL to the downloads folder}
mkdir -p "$DL/wheels" "$DL/fallback"

PYTHON=cpython-3.13.16+20261003-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz
PYTHON_URL=https://github.com/astral-sh/python-build-standalone/releases/download/20261003/cpython-3.13.16%2B20261003-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz
PYTHON_SHA=4595c5589fff7bf0cb158d9a88a797e0d791fa33830770fcb7bf3f4b104feeae
TOOL_URL=https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage
TOOL_SHA=ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0
# appimagetool would otherwise download the newest runtime itself.
RUNTIME_URL=https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64
RUNTIME_SHA=2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d
# libxcb-cursor from Ubuntu 22.04: newer distributions build it against glibc 2.38.
CURSOR_URL=http://archive.ubuntu.com/ubuntu/pool/universe/x/xcb-util-cursor/libxcb-cursor0_0.1.1-4ubuntu1_amd64.deb
CURSOR_SHA=c9b5d1ad4af57397b1bd77e0a92750e34419def134c0282a0836ae9efc07cf64

fetch() {  # fetch <url> <file> <sha256>
  local url=$1 file="$DL/$2" sha=$3
  if [ ! -f "$file" ] || ! echo "$sha  $file" | sha256sum -c --quiet - 2>/dev/null; then
    curl -sSfL --retry 3 -o "$file.part" "$url"
    mv "$file.part" "$file"
  fi
  echo "$sha  $file" | sha256sum -c --quiet -
}

fetch "$PYTHON_URL" "$PYTHON" "$PYTHON_SHA"
fetch "$TOOL_URL" appimagetool "$TOOL_SHA"; chmod +x "$DL/appimagetool"
fetch "$RUNTIME_URL" runtime-x86_64 "$RUNTIME_SHA"
fetch "$CURSOR_URL" libxcb-cursor0.deb "$CURSOR_SHA"
rm -rf "$DL/cursor-deb"; dpkg-deb -x "$DL/libxcb-cursor0.deb" "$DL/cursor-deb"
cp -L "$DL/cursor-deb/usr/lib/x86_64-linux-gnu/libxcb-cursor.so.0" "$DL/fallback/libxcb-cursor.so.0"

# Wheels: pip from the pinned Python, every file checked against requirements-linux.txt.
rm -rf "$DL/py-fetch"; mkdir -p "$DL/py-fetch"
tar -xzf "$DL/$PYTHON" -C "$DL/py-fetch" --strip-components=1
"$DL/py-fetch/bin/python3" -m pip download -q --only-binary=:all: --require-hashes \
  -r "$HERE/requirements-linux.txt" -d "$DL/wheels"
rm -rf "$DL/py-fetch"
ls -l "$DL" "$DL/wheels"
