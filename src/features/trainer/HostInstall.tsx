import { Download, ExternalLink, PlugZap } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
    return <p className="trainer-note">
        Connected to {name}{build.keybardCommit ? ` · Keybard ${build.keybardCommit}` : ''}.
        {outdated && <> Keybard Host {HOST_RELEASE_TAG} is available: <a href={HOST_RELEASE} target="_blank" rel="noreferrer">download it</a>.</>}
    </p>;
}

export function HostInstall({ onConnect }: { onConnect?: () => void }) {
    return <section className="trainer-install" aria-label="Install desktop overlay">
        <div className="trainer-install-heading"><div><h2>Show the overlay on your desktop</h2>
            <p>Install Keybard Host to show the overlay above your other apps.</p></div>
            <a className="trainer-install-download" href={HOST_DOWNLOAD}><Download size={16} /> Download for Windows</a>
        </div>
        <p>Extract the ZIP, then run <strong>Start-Windows.cmd</strong>. First launch needs internet to install its local runtime. No administrator access needed.</p>
        <p>The overlay shows your Svalboard’s layout and follows it as you type. Its settings are in its <strong>⋯</strong> menu and the system tray icon.</p>
        {onConnect && <p>Is Keybard Host running? Connect this page to it. If your browser asks to let this site access apps on your device, allow it.</p>}
        <div className="trainer-install-links">{onConnect && <Button variant="outline" onClick={onConnect}><PlugZap size={14} /> Connect to Keybard Host</Button>}<a href="http://127.0.0.1:5178/" target="_blank" rel="noreferrer">Already running? Open local Keybard <ExternalLink size={12} /></a>
            <a href={HOST_RELEASE} target="_blank" rel="noreferrer">Release notes</a></div>
    </section>;
}
