import React from "react";
import { RELEASE_TAG } from "@/utils/build-info";

/**
 * Tiny build identifier in the bottom-left corner so you can tell which
 * release / branch / PR / commit is actually deployed at the URL you're looking at.
 * A release build (v3, x3.1) leads with its tag.
 * Reads from globals injected by vite.config.ts (__GIT_BRANCH__, __GIT_SHA__,
 * __GIT_SUBJECT__) which the deploy workflows populate from GitHub Actions
 * context (commit message subject usually contains the PR number for squash
 * merges, or "Merge pull request #N" for merge commits).
 */
const DeployBadge: React.FC = () => {
    const branch = typeof __GIT_BRANCH__ !== "undefined" ? __GIT_BRANCH__ : "";
    const sha = typeof __GIT_SHA__ !== "undefined" ? __GIT_SHA__ : "";
    const subject = typeof __GIT_SUBJECT__ !== "undefined" ? __GIT_SUBJECT__ : "";

    if (!RELEASE_TAG && !branch && !sha && !subject) return null;

    const prMatch = subject.match(/(?:Merge pull request #|\(#)(\d+)\)?/);
    const prNumber = prMatch ? `PR #${prMatch[1]}` : "";

    const truncated = subject.length > 70 ? subject.slice(0, 67) + "…" : subject;
    const parts = RELEASE_TAG
        ? [RELEASE_TAG, sha || null]
        : [prNumber || branch || null, sha || null, truncated || null];
    const shown = parts.filter(Boolean);

    return (
        <div
            className="fixed bottom-1 left-1 max-w-[80vw] truncate font-mono text-[10px] text-slate-500/70 dark:text-neutral-400/70 pointer-events-none select-none z-50"
            aria-hidden="true"
        >
            {shown.join(" · ")}
        </div>
    );
};

export default DeployBadge;
