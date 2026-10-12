"""Keeping the overlay above ordinary windows on Windows."""
import unittest
from unittest import mock
from keybard_host import ontop


class FakeUser32:
    """A z-order, top first: (hwnd, visible, topmost)."""
    def __init__(self, stack):
        self.stack, self.raised = stack, []

    def GetWindow(self, hwnd, cmd):
        order = [h for h, _, _ in self.stack]
        i = order.index(hwnd)
        return order[i - 1] if i > 0 else 0

    def GetWindowLongW(self, hwnd, index):
        return next(ontop.WS_EX_TOPMOST if top else 0 for h, _, top in self.stack if h == hwnd)

    def IsWindowVisible(self, hwnd):
        return next(visible for h, visible, _ in self.stack if h == hwnd)

    def SetWindowPos(self, hwnd, after, *args):
        self.raised.append((hwnd, after))
        return True


def widget(hwnd):
    w = mock.Mock(); w.winId.return_value = hwnd; w.isVisible.return_value = True
    return w


class OnTopTest(unittest.TestCase):
    def test_ordinary_window_above_means_buried(self):
        api = FakeUser32([(1, True, True), (2, True, False), (10, True, True)])
        self.assertTrue(ontop.buried(10, api))

    def test_other_topmost_and_hidden_windows_do_not_count(self):
        api = FakeUser32([(1, True, True), (2, False, False), (10, True, True)])
        self.assertFalse(ontop.buried(10, api))

    def test_raises_overlay_then_controls_only_when_buried(self):
        api = FakeUser32([(2, True, False), (10, True, True), (11, True, True)])
        self.assertTrue(ontop.keep_on_top([widget(10), widget(11)], 'win32', api))
        self.assertEqual(api.raised, [(10, ontop.HWND_TOPMOST), (11, ontop.HWND_TOPMOST)])
        calm = FakeUser32([(11, True, True), (10, True, True), (2, True, False)])
        self.assertFalse(ontop.keep_on_top([widget(10), widget(11)], 'win32', calm))
        self.assertEqual(calm.raised, [])

    def test_does_nothing_off_windows(self):
        self.assertFalse(ontop.keep_on_top([widget(10)], 'darwin', FakeUser32([])))


if __name__ == '__main__':
    unittest.main()
