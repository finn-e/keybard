"""The Host icon contrasts with the taskbar or tray it sits on."""
import os
import sys
import unittest
from unittest import mock
os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
try:
    from PySide6.QtWidgets import QApplication
    from keybard_host import __main__ as host
    AVAILABLE = True
except ImportError:
    AVAILABLE = False


@unittest.skipUnless(AVAILABLE, 'Requires the native Qt WebEngine runtime')
class HostIconTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def test_both_glyphs_load(self):
        for light in (True, False):
            self.assertFalse(host.host_icon(light).isNull())

    @unittest.skipUnless(sys.platform == 'win32', 'Windows taskbar setting')
    def test_reads_the_windows_taskbar_setting(self):
        import winreg
        for stored, light in ((1, True), (0, False)):
            # Independent of this machine's registry: the key needn't exist.
            with mock.patch.object(winreg, "OpenKey", return_value=mock.MagicMock()), mock.patch.object(winreg, 'QueryValueEx', return_value=(stored, winreg.REG_DWORD)):
                self.assertIs(host.taskbar_is_light(), light)

    @unittest.skipUnless(sys.platform == 'win32', 'Windows taskbar setting')
    def test_missing_windows_setting_means_dark_taskbar(self):
        import winreg
        with mock.patch.object(winreg, 'OpenKey', side_effect=OSError):
            self.assertFalse(host.taskbar_is_light())


if __name__ == '__main__':
    unittest.main()
