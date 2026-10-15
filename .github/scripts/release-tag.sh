#!/usr/bin/env bash
# Classify a release tag. The same tag names are used on svalboard/keybard
# (site and Keybard Host) and svalboard/qmk (firmware):
#
#   v<N>[.<M>...]   full release   (v3, v3.1)  -> keybard.svalboard.com
#   x<N>[.<M>...]   prerelease     (x3, x3.1)  -> next.keybard.svalboard.com
#
# Anything else (vLaunch2, v3-rc1, x, 3, ...) does not release.
#
# Usage: release-tag.sh <tag> [release|prerelease]
# Prints "release" or "prerelease". Exits 1 when the tag is not a release tag,
# or when it is not the kind named by the optional second argument.
set -euo pipefail

tag=${1:-}
want=${2:-}

if [[ "$tag" =~ ^v[0-9]+(\.[0-9]+)*$ ]]; then
  kind=release
elif [[ "$tag" =~ ^x[0-9]+(\.[0-9]+)*$ ]]; then
  kind=prerelease
else
  echo "::error::'$tag' is not a release tag: v<N>[.<M>] (release) or x<N>[.<M>] (prerelease)" >&2
  exit 1
fi

if [[ -n "$want" && "$want" != "$kind" ]]; then
  echo "::error::'$tag' is a $kind tag; this workflow takes only $want tags" >&2
  exit 1
fi

echo "$kind"
