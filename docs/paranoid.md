# Keybard Paranoid

Keybard Paranoid is Keybard as a single HTML file that runs on your own computer, plus launchers that keep the browser from reaching the network.

## What protects you, and how

There are two layers. You need both.

1. **The page cannot fetch or load anything.** The file carries a Content Security Policy that blocks fetches, XHR, WebSockets, beacons, fonts, images, frames, workers, preloads and form posts. Scripts run only if their hashes match. Everything Keybard needs is embedded: code, styles, the Inter font, the icon, the example layout and the layer library. The only connection the policy allows is to the Keybard Overlay serving the page in paranoid mode.
2. **The browser cannot reach the network.** A page's policy cannot stop navigations: redirects, prerendering, downloads and new windows can still carry data out. So the launchers open Chrome or Edge in a separate profile behind a dead proxy (`--proxy-server=127.0.0.1:9`). Every request that isn't loopback fails, navigations included. WebRTC is limited to proxied traffic, which means none, and background browser services are off. Chromium always bypasses proxies for loopback, so Keybard Overlay still works. That also means other services listening on your own machine stay reachable from the page.

Opening the file by double-clicking it, or opening the overlay app's address in your normal browser, gives you layer 1 only. Extensions installed in a normal profile can also read the page. Use the launchers for both layers.

## What reads your keyboard, and when

- **Keybard Paranoid** asks the board for its active layer only while its window is visible and focused. The Matrix Tester and Scan Lab only read while open and in front of you.
- **Keybard Overlay** reads the board continuously while it runs, because the overlay is meant to work while you type in other apps. It reads the active layer and runs periodic device scans, and checks the Shift and Caps Lock state from Windows. Key presses are read only if you turn on held-key highlighting. It never sends anything off your computer, and in paranoid mode it accepts no website at all.

## Use it

### On its own

1. Extract the Keybard Overlay ZIP. It contains `keybard-paranoid.html` and `Open-Paranoid.cmd`. You can also download `keybard-paranoid.html` on its own from the release and check it against `SHA256SUMS.txt`.
2. Run **Open-Paranoid.cmd**. It opens the file in the contained Chrome or Edge profile.
3. Click **Connect Keyboard** and choose your Svalboard.

The Trainer works as a preview. For the desktop overlay, use Keybard Overlay in paranoid mode.

### With the Trainer overlay

1. Quit any Keybard Overlay that is already running (tray icon → Quit).
2. Run **Start-Paranoid.cmd**. The first run downloads and verifies the overlay app's private Python/Qt runtime. After that it needs no network.
3. Keybard Paranoid opens at `http://127.0.0.1:5178/` in the contained profile.

In paranoid mode the overlay app:
- Refuses every website, including keybard.svalboard.com.
- Refuses to be framed by any page.
- Serves only Keybard Paranoid: it checks the page against the checksum shipped with it and its policy at startup, caches it, and serves nothing else.
- Binds its port exclusively.
- Will not take over from an overlay app it can't confirm is in paranoid mode; it tells you to quit that one first.
- If a paranoid overlay app is already running, starting Keybard Overlay normally opens it in the contained profile too.

## Limits worth knowing

- **Keep the profile for Keybard only.** Chrome treats every HTML file opened from disk as the same origin. Another local HTML file opened in the contained profile could read Keybard's saved settings and, if permitted, talk to your keyboard. Don't use that profile for anything else.
- **The firmware answers any page you connect.** Over WebHID, the keyboard's firmware reports its switch matrix to whatever page you've connected it to. Keybard Paranoid only asks while the Matrix Tester is open, but that protection is in the page's code, not in the firmware.
- **Managed browsers may ignore the proxy.** If your organization sets proxy settings by policy, they override the launchers' flags, and layer 2 may not apply.
- **Outside apps can be launched with your consent.** A `mailto:` or other app link goes through the operating system, not the browser's network stack, if you approve Chrome's prompt.
- **The launchers need Chrome or Edge.** WebHID needs a Chromium browser. If neither is installed, the launchers say so and open nothing.
- **Updates are manual.** Download the new release when one comes out. There is no update check, by design.

## Build it

```sh
npm run build:paranoid     # writes dist-paranoid/keybard-paranoid.html and SHA256SUMS.txt
```

`build/paranoid.ts` inlines everything. It hashes each inline script into the policy, after normalizing line endings exactly as browsers do. It fails the build if the static page still references anything outside the file, through `src`, `href`, `srcset`, `poster`, `xlink:href`, CSS `url()` or `@import`. It also fails on meta refresh, preconnect, prefetch, prerender, preload or speculation rules. `tests/build/paranoid.test.ts` covers these rules, including the bypasses found in review.
