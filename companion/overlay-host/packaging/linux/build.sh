#!/usr/bin/env bash
# Build the Linux x86_64 test package of Keybard Overlay: a .tar.gz and an AppImage,
# each with its own Python and Qt, so the tester needs no pip and no admin rights.
#
# Run on Linux (WSL Ubuntu is fine) after building Keybard with VITE_BASE_PATH=/
# (npm run build:svalboard) and npm run build:paranoid:
#
#   DL=<downloads> OUT=<output dir> bash companion/overlay-host/packaging/linux/build.sh
#
# DL holds the python-build-standalone tarball (PYTHON_TARBALL), the pinned wheels
# for requirements.txt in DL/wheels, appimagetool, and DL/fallback (see below).
# Nothing is downloaded here.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
HOST=$(cd "$HERE/../.." && pwd)
ROOT=$(cd "$HOST/../.." && pwd)
DL=${DL:?set DL to the downloads folder}
OUT=${OUT:?set OUT to the output folder}
WORK=${WORK:-$HOME/builds/overlay-linux/work}
PYTHON_TARBALL=${PYTHON_TARBALL:-cpython-3.13.16+20261003-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz}
VERSION=${KEYBARD_HOST_VERSION:-linux-test}
COMMIT=${KEYBARD_COMMIT:-$(git -C "$ROOT" rev-parse --short=7 HEAD)}
NAME=KeybardOverlay

[ -f "$ROOT/dist/index.html" ] || { echo "Build Keybard first (npm run build:svalboard)" >&2; exit 1; }
grep -q 'src="/assets/' "$ROOT/dist/index.html" || { echo "dist/ is not built with VITE_BASE_PATH=/" >&2; exit 1; }
[ -f "$ROOT/dist-paranoid/keybard-paranoid.html" ] || { echo "Build Keybard Paranoid first" >&2; exit 1; }

rm -rf "$WORK"; mkdir -p "$WORK/$NAME"
APP="$WORK/$NAME"

echo "== Python runtime"
mkdir -p "$APP/runtime"
tar -xzf "$DL/$PYTHON_TARBALL" -C "$APP/runtime" --strip-components=1
PY="$APP/runtime/bin/python3"
"$PY" -m pip install -q --no-index --find-links "$DL/wheels" --no-warn-script-location \
  -r "$HOST/requirements.txt"
"$PY" -m pip uninstall -q -y pip
SITE=$("$PY" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')

echo "== Trim Qt modules the overlay doesn't load"
"$PY" "$HERE/prune.py" "$SITE/PySide6" > "$WORK/qt-libs-kept.txt"
rm -rf "$APP"/runtime/lib/python3*/test "$APP"/runtime/lib/python3*/idlelib \
  "$APP"/runtime/lib/python3*/tkinter "$APP"/runtime/lib/python3*/turtledemo \
  "$APP"/runtime/lib/tcl* "$APP"/runtime/lib/tk* "$APP"/runtime/lib/itcl* \
  "$APP"/runtime/lib/thread* "$APP"/runtime/lib/python3*/lib-dynload/_tkinter*
find "$APP/runtime" -name __pycache__ -prune -exec rm -rf {} +

echo "== App"
mkdir -p "$APP/app"
cp -r "$HOST/keybard_host" "$APP/app/"
find "$APP/app" -name __pycache__ -prune -exec rm -rf {} +
printf '{"version": "%s", "keybardCommit": "%s"}\n' "$VERSION" "$COMMIT" > "$APP/app/keybard_host/build.json"
cp -r "$ROOT/dist" "$APP/app/web"
find "$APP/app/web" -name '*.zip' -delete
mkdir -p "$APP/app/web-paranoid"
cp "$ROOT/dist-paranoid/keybard-paranoid.html" "$APP/app/web-paranoid/index.html"
(cd "$APP/app/web-paranoid" && sha256sum index.html > SHA256SUMS.txt)
# Byte-compile once, so a read-only AppImage never needs to write .pyc files.
"$PY" -m compileall -q "$APP/app/keybard_host" "$APP/runtime/lib" >/dev/null || true

echo "== Fallback X libraries"
mkdir -p "$APP/lib-fallback"
LDCACHE=$(ldconfig -p)
while read -r lib; do
  case "$lib" in ''|'#'*) continue ;; esac
  # DL/fallback holds copies built for older glibc where this machine's are too new
  # (Ubuntu 24.04's libxcb-cursor needs glibc 2.38; the copy from Ubuntu 22.04 needs 2.8).
  src="$DL/fallback/$lib"
  [ -f "$src" ] || src=$(awk -v n="$lib" '$1 == n && /x86-64/ && !found {print $NF; found=1}' <<<"$LDCACHE")
  [ -n "$src" ] || { echo "missing on build machine: $lib (apt install it)" >&2; exit 1; }
  cp -L "$src" "$APP/lib-fallback/$lib"
  need=$(objdump -T "$APP/lib-fallback/$lib" | grep -o 'GLIBC_[0-9.]*' | sort -Vu | tail -1)
  # Qt's wheels need glibc 2.34; the fallbacks must not need more.
  if [ "$(printf '%s\n' GLIBC_2.34 "$need" | sort -V | tail -1)" != GLIBC_2.34 ]; then
    echo "$lib needs $need; put an older build in DL/fallback" >&2; exit 1
  fi
done < "$HERE/fallback-libs.txt"

echo "== Launcher and files for the tester"
install -m 0755 "$HERE/keybard-overlay" "$APP/keybard-overlay"
install -m 0755 "$HERE/install-udev-rule.sh" "$APP/install-udev-rule.sh"
cp "$HERE/60-svalboard.rules" "$HERE/README-LINUX.md" "$HERE/keybard-overlay.desktop" "$APP/"
# A Windows checkout may have CRLF line endings; the tester's files must have LF.
sed -i 's/\r$//' "$APP/keybard-overlay" "$APP/install-udev-rule.sh" \
  "$APP/60-svalboard.rules" "$APP/README-LINUX.md" "$APP/keybard-overlay.desktop"
cp "$HOST/keybard_host/assets/svalboard.png" "$APP/keybard-overlay.png"
echo "$VERSION $COMMIT" > "$APP/VERSION"

mkdir -p "$OUT"
echo "== tar.gz"
TAR="$NAME-Linux-x86_64.tar.gz"
tar -C "$WORK" --owner=0 --group=0 -czf "$OUT/$TAR" "$NAME"

echo "== AppImage"
APPDIR="$WORK/$NAME.AppDir"
cp -a "$APP" "$APPDIR"
ln -s keybard-overlay "$APPDIR/AppRun"
ln -s keybard-overlay.png "$APPDIR/.DirIcon"
IMG="$NAME-x86_64.AppImage"
ARCH=x86_64 "$DL/appimagetool" --appimage-extract-and-run --no-appstream "$APPDIR" "$OUT/$IMG" >/dev/null

cp "$APP/README-LINUX.md" "$APP/60-svalboard.rules" "$APP/install-udev-rule.sh" "$OUT/"
(cd "$OUT" && sha256sum "$TAR" "$IMG" README-LINUX.md 60-svalboard.rules install-udev-rule.sh > SHA256SUMS)
ls -la "$OUT"
cat "$OUT/SHA256SUMS"
