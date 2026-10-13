import copy
import json
import lzma
import unittest
from unittest.mock import patch

from keybard_host.device.board_layout import decode_definition, geometry_from_definition
from keybard_host.device.model import legend
from keybard_host.device.protocol import SvalReader, ProtocolError, Cancelled, READ_COMMANDS
from test_protocol import FakeDevice


def fragment_definition():
    """Independent fixture: deliberately use fragment IDs unlike option indices."""
    return {
        "name": "Svalboard", "matrix": {"rows": 10, "cols": 6},
        "fragment_schema_version": 1,
        "fragments": {"five": {"id": 40}, "six": {"id": 90}, "thumb": {"id": 5}},
        "composition": {"instances": [
            {"fragment": "thumb", "matrix_map": [[r, c] for c in range(6)]}
            if r in (0, 5) else
            {"fragment_options": [
                {"fragment": "five", "matrix_map": [[r, c] for c in range(5)]},
                {"fragment": "six", "matrix_map": [[r, c] for c in range(6)], "default": True}
            ]} for r in range(10)
        ]},
    }


class BoardLayoutTests(unittest.TestCase):
    def test_definition_uses_firmware_lzma_alone_with_large_dictionary(self):
        definition = fragment_definition()
        payload = lzma.compress(json.dumps(definition).encode(), format=lzma.FORMAT_ALONE, preset=9)
        self.assertEqual(decode_definition(payload), definition)
        for bad in (payload[:-1], payload + b"extra", b"invalid", lzma.compress(b"{}")):
            with self.subTest(bad=bad[:10]), self.assertRaises(ValueError):
                decode_definition(bad)

    def test_bounded_definition_and_matrix_validation(self):
        with patch('keybard_host.device.board_layout.MAX_DEFINITION_BYTES', 100):
            with self.assertRaisesRegex(ValueError, 'oversized'):
                decode_definition(lzma.compress(b' ' * 101, format=lzma.FORMAT_ALONE))
        for value in ([], {}, {"matrix": {"rows": 6, "cols": 10}}):
            with self.assertRaises(ValueError):
                decode_definition(lzma.compress(json.dumps(value).encode(), format=lzma.FORMAT_ALONE))

    def test_geometry_defaults_and_saved_options(self):
        definition = fragment_definition()
        automatic = geometry_from_definition(definition, (255,) * 10, (255,) * 10)
        self.assertEqual(len(automatic), 60)
        self.assertEqual(len({(k.x, k.y) for k in automatic}), 60)
        saved = geometry_from_definition(definition, (255,) * 10, (0,) * 10)
        self.assertEqual(len(saved), 52)
        self.assertEqual(len([k for k in automatic if k.direction == 'second south']), 8)
        # Hardware uses ID 40, saved selection uses index 1 (ID 90).
        self.assertEqual(len(geometry_from_definition(definition, (40,) * 10, (1,) * 10)), 60)
        for instance in definition['composition']['instances']:
            instance['allow_override'] = False
        self.assertEqual(len(geometry_from_definition(definition, (40,) * 10, (1,) * 10)), 52)

    def test_zero_key_pointing_instances(self):
        # Firmware with pointing fragments (svalboard/qmk#23): zero-key instances per hand.
        definition = fragment_definition()
        definition['fragments'].update({"pointing_none": {"id": 4}, "pmw3389": {"id": 6}})
        pointing = {"hardware_detect": True, "fragment_options": [
            {"fragment": "pointing_none", "matrix_map": [], "default": True, "allow_override": False},
            {"fragment": "pmw3389", "matrix_map": [], "allow_override": False}]}
        definition['composition']['instances'] += [copy.deepcopy(pointing), copy.deepcopy(pointing)]
        for hardware in ((255, 255), (6, 6), (6, 4)):
            with self.subTest(hardware=hardware):
                keys = geometry_from_definition(definition, (255,) * 10 + hardware, (255,) * 12)
                self.assertEqual(len(keys), 60)
        missing = copy.deepcopy(definition)
        del missing['composition']['instances'][10]['fragment_options'][0]['matrix_map']
        with self.assertRaisesRegex(ValueError, 'matrix map'):
            geometry_from_definition(missing, (255,) * 12, (255,) * 12)

    def test_pointing_slot_settling_mid_load_does_not_abort(self):
        # 0x18 reads 0xFF for a pointing slot until the module probe settles.
        device = FakeDevice()
        device.definition = fragment_definition()
        device.definition['fragments'].update({"pointing_none": {"id": 4}, "pmw3389": {"id": 6}})
        pointing = {"hardware_detect": True, "fragment_options": [
            {"fragment": "pointing_none", "matrix_map": [], "default": True},
            {"fragment": "pmw3389", "matrix_map": []}]}
        device.definition['composition']['instances'] += [copy.deepcopy(pointing), copy.deepcopy(pointing)]
        device.hardware = (255,) * 12
        device.selections = (255,) * 10 + (9, 9)  # a stray byte in a slot that has no keys
        reader = SvalReader(device)
        def progress(message):
            if 'labels' in message:
                device.hardware = (255,) * 10 + (6, 4)
        profile = reader.read_profile(device.uid, progress)
        self.assertEqual(len(profile.keys), 60)
        # A change in a slot that has keys still aborts the load.
        device.hardware = (255,) * 12
        def keyed(message):
            if 'labels' in message:
                device.selections = (0,) * 10 + (9, 9)
        with self.assertRaisesRegex(ProtocolError, 'Cluster selection changed'):
            reader.read_profile(device.uid, keyed)

    def test_bad_fragment_metadata_never_produces_partial_geometry(self):
        cases = []
        original = fragment_definition()
        wrong = copy.deepcopy(original)
        wrong['composition']['instances'][1]['fragment_options'][0]['fragment'] = []
        cases.append(wrong)
        wrong = copy.deepcopy(original)
        wrong['composition']['instances'][0]['matrix_map'] = [[20, 0]]
        cases.append(wrong)
        wrong = copy.deepcopy(original)
        wrong['composition']['instances'][0]['matrix_map'] = [[1, 0]]
        cases.append(wrong)
        for definition in cases:
            with self.assertRaises(ValueError):
                geometry_from_definition(definition, (255,) * 10, (255,) * 10)
        with self.assertRaises(ValueError):
            geometry_from_definition(original, (), ())
        with self.assertRaises(ValueError):
            geometry_from_definition(original, (255,) * 10, (9,) * 10)

    def test_complete_profile_reads_all_layers_labels_and_behaviors(self):
        device = FakeDevice()
        device.definition = fragment_definition()
        device.definition['customKeycodes'] = [{'name': 'Pointer mode', 'shortName': 'Pointer'}]
        device.hardware = device.selections = (255,) * 10
        device.keycodes[:6] = [0x5700, 0x7700, 0x7E40, 0x4128, 0x2104, 1]
        device.keycodes[-1] = 0x5223
        reader = SvalReader(device)
        _, uid = reader.info()
        profile = reader.read_profile(uid)
        self.assertEqual((profile.uid, len(profile.layers), len(profile.keys)), (uid, 32, 60))
        self.assertTrue(profile.from_board)
        self.assertEqual(profile.layers[-1][-1][-1], 0x5223)
        self.assertEqual(profile.layer_name(2), 'Navigation')
        self.assertEqual(profile.layer_name(5), 'Layer 5')
        self.assertIn('tap: Esc', profile.label(0x5700))
        self.assertIn('hold: Ctrl', profile.label(0x5700))
        self.assertEqual(profile.label(0x7700), 'Macro 0\nGreeting')
        self.assertEqual(profile.label(0x7E40), 'Pointer')
        self.assertEqual(profile.label(0x4128), 'Enter\nL1 hold')
        for packet in device.writes:
            self.assertEqual(len(packet), 33)
            if packet[2:6] != bytes(4):
                self.assertIn(packet[7], READ_COMMANDS[packet[6]])
        offsets = [int.from_bytes(p[8:10], 'big') for p in device.writes if p[6:8] == b'\xfe\x12']
        self.assertEqual(offsets.count(0), 2)  # Two identical passes before publishing.
        self.assertGreater(max(offsets), 255)  # Byte order tested beyond a single-byte offset.

    def test_refresh_reuses_the_definition_but_rereads_keys_and_positions(self):
        device = FakeDevice()
        device.definition = fragment_definition()
        device.hardware = device.selections = (255,) * 10
        reader = SvalReader(device)
        _, uid = reader.info()
        # Without a definition read on this connection, a refresh reads it anyway.
        reader.read_profile(uid, reuse_definition=True)
        self.assertTrue(any(p[6:8] == b'\xdf\x0e' for p in device.writes))
        device.writes.clear()
        device.keycodes[0] = 0x0005
        device.selections = (0,) * 10
        profile = reader.read_profile(uid, reuse_definition=True)
        commands = [p[6:8] for p in device.writes if p[2:6] != bytes(4)]
        self.assertNotIn(b'\xdf\x0d', commands)
        self.assertNotIn(b'\xdf\x0e', commands)
        self.assertIn(b'\xdf\x19', commands)  # Hardware positions can change without new firmware.
        self.assertEqual(profile.layers[0][0][0], 0x0005)
        self.assertEqual(len(profile.keys), 52)
        # A full reload reads the definition again.
        device.writes.clear()
        reader.read_profile(uid)
        self.assertTrue(any(p[6:8] == b'\xdf\x0e' for p in device.writes))

    def test_unstable_keymap_truncated_definition_and_uid_change_rejected(self):
        device = FakeDevice()
        device.change_keymap = True
        with self.assertRaisesRegex(ProtocolError, 'changed during loading'):
            SvalReader(device).read_profile(device.uid)
        device = FakeDevice()
        device.corrupt_chunk = True
        with self.assertRaisesRegex(ProtocolError, 'Truncated'):
            SvalReader(device).read_profile(device.uid)
        device = FakeDevice()
        with self.assertRaisesRegex(ProtocolError, 'identity changed'):
            SvalReader(device).read_profile(42)

    def test_geometry_changed_during_read_rejected(self):
        device = FakeDevice()
        device.definition = fragment_definition()
        device.hardware = device.selections = (255,) * 10
        reader = SvalReader(device)
        def progress(message):
            if 'labels' in message:
                device.selections = (0,) * 10
        with self.assertRaisesRegex(ProtocolError, 'Cluster selection changed'):
            reader.read_profile(device.uid, progress)

    def test_cancellation_stops_transfer_and_clears_deadline(self):
        device = FakeDevice()
        reader = SvalReader(device, cancelled=lambda: len(device.writes) >= 5)
        with self.assertRaises(Cancelled):
            reader.read_profile(device.uid)
        self.assertEqual(len(device.writes), 5)
        self.assertIsNone(reader.load_deadline)

    def test_common_encoded_behaviors_and_unknown_values(self):
        expected = {0x2104: 'A\nCtrl hold', 0x3104: 'A\nR Ctrl hold',
                    0x0104: 'Ctrl+A', 0x5223: 'MO(3)', 0x5242: 'DF(2)',
                    0x52A2: 'OSM Shift', 0x7680: 'Macro 128', 0xFFFF: '0xFFFF',
                    0x002D: '−', 0x003A: 'F1', 0x0073: 'F24', 0: '—', 1: '▽'}
        for code, label in expected.items():
            with self.subTest(code=code):
                self.assertEqual(legend(code), label)
