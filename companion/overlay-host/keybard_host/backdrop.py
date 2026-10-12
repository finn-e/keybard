"""Adaptive contrast: sample the screen under the overlay.

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
from PySide6.QtGui import QImage, QPainter

# Grid cell size in window pixels: fine enough to see background in the gaps between keys.
CELL = 4


def supported(platform=None):
    return (platform or sys.platform) == 'win32'


def brightness_grid(image, cols, rows):
    """A cols x rows grid of perceived brightness (0-255) averaged over the image, row by row."""
    small = image.convertToFormat(QImage.Format_Grayscale8).scaled(cols, rows, Qt.IgnoreAspectRatio, Qt.SmoothTransformation)
    data, stride = bytes(small.constBits()), small.bytesPerLine()
    return b''.join(data[r * stride:r * stride + cols] for r in range(rows))


def detail_grid(image, cols, rows):
    """Fine detail per cell: the mean difference of its pixels from the image blurred to the grid.
    Text and icons score high even where a cell's average brightness matches its neighbours'."""
    image = image.convertToFormat(QImage.Format_RGB32)
    blurred = image.scaled(cols, rows, Qt.IgnoreAspectRatio, Qt.SmoothTransformation).scaled(image.width(), image.height(), Qt.IgnoreAspectRatio, Qt.SmoothTransformation)
    painter = QPainter(image)
    painter.setCompositionMode(QPainter.CompositionMode_Difference)
    painter.drawImage(0, 0, blurred)
    painter.end()
    return brightness_grid(image, cols, rows)


def unusable(surface, screen, exclude=()):
    """Parts of the surface (window coordinates [x, y, w, h]) whose grabbed pixels aren't background:
    off its screen (the grab is blank there) or under other Host windows such as the controls."""
    s, visible = surface.geometry(), surface.geometry().intersected(screen.geometry())
    if visible.isEmpty(): return [[0, 0, s.width(), s.height()]]
    rects = []
    left, top = visible.x() - s.x(), visible.y() - s.y()
    right, bottom = left + visible.width(), top + visible.height()
    if left > 0: rects.append([0, 0, left, s.height()])
    if right < s.width(): rects.append([right, 0, s.width() - right, s.height()])
    if top > 0: rects.append([left, 0, visible.width(), top])
    if bottom < s.height(): rects.append([left, bottom, visible.width(), s.height() - bottom])
    for other in exclude:
        overlap = other.intersected(s)
        if not overlap.isEmpty(): rects.append([overlap.x() - s.x(), overlap.y() - s.y(), overlap.width(), overlap.height()])
    return rects


def sample(surface, exclude=()):
    """The surface's rectangle as it appears on screen, as {cols, rows, lum, detail, mask} for the overlay page, or None."""
    screen = surface.screen()
    if screen is None or surface.width() < CELL or surface.height() < CELL: return None
    origin = screen.geometry().topLeft()
    pixmap = screen.grabWindow(0, surface.x() - origin.x(), surface.y() - origin.y(), surface.width(), surface.height())
    if pixmap.isNull(): return None
    cols, rows = max(1, surface.width() // CELL), max(1, surface.height() // CELL)
    image = pixmap.toImage()
    encode = lambda grid: base64.b64encode(grid).decode('ascii')
    return dict(cols=cols, rows=rows, lum=encode(brightness_grid(image, cols, rows)), detail=encode(detail_grid(image, cols, rows)),
                mask=unusable(surface, screen, exclude))
