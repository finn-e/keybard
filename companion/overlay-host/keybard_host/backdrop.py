"""Adaptive contrast (prototype): sample the screen under the overlay.

A couple of times a second the Host grabs the overlay's rectangle as it appears on
screen, overlay included, and sends a coarse brightness grid to the overlay page. The
page ignores the cells its keys cover and reads each key's background from the
uncovered cells around it, so the overlay never has to hide from capture and stays in
screenshots and recordings. Windows only for now (other platforms need a
screen-recording permission for the grab).
"""
import base64
import sys

from PySide6.QtCore import Qt
from PySide6.QtGui import QImage

# Grid cell size in window pixels: fine enough to see background in the gaps between keys.
CELL = 4


def supported(platform=None):
    return (platform or sys.platform) == 'win32'


def brightness_grid(image, cols, rows):
    """A cols x rows grid of perceived brightness (0-255) averaged over the image, row by row."""
    small = image.convertToFormat(QImage.Format_Grayscale8).scaled(cols, rows, Qt.IgnoreAspectRatio, Qt.SmoothTransformation)
    data, stride = bytes(small.constBits()), small.bytesPerLine()
    return b''.join(data[r * stride:r * stride + cols] for r in range(rows))


def sample(surface):
    """The surface's rectangle as it appears on screen, as {cols, rows, lum} for the overlay page, or None."""
    screen = surface.screen()
    if screen is None or surface.width() < CELL or surface.height() < CELL: return None
    origin = screen.geometry().topLeft()
    pixmap = screen.grabWindow(0, surface.x() - origin.x(), surface.y() - origin.y(), surface.width(), surface.height())
    if pixmap.isNull(): return None
    cols, rows = max(1, surface.width() // CELL), max(1, surface.height() // CELL)
    return dict(cols=cols, rows=rows, lum=base64.b64encode(brightness_grid(pixmap.toImage(), cols, rows)).decode('ascii'))
