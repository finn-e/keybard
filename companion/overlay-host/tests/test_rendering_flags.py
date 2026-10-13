"""The overlay renders in software on Windows (GPU frames reached the window partially)."""
import os
import sys
import unittest

try:
    import keybard_host.__main__ as host
    AVAILABLE = True
except ImportError:
    AVAILABLE = False


@unittest.skipUnless(AVAILABLE and sys.platform == 'win32', 'Windows only')
class RenderingFlagsTest(unittest.TestCase):
    def test_chromium_runs_without_the_gpu_on_windows(self):
        flags = os.environ.get('QTWEBENGINE_CHROMIUM_FLAGS', '').split()
        for flag in host.WINDOWS_CHROMIUM_FLAGS:
            self.assertEqual(flags.count(flag), 1, flag)


if __name__ == '__main__':
    unittest.main()
