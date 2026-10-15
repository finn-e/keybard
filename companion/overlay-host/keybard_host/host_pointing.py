"""Pointing devices in the overlay: a scripted demo for review without a board.

The overlay draws the devices and the sniper and boost pills itself (Keybard's
PointingOverlayLayer); the Host only forwards the board's POINTING_MOTION (0x2D).
"""
import math


def demo_motion(t, dt):
    """A scripted POINTING_MOTION dict: the right trackball rolls, sniper on (as parsed from 0x2D)."""
    u = t % 8
    env = min(1, max(0, (u - .7) / .7)) * (1 - min(1, max(0, (u - 5.6) / 1.0)))
    vx = 1.25 * (math.sin(.9 * t) + .55 * math.sin(2.1 * t + 1)) * env
    vy = 1.25 * (math.cos(.7 * t + .3) + .45 * math.sin(1.7 * t)) * env
    counts = dt * 22 * 800 / 25.4
    still = dict(valid=True, scrolling=False, touchValid=False, fingers=0, dx=0, dy=0, touchX=0, touchY=0)
    return dict(sniper=True, boost=False, elapsedMs=int(dt * 1000), left=dict(still),
                right=dict(still, dx=int(round(vx * counts)), dy=int(round(vy * counts))))
