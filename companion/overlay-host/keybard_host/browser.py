"""Open Keybard Paranoid in a contained Chromium profile.

A page's Content Security Policy cannot stop navigations, prerendering or
downloads, so paranoid mode also runs the browser behind a dead proxy: every
non-loopback request fails, while Chromium still bypasses proxies for
127.0.0.1, so the local Keybard Host keeps working. WebRTC is kept off the
network, and background services (sync, updates, safe-browsing pings) are off.
"""
import os
from pathlib import Path
import subprocess
import sys

# Keep in sync with scripts/Open-Paranoid.ps1.
CONTAINMENT_FLAGS = (
    '--proxy-server=http://127.0.0.1:9',
    '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-component-update',
    '--no-first-run',
    '--no-default-browser-check',
)


# macOS app bundles, checked in /Applications and then ~/Applications.
MAC_BROWSERS = (
    'Google Chrome.app/Contents/MacOS/Google Chrome',
    'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
)


def find_chromium(platform=None):
    if (platform or sys.platform) == 'darwin':
        for root in (Path('/Applications'), Path.home() / 'Applications'):
            for rel in MAC_BROWSERS:
                path = root / rel
                if path.is_file(): return path
        return None
    roots = [os.environ.get(k) for k in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA')]
    for root in filter(None, roots):
        for rel in (r'Google\Chrome\Application\chrome.exe', r'Microsoft\Edge\Application\msedge.exe'):
            path = Path(root) / rel
            if path.is_file(): return path
    return None


def contained_command(browser, profile, url):
    return [str(browser), f'--user-data-dir={profile}', *CONTAINMENT_FLAGS, f'--app={url}']


def open_contained(url, profile):
    browser = find_chromium()
    if not browser: return False
    Path(profile).mkdir(parents=True, exist_ok=True)
    subprocess.Popen(contained_command(browser, profile, url), close_fds=True)
    return True
