#!/usr/bin/env bash
# Start Keybard Host on macOS from source or from the release ZIP.
# Untested on real hardware: see "macOS" in README.md.
# Usage: bash start-macos.sh [--paranoid] [--port 5179] [other host options]
set -euo pipefail
cd "$(dirname "$0")"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "start-macos.sh is for macOS. On Linux, use start-linux.sh." >&2
  exit 1
fi

# PySide6 6.11 needs Python 3.10 or later and macOS 13 or later. The python3
# that ships with Xcode's command line tools is 3.9, so prefer a newer one.
ok() { "$1" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; }
PYTHON=""
for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$candidate" >/dev/null 2>&1 && ok "$candidate"; then
    PYTHON="$candidate"
    break
  fi
done
if [ -z "$PYTHON" ]; then
  echo "Keybard Host needs Python 3.10 or later." >&2
  echo "Install it from https://www.python.org/downloads/macos/" >&2
  echo "or with Homebrew: brew install python@3.13" >&2
  exit 1
fi

# Rebuild a virtual environment left by an older Python.
if [ -x .venv/bin/python ] && ! ok .venv/bin/python; then
  rm -rf .venv
fi
if [ ! -x .venv/bin/python ]; then
  "$PYTHON" -m venv .venv
fi
.venv/bin/python -m pip install --quiet --disable-pip-version-check \
  -r requirements.txt

paranoid=0; custom=0
for arg in "$@"; do
  case "$arg" in
    --paranoid) paranoid=1 ;;
    --assets|--assets=*) custom=1 ;;  # the host checks a folder given to it
  esac
done
web=web
[ "$paranoid" = 1 ] && web=web-paranoid
[ "$custom" = 1 ] && web=""
if [ -n "$web" ] && [ ! -f "$web/index.html" ]; then
  echo "Keybard's web build is missing from $(pwd)/$web." >&2
  echo "Extract the whole release ZIP, or see 'macOS' in README.md." >&2
  exit 1
fi

exec .venv/bin/python -m keybard_host "$@"
