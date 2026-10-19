"""Pointing devices in the overlay: the 0x2D read, the settings, the look op, the allowlist."""
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from keybard_host.device.protocol import (READ_COMMANDS, POINTING_MOTION, POINTING_MOTION_FLAG2, SvalReader,
                                          POINTING_MOTION_READERS_FLAG2, HOST_MOTION_READER,
                                          parse_pointing_motion, pointing_kinds, unsettled_pointing)
from keybard_host.host_pointing import demo_motion
from keybard_host.server import REMOTE_ORIGINS, make_server
from keybard_host.state import DEFAULTS, HostState, serialize_profile, validate_config, validate_pointing_look
from keybard_host.device.model import demo_profile
from test_protocol import FakeDevice


def motion_payload(modes=0, ms=16, left=(0, 0, 0), right=(0, 0, 0), ext=None):
    """format, modes, ms, left block, right block, axis: what follows the 0x2D echo.
    ext=(reader, left_cpi, right_cpi) appends the per-reader extension."""
    def hand(flags, dx, dy):
        return bytes((flags,)) + dx.to_bytes(2, 'little', signed=True) + dy.to_bytes(2, 'little', signed=True) + bytes(5)
    out = bytes((1, modes, ms)) + hand(*left) + hand(*right) + bytes((0,))
    if ext:
        out += bytes((ext[0],)) + ext[1].to_bytes(2, 'little') + ext[2].to_bytes(2, 'little')
    return out


class MotionDevice(FakeDevice):
    def __init__(self):
        super().__init__()
        self.motion = motion_payload(modes=1, left=(1, -5, 7), right=(1, 300, -2))

    def write(self, packet):
        if packet[6:8] == bytes((0xDF, POINTING_MOTION)) and packet[2:6] != bytes(4):
            self.writes.append(packet)
            reply = bytearray(packet[1:]).ljust(self.size, b'\0')[:self.size]
            reply[7:] = self.motion.ljust(self.size - 7, b'\0')
            self.queue.append(reply)
            return len(packet)
        return super().write(packet)


