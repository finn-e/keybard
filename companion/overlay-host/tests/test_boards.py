"""Every connected board at once: which one the overlay shows, hot-plug, pause, pin and preferences."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
from keybard_host.boards import (LEND_HOLD, QUIET, Board, Follower, composite, device_keys, has_keys,
                                 lent_sides, motion_used)
from keybard_host.device.protocol import LayerSnapshot
from keybard_host.state import HostState

try:
    from keybard_host import __main__ as main
    QT = True
except ImportError:
    QT = False

DAILY, TOUCH, MULE = 'sval:E465B0621736062B', 'sval:E4655015C33E122F', 'sval:E465B0621725122B'
KEYLAYOUT = {str(i): dict(row=i // 6, col=i % 6, x=i % 6, y=i // 6, w=1, h=1) for i in range(60)}


def serialized(name, keyed=True, pointing=None, uid='1'):
    keymap = [[4] * 60 if keyed else [0] * 60, [1] * 60]
    return dict(name=name, uid=uid, keymap=keymap, keylayout=KEYLAYOUT, pointing=pointing or {})


def device(serial, name, path=None):
    return dict(serial_number=serial, product_string=name, path=path or serial.encode())


def board(serial, name, keyed=True, pointing=None, order=0):
    b = Board(serial, device(serial, name), order=order)
    b.board, b.ready, b.valid = serialized(name, keyed, pointing), True, True
    return b


def still(**hand):
    return dict(dict(valid=True, scrolling=False, touchValid=False, fingers=0, dx=0, dy=0, touchX=0, touchY=0), **hand)


def motion(left=None, right=None, ms=16, sniper=False):
    return dict(sniper=sniper, boost=False, elapsedMs=ms, left=left or still(), right=right or still())


class ActivityTests(unittest.TestCase):
    def test_a_blank_keymap_has_no_keys(self):
        self.assertTrue(has_keys(serialized('A')))
        self.assertFalse(has_keys(serialized('T', keyed=False)))
        self.assertFalse(has_keys(dict(serialized('A'), keylayout={})))
        self.assertFalse(has_keys(dict(keymap=[['KC_NO', 'KC_TRNS', '_______']], keylayout=KEYLAYOUT)))
        self.assertTrue(has_keys(dict(keymap=[['KC_NO', 'KC_A']], keylayout=KEYLAYOUT)))

    def test_motion_counts_only_real_movement_or_a_finger(self):
        self.assertFalse(motion_used(None))
        self.assertFalse(motion_used(motion(right=still(dx=1, dy=1))))       # sensor jitter
        self.assertTrue(motion_used(motion(right=still(dx=2, dy=-1))))
        self.assertFalse(motion_used(motion(left=still(contacts=[]))))      # pad, no finger
        self.assertTrue(motion_used(motion(left=still(contacts=[dict(id=0, x=0, y=0, confident=True)]))))

    def test_ids_follow_the_serial_across_a_firmware_update(self):
        before = device_keys([device(DAILY, 'A', b'\\\\?\\hid#vid_303a&pid_4044&rev_0f02'), device(TOUCH, 'T')])
        after = device_keys([device(DAILY, 'A', b'\\\\?\\hid#vid_303a&pid_4044&rev_0f03'), device(TOUCH, 'T')])
        self.assertEqual(set(before), set(after))
        # Two boards with one serial (or none) are told apart by path.
        same = device_keys([device('', 'A', b'p1'), device('', 'B', b'p2'), device('X', 'C', b'p3'), device('X', 'D', b'p4')])
        self.assertEqual(len(same), 4)


class FollowTests(unittest.TestCase):
    def setUp(self):
        self.daily = board(DAILY, 'Daily', pointing={'left': 'trackball', 'right': 'trackball'}, order=1)
        self.touch = board(TOUCH, 'Touch', keyed=False, pointing={'left': 'touchpad', 'right': 'touchpad'}, order=2)
        self.mule = board(MULE, 'Mule', pointing={'right': 'trackball'}, order=3)
        self.boards = {b.key: b for b in (self.daily, self.touch, self.mule)}

    def test_before_any_use_the_board_shown_last_time_is_shown(self):
        follower = Follower(preferred=MULE)
        self.assertEqual(follower.choose(self.boards, 10), (MULE, None))
        self.assertEqual(Follower().choose(self.boards, 10), (DAILY, None))  # else the first one ready

    def test_the_preferred_board_takes_over_when_it_becomes_ready_before_any_use(self):
        follower = Follower(preferred=DAILY)
        self.daily.ready = False
        self.assertEqual(follower.choose(self.boards, 10)[0], MULE)
        self.daily.ready = True
        self.assertEqual(follower.choose(self.boards, 10.1)[0], DAILY)

    def test_switches_to_the_board_in_use_only_after_the_shown_one_is_quiet(self):
        follower = Follower(preferred=DAILY)
        follower.choose(self.boards, 10)
        self.daily.used = 10.0
        self.mule.used = 10.2                       # both in use: the shown one stays
        self.assertEqual(follower.choose(self.boards, 10.2)[0], DAILY)
        self.daily.used = 10.5; self.mule.used = 10.6
        self.assertEqual(follower.choose(self.boards, 10.6 + QUIET / 2)[0], DAILY)
        self.mule.used = 11.6
        self.assertEqual(follower.choose(self.boards, 11.6)[0], MULE)

    def test_no_flicker_between_two_boards_in_use_together(self):
        follower = Follower(preferred=DAILY)
        follower.choose(self.boards, 9)
        shown = []
        for step in range(200):                     # 10 s of interleaved use, 50 ms apart
            now = 10 + step * .05
            (self.mule if step % 2 else self.daily).used = now  # the daily driver first
            shown.append(follower.choose(self.boards, now)[0])
        self.assertEqual(set(shown), {DAILY})

    def test_a_board_used_once_while_another_was_busy_doesnt_take_over_later(self):
        follower = Follower(preferred=DAILY)
        follower.choose(self.boards, 9)
        self.daily.used = 10.0; self.mule.used = 10.1
        follower.choose(self.boards, 10.1)
        self.assertEqual(follower.choose(self.boards, 13)[0], DAILY)    # idle since: stays

    def test_a_keyless_board_is_shown_only_without_a_keyed_board(self):
        follower = Follower()
        self.touch.used = self.touch.moved = 20
        self.assertNotEqual(follower.choose(self.boards, 20)[0], TOUCH)
        only = {TOUCH: self.touch}
        self.assertEqual(Follower().choose(only, 20), (TOUCH, None))

    def test_a_touch_board_lends_its_pads_and_hands_them_back(self):
        follower = Follower(preferred=DAILY)
        follower.choose(self.boards, 10)
        self.daily.used = 10.0                      # typing on the daily driver
        self.touch.used = self.touch.moved = 10.1   # touching the pad tester
        shown, lender = follower.choose(self.boards, 10.1)
        self.assertEqual((shown, lender), (DAILY, TOUCH))
        drawn = composite(self.daily, self.touch)
        self.assertEqual(drawn['pointing'], {'left': 'touchpad', 'right': 'touchpad'})
        self.assertEqual(drawn['keymap'], self.daily.board['keymap'])      # still the daily driver's keys
        self.assertEqual(lent_sides(self.touch), ('left', 'right'))
        self.assertEqual(follower.choose(self.boards, 10.1 + LEND_HOLD - .1), (DAILY, TOUCH))
        self.assertEqual(follower.choose(self.boards, 10.1 + LEND_HOLD + .1), (DAILY, None))

    def test_the_shown_boards_own_trackball_takes_its_hands_back(self):
        follower = Follower(preferred=DAILY)
        self.touch.used = self.touch.moved = 10.0
        self.assertEqual(follower.choose(self.boards, 10.0), (DAILY, TOUCH))
        self.daily.used = self.daily.moved = 10.5   # too soon after the touch: kept
        self.assertEqual(follower.choose(self.boards, 10.5), (DAILY, TOUCH))
        self.daily.used = self.daily.moved = 11.2
        self.assertEqual(follower.choose(self.boards, 11.2), (DAILY, None))

    def test_a_touch_while_the_shown_trackball_rolls_isnt_lent(self):
        follower = Follower(preferred=DAILY)
        self.daily.used = self.daily.moved = 10.0
        self.touch.used = self.touch.moved = 10.2
        self.assertEqual(follower.choose(self.boards, 10.2), (DAILY, None))

    def test_a_pin_shows_that_board_only(self):
        follower = Follower(preferred=DAILY, pinned=MULE)
        self.daily.used = 10; self.touch.used = self.touch.moved = 10
        self.assertEqual(follower.choose(self.boards, 10), (MULE, None))
        follower.pinned = TOUCH
        self.assertEqual(follower.choose(self.boards, 10), (TOUCH, None))
        follower.pinned = 'sval:unplugged'
        self.assertEqual(follower.choose(self.boards, 10), (None, None))   # waits for it


class PreferencesTests(unittest.TestCase):
    def test_a_remembered_board_becomes_automatic_and_is_kept(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'preferences.json'
            path.write_text(json.dumps({'version': 1, 'config': {'scale': 90}, 'remembered': {'serial': DAILY, 'uid': '7'}}))
            state = HostState(path)
            self.assertIsNone(state.pinned)
            self.assertEqual(state.snapshot()['follow'], 'auto')
            self.assertEqual(state.remembered, {'serial': DAILY, 'uid': '7'})   # now the board shown first
            self.assertEqual(state.config['scale'], 90)
            self.assertEqual(Follower((state.remembered or {}).get('serial')).preferred, DAILY)

    def test_a_pin_is_saved_and_a_bad_one_dropped(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'settings.json'   # any --settings file works the same
            state = HostState(path); state.pinned = TOUCH; state.save()
            self.assertEqual(HostState(path).pinned, TOUCH)
            saved = json.loads(path.read_text())
            for bad in (7, '', 'x' * 129, ['a'], 'a\nb'):
                path.write_text(json.dumps(dict(saved, pinned=bad)))
                self.assertIsNone(HostState(path).pinned, bad)


class FakeSignal:
    def __init__(self): self.slots = []
    def connect(self, slot): self.slots.append(slot)


class FakeWorker:
    made = []

    def __init__(self, selected):
        self.selected = selected
        self.profile, self.state, self.pressed, self.status, self.pointing = (FakeSignal() for _ in range(5))
        self.started = self.stopped = False
        self.pointing_tracking = None
        self.reloads = self.refreshes = 0
        FakeWorker.made.append(self)

    def set_press_tracking(self, enabled): return 1
    def set_pointing_tracking(self, enabled, watch=False): self.pointing_tracking = (enabled, watch)
    def start(self): self.started = True
    def stop(self): self.stopped = True
    def wait(self, ms=0): return True
    def isFinished(self): return self.stopped
    def deleteLater(self): pass
    def reload(self): self.reloads += 1
    def refresh(self): self.refreshes += 1


@unittest.skipUnless(QT, 'Requires the native Qt runtime')
class HostBoardsTests(unittest.TestCase):
    """The Host's board handling, with fake readers and a fake HID list."""

    def setUp(self):
        FakeWorker.made = []
        self.folder = tempfile.TemporaryDirectory()
        self.state = HostState(Path(self.folder.name) / 'preferences.json')
        self.state.remembered = {'serial': DAILY, 'uid': '1'}
        self.present = [device(DAILY, 'Daily'), device(TOUCH, 'Touch'), device(MULE, 'Mule')]
        Host = main.Host
        names = ('scan', 'start', 'retire', 'reap', 'board_of', 'connect', 'disconnect', 'follow', 'profile', 'layers',
                 'pressed', 'status', 'command', 'track_pointing', 'pointing_motion', 'forward_pointing', 'shown_board')
        host = SimpleNamespace(state=self.state, auto_connect=True, devices={}, boards={}, board_order=0, retiring=[],
                               paused=None, follower=Follower(DAILY, None), shown_signature=None, demo=False,
                               pointing_pending=None, pointing_source=None, pointing_sides={}, pointing_sent=0.0,
                               demo_pointing=None, Worker=FakeWorker, size_surface=mock.Mock(), publish_state=mock.Mock(),
                               surface=mock.Mock(), _sender=None)
        for name in names: setattr(host, name, getattr(Host, name).__get__(host))
        host.sender = lambda: host._sender
        self.host = host
        patcher = mock.patch.multiple(main, hid_backend=lambda: None, candidates=lambda hid: list(self.present))
        patcher.start(); self.addCleanup(patcher.stop)

    def tearDown(self):
        self.folder.cleanup()

    def worker(self, serial):
        return next(b.worker for b in self.host.boards.values() if b.serial == serial)

    def emit(self, worker, slot, value):
        self.host._sender = worker
        getattr(self.host, slot)(value)

    def read(self, serial, keyed=True, pointing=None):
        """The worker reads the board's layout and first layer state."""
        from keybard_host.device.model import Profile
        w = self.worker(serial)
        layers = [[[4 if keyed else 0] * 6 for _ in range(10)]]
        profile = Profile.parse({'uid': '1', 'layout': layers}, serial)
        from dataclasses import replace
        self.emit(w, 'profile', replace(profile, pointing=tuple((pointing or {}).items())))
        self.emit(w, 'status', 'Connected · Sval v3 · layout read from board; automatic defaults')
        self.emit(w, 'layers', LayerSnapshot(0, 1, None))

    def connect_all(self):
        self.host.scan()
        self.read(DAILY, pointing={'left': 'trackball', 'right': 'trackball'})
        self.read(TOUCH, keyed=False, pointing={'left': 'touchpad', 'right': 'touchpad'})
        self.read(MULE, pointing={'right': 'trackball'})

    def shown(self):
        return next((d['serial'] for d in self.state.devices if d['id'] == self.state.selected_device), None)

    def test_every_board_is_read_and_listed(self):
        self.connect_all()
        self.assertEqual(len(FakeWorker.made), 3)
        self.assertTrue(all(w.started for w in FakeWorker.made))
        snapshot = self.state.snapshot()
        self.assertEqual({d['serial'] for d in snapshot['devices']}, {DAILY, TOUCH, MULE})
        self.assertEqual([(b['serial'], b['keys'], b['ready']) for b in snapshot['boards']],
                         [(DAILY, True, True), (TOUCH, False, True), (MULE, True, True)])
        self.assertEqual(self.shown(), DAILY)
        self.assertTrue(snapshot['valid'])
        self.assertEqual(snapshot['board']['keymap'][0][0], 4)
        self.assertEqual(snapshot['follow'], 'auto')

    def test_keys_on_another_board_switch_the_overlay_and_remember_it(self):
        self.connect_all()
        with mock.patch.object(main.time, 'monotonic', return_value=1000.0):
            self.emit(self.worker(MULE), 'pressed', (1, frozenset({(6, 0)}), 1000.0))
        self.assertEqual(self.shown(), MULE)
        self.assertEqual(self.state.pressed, [36])
        self.assertEqual(json.loads(self.state.path.read_text())['remembered']['serial'], MULE)

    def test_touching_the_pad_tester_draws_its_pads_with_the_daily_drivers_keys(self):
        self.connect_all()
        revision = self.state.layout_revision
        touch = still(contacts=[dict(id=0, x=.5, y=-.5, confident=True)])
        self.emit(self.worker(TOUCH), 'pointing_motion', motion(left=touch, ms=16))
        self.assertEqual(self.shown(), DAILY)
        self.assertEqual(self.state.board['pointing'], {'left': 'touchpad', 'right': 'touchpad'})
        self.assertGreater(self.state.layout_revision, revision)
        self.assertEqual(self.state.snapshot()['pointingDevice'], next(b.key for b in self.host.boards.values() if b.serial == TOUCH))
        self.assertEqual(self.worker(TOUCH).pointing_tracking, (True, True))   # read at full rate while lent
        # Its contacts reach the overlay; the daily driver's own trackball reads don't overwrite them.
        self.host.pointing_sent = 0
        self.emit(self.worker(TOUCH), 'pointing_motion', motion(left=touch))
        sent = self.host.surface.page().runJavaScript.call_args[0][0]
        self.assertIn('"contacts":[{"id":0', sent)
        self.host.pointing_sent = 0
        self.emit(self.worker(DAILY), 'pointing_motion', motion(right=still(dx=1)))
        self.assertIn('"contacts":[{"id":0', self.host.surface.page().runJavaScript.call_args[0][0])

    def test_unplugged_boards_go_and_come_back_by_themselves(self):
        self.connect_all()
        daily = self.worker(DAILY)
        self.present = [d for d in self.present if d['serial_number'] != DAILY]
        self.host.scan()
        self.assertTrue(daily.stopped)
        self.assertNotIn(DAILY, {b.serial for b in self.host.boards.values()})
        self.assertIn(self.shown(), (MULE,))                              # another keyed board shows meanwhile
        # Back after a firmware update: a new path (new bcdDevice), the same serial and id.
        self.present.append(device(DAILY, 'Daily', b'new-path'))
        self.host.scan()
        self.assertIsNot(self.worker(DAILY), daily)
        self.read(DAILY)
        self.assertEqual(self.shown(), DAILY)                             # the remembered board, before any use
        self.host.reap()
        self.assertNotIn(daily, self.host.retiring)

    def test_a_reader_that_ends_is_started_again(self):
        self.host.scan()
        first = self.worker(DAILY); first.stopped = True    # e.g. a board without a stable serial
        self.host.scan()
        self.assertIsNot(self.worker(DAILY), first)

    def test_disconnect_pauses_every_board_until_one_arrives(self):
        self.connect_all()
        self.host.command({'op': 'disconnect'})
        self.assertTrue(all(w.stopped for w in FakeWorker.made))
        self.assertEqual(self.host.boards, {})
        self.assertTrue(self.state.snapshot()['paused'])
        self.assertIsNone(self.state.selected_device)
        self.host.scan()
        self.assertEqual(self.host.boards, {})                            # still paused
        # The updated board leaves for its bootloader and comes back: everything reconnects.
        updated = self.present.pop(0); self.host.scan()
        self.assertEqual(self.host.boards, {})
        self.present.append(updated); self.host.scan()
        self.assertEqual(len(self.host.boards), 3)
        self.assertFalse(self.state.snapshot()['paused'])

    def test_choosing_a_board_pins_it_and_ends_a_pause(self):
        self.connect_all()
        self.host.command({'op': 'disconnect'})
        mule = next(d['id'] for d in self.state.devices if d['serial'] == MULE)
        self.host.command({'op': 'connect', 'id': mule})
        self.assertEqual(len(self.host.boards), 3)
        self.read(DAILY); self.read(MULE)
        self.assertEqual(self.shown(), MULE)
        self.assertEqual(self.state.snapshot()['follow'], mule)
        self.assertEqual(json.loads(self.state.path.read_text())['pinned'], MULE)
        self.host.command({'op': 'connect', 'id': 'auto'})
        self.assertEqual(self.state.snapshot()['follow'], 'auto')
        self.assertIsNone(json.loads(self.state.path.read_text())['pinned'])

    def test_keybard_edits_refresh_every_board(self):
        self.connect_all()
        self.host.command({'op': 'refresh'})
        self.assertEqual([w.refreshes for w in FakeWorker.made], [1, 1, 1])
        self.host.command({'op': 'reload'})
        self.assertEqual([w.reloads for w in FakeWorker.made], [1, 1, 1])
        self.assertEqual(self.shown(), DAILY)                             # stays on show while reading
        self.assertFalse(self.state.valid)

    def test_a_board_reconnecting_with_new_firmware_is_read_again_not_stopped(self):
        from keybard_host.device.worker import DeviceWorker
        worker = DeviceWorker(device(DAILY, 'Daily'), expected_uid=1)
        self.assertEqual(worker.expected_uid, 1)
        import inspect
        self.assertNotIn('select it again', inspect.getsource(DeviceWorker.run))



