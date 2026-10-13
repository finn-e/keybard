import type { HostBuild } from './host';

/** The Keybard Host release this Keybard offers; a connected host on another release is told about it. */
export const HOST_RELEASE_TAG = 'vLaunch2.2';
export const HOST_RELEASE = `https://github.com/svalboard/keybard/releases/tag/${HOST_RELEASE_TAG}`;
export const HOST_DOWNLOAD = HOST_RELEASE.replace('/tag/', '/download/') + '/KeybardHost-Windows.zip';

/** Which Keybard Host is connected, and a pointer to the current release when it's an older one. */
export function HostVersion({ build }: { build: HostBuild | null }) {
    if (!build) return null;
    const outdated = build.version !== 'dev' && build.version !== HOST_RELEASE_TAG;
    const name = build.version === 'unknown' ? 'an older Keybard Host' : `Keybard Host ${build.version}`;
    return <p className="text-xs text-muted-foreground">
        Connected to {name}{build.keybardCommit ? ` · Keybard ${build.keybardCommit}` : ''}.
        {outdated && <> Keybard Host {HOST_RELEASE_TAG} is available: <a className="underline" href={HOST_RELEASE} target="_blank" rel="noreferrer">download it</a>.</>}
    </p>;
}