class MotionTests(unittest.TestCase):
    def test_read_only_allowlist_gains_only_the_motion_and_contacts_reads(self):
        self.assertEqual(READ_COMMANDS[0xDF][0x2D], 1)  # the reader id
        self.assertEqual(READ_COMMANDS[0xDF][0x2F], 0)  # contacts: no arguments
        self.assertEqual(set(READ_COMMANDS[0xDF]), {0x00, 0x01, 0x0D, 0x0E, 0x16, 0x18, 0x19, 0x1B, 0x2D, 0x2F})
        self.assertNotIn(0x1A, READ_COMMANDS[0xDF])  # the fragment write stays out
        self.assertEqual(POINTING_MOTION_FLAG2, 0x08)

    def test_parse(self):
        m = parse_pointing_motion(motion_payload(modes=3, ms=20, left=(1, -5, 7), right=(0x11, 300, -2)))
        self.assertEqual((m['sniper'], m['boost'], m['elapsedMs']), (True, True, 20))
        self.assertEqual((m['left']['valid'], m['left']['dx'], m['left']['dy']), (True, -5, 7))
        self.assertEqual((m['right']['dx'], m['right']['dy'], m['right']['touchValid']), (300, -2, True))
        self.assertIsNone(parse_pointing_motion(bytes(24)))  # format 0: no data
        self.assertIsNone(parse_pointing_motion(motion_payload()[:20]))

    def test_never_sent_without_the_flag(self):
        device = MotionDevice()
        reader = SvalReader(device)
        reader.info()
        self.assertIsNone(reader.pointing_motion())
        self.assertFalse(any(p[7:9] == bytes((0xDF, POINTING_MOTION)) for p in device.writes))

    def test_read_with_the_flag(self):
        device = MotionDevice(); device.feature_flags2 = POINTING_MOTION_FLAG2
        reader = SvalReader(device)
        reader.info()
        m = reader.pointing_motion()
        self.assertTrue(m['sniper'])
        self.assertEqual((m['right']['dx'], m['right']['dy']), (300, -2))

    def test_parse_cpi_extension(self):
        m = parse_pointing_motion(motion_payload(left=(1, 4, 0), right=(1, 0, 0), ext=(2, 1600, 0)))
        self.assertEqual(m['left']['cpi'], 1600)
        self.assertNotIn('cpi', m['right'])  # 0: no CPI-based sensor
        self.assertNotIn('cpi', parse_pointing_motion(motion_payload(left=(1, 4, 0)))['left'])  # 32-byte reports
        self.assertNotIn('cpi', parse_pointing_motion(motion_payload().ljust(52, b'\0'))['left'])  # older firmware: zeros

    def test_reader_two_with_the_readers_flag(self):
        self.assertEqual((POINTING_MOTION_READERS_FLAG2, HOST_MOTION_READER), (0x10, 2))
        device = MotionDevice(); device.size = 64; device.feature_flags2 = POINTING_MOTION_FLAG2 | POINTING_MOTION_READERS_FLAG2
        device.motion = motion_payload(left=(1, 9, 0), ext=(2, 1200, 0))
        reader = SvalReader(device)
        reader.info()
        m = reader.pointing_motion()
        self.assertEqual(device.writes[-1][8], HOST_MOTION_READER)
        self.assertEqual((m['left']['dx'], m['left']['cpi']), (9, 1200))

    def test_reader_zero_without_the_readers_flag(self):
        device = MotionDevice(); device.feature_flags2 = POINTING_MOTION_FLAG2
        reader = SvalReader(device)
        reader.info()
        reader.pointing_motion()
        self.assertEqual(device.writes[-1][8], 0)

    def test_kinds_from_widget_fragments(self):
        definition = {"fragments": {"tb": {"id": 9, "widget": {"module": "trackball"}}, "tp": {"id": 7, "widget": {"module": "touchpad"}}},
                      "composition": {"instances": [{"id": "left_pointing", "fragment_options": [{"fragment": "tb", "matrix_map": []}, {"fragment": "tp", "matrix_map": []}]},
                                                    {"id": "right_pointing", "fragment_options": [{"fragment": "tb", "matrix_map": []}]}]}}
        self.assertEqual(pointing_kinds(definition, (7, 9)), {'left': 'touchpad', 'right': 'trackball'})
        self.assertEqual(pointing_kinds(definition, (255, 9)), {'left': None, 'right': 'trackball'})
        self.assertEqual(pointing_kinds({}, ()), {'left': None, 'right': None})

    def test_unsettled_pointing_lists_unknown_modules_only(self):
        definition = {"fragments": {"tb": {"id": 9, "widget": {"module": "trackball"}}, "key": {"id": 1}},
                      "composition": {"instances": [{"id": "left_thumb", "fragment_options": [{"fragment": "key"}]},
                                                    {"id": "left_pointing", "fragment_options": [{"fragment": "tb"}]},
                                                    {"id": "right_pointing", "fragment_options": [{"fragment": "tb"}]}]}}
        self.assertEqual(unsettled_pointing(definition, (255, 255, 9)), (1,))
        self.assertEqual(unsettled_pointing(definition, (255, 9, 9)), ())
        self.assertEqual(unsettled_pointing({}, ()), ())

    def test_pointing_settled_rereads_the_hardware_bytes(self):
        # The other half reports its module a second or two after power-up: 255 until then.
        device = FakeDevice()
        reader = SvalReader(device)
        reader.info()
        self.assertFalse(reader.pointing_settled())  # nothing unknown: no read
        reader.pointing_unsettled = (0,)
        device.hardware = (255, 9)
        self.assertFalse(reader.pointing_settled())
        device.hardware = (9, 9)
        self.assertTrue(reader.pointing_settled())

    def test_profile_carries_kinds(self):
        from dataclasses import replace
        board = serialize_profile(replace(demo_profile(), pointing=(('left', 'touchpad'), ('right', 'trackball'))))
        self.assertEqual(board['pointing'], {'left': 'touchpad', 'right': 'trackball'})
        self.assertEqual(serialize_profile(demo_profile())['pointing'], {})


