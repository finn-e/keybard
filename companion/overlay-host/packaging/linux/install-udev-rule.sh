#!/bin/sh
# Install the Svalboard udev rule so Keybard Overlay can read the board without root.
# Run once with: sudo ./install-udev-rule.sh   Then unplug and replug the board.
set -e
if [ "$(id -u)" != 0 ]; then echo "Run with sudo: sudo $0" >&2; exit 1; fi
install -m 0644 "$(dirname "$0")/60-svalboard.rules" /etc/udev/rules.d/60-svalboard.rules
udevadm control --reload
udevadm trigger --subsystem-match=hidraw
echo "Installed /etc/udev/rules.d/60-svalboard.rules. Unplug and replug the board."
