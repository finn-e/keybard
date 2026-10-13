"""The color setup panel: every control writes the overlay's appearance, and it shows outside changes."""
import os
import unittest
os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
from keybard_host.state import DEFAULTS, PRESETS
try:
    from PySide6.QtWidgets import QApplication
    from keybard_host.colors import ColorsPanel
    AVAILABLE = True
except ImportError:
    AVAILABLE = False


@unittest.skipUnless(AVAILABLE, 'PySide6 not installed')
class ColorsPanelTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.appearance = dict(PRESETS['Dark'])
        self.writes = []
        def write(value):
            self.writes.append(value); self.appearance = dict(value)
        self.panel = ColorsPanel(lambda: dict(self.appearance), write, DEFAULTS['appearance'])

    def tearDown(self):
        self.panel.close(); self.panel.deleteLater()

    def test_opacity_moves_in_tens_and_shows_its_value(self):
        self.panel.sliders['fillAlpha'].setValue(3)
        self.assertEqual(self.appearance['fillAlpha'], 30)
        self.panel.refresh()
        self.assertEqual(self.panel.readouts['fillAlpha'].text(), '30%')

    def test_width_shadow_colors_and_reset(self):
        self.panel.widths.button(3).click()
        self.assertEqual(self.appearance['width'], 3)
        self.panel.halo.setChecked(True)
        self.assertTrue(self.appearance['halo'])
        self.panel.change(legend='#ff0000')
        self.assertEqual(self.appearance['legend'], '#ff0000')
        reset = [b for b in self.panel.findChildren(type(self.panel.widths.button(0))) if b.text() == 'Reset to default look'][0]
        reset.click()
        self.assertEqual(self.appearance, DEFAULTS['appearance'])

    def test_shows_outside_changes_without_writing_them_back(self):
        self.appearance = dict(PRESETS['High contrast'])
        self.panel.refresh()
        self.assertEqual(self.panel.sliders['fillAlpha'].value(), 9)
        self.assertTrue(self.panel.widths.button(2).isChecked())
        self.assertTrue(self.panel.halo.isChecked())
        self.assertEqual(self.writes, [])

    def test_an_unchanged_value_writes_nothing(self):
        self.panel.change(fillAlpha=self.appearance['fillAlpha'])
        self.assertEqual(self.writes, [])


if __name__ == '__main__':
    unittest.main()