class SettingsTests(unittest.TestCase):
    def test_defaults(self):
        self.assertEqual((DEFAULTS['showPointing'], DEFAULTS['pointingPills']), (False, True))
        self.assertNotIn('cursorMultiplier', DEFAULTS)

    def test_validation(self):
        self.assertTrue(validate_config({'showPointing': True})['showPointing'])
        for bad in ({'showPointing': 1}, {'pointingPills': 'yes'}):
            with self.assertRaises(ValueError): validate_config(bad)
        # A test build's saved cursorMultiplier is dropped, keeping the rest of the settings.
        self.assertEqual(validate_config({'cursorMultiplier': True, 'showPointing': True}), dict(DEFAULTS, showPointing=True))

    def test_look(self):
        self.assertEqual(validate_pointing_look({'op': 'pointingLook', 'uid': '123', 'left': 'pearl_blue', 'gloss': 0.25, 'sparkle': 1}),
                         ('123', {'left': 'pearl_blue', 'gloss': 0.25, 'sparkle': 1.0}))
        for bad in ({'uid': 'x'}, {'uid': '1', 'left': 'gold'}, {'uid': '1', 'gloss': 2}, {'uid': '1', 'gloss': True}, {'uid': '1', 'other': 1}):
            with self.assertRaises(ValueError): validate_pointing_look(bad)

    def test_look_kept_per_board_and_saved(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'prefs.json'
            state = HostState(path)
            state.set_pointing_look({'uid': '42', 'right': 'red', 'gloss': 0.5})
            state.board = {'uid': '42'}
            # Keybard's fixed gloss and sparkle, whatever an older Keybard saved.
            fixed = {'gloss': 1.0, 'sparkle': 0.75}
            self.assertEqual(state.snapshot()['pointingLook'], dict(fixed, right='red'))
            again = HostState(path); again.board = {'uid': '42'}
            self.assertEqual(again.snapshot()['pointingLook'], dict(fixed, right='red'))
            again.board = {'uid': '7'}
            self.assertEqual(again.snapshot()['pointingLook'], fixed)

    def test_demo_motion_shape(self):
        m = demo_motion(3.0, .016)
        self.assertTrue(m['sniper'] and m['right']['valid'] and m['left']['valid'])
        self.assertEqual(m['left']['dx'], 0)

    def test_no_github_io_origin(self):
        self.assertFalse(any('github.io' in o for o in REMOTE_ORIGINS))


class LookOpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); root = Path(self.temp.name)
        (root / 'index.html').write_text('<html lang="en"><body>Keybard</body></html>')
        self.state = HostState(root / 'prefs.json'); self.commands = []
        self.server = make_server(self.state, root, self.commands.append)
        self.thread = threading.Thread(target=self.server.serve_forever); self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(); self.temp.cleanup()

    def post(self, value, path='/api/host/command'):
        return urlopen(Request(self.base + path, data=json.dumps(value).encode(), headers={'X-Keybard-Token': self.state.token, 'Content-Type': 'application/json'}))

    def test_look_op_accepted_and_stored_never_dispatched_to_board(self):
        with self.post({'op': 'pointingLook', 'uid': '42', 'left': 'black', 'sparkle': 0.75}) as r: self.assertEqual(r.status, 202)
        self.assertEqual(self.state.pointing_looks['42'], {'left': 'black', 'sparkle': 0.75})
        with self.assertRaises(HTTPError) as error: self.post({'op': 'pointingLook', 'uid': '42', 'left': 'gold'})
        self.assertEqual(error.exception.code, 400)

    def test_config_with_pointing_settings(self):
        config = dict(DEFAULTS, showPointing=True)
        with self.post({'config': config, 'revision': 0}, path='/api/host/config') as r: self.assertEqual(json.load(r)['revision'], 1)
        self.assertTrue(self.state.config['showPointing'])


