# Keybard Host

Keybard Host shows your Svalboard layout as a transparent overlay on your desktop. It follows the layer you're on, so you can glance at it while you type in any app. It runs in the system tray and only reads from the keyboard: it never changes your layout or flashes firmware.

You choose what the overlay looks like in the **Overlay** panel of [Keybard](https://keybard.svalboard.com).

## Install (Windows)

1. Download `KeybardHost-Windows.zip` from [Releases](https://github.com/svalboard/keybard/releases) and extract the whole ZIP to a folder you'll keep.
2. Run `Start-Windows.cmd`. The first launch downloads its own copy of Python and Qt, so you need to be online. No admin rights or system changes are needed.

Keybard Host is now in your system tray, and it opens Keybard's Overlay page on [keybard.svalboard.com](https://keybard.svalboard.com) in your browser.

## Set up the overlay

1. On the Overlay page, connect your keyboard if it isn't already, and click **Connect to Keybard Host**. If the browser asks whether the site can access apps on this device, allow it. Next time it reconnects on its own.
2. If you have more than one Svalboard, pick yours from **Board** in the overlay's ⋯ menu or the tray icon. Settings are saved on this computer.

Use Chrome or Edge. **Open Keybard** in the tray menu takes you back to the Overlay page. Offline, the Host's built-in copy of Keybard at `http://127.0.0.1:5178/` works the same way.

## Using it

- **Place it:** drag the move grip above the overlay's top-right corner. **Size it:** drag the resize grip next to it, up or right to grow, down or left to shrink. **Collapse it:** the collapse button beside the grips hides the overlay and leaves just the grips; click it again to bring it back. Clicks anywhere else, keys included, pass through to the window underneath.
- **Overlay menu** (⋯ beside the grips, and the same items in the tray menu): **Board** picks the Svalboard to follow; **Style** picks a look (Dark, Subtle, Outline only, Light, High contrast); **Outline shadow** adds a contrasting shadow around legends and outlines (on by default); **Layer highlight** is Off, Flash or Fade; **Highlight held keys**; **Hands**; **Capital letters** shows letter keys in capitals; **Adaptive contrast** (Windows, off by default) restyles each key for the background behind it; **Place at bottom**; **Reload board layout**.
- **Tray menu:** show or hide the overlay, drag or place it at the bottom of the screen, reload the layout, open Keybard's Overlay page, or quit. Closing the browser leaves the overlay running.
- **After you edit your layout in Keybard**, the overlay updates by itself about a second after the change reaches the keyboard, as long as Keybard is connected to Keybard Host (the Overlay page's **Connect to Keybard Host**, once). For changes made elsewhere, choose **Reload layout** from the tray.
- **Held keys:** the keys you're holding are highlighted. Turn this off with **Highlight held keys** in the overlay's menu. Very short taps can be missed.
- **Shift and Caps Lock** on your Svalboard change the letters and symbols shown, using the keyboard language chosen in Keybard. Other keyboards on the computer don't. The board reports them itself, so this needs Svalboard firmware that does; older firmware shows plain legends.

## What it doesn't do

Keybard Host never writes to the keyboard, flashes firmware or records what you type. Its control page listens only on your own computer. It takes commands only from its built-in Keybard, keybard.svalboard.com and the preview site next.keybard.svalboard.com, and each change needs a per-session token.

## Updating

Quit Keybard Host from the tray, extract the new release to a new folder, and run `Start-Windows.cmd` there. Your settings are kept, because they're stored in your user profile rather than in the app folder.

## Paranoid mode

Paranoid mode is a separate way to run Keybard Host, for people who want Keybard to have no network access at all. `Start-Paranoid.cmd` starts the Host with Keybard Paranoid, a single-file build of Keybard that can't reach the network. It ignores all websites, keybard.svalboard.com included, and opens its own Keybard in a separate browser profile that can only reach your own computer. `Open-Paranoid.cmd` opens Keybard Paranoid on its own, without the overlay. See `docs/paranoid.md` for exactly what it protects.

## Linux and macOS

Linux: copy the web build to `companion/overlay-host/web`, then run `bash companion/overlay-host/start-linux.sh`. On Wayland, placement, stacking and click-through depend on the compositor.

macOS: see [macOS](#macos) below.

### Linux setup

Qt's X11 plugin and Qt WebEngine need these libraries. A full Ubuntu desktop has most of them; minimal installs and WSL do not. Qt reports any missing X11 library as `xcb-cursor0`, so install the whole list:

```sh
sudo apt install python3-venv libnss3 libasound2t64 libxkbfile1 libxcb-cursor0 libxcb-icccm4 \
  libxcb-keysyms1 libxcb-image0 libxcb-render-util0 libxcb-shape0 libxkbcommon-x11-0
```

The Host reads the board through hidraw, which only root can open by default. Give the logged-in user access to Svalboard HID devices, then replug the board. The rule matches the USB IDs rather than the serial number, because current firmware no longer reports the serial that Vial's udev rule looks for.

```sh
echo 'KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="303a", ATTRS{idProduct}=="4044", MODE="0660", TAG+="uaccess"' \
  | sudo tee /etc/udev/rules.d/60-svalboard.rules
sudo udevadm control --reload && sudo udevadm trigger --subsystem-match=hidraw
```

Under WSL, attach the board with [usbipd-win](https://github.com/dorssel/usbipd-win) (`usbipd bind`, then `usbipd attach --wsl`); Windows loses the board until it is detached. If Wayland fails with `Failed to create wl_display`, set `XDG_RUNTIME_DIR=/mnt/wslg/runtime-dir`. WSLg doesn't show the overlay under X11 (`QT_QPA_PLATFORM=xcb`), so use Wayland there. If a Windows Host already uses port 5178, start the Linux Host with `--port 5179`. What works under WSLg says nothing about stacking, focus or click-through on native Ubuntu.

### macOS

> **Untested on real hardware.** The macOS support was written without a Mac. It needs a Mac tester before anyone calls it supported; please report what works and what doesn't in [svalboard/keybard#51](https://github.com/svalboard/keybard/issues/51).

You need macOS 13 (Ventura) or later, on Apple Silicon or Intel, and Python 3.10 or later. The `python3` that comes with Xcode's command line tools is 3.9, which is too old: install Python from [python.org](https://www.python.org/downloads/macos/) or with `brew install python@3.13`.

1. Download `KeybardHost-Windows.zip` from a [release](https://github.com/svalboard/keybard/releases) that includes `start-macos.sh`, and extract it. Despite the name it carries everything the Mac needs except Python and Qt; `start-macos.sh` downloads Qt into a `.venv` folder next to it on first launch.
2. In Terminal, `cd` into the extracted `KeybardHost` folder and run `bash start-macos.sh`.

From a source checkout instead, build the web assets into `companion/overlay-host/web` (see [Build](#build): `VITE_BASE_PATH=/ npm run build`, then copy `dist` there), and run `bash companion/overlay-host/start-macos.sh`. Paranoid mode is `bash start-macos.sh --paranoid`, which needs `web-paranoid/index.html`; it opens Keybard Paranoid in Google Chrome or Microsoft Edge from `/Applications` or `~/Applications`.

On macOS the Host:

- runs as a menu bar app: its icon is in the menu bar, with no Dock icon. Click it for the menu.
- keeps the overlay above other windows, on every Space and over full-screen apps, and doesn't take focus or clicks.
- stores its settings in `~/Library/Application Support/Keybard Host/`.
- doesn't start at login. To have it start at login, add a login item for a script that runs `start-macos.sh`.

#### Permissions

The Host shouldn't need any privacy permission, but these are the ones to look at if something doesn't work (System Settings → Privacy & Security):

- **Input Monitoring:** the Host reads the board's layer, held keys, Shift and Caps Lock through the board's own Raw HID interface, not its keyboard interface, and never watches keystrokes. That shouldn't need Input Monitoring. If the overlay never finds the board, check whether macOS has listed Terminal (or your Python) here, and allow it.
- **Accessibility:** not used. The Host doesn't move other apps' windows or send input.
- **Local Network:** the Host only listens on `127.0.0.1`, which macOS doesn't ask about.

Chrome needs the board too. Keybard and the Host should both be able to have it open at the same time, as on Windows, because hidapi opens it without exclusive access.

#### What a Mac tester should check

1. `bash start-macos.sh` installs and starts with no errors, and the menu bar icon appears with no Dock icon.
2. The Overlay page opens in your browser, **Connect to Keybard Host** works, and the overlay shows your layout.
3. The overlay is see-through between the keys, stays above other windows, and clicks pass through it to the window underneath.
4. Clicking the overlay or its controls doesn't take focus from the app you're typing in.
5. The move grip drags the overlay and the resize grip resizes it; the collapse button hides the overlay but keeps the grips, and brings it back; clicks anywhere else on the overlay, keys included, pass through.
6. The overlay stays visible after you click on another app, switch Spaces, and open an app in full screen.
7. Layer changes and, with **Held keys** on, held keys show up live. Shift and Caps Lock on the board change the legends.
8. Keybard in Chrome and the Host both stay connected to the board at the same time.
9. **Quit host** from the menu bar quits it, and starting it again keeps your settings.
10. `bash start-macos.sh --paranoid` opens Keybard Paranoid in its own Chrome or Edge window.
11. Note your macOS version, Mac model (Apple Silicon or Intel), Python version and display setup (Retina, external monitors).

## For developers

### Build

From the repository root:

```sh
npm ci
VITE_BASE_PATH=/ npm run build
python3 companion/overlay-host/scripts/package.py
```

This makes `dist/KeybardHost-Windows.zip`, a local test build. It isn't signed, and it doesn't include downloaded runtimes or anyone's settings.

### Test

```sh
npm test
PYTHONPATH=companion/overlay-host python3 -m unittest discover -s companion/overlay-host/tests -v
```

These don't cover moving the window, focus, click-through, fullscreen, or live layer and held-key changes on real hardware. Check those by hand.

### Publish a Windows preview

1. Update `RELEASE-NOTES.md`.
2. Run the tests above and a Windows smoke test.
3. Build with `npm run build:svalboard`, then run `python3 companion/overlay-host/scripts/package.py`.
4. In `dist`, run `sha256sum KeybardHost-Windows.zip > SHA256SUMS.txt`.
5. Tag the commit (`keybard-host-vX.Y.Z-preview.N`, or a launch tag shared with the firmware such as `vLaunch2`) and publish a GitHub prerelease with the ZIP and the checksum. Set `KEYBARD_HOST_VERSION` to the tag when packaging, so the host reports it.
6. Set `HOST_RELEASE_TAG` in `src/features/trainer/HostInstall.tsx` to the new tag, so the Overlay page's install link finds it. Link the tag itself, not GitHub's `latest` redirect, which skips prereleases.

Instead of steps 3–5, you can run the **Package Keybard Host preview** workflow with an existing tag. It builds a draft prerelease with both files, stamps the release and the bundled Keybard commit into the host and the release notes; test the ZIP before you publish it.
