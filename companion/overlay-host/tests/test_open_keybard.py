import unittest
try:
    from keybard_host.__main__ import KEYBARD_URL, controls_url
    AVAILABLE = True
except ImportError:
    AVAILABLE = False


@unittest.skipUnless(AVAILABLE, 'PySide6 not installed')
class OpenKeybardTests(unittest.TestCase):
    def test_opens_the_overlay_page_on_the_website(self):
        self.assertEqual(KEYBARD_URL, 'https://keybard.svalboard.com/#overlay')
        self.assertEqual(controls_url(False, 'http://127.0.0.1:5178/'), KEYBARD_URL)

    def test_paranoid_mode_stays_on_its_own_keybard(self):
        self.assertEqual(controls_url(True, 'http://127.0.0.1:5178/'), 'http://127.0.0.1:5178/')

    def test_url_can_be_overridden_for_testing(self):
        self.assertEqual(controls_url(False, 'http://127.0.0.1:5178/', 'http://localhost:5173/#trainer'), 'http://localhost:5173/#trainer')


if __name__ == '__main__':
    unittest.main()
