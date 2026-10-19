# Keybard Overlay for Linux (test build)

Keybard Overlay shows your Svalboard layout as a see-through overlay on your desktop. It follows the layer you're on, so you can glance at it while you type in any app. It sits in the system tray and only reads from the keyboard: it never changes your layout, flashes firmware or records what you type.

This is a **test build** for Linux. Thank you for trying it. Please run through the checklist below and send back your notes and one report file.

## What you need

- A 64-bit x86 PC (x86_64) running a desktop Linux from 2021 or later: Ubuntu 22.04+, Debian 12+, Fedora 36+, Linux Mint 21+, Arch or similar (glibc 2.34 or later).
- An X11 or Wayland desktop session.
- Google Chrome, Microsoft Edge or Chromium, to open Keybard and connect it to the overlay. Firefox has no WebHID.

Python, Qt and everything else come with the package. You don't need pip, and you don't need admin rights to run it. Admin rights are only needed once, for the board permission step below.

## 1. Let your user read the board (once)

Linux lets only root open a keyboard's raw HID interface by default. This udev rule gives the logged-in user access to Svalboards only (USB vendor ID `303a`, product IDs `4044` to `404d`).

From the folder with the files, run:

```sh
sudo ./install-udev-rule.sh
```

Then unplug the board and plug it back in.

<details><summary>Or install the rule by hand</summary>

```sh
sudo cp 60-svalboard.rules /etc/udev/rules.d/
sudo udevadm control --reload
sudo udevadm trigger --subsystem-match=hidraw
```

</details>

## 2. Start Keybard Overlay

Pick **one** of the two downloads. Both contain the same app.

**AppImage** (one file):

```sh
chmod +x KeybardOverlay-x86_64.AppImage
./KeybardOverlay-x86_64.AppImage
```

If it says something about FUSE, run it as `./KeybardOverlay-x86_64.AppImage --appimage-extract-and-run` instead, or use the `.tar.gz`.

**Folder** (`.tar.gz`):

```sh
tar -xzf KeybardOverlay-Linux-x86_64.tar.gz
cd KeybardOverlay
./keybard-overlay
```

The Svalboard icon appears in the system tray, and Keybard opens in your browser at its Overlay dialog. Click **Connect** there. If the browser asks whether the site may access apps on this device, allow it.

To put Keybard Overlay in your app menu, run it once with `--install-desktop-entry`.

### X11 and Wayland

On a Wayland desktop, Keybard Overlay runs through XWayland by default, because native Wayland doesn't let an app keep its window on top or place it on the screen. To try native Wayland instead, start it with `--wayland`. On an X11 desktop there is nothing to choose.

To quit, choose **Quit** in the tray menu, or press Ctrl+C in the terminal you started it from.

## 3. Using it

- **Place it:** drag the move grip above the overlay's top-right corner. **Size it:** drag the resize grip next to it. **Collapse it:** the button beside the grips.
- Clicks anywhere else on the overlay, keys included, pass through to the window underneath.
- The **⋯** menu beside the grips, and the tray menu, choose the board, style, colors and highlights.

## 4. What to check

Please note down your setup first:

| | |
|---|---|
| Distribution and version (e.g. Ubuntu 24.04) | |
| Desktop environment (GNOME, KDE Plasma, Xfce, Cinnamon, …) | |
| Session type (`echo $XDG_SESSION_TYPE`: x11 or wayland) | |
| Which download (AppImage or .tar.gz) | |
| Browser | |
| Displays (how many, scaling) | |

Then check each item, and add a note for anything that doesn't work:

| # | Check | Works? | Notes |
|---|---|---|---|
| 1 | Keybard Overlay starts with no error, and the tray icon appears | | |
| 2 | The board connects (Keybard's Overlay dialog, **Connect**) | | |
| 3 | The overlay shows your layout | | |
| 4 | It follows layer changes as you switch layers on the board | | |
| 5 | Held keys light up while you hold them | | |
| 6 | Clicks pass through the overlay to the window underneath | | |
| 7 | Clicking the overlay doesn't take focus from the app you're typing in | | |
| 8 | It stays on top of other windows, including after you click another window | | |
| 9 | The move and resize grips work | | |
| 10 | The tray icon's menu works: show and hide, Open Keybard, Quit | | |
| 11 | Quitting and starting again keeps your settings and position | | |
| 12 | On Wayland: the default start (through XWayland) does all of the above | | |
| 13 | On Wayland: `--wayland` (native) — note which of 6, 7, 8 and 9 work | | |
| 14 | If you can, log into the other session type (X11 or Wayland) and repeat | | |

## 5. Send back one report

After testing, with the board plugged in, run:

```sh
./keybard-overlay --diagnose
```

(or `./KeybardOverlay-x86_64.AppImage --diagnose`). It writes `keybard-overlay-report.txt` in your home folder. Please send that file with your notes. It contains your system and desktop details, what Keybard Overlay can see of your Svalboards, and the log of its last two runs. It contains nothing you typed.

Every run is also logged to `~/.local/state/keybard-overlay/overlay.log`.

## Troubleshooting

- **The board never connects:** check that you ran step 1 and replugged the board. `--diagnose` shows `CANNOT OPEN` when the permission is missing.
- **No tray icon on GNOME:** plain GNOME has no tray. Ubuntu's desktop includes one; on Fedora and others, install the "AppIndicator and KStatusNotifierItem Support" GNOME extension. The overlay still works without the tray; **Open Keybard** is then reached from Keybard itself, and Ctrl+C in the terminal quits.
- **A missing library error** (for example `libnss3` or `libasound`): install your distribution's `nss` and `alsa-lib` (or `libnss3` and `libasound2`) packages, and send the report.
- **Black box behind the keys on X11:** the overlay needs a compositor to be see-through. GNOME, KDE Plasma and Cinnamon always have one; on Xfce turn on Settings > Window Manager Tweaks > Compositor; with i3 and other plain window managers, run a compositor such as picom.
- **Port in use:** if something else uses port 5178, start with `--port 5179`.

## Removing it

Delete the AppImage or the `KeybardOverlay` folder. Settings are under `~/.local/share` and logs under `~/.local/state/keybard-overlay`. To remove the board permission rule: `sudo rm /etc/udev/rules.d/60-svalboard.rules`.
