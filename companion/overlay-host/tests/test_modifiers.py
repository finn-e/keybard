"""Modifier flags never use matrix guesses or require keyboard focus."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from keybard_host.modifiers import ModifierReader


class ModifierReaderTest(unittest.TestCase):
    def test_windows_reads_held_and_toggle_bits_separately(self):
        user = SimpleNamespace(GetAsyncKeyState=Mock(return_value=-32768), GetKeyState=Mock(return_value=1))
        with patch('keybard_host.modifiers.sys.platform', 'win32'), patch('ctypes.WinDLL', return_value=user, create=True):
            reader = ModifierReader()
        self.assertEqual(reader.read(), dict(shift=True, capsLock=True))
        user.GetAsyncKeyState.return_value = 1  # "pressed since last call" is NOT currently held
        user.GetKeyState.return_value = -32768  # held Caps is NOT the toggle flag
        self.assertEqual(reader.read(), dict(shift=False, capsLock=False))
        user.GetAsyncKeyState.assert_called_with(0x10)
        user.GetKeyState.assert_called_with(0x14)

    def test_mac_combined_session_flags(self):
        core = SimpleNamespace(CGEventSourceFlagsState=Mock(return_value=0x30000))
        with patch('keybard_host.modifiers.sys.platform', 'darwin'), patch('ctypes.CDLL', return_value=core):
            reader = ModifierReader()
        self.assertEqual(reader.read(), dict(shift=True, capsLock=True))
        core.CGEventSourceFlagsState.return_value = 0x10000
        self.assertEqual(reader.read(), dict(shift=False, capsLock=True))

    def test_wayland_is_explicitly_unavailable_even_with_xwayland(self):
        with patch('keybard_host.modifiers.sys.platform', 'linux'), patch.dict('os.environ', {'DISPLAY': ':0', 'WAYLAND_DISPLAY': 'wayland-0'}):
            reader = ModifierReader()
        self.assertIsNone(reader.read())
        reader.close()

    def test_failed_api_load_keeps_static_fallback(self):
        with patch('keybard_host.modifiers.sys.platform', 'darwin'), patch('ctypes.CDLL', side_effect=OSError):
            reader = ModifierReader()
        self.assertIsNone(reader.read())
