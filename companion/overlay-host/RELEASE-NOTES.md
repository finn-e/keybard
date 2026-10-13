# Keybard Host — Windows

Keybard Host shows your Svalboard layout as a transparent overlay on your desktop. It follows the layer you're on, so you can glance at it while you type in any app. You set it up in the **Overlay** panel of [Keybard](https://keybard.svalboard.com).

This release is a portable ZIP for 64-bit Windows 10 and 11, not a signed installer.

## Unreleased

- **Trainer is now called Overlay.** The page in Keybard's left panel that sets up the overlay is now **Overlay**.
- **Practice is hidden for now.** The Overlay page no longer shows the Practice tab.
- **One settings panel.** The Overlay page's Placement, Appearance and Feedback tabs are now one compact panel, with each setting's name beside it. The preview shows the layer-change and held-key highlights on its own. **Place at bottom** and **Reload board layout** moved to the overlay's ⋯ menu (they're still in the tray menu); the overlay size is set with the resize grip.
- **Steadier overlay on Windows.** The overlay could leave a key lit, or patches blank, until the next keypress. It now renders in software, which fixes that with no noticeable cost.
- **Shift comes from your Svalboard.** Shifted legends follow Shift, Caps Lock and Caps Word on the board the overlay follows, as the board reports them. Shift on another keyboard no longer changes the overlay. This needs current Svalboard firmware; older firmware shows plain legends.
- **Held keys are highlighted.** **Highlight held keys** is now on by default, and this update turns it on once for everyone, since earlier versions saved it as off on their own. Turn it off with the **Held** switch on the Overlay page; that choice is kept.
- **The Svalboard icon matches your taskbar.** In the tray and taskbar it is a black glyph on a light taskbar and a white one on a dark taskbar, and switches when you change the Windows theme. Shortcuts and the installer keep the black-on-white icon.
- **Resize the overlay where it is.** Drag the new resize grip, between the move grip and the menu above the overlay's corner: up or right makes the overlay bigger, down or left smaller. Its bottom-left corner stays put, and the size is saved like Trainer's **Overlay size** slider.
- **Collapse the overlay out of the way.** The new collapse button, beside the grips above the overlay's corner, hides the overlay and leaves just the grips. Click it again to bring the overlay back; no trip to the tray needed. The move grip still moves it while it's collapsed. It replaces **Hide overlay** in the overlay's menu; the tray's **Show overlay** still hides it completely.
- **Bigger letters and numbers.** Keys that show a single letter or digit draw it half again as large, at every overlay size.
- **Adaptive contrast (Windows).** Turn on **Adaptive contrast** in the overlay's menu and each key restyles itself for the background around it, about twice a second: dark legends over light windows, light ones over dark windows, and a backing plate that gets more opaque the busier the background is. The overlay still shows in screenshots and recordings.
- **Capital letters, if you prefer.** Turn on **Capital letters** in the overlay's menu to show letter keys in capitals.
- **Only the grip moves the overlay.** **Drag by keys** is gone from the Overlay page, the overlay's menu and the tray, so every click on the overlay, keys included, reaches the window underneath.
- **The overlay stays on top.** Windows could leave the overlay, or its grips, underneath other windows; the Host now puts them back within a second.
- **Overlay menu changes stick.** A setting saved shortly after you changed Capital letters, adaptive contrast or the overlay size no longer undoes that change.
- **Size changes keep the overlay on screen.** Changing the size from the Overlay page keeps the overlay's bottom edge where it is instead of growing it off the bottom of the screen.
- **A damaged settings file no longer stops the Host from starting**; it falls back to the default settings.
- **macOS, for testers.** The ZIP now includes `start-macos.sh`, which runs Keybard Host on macOS 13 or later with Python 3.10 or later. Nobody has tried it on a Mac yet; see "macOS" in `README.md` for what to check.

## New in vLaunch2.2

- **Clicks go through the overlay.** The overlay no longer catches clicks anywhere in its rectangle: everything you click reaches the window underneath. Move it with the grip above its top-right corner.
- **Drag by keys, if you want it.** Turn on **Drag by keys** in Trainer, the overlay's menu or the tray to drag the overlay by its keys as well. Only the keys themselves take the click; the space between them still passes through.
- **Trainer's settings stick after the Host restarts.** Changing the overlay size or another setting in a Trainer tab opened before Keybard Host restarted used to snap back. Trainer now reconnects and saves the change. The Hide overlay button is gone from Trainer: hide the overlay from its handle menu or the tray.

## New in vLaunch2.1

- **Works with Keybard's preview site.** Trainer on [next.keybard.svalboard.com](https://next.keybard.svalboard.com), the bleeding-edge Keybard built from every change, can now connect to Keybard Host, as keybard.svalboard.com can.

## New in vLaunch2

- **The overlay keeps up with your edits.** When Keybard saves a change to the keyboard, the overlay updates about a second later, without going blank. Before, you had to choose **Reload layout** from the tray.
- **The bundled Keybard is current:** it can reorder layers by dragging their tabs, shows and sets the default layer, and warns when the keyboard couldn't save a setting.
- **Shows which version you have.** Trainer says which Keybard Host is connected and which Keybard it bundles, and points to a newer release when there is one. The tray icon's tooltip shows the same.
- **Made for Svalboard firmware vLaunch2.** It works with older firmware too, but moving or setting the default layer needs vLaunch2.

## Get started

1. Download **KeybardHost-Windows.zip** and extract the whole ZIP to a folder you'll keep.
2. Run **Start-Windows.cmd**. The first launch downloads its own copy of Python and Qt, so you need to be online. No admin rights or system changes are needed. Keybard Host then sits in your system tray and opens Trainer on [keybard.svalboard.com](https://keybard.svalboard.com).
3. In Trainer (Chrome or Edge), connect your keyboard and click **Connect to Keybard Host**. If the browser asks whether the site can access apps on this device, allow it.
4. Set up the overlay in Trainer. Use the tray icon to show, move or hide it, or to quit.

## What it does

- Shows your board's layout and follows your active layer, and your default layer on firmware that reports it.
- Keeps up with edits: when Keybard saves a change to the keyboard, the overlay re-reads the layout by itself, showing the old one until the new one is read.
- Uses Keybard's key icons. Shift and Caps Lock change the letters shown.
- Stays on top and lets clicks pass through. Move it with its grip.
- Adjustable color, outline, opacity and halo.
- Highlights layer changes and, optionally, the keys you're holding. Includes recall practice.

## Paranoid mode

Paranoid mode is a separate way to run Keybard Host, for people who want Keybard to have no network access at all.

- **Start-Paranoid.cmd** starts the Host with Keybard Paranoid, a single-file build of Keybard that can't reach the network. It ignores all websites, keybard.svalboard.com included, and opens Keybard in a separate browser profile that can only reach your own computer. The overlay works as usual.
- **Open-Paranoid.cmd** opens Keybard Paranoid on its own, without the overlay.

`docs/paranoid.md` in the source explains exactly what it protects.

## Limits

- **Read-only:** Keybard Host never changes your layout or flashes firmware. After you edit your layout, choose **Reload layout** from the tray.
- **Unsigned:** Windows may warn you about it. Only run a ZIP you downloaded from this release page.
- **Windows only for now:** macOS is untested, and Wayland has limits.
- **No automatic updates:** to update, quit from the tray, extract the new release to a new folder, and run it. Your settings carry over.

`SHA256SUMS.txt` has the ZIP's checksum.
