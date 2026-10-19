from pathlib import Path
import unittest
from unittest import mock

from keybard_host import diagnose
from keybard_host.browser import find_chromium

try:
    from PySide6.QtCore import Qt
    from keybard_host.__main__ import overlay_flags, quit_on_signals
    QT = True
except ImportError:
    QT = False

PACKAGING = Path(__file__).resolve().parent.parent / 'packaging' / 'linux'


class FindChromiumOnLinux(unittest.TestCase):
    def test_first_installed_browser_wins(self):
        installed = {'chromium': '/usr/bin/chromium', 'microsoft-edge': '/usr/bin/microsoft-edge'}
        self.assertEqual(find_chromium('linux', which=installed.get), Path('/usr/bin/microsoft-edge'))

    def test_none_installed(self):
        self.assertIsNone(find_chromium('linux', which=lambda name: None))


class FakeDevice:
    def __init__(self, fail): self.fail = fail
    def open_path(self, path):
        if self.fail: raise OSError('open failed')
    def close(self): pass


class FakeHid:
    __name__ = 'hidraw'

    def __init__(self, fail=False): self.fail = fail
    def enumerate(self):
        return [
            dict(vendor_id=0x303A, product_id=0x4048, usage_page=0xFF61, usage=0x62, path=b'/dev/hidraw9', product_string='Svalboard', interface_number=1),
            dict(vendor_id=0x303A, product_id=0x4048, usage_page=0x01, usage=0x06, path=b'/dev/hidraw8', product_string='Svalboard', interface_number=0),
            dict(vendor_id=0x046D, product_id=0xC52B, usage_page=0x01, usage=0x02, path=b'/dev/hidraw2'),
        ]
    def device(self): return FakeDevice(self.fail)


class Diagnose(unittest.TestCase):
    def lines(self, hid):
        with mock.patch('keybard_host.device.protocol.hid_backend', return_value=hid):
            return '\n'.join(diagnose.hid_lines())

    def test_lists_svalboard_interfaces_and_checks_the_sval_collection(self):
        text = self.lines(FakeHid())
        self.assertIn('3 in all, 2 with Svalboard vendor ID 0x303a', text)
        self.assertIn('Sval collections (usage page 0xff61, usage 0x62): 1', text)
        self.assertIn('/dev/hidraw9', text)
        self.assertIn('opens OK', text)

    def test_says_how_to_fix_a_permission_problem(self):
        self.assertIn('CANNOT OPEN', self.lines(FakeHid(fail=True)))
        self.assertIn('udev rule', self.lines(FakeHid(fail=True)))

    def test_system_section_names_the_session(self):
        with mock.patch.dict('os.environ', {'XDG_SESSION_TYPE': 'wayland'}):
            self.assertIn('XDG_SESSION_TYPE=wayland', '\n'.join(diagnose.system_lines()))


@unittest.skipUnless(QT, 'PySide6 not installed')
class Signals(unittest.TestCase):
    def test_windows_keeps_its_signal_handling(self):
        self.assertIsNone(quit_on_signals(object(), 'win32'))


@unittest.skipUnless(QT, 'PySide6 not installed')
class OverlayFlags(unittest.TestCase):
    def test_linux_asks_for_click_through_before_the_first_show(self):
        # Added after show, X11 window managers drop the overlay's stay-on-top state.
        flags = overlay_flags('linux')
        self.assertTrue(flags & Qt.WindowTransparentForInput)
        self.assertTrue(flags & Qt.WindowStaysOnTopHint)

    def test_windows_and_macos_flags_are_unchanged(self):
        for platform in ('win32', 'darwin'):
            self.assertFalse(overlay_flags(platform) & Qt.WindowTransparentForInput)
            self.assertTrue(overlay_flags(platform) & Qt.WindowStaysOnTopHint)


class DemoBoard(unittest.TestCase):
    def test_demo_keymap_is_numeric_like_a_real_board(self):
        # Keybard's renderer names numeric keycodes only; strings were drawn as "0xKC_D".
        from keybard_host.device.model import demo_profile
        profile = demo_profile()
        codes = [code for layer in profile.layers for row in layer for code in row]
        self.assertTrue(all(type(code) is int for code in codes))
        self.assertEqual([profile.label(c) for c in profile.layers[0][0]], ['Ctrl', 'Tab', 'Shift', 'Enter' + chr(10) + 'L1 hold', 'Esc', 'Caps'])
        self.assertEqual(profile.label(profile.layers[0][5][2]), 'MO(1)')


class UdevRule(unittest.TestCase):
    def test_matches_every_svalboard_product_id(self):
        rule = (PACKAGING / '60-svalboard.rules').read_text()
        self.assertIn('ATTRS{idVendor}=="303a"', rule)
        self.assertIn('ATTRS{idProduct}=="404[4-9a-d]"', rule)
        self.assertIn('TAG+="uaccess"', rule)


if __name__ == '__main__':
    unittest.main()