class BallLookTests(unittest.TestCase):
    """The ball each trackball shows: chosen in the Overlay per board, or sent by Keybard; the latest wins."""

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(); self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / 'preferences.json'
        self.state = HostState(self.path)
        self.state.board = {'uid': '42', 'pointing': {'left': 'trackball', 'right': 'trackball'}}

    def test_an_overlay_choice_is_per_board_even_with_the_same_firmware(self):
        self.state.set_board_ball(DAILY, 'right', 'pearl_blue')
        self.state.set_board_ball(MULE, 'right', 'red')
        self.assertEqual(self.state.pointing_look(serial=DAILY), {'right': 'pearl_blue', 'gloss': 1.0, 'sparkle': 0.75})
        self.assertEqual(self.state.pointing_look(serial=MULE)['right'], 'red')
        self.state.shown_serial = MULE
        self.assertEqual(self.state.snapshot()['pointingLook']['right'], 'red')
        again = HostState(self.path); again.board = self.state.board
        self.assertEqual(again.pointing_look(serial=DAILY)['right'], 'pearl_blue')     # it sticks

    def test_the_most_recent_choice_wins(self):
        with mock.patch('keybard_host.state.time.time', return_value=100.0):
            self.state.set_board_ball(DAILY, 'right', 'pearl_blue')
        with mock.patch('keybard_host.state.time.time', return_value=200.0):
            self.state.set_pointing_look({'uid': '42', 'left': 'black', 'right': 'red', 'gloss': .2})
        look = self.state.pointing_look(serial=DAILY)
        self.assertEqual((look['left'], look['right'], look['gloss']), ('black', 'red', 1.0))   # Keybard, later
        with mock.patch('keybard_host.state.time.time', return_value=300.0):
            self.state.set_board_ball(DAILY, 'right', 'pearl_white')
        look = self.state.pointing_look(serial=DAILY)
        self.assertEqual((look['left'], look['right']), ('black', 'pearl_white'))       # the Overlay, later
        again = HostState(self.path); again.board = self.state.board
        self.assertEqual(again.pointing_look(serial=DAILY), look)                     # times are kept too

    def test_bad_choices_are_refused_or_dropped(self):
        for side, ball in (('middle', 'red'), ('left', 'gold')):
            with self.assertRaises(ValueError): self.state.set_board_ball(DAILY, side, ball)
        self.path.write_text(json.dumps({'boardBalls': {DAILY: {'left': 'gold', 'at': 1}, MULE: {'left': 'red'}, 'x': 'y'}}))
        self.assertEqual(HostState(self.path).board_balls, {})

    def test_the_balls_are_keybards(self):
        from keybard_host.state import BALL_NAMES, DEFAULT_BALL
        source = Path(__file__).resolve().parents[3] / 'src/components/pointing-viz/webgl/materials.ts'
        if not source.exists(): self.skipTest('Keybard source not here (a packaged release)')
        materials = source.read_text(encoding='utf-8')
        import re
        order = re.search(r'MAT_ORDER: BallId\[\] = \[([^\]]+)\]', materials).group(1)
        self.assertEqual(list(BALL_NAMES), re.findall(r'"(\w+)"', order))
        for ball, name in BALL_NAMES.items():
            self.assertRegex(materials, rf'{ball}:\s+\{{ name: "{name}"')
        self.assertIn(f'DEFAULT_BALL: BallId = "{DEFAULT_BALL}"', materials)
        self.assertIn('BALL_GLOSS = 1;', materials)
        self.assertIn('SPARKLE_DEFAULT = 0.75;', materials)


