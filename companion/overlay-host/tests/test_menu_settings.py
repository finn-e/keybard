"""The overlay's settings live in the Host's menus: presets, highlight choices, and the menu wiring."""
import os
import unittest
from keybard_host.state import DEFAULTS, EFFECTS, PRESETS, validate_config

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
try:
    from PySide6.QtWidgets import QApplication, QMenu
    from keybard_host.__main__ import Surface, OverlayControls
    QT = True
except ImportError:
    QT = False


class PresetTest(unittest.TestCase):
    def test_every_preset_is_a_valid_appearance(self):
        for name, appearance in PRESETS.items():
            with self.subTest(name):
                self.assertEqual(validate_config(dict(DEFAULTS, appearance=appearance))['appearance'], appearance)

    def test_defaults_to_outline_only(self):
        self.assertEqual(DEFAULTS['appearance'], PRESETS['Outline only'])

    def test_highlight_choices_set_effect_and_duration(self):
        self.assertEqual(EFFECTS['Off'], dict(effect='Off'))
        for name in ('Flash', 'Fade'):
            config = validate_config(dict(DEFAULTS, **EFFECTS[name]))
            self.assertEqual((config['effect'], config['duration']), (EFFECTS[name]['effect'], EFFECTS[name]['duration']))


@unittest.skipUnless(QT, 'Requires the native Qt WebEngine runtime')
class MenuWiringTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_settings_go_between_open_keybard_and_the_toggles(self):
        surface = Surface(5178)
        board = QMenu('Board')
        controls = OverlayControls(surface, lambda: None, add_settings=lambda menu: menu.addMenu(board))
        try:
            texts = [a.text() for a in controls.more.menu().actions() if not a.isSeparator()]
            self.assertEqual(texts, ['Open Keybard', 'Board', 'Capital letters', 'Adaptive contrast', 'Place at bottom', 'Reload board layout'])
        finally:
            controls.close(); surface.close(); controls.deleteLater(); surface.deleteLater()


if __name__ == '__main__':
    unittest.main()
