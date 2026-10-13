"""Release hardening: preferences loading, stacking, sampling and overlay controls behavior."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
from keybard_host import ontop
from keybard_host.state import DEFAULTS, HostState
try:
    from PySide6.QtCore import QRect
    from PySide6.QtGui import QColor, QImage, QPainter
    from PySide6.QtWidgets import QApplication, QWidget
    from keybard_host import backdrop
    from keybard_host.__main__ import Host
    QT = True
except ImportError:
    QT = False

BOARD = {'serial': 'S1', 'uid': '42', 'name': 'Svalboard'}


class PreferencesTest(unittest.TestCase):
    def load(self, text):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'preferences.json'
            path.write_text(text)
            return HostState(path)

    def test_a_file_that_is_not_an_object_falls_back_to_defaults(self):
        for text in ('null', '[]', '"x"', '7', '{broken'):
            state = self.load(text)
            self.assertEqual(state.config, DEFAULTS, text)
            self.assertIsNone(state.remembered, text)

    def test_a_bad_remembered_board_is_dropped(self):
        for remembered in (None, 'S1', [], {'serial': 1, 'uid': '42'}, {'serial': 'S1'}):
            self.assertIsNone(self.load(json.dumps({'remembered': remembered})).remembered, remembered)
        self.assertEqual(self.load(json.dumps({'remembered': BOARD})).remembered, BOARD)

    def test_a_bad_setting_keeps_the_remembered_board(self):
        state = self.load(json.dumps({'config': {'scale': 'huge'}, 'remembered': BOARD}))
        self.assertEqual(state.config, DEFAULTS)
        self.assertEqual(state.remembered, BOARD)


class FakeUser32:
    """A z-order, top first: (hwnd, visible, topmost)."""
    def __init__(self, stack): self.stack, self.raised = stack, []
    def GetWindow(self, hwnd, cmd):
        order = [h for h, _, _ in self.stack]; i = order.index(hwnd)
        return order[i - 1] if i > 0 else 0
    def GetWindowLongW(self, hwnd, index): return next(ontop.WS_EX_TOPMOST if t else 0 for h, _, t in self.stack if h == hwnd)
    def IsWindowVisible(self, hwnd): return next(v for h, v, _ in self.stack if h == hwnd)
    def SetWindowPos(self, hwnd, after, *args): self.raised.append(hwnd); return True


def window(hwnd):
    w = mock.Mock(); w.winId.return_value = hwnd; w.isVisible.return_value = True
    return w


class StackingTest(unittest.TestCase):
    def test_controls_under_the_overlay_are_put_back_on_top(self):
        # Both topmost and nothing ordinary above, but the overlay (10) sits over its controls (11).
        api = FakeUser32([(10, True, True), (11, True, True), (2, True, False)])
        self.assertTrue(ontop.keep_on_top([window(10), window(11)], 'win32', api))
        self.assertEqual(api.raised, [10, 11])

    def test_right_order_is_left_alone(self):
        api = FakeUser32([(11, True, True), (10, True, True), (2, True, False)])
        self.assertFalse(ontop.keep_on_top([window(10), window(11)], 'win32', api))


@unittest.skipUnless(QT, 'Requires Qt')
class QtHardeningTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.state = HostState(Path(self.folder.name) / 'preferences.json')

    def tearDown(self):
        self.folder.cleanup()

    # --- the backdrop grids and what isn't background ---

    def test_detail_is_zero_on_a_flat_image_and_high_on_text_like_stripes(self):
        image = QImage(80, 40, QImage.Format_RGB32); image.fill(QColor('#202020'))
        painter = QPainter(image)
        for x in range(40, 80, 2): painter.fillRect(x, 0, 1, 40, QColor('#f0f0f0'))
        painter.end()
        detail = backdrop.detail_grid(image, 20, 10)
        self.assertTrue(all(v <= 2 for r in range(10) for v in detail[r * 20:r * 20 + 9]))
        self.assertTrue(all(v >= 40 for r in range(10) for v in detail[r * 20 + 11:r * 20 + 20]))

    def test_parts_off_screen_or_under_the_controls_are_masked(self):
        surface = mock.Mock(); surface.geometry.return_value = QRect(700, 500, 200, 100)
        screen = mock.Mock(); screen.geometry.return_value = QRect(0, 0, 800, 560)
        rects = backdrop.unusable(surface, screen, [QRect(820, 480, 80, 30)])
        self.assertIn([100, 0, 100, 100], rects)   # right of the screen edge
        self.assertIn([0, 60, 100, 40], rects)     # below the screen bottom
        self.assertIn([120, 0, 80, 10], rects)     # under the controls
        screen.geometry.return_value = QRect(0, 0, 400, 300)
        self.assertEqual(backdrop.unusable(surface, screen), [[0, 0, 200, 100]])

    # --- when the Host samples ---

    def sampler(self, **state):
        page = mock.Mock()
        host = SimpleNamespace(state=self.state, sampling=False, surface=mock.Mock(), controls=mock.Mock(collapsed=False))
        host.surface.page.return_value = page
        host.controls.geometry.return_value = QRect()
        self.state.config['adaptiveContrast'] = True
        self.state.valid, self.state.board, self.state.visible = True, {'keylayout': {}}, True
        for k, v in state.items(): setattr(self.state, k, v)
        return host, page

    def test_samples_only_while_the_overlay_draws_keys_and_says_stop_once(self):
        with mock.patch.object(backdrop, 'supported', return_value=True), \
             mock.patch.object(backdrop, 'sample', return_value={'cols': 1, 'rows': 1, 'lum': 'AA=='}) as grab:
            host, page = self.sampler()
            Host.sample_backdrop(host)
            self.assertEqual(grab.call_count, 1)
            self.assertIn('"cols": 1', page.runJavaScript.call_args[0][0])
            for stop in (lambda: setattr(self.state, 'valid', False), lambda: setattr(host.controls, 'collapsed', True),
                         lambda: setattr(self.state, 'visible', False), lambda: self.state.config.update(adaptiveContrast=False),
                         lambda: setattr(self.state, 'board', None)):
                host, page = self.sampler(); Host.sample_backdrop(host); grab.reset_mock(); page.reset_mock()
                stop()
                Host.sample_backdrop(host); Host.sample_backdrop(host)
                grab.assert_not_called()
                self.assertEqual(page.runJavaScript.call_count, 1)
                self.assertIn('detail:null', page.runJavaScript.call_args[0][0])

    # --- overlay menu toggles, icon and show ---

    def test_a_failed_save_puts_the_check_mark_back(self):
        controls = mock.Mock()
        host = SimpleNamespace(state=self.state, controls=controls, publish_state=mock.Mock(), command=mock.Mock(),
                               style_actions={}, highlight_actions={}, hands_actions={}, held_action=mock.Mock(), halo_action=mock.Mock())
        host.sync_menu = lambda: Host.sync_menu(host)
        host.set_config = lambda **fields: Host.set_config(host, **fields)
        with mock.patch.object(self.state, 'save', side_effect=OSError):
            Host.set_flag(host, 'capitalAlphas', True)
        self.assertFalse(self.state.config['capitalAlphas'])
        controls.capitals.setChecked.assert_called_with(False)
        Host.set_flag(host, 'capitalAlphas', True)
        self.assertTrue(self.state.config['capitalAlphas'])
        controls.capitals.setChecked.assert_called_with(True)

    def test_menu_choices_save_and_apply_together(self):
        from keybard_host.state import EFFECTS, PRESETS
        actions = {name: mock.Mock() for name in PRESETS}
        host = SimpleNamespace(state=self.state, controls=mock.Mock(), publish_state=mock.Mock(), command=mock.Mock(),
                               style_actions=actions, highlight_actions={}, hands_actions={}, held_action=mock.Mock(), halo_action=mock.Mock())
        host.sync_menu = lambda: Host.sync_menu(host)
        Host.set_config(host, appearance=dict(PRESETS['High contrast']), **EFFECTS['Flash'], hands='Left')
        self.assertEqual(self.state.config['appearance'], PRESETS['High contrast'])
        self.assertEqual((self.state.config['effect'], self.state.config['duration'], self.state.config['hands']), ('Quick flash', 150, 'Left'))
        host.command.assert_called_once_with(dict(op='configure'))  # held-key tracking and size follow
        actions['High contrast'].setChecked.assert_called_with(True)
        actions['Dark'].setChecked.assert_called_with(False)
        host.command.reset_mock()
        Host.set_config(host, hands='Left')  # no change: nothing saved or re-applied
        host.command.assert_not_called()
        # The outline shadow is separate from the style: Dark without it still checks Dark.
        Host.set_config(host, appearance=dict(PRESETS['Dark'], halo=True))
        actions['Dark'].setChecked.assert_called_with(True)
        host.halo_action.setChecked.assert_called_with(True)

    def test_icon_swaps_once_when_the_taskbar_theme_changes(self):
        host = SimpleNamespace(icon_light_background=False, app=mock.Mock(), surface=mock.Mock(), tray=mock.Mock())
        with mock.patch('keybard_host.__main__.taskbar_is_light', return_value=True):
            Host.update_icon(host); Host.update_icon(host)
        self.assertTrue(host.icon_light_background)
        self.assertEqual(host.tray.setIcon.call_count, 1)

    def test_keybard_can_open_the_colors_panel(self):
        host = SimpleNamespace(state=self.state, open_colors=mock.Mock(), publish_state=mock.Mock())
        Host.command(host, {'op': 'colors'})
        host.open_colors.assert_called_once_with()

    def test_showing_the_overlay_expands_it(self):
        host = SimpleNamespace(state=self.state, surface=mock.Mock(), controls=mock.Mock(), show_action=mock.Mock(), publish_state=mock.Mock())
        Host.command(host, {'op': 'show', 'value': True})
        host.controls.set_collapsed.assert_called_once_with(False)
        self.assertTrue(self.state.visible)
        host.controls.reset_mock()
        Host.command(host, {'op': 'show', 'value': False})
        host.controls.set_collapsed.assert_not_called()
        self.assertFalse(self.state.visible)

    def test_size_changes_keep_the_bottom_edge_on_screen(self):
        surface = QWidget()
        try:
            area = self.app.primaryScreen().availableGeometry()
            host = SimpleNamespace(state=self.state, surface=surface, app=self.app)
            Host.size_surface(host, 60)
            surface.move(area.x() + 10, area.bottom() - surface.height() - 30)
            bottom = surface.geometry().bottom()
            Host.size_surface(host, 100)
            self.assertEqual(surface.geometry().bottom(), bottom)
            surface.move(surface.x(), area.bottom() - surface.height() + 50)   # partly below the screen
            Host.size_surface(host, 100)
            self.assertLessEqual(surface.geometry().bottom(), area.bottom())
        finally:
            surface.deleteLater()


if __name__ == '__main__':
    unittest.main()
