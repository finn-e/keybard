#!/usr/bin/env bash
# Fail unless HEAD (a checked-out release tag) is already on origin/main.
# Both v (release) and x (prerelease) tags must be on main: a release is
# always something that was merged through a reviewed PR.
set -euo pipefail
tag=${1:?usage: on-main.sh <tag>}
git fetch -q --no-tags origin main
git merge-base --is-ancestor HEAD origin/main || { echo "::error::$tag is not on main" >&2; exit 1; }
echo "Releasing $tag: $(git log -1 --format='%h %s')"
