"""Adaptive contrast: the brightness grid of what's behind the overlay."""
import base64
import os
import unittest
from unittest import mock
os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
try:
    from PySide6.QtGui import QColor, QImage, QPainter
    from PySide6.QtWidgets import QApplication
    from keybard_host import backdrop
    AVAILABLE = True
except ImportError:
    AVAILABLE = False


@unittest.skipUnless(AVAILABLE, 'Requires Qt')
class BackdropTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_grid_separates_a_dark_and_a_light_window(self):
        # The overlay draped across two windows: dark on the left, light on the right.
        image = QImage(120, 36, QImage.Format_RGB32)
        painter = QPainter(image)
        painter.fillRect(0, 0, 60, 36, QColor('#101010')); painter.fillRect(60, 0, 60, 36, QColor('#f0f0f0'))
        painter.end()
        grid = backdrop.brightness_grid(image, 20, 6)
        self.assertEqual(len(grid), 120)
        for row in range(6):
            cells = grid[row * 20:(row + 1) * 20]
            self.assertTrue(all(v < 40 for v in cells[:9]))
            self.assertTrue(all(v > 215 for v in cells[11:]))

    def test_sample_encodes_the_grid_for_the_page(self):
        surface = mock.Mock()
        surface.width.return_value, surface.height.return_value = 60, 30
        surface.x.return_value, surface.y.return_value = 10, 20
        image = QImage(60, 30, QImage.Format_RGB32); image.fill(QColor('#808080'))
        pixmap = mock.Mock(); pixmap.isNull.return_value = False; pixmap.toImage.return_value = image
        surface.screen.return_value.geometry.return_value.topLeft.return_value.x.return_value = 0
        surface.screen.return_value.geometry.return_value.topLeft.return_value.y.return_value = 0
        surface.screen.return_value.grabWindow.return_value = pixmap
        grid = backdrop.sample(surface)
        surface.screen.return_value.grabWindow.assert_called_once_with(0, 10, 20, 60, 30)
        self.assertEqual((grid['cols'], grid['rows']), (60 // backdrop.CELL, 30 // backdrop.CELL))
        self.assertTrue(all(abs(v - 128) < 3 for v in base64.b64decode(grid['lum'])))

    def test_exclusion_is_windows_only(self):
        self.assertEqual(backdrop.supported('darwin'), False)
        self.assertEqual(backdrop.supported('win32'), True)


if __name__ == '__main__':
    unittest.main()
