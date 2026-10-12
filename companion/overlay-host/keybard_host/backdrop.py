"""Adaptive contrast (prototype): sample the screen behind the overlay.

The overlay asks for a coarse brightness grid of whatever is behind it, a couple of
times a second, and restyles each key to stand out against it. Windows only for now:
the overlay window is excluded from screen capture while this runs, so a grab of its
rectangle shows what's underneath rather than the overlay itself. That exclusion also
hides the overlay from screenshots and screen recordings, so it's only on while the
option is.
"""
import base64
import sys

from PySide6.QtCore import Qt
from PySide6.QtGui import QImage

# SetWindowDisplayAffinity values (Windows 10 2004 and later).
WDA_NONE = 0x00
WDA_EXCLUDEFROMCAPTURE = 0x11

# Grid cell size in window pixels: fine enough to measure how busy the area behind one key is.
CELL = 6


def supported(platform=None):
    return (platform or sys.platform) == 'win32'


def exclude_from_capture(widget, exclude):
    """Hide the widget's window from screen capture (and from our own grab). Best effort."""
    if not supported(): return False
    try:
        import ctypes
        return bool(ctypes.windll.user32.SetWindowDisplayAffinity(int(widget.winId()), WDA_EXCLUDEFROMCAPTURE if exclude else WDA_NONE))
    except (AttributeError, OSError):
        return False


def brightness_grid(image, cols, rows):
    """A cols x rows grid of perceived brightness (0-255) averaged over the image, row by row."""
    small = image.convertToFormat(QImage.Format_Grayscale8).scaled(cols, rows, Qt.IgnoreAspectRatio, Qt.SmoothTransformation)
    data, stride = bytes(small.constBits()), small.bytesPerLine()
    return b''.join(data[r * stride:r * stride + cols] for r in range(rows))


def sample(surface):
    """What's on screen behind the surface, as {cols, rows, lum} for the overlay page, or None."""
    screen = surface.screen()
    if screen is None or surface.width() < CELL or surface.height() < CELL: return None
    origin = screen.geometry().topLeft()
    pixmap = screen.grabWindow(0, surface.x() - origin.x(), surface.y() - origin.y(), surface.width(), surface.height())
    if pixmap.isNull(): return None
    cols, rows = max(1, surface.width() // CELL), max(1, surface.height() // CELL)
    return dict(cols=cols, rows=rows, lum=base64.b64encode(brightness_grid(pixmap.toImage(), cols, rows)).decode('ascii'))
