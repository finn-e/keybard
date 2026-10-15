/**
 * Which Keybard this build is. Release builds carry their tag (v3 is a full
 * release, x3 a prerelease), set by the deploy and Keybard Host workflows
 * through RELEASE_TAG; any other build reports its commit.
 */
export const RELEASE_TAG = typeof __RELEASE_TAG__ !== "undefined" ? __RELEASE_TAG__ : "";
export const BUILD_SHA = typeof __GIT_SHA__ !== "undefined" ? __GIT_SHA__ : "";

/** "v3", "x3.1", or "build 1a2b3c4" (or "development build" with no commit). */
export function keybardVersion(tag = RELEASE_TAG, sha = BUILD_SHA): string {
    if (tag) return tag;
    return sha ? `build ${sha}` : "development build";
}
