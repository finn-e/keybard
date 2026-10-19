"""Pointing devices in the overlay: a scripted demo for review without a board.

The overlay draws the devices and the sniper and boost pills itself (Keybard's
PointingOverlayLayer); the Host only forwards the board's POINTING_MOTION (0x2D).
"""
import math

# Counts per mm of trackball surface the demo reports, as a sensor at the default
# CPI would; the demo reports no CPI, so the overlay assumes the same default
# (DEFAULT_TRACKBALL_CPI in Keybard's src/components/pointing-viz/ball-gearing.ts).
DEFAULT_TRACKBALL_CPI = 800
TRACKBALL_COUNTS_PER_MM = DEFAULT_TRACKBALL_CPI / 25.4


# Velocity Scroll's build-time defaults (velocity_scroll.h), for the demo: a board reports its own.
VELOCITY_BALL = dict(deadMm=0.8, gain=12.0, exponent=1.5, maxNps=60.0)
VELOCITY_PAD = dict(deadMm=1.5, gain=16.0, exponent=1.5, maxNps=60.0)


def velocity_speed(curve, offset_mm):
    """Signed notches/s for an offset along one axis (the firmware's sval_vs_speed)."""
    past = abs(offset_mm) - curve['deadMm']
    if past <= 0:
        return 0.0
    nps = min(curve['maxNps'], curve['gain'] * (past / 10) ** curve['exponent'])
    return -nps if offset_mm < 0 else nps


def velocity_path(t):
    """The demo trackball's offset in mm at t seconds (Keybard's velocityPath for a trackball)."""
    u = (t % 9) / 9
    y = 34 * (.62 * math.cos(u * 2 * math.pi) + .18 * math.sin(u * 4 * math.pi))
    x = 34 * .16 * math.sin(u * 3 * math.pi + .6)
    return x, y


def demo_velocity(t, dt):
    """--demo-velocity: Velocity Scroll held on the right trackball, its offset moving."""
    (x0, y0), (x1, y1) = velocity_path(t - dt), velocity_path(t)
    still = dict(valid=True, scrolling=False, touchValid=False, fingers=0, dx=0, dy=0, touchX=0, touchY=0)
    right = dict(still, dx=int(round((x1 - x0) * TRACKBALL_COUNTS_PER_MM)), dy=int(round((y1 - y0) * TRACKBALL_COUNTS_PER_MM)))
    state = dict(held=True, padHand=None, axisLock=False, lockedAxis='none', offsetMm=dict(x=round(x1, 2), y=round(y1, 2)),
                 speedNps=dict(h=round(velocity_speed(VELOCITY_BALL, x1), 2), v=round(-velocity_speed(VELOCITY_BALL, y1), 2)),
                 ball=dict(VELOCITY_BALL), pad=dict(VELOCITY_PAD))
    return dict(sniper=False, boost=False, elapsedMs=int(dt * 1000), left=dict(still), right=right, velocityScroll=state)


def demo_motion(t, dt, velocity=False):
    """A scripted POINTING_MOTION dict: the right trackball rolls, sniper on (as parsed from 0x2D).
    With velocity: Velocity Scroll held on it instead (demo_velocity)."""
    if velocity:
        return demo_velocity(t, dt)
    u = t % 8
    env = min(1, max(0, (u - .7) / .7)) * (1 - min(1, max(0, (u - 5.6) / 1.0)))
    vx = 1.25 * (math.sin(.9 * t) + .55 * math.sin(2.1 * t + 1)) * env
    vy = 1.25 * (math.cos(.7 * t + .3) + .45 * math.sin(1.7 * t)) * env
    counts = dt * 22 * TRACKBALL_COUNTS_PER_MM
    still = dict(valid=True, scrolling=False, touchValid=False, fingers=0, dx=0, dy=0, touchX=0, touchY=0)
    return dict(sniper=True, boost=False, elapsedMs=int(dt * 1000), left=dict(still),
                right=dict(still, dx=int(round(vx * counts)), dy=int(round(vy * counts))))