@unittest.skipUnless(QT, 'Requires the native Qt runtime')
class BallMenuTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from PySide6.QtWidgets import QApplication
        cls.app = QApplication.instance() or QApplication([])

    def test_the_picker_shows_each_trackball_hand_and_saves_the_choice(self):
        folder = tempfile.TemporaryDirectory(); self.addCleanup(folder.cleanup)
        state = HostState(Path(folder.name) / 'preferences.json')
        state.board = {'uid': '42', 'pointing': {'left': 'touchpad', 'right': 'trackball'}}
        state.shown_serial = DAILY
        from PySide6.QtCore import QObject

        class Harness(QObject):  # menus need a QObject parent
            build_settings_menus, sync_balls, set_ball = (main.Host.__dict__[n] for n in ('build_settings_menus', 'sync_balls', 'set_ball'))
            fill_board_menu = open_colors = lambda self: None
            set_config = lambda self, **fields: None
        host = Harness(); self.addCleanup(host.deleteLater)
        host.state, host.publish_state = state, mock.Mock()
        host.build_settings_menus()
        texts = [a.text() for a in host.pointing_menu.actions() if not a.isSeparator()]
        self.assertEqual(texts, ['Show pointing devices', 'Show sniper and boost', 'Left trackball', 'Right trackball'])
        left, right = host.ball_menus['left'], host.ball_menus['right']
        self.assertFalse(left[0].menuAction().isVisible())        # a touchpad: no ball to choose
        self.assertTrue(right[0].menuAction().isVisible())
        self.assertEqual([a.text() for a in right[0].actions()], ['Silver sparkle', 'Glossy red', 'Black sparkle', 'Pearl blue', 'Pearl purple', 'Pearl white', 'Pearl black'])
        self.assertTrue(right[1]['silver'].isChecked())            # Keybard's default
        right[1]['pearl_purple'].trigger()
        self.assertEqual(state.board_balls[DAILY]['right'], 'pearl_purple')
        self.assertTrue(right[1]['pearl_purple'].isChecked())
        self.assertEqual(state.snapshot()['pointingLook']['right'], 'pearl_purple')
        host.publish_state.assert_called()


class WebBuildTests(unittest.TestCase):
    def test_a_build_with_the_git_bash_base_is_refused(self):
        from keybard_host.server import web_base_problem
        good = '<script type="module" crossorigin src="/assets/index-a.js"></script><link rel="stylesheet" crossorigin href="/assets/index-b.css">'
        self.assertIsNone(web_base_problem(good))
        broken = good.replace('/assets/', '/Program Files/Git/assets/')
        self.assertIn('/Program Files/Git/assets/index-a.js', web_base_problem(broken))
        self.assertIn('/keybard/assets/', web_base_problem(good.replace('"/assets/index-b', '"/keybard/assets/index-b')))
        self.assertIsNotNone(web_base_problem('<html></html>'))


if __name__ == '__main__':
    unittest.main()