if __name__ == '__main__':
    unittest.main()


def late_pointing_device():
    """A board whose two pointing slots read "no pointing module" (id 4) at first."""
    import copy
    from test_board_layout import fragment_definition
    device = FakeDevice()
    device.definition = fragment_definition()
    device.definition['fragments'].update({
        "pointing_none": {"id": 4, "kle": [], "widget": {"kind": "pointing", "module": "none", "w": 2.5, "h": 2.5}},
        "pmw3389": {"id": 6, "kle": [], "widget": {"kind": "pointing", "module": "trackball", "sensor": "pmw3389", "w": 2.5, "h": 2.5}},
    })
    pointing = {"hardware_detect": True, "fragment_options": [
        {"fragment": "pointing_none", "matrix_map": [], "default": True},
        {"fragment": "pmw3389", "matrix_map": []}]}
    for side in ("left", "right"):
        device.definition['composition']['instances'].append(dict(copy.deepcopy(pointing), id=f"{side}_pointing"))
    device.hardware = (255,) * 10 + (4, 4)
    device.selections = (255,) * 12
    return device


class LatePointingTests(unittest.TestCase):
    """The firmware probes again until 30 s after power-on: "none" early on can become a module."""

    def setUp(self):
        self.now = 100.0
        self.device = late_pointing_device()
        self.reader = SvalReader(self.device, clock=lambda: self.now)
        self.reader.info()

    def reads_0x18(self):
        return sum(1 for p in self.device.writes if bytes(p[6:8]) == bytes((0xDF, 0x18)))

    def test_a_none_slot_that_turns_into_a_trackball_is_drawn(self):
        profile = self.reader.read_profile(self.device.uid)
        self.assertEqual(serialize_profile(profile)['pointing'], {'left': None, 'right': None})
        self.assertTrue(self.reader.pointing_watching())
        self.now += 2
        self.assertFalse(self.reader.pointing_settled())
        # The board's 30 s probe finds the right trackball.
        self.now += 28
        self.device.hardware = (255,) * 10 + (4, 6)
        self.assertTrue(self.reader.pointing_settled())
        profile = self.reader.read_profile(self.device.uid, reuse_definition=True)
        self.assertEqual(serialize_profile(profile)['pointing'], {'left': None, 'right': 'trackball'})
        # The left hand still reads none and the window is still open: watched until 35 s.
        self.assertTrue(self.reader.pointing_watching())
        self.now += 6
        self.assertFalse(self.reader.pointing_watching())

    def test_a_slot_that_stays_none_is_not_read_after_35_s(self):
        self.reader.read_profile(self.device.uid)
        self.now += 34.9
        self.assertTrue(self.reader.pointing_watching())
        self.assertFalse(self.reader.pointing_settled())
        self.now += 0.2
        self.assertFalse(self.reader.pointing_watching())
        before = self.reads_0x18()
        self.assertGreater(before, 0)
        self.assertFalse(self.reader.pointing_settled())
        self.assertEqual(self.reads_0x18(), before)
        # A later profile read (a layout refresh) doesn't open the window again.
        self.reader.read_profile(self.device.uid, reuse_definition=True)
        self.assertFalse(self.reader.pointing_watching())

    def test_a_module_present_at_the_first_read_causes_no_rereads(self):
        self.device.hardware = (255,) * 10 + (6, 6)
        profile = self.reader.read_profile(self.device.uid)
        self.assertEqual(serialize_profile(profile)['pointing'], {'left': 'trackball', 'right': 'trackball'})
        self.assertFalse(self.reader.pointing_watching())
        before = self.reads_0x18()
        self.assertFalse(self.reader.pointing_settled())
        self.assertEqual(self.reads_0x18(), before)
