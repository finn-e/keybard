import unittest
import json
import lzma
import sys
import types
from unittest import mock
from keybard_host.device.protocol import SvalReader, ProtocolError, candidates, hid_backend, READ_COMMANDS, LayerSnapshot, DEFAULT_LAYER_STATE_FLAG, MODIFIER_STATE_FLAG2
from keybard_host.device.protocol import report_size_from_descriptor, device_report_size


class FakeDevice:
    def __init__(self):
        self.writes = []
        self.queue = []
        self.client = 7
        self.expire_once = False
        self.foreign = False
        self.version = 3
        self.feature_flags = 0
        self.feature_flags2 = 0
        self.mods = 0
        self.status = 0
        self.default_mask = 1
        self.legacy_padding = b"\xa5" * 4
        self.uid = 0x1122334455667788
        self.mask = 1 << 31
        self.layer_count = 32
        self.keycodes = [4] * (32 * 60)
        self.definition = {"name": "Test Svalboard", "matrix": {"rows": 10, "cols": 6}}
        self.hardware = ()
        self.selections = ()
        self.labels = {0: {0: "Base", 2: "Navigation"}, 1: {0: "Escape dance"}, 2: {0: "Greeting"}}
        self.dances = {0: (41, 0xE0, 43, 0, 200)}
        self.compressed = None
        self.corrupt_chunk = False
        self.change_keymap = False
        self.matrix_rows = [0] * 10
        self.matrix_unsupported = False
        # The board's raw HID report length, and the firmware's definition chunk cap
        self.size = 32
        self.chunk_cap = 22
        # Ignore writes of another length (as hidraw does) rather than pad them (as Windows does)
        self.strict_size = False
        # Windows hidapi pads a short write to the report length and returns the padded count
        self.padded_count = False

    def write(self, packet):
        self.writes.append(packet)
        if self.strict_size and len(packet) - 1 != self.size:
            return len(packet)
        reply = bytearray(packet[1:]).ljust(self.size, b"\0")[:self.size]
        if reply[1:5] == bytes(4):
            self.client += 1
            reply[25:29] = self.client.to_bytes(4, "little")
            reply[29:31] = (120).to_bytes(2, "little")
        elif self.expire_once:
            self.expire_once = False
            reply[5:7] = bytes((0xFF, 1))
        elif reply[5:7] == bytes((0xDF, 0)):
            reply[7:11] = self.version.to_bytes(4, "little")
            reply[11:19] = self.uid.to_bytes(8, "little")
            reply[19] = self.feature_flags
            reply[24] = self.feature_flags2
        else:
            protocol, command = reply[5:7]
            args = bytes(reply[7:])
            data = b""
            if (protocol, command) == (0xDF, 0x16):
                data = self.mask.to_bytes(4, "little")
                data += self.default_mask.to_bytes(4, "little") if self.feature_flags & DEFAULT_LAYER_STATE_FLAG else self.legacy_padding
                data += bytes((self.mods, self.status)) if self.feature_flags2 & MODIFIER_STATE_FLAG2 else b"\xa5\xa5"
            elif protocol == 0xDF and command in (0x0D, 0x0E):
                if self.compressed is None:
                    self.compressed = lzma.compress(json.dumps(self.definition).encode(), format=lzma.FORMAT_ALONE)
                if command == 0x0D:
                    data = len(self.compressed).to_bytes(4, "little")
                else:
                    offset, count = int.from_bytes(args[:2], "little"), min(args[2], self.chunk_cap)
                    chunk = self.compressed[offset:offset + count]
                    data = args[:2] + bytes((len(chunk) - int(self.corrupt_chunk),)) + chunk
            elif protocol == 0xDF and command in (0x18, 0x19):
                values = self.hardware if command == 0x18 else self.selections
                data = bytes((len(values),)) + bytes(values)
            elif (protocol, command) == (0xFE, 0x02):
                assert args[:2] == b"\x03\x00"
                data = args[:2] + bytes(self.matrix_rows)
                if self.matrix_unsupported:
                    reply[6] = 0xFF
            elif (protocol, command) == (0xFE, 0x11):
                data = bytes((self.layer_count,))
            elif (protocol, command) == (0xFE, 0x12):
                offset, count = int.from_bytes(args[:2], "big"), args[2]
                if offset == 0 and self.change_keymap:
                    self.keycodes[0] += 1
                raw = b"".join(c.to_bytes(2, "big") for c in self.keycodes)
                data = args[:3] + raw[offset:offset + count]
            elif (protocol, command) == (0xDF, 0x1B):
                kind, start = args[0], int.from_bytes(args[1:3], "little")
                labels = self.labels[kind]
                index = next((i for i in sorted(labels) if i >= start), None)
                data = bytes((kind, int(index is not None))) + (index or 0).to_bytes(2, "little")
                data += labels[index].encode().ljust(16, b"\0") if index is not None else bytes(16)
            elif (protocol, command) == (0xDF, 0x01):
                index = int.from_bytes(args[:2], "little")
                data = args[:2] + b"".join(c.to_bytes(2, "little") for c in self.dances[index])
            else:
                raise AssertionError(f"Unexpected command {protocol:02X}:{command:02X}")
            reply[7:] = data.ljust(self.size - 7, b"\0")
        if self.foreign:
            other = bytearray(reply)
            other[1:5] = (9999).to_bytes(4, "little")
            self.queue.append(other)
        self.queue.append(reply)
        return max(len(packet), self.size + 1) if self.padded_count else len(packet)

    def read(self, size, timeout):
        return self.queue.pop(0) if self.queue else []


class ProtocolTests(unittest.TestCase):
    def test_info_and_unsigned_mask(self):
        device = FakeDevice()
        reader = SvalReader(device)
        self.assertEqual(reader.info(), (3, device.uid))
        self.assertEqual(reader.layer_state(), 1 << 31)
        self.assertTrue(all(len(p) == 33 and p[0] == 0 and p[1] == 0xDD for p in device.writes))

    def test_default_layer_capability_and_legacy_padding(self):
        device = FakeDevice()
        reader = SvalReader(device)
        for version in (2, 3):
            device.version = version
            for padding in (bytes(4), b'\xff' * 4, b'\x02\x00\x00\x00'):
                device.legacy_padding = padding
                reader.info()
                self.assertEqual(reader.layer_snapshot(), LayerSnapshot(1 << 31, None))
        device.feature_flags = DEFAULT_LAYER_STATE_FLAG | 8
        reader.info()
        for default in (0, 1, 4, (1 << 31) | 2, 0xFFFFFFFF):
            device.default_mask = default
            self.assertEqual(reader.layer_snapshot(), LayerSnapshot(1 << 31, default))
        # A fresh handshake must clear capabilities after a firmware downgrade.
        device.feature_flags = 0
        reader.info()
        self.assertIsNone(reader.layer_snapshot().default)

    def test_shift_and_caps_lock_come_from_the_board(self):
        device = FakeDevice()
        reader = SvalReader(device)
        reader.info()
        self.assertIsNone(reader.layer_snapshot().modifiers)  # Not advertised: trailing bytes are ignored.
        device.feature_flags2 = MODIFIER_STATE_FLAG2
        reader.info()
        # (HID mods, status) -> shift, capsLock. Status bit 0 Caps Word, bit 1 Caps Lock LED.
        for mods, status, shift, caps in [(0, 0, False, False), (0x02, 0, True, False), (0x20, 0, True, False),
                                          (0x01 | 0x04 | 0x08, 0, False, False), (0, 2, False, True),
                                          (0, 1, False, True), (0, 3, False, False), (0x02, 1, True, True)]:
            device.mods, device.status = mods, status
            self.assertEqual(reader.layer_snapshot().modifiers, dict(shift=shift, capsLock=caps), (mods, status))
        device.feature_flags2 = 0  # A downgrade drops it on the next handshake.
        reader.info()
        self.assertIsNone(reader.layer_snapshot().modifiers)

    def test_pressed_matrix_covers_both_hands_chords_and_release(self):
        device = FakeDevice()
        reader = SvalReader(device)
        device.matrix_rows[0] = 0b100001
        device.matrix_rows[9] = 0b100010
        self.assertEqual(reader.pressed_keys(), {(0, 0), (0, 5), (9, 1), (9, 5)})
        device.matrix_rows = [0] * 10
        self.assertFalse(reader.pressed_keys())
        for args in (b'\x01\x00', b'\x03\x01', b'\x00\x00'):
            with self.assertRaises(ValueError):
                reader._read(0x02, args, protocol=0xFE)
        device.matrix_rows[0] = 0x80
        with self.assertRaisesRegex(ProtocolError, 'column bits'):
            reader.pressed_keys()

    def test_request_allowlist_cannot_emit_mutations(self):
        device = FakeDevice()
        reader = SvalReader(device)
        for protocol in (0xDF, 0xFE, 0xFD):
            for command in range(256):
                if command not in READ_COMMANDS.get(protocol, {}):
                    with self.assertRaises(ValueError):
                        reader._read(command, protocol=protocol)
        for protocol, commands in READ_COMMANDS.items():
            for command, length in commands.items():
                with self.assertRaises(ValueError):
                    reader._read(command, bytes(length + 1), protocol=protocol)
        self.assertEqual(device.writes, [])

    def test_foreign_replies_ignored(self):
        device = FakeDevice()
        device.foreign = True
        self.assertEqual(SvalReader(device).info(), (3, device.uid))

    def test_expired_lease_rebootstraps_and_retries(self):
        device = FakeDevice()
        reader = SvalReader(device)
        reader.info()
        first_id = reader.client_id
        device.expire_once = True
        self.assertEqual(reader.layer_state(), device.mask)
        self.assertNotEqual(reader.client_id, first_id)

    def test_renews_before_quantized_ttl(self):
        now = [0]
        device = FakeDevice()
        reader = SvalReader(device, lambda: now[0])
        reader.info()
        first_id = reader.client_id
        now[0] = 51
        reader.layer_state()
        self.assertNotEqual(reader.client_id, first_id)

    def test_short_write_and_short_report_rejected(self):
        device = FakeDevice()
        device.write = lambda p: 1
        with self.assertRaisesRegex(ProtocolError, "write"):
            SvalReader(device).info()
        device = FakeDevice()
        device.read = lambda *args: [0xDD]
        with self.assertRaisesRegex(ProtocolError, "length"):
            SvalReader(device).info()

    def test_timeout_is_bounded(self):
        now = [0]
        device = FakeDevice()
        def clock():
            now[0] += .05
            return now[0]
        device.read = lambda *args: []
        with self.assertRaisesRegex(ProtocolError, "timed out"):
            SvalReader(device, clock).info()
        self.assertLess(now[0], 1)

    def test_unrecognized_protocol_rejected(self):
        device = FakeDevice()
        device.version = 999
        with self.assertRaisesRegex(ProtocolError, "not supported"):
            SvalReader(device).info()

    def test_multiple_boards_and_custom_usb_ids_are_discovered(self):
        class HID:
            def enumerate(self):
                common = {"usage_page": 0xFF61, "usage": 0x62, "product_string": "Svalboard"}
                left = dict(common, path=b"left", vendor_id=0x303A, product_id=0x4044)
                return [left, dict(left),
                        dict(common, path=b"right", vendor_id=0x303A, product_id=0x4045),
                        dict(common, path=b"main", vendor_id=0x303A, product_id=0x4049),
                        dict(common, path=b"custom", vendor_id=0xCAFE, product_id=0x1234),
                        dict(common, path=b"mouse", usage_page=1, usage=2)]
        self.assertEqual([d["path"] for d in candidates(HID())], [b"left", b"right", b"main", b"custom"])

    def test_only_sval_usage_is_enumerated(self):
        class HID:
            def enumerate(self):
                return [{"usage_page": 0xFF61, "usage": 0x62, "path": b"sval"},
                        {"usage_page": 0xFF60, "usage": 0x61, "path": b"raw-hid"},
                        {"usage_page": 1, "usage": 6, "path": b"keyboard"},
                        {"usage_page": 1, "usage": 2, "path": b"pointer"}]
        self.assertEqual([d["path"] for d in candidates(HID())], [b"sval"])

    def test_linux_uses_hidraw_backend(self):
        # libusb, the hidapi wheel's default on Linux, reports usage page 0 for every interface.
        hid, hidraw = types.ModuleType("hid"), types.ModuleType("hidraw")
        with mock.patch.dict(sys.modules, {"hid": hid, "hidraw": hidraw}):
            self.assertIs(hid_backend("linux"), hidraw)
            self.assertIs(hid_backend("win32"), hid)
            self.assertIs(hid_backend("darwin"), hid)


def raw_hid_descriptor(size):
    """QMK's raw HID report descriptor, with `size`-byte input and output reports."""
    return bytes([0x06, 0x60, 0xFF, 0x09, 0x61, 0xA1, 0x01,
                  0x09, 0x62, 0x15, 0x00, 0x26, 0xFF, 0x00, 0x95, size, 0x75, 0x08, 0x81, 0x02,
                  0x09, 0x63, 0x15, 0x00, 0x26, 0xFF, 0x00, 0x95, size, 0x75, 0x08, 0x91, 0x02,
                  0xC0])


class DescribedDevice(FakeDevice):
    """A fake board whose binding exposes hidapi >= 0.14's get_report_descriptor."""

    def __init__(self, size):
        super().__init__()
        self.size = size
        self.strict_size = True

    def get_report_descriptor(self):
        return raw_hid_descriptor(self.size)


class ReportSizeTests(unittest.TestCase):
    def test_descriptor_gives_32_or_64(self):
        self.assertEqual(report_size_from_descriptor(raw_hid_descriptor(32)), 32)
        self.assertEqual(report_size_from_descriptor(raw_hid_descriptor(64)), 64)
        self.assertEqual(report_size_from_descriptor(list(raw_hid_descriptor(64))), 64)

    def test_unusable_descriptor_gives_none(self):
        self.assertIsNone(report_size_from_descriptor(b""))
        self.assertIsNone(report_size_from_descriptor(None))
        # No output report
        self.assertIsNone(report_size_from_descriptor(raw_hid_descriptor(32)[:-3]))
        # Too small for the protocol
        self.assertIsNone(report_size_from_descriptor(raw_hid_descriptor(8)))

    def test_binding_without_descriptor_support(self):
        self.assertIsNone(device_report_size(FakeDevice()))
        device = FakeDevice()
        def broken():
            raise OSError("not supported")
        device.get_report_descriptor = broken
        self.assertIsNone(device_report_size(device))
        self.assertEqual(device_report_size(DescribedDevice(64)), 64)

    def test_64_byte_board_from_descriptor_reads_whole_profile(self):
        for cap in (22, 54):
            device = DescribedDevice(64)
            device.chunk_cap = cap
            reader = SvalReader(device)
            self.assertEqual(reader.report_size, 64)
            _, uid = reader.info()
            profile = reader.read_profile(uid)
            self.assertEqual(len(profile.layers), 32)
            self.assertTrue(all(len(packet) == 65 for packet in device.writes))
            keymap = [p for p in device.writes if p[6:8] == b"\xfe\x12"]
            # 32 layers x 120 bytes in 54-byte chunks, read twice to check it is stable
            self.assertEqual(len(keymap), 2 * -(-32 * 120 // 54))
            self.assertEqual(keymap[0][10], 54)
            self.assertEqual(int.from_bytes(keymap[1][8:10], "big"), 54)
            chunks = [p for p in device.writes if p[6:8] == b"\xdf\x0e"]
            self.assertEqual(chunks[0][10], 54)
            self.assertEqual(len(chunks), -(-len(device.compressed) // cap))

    def test_32_byte_board_from_descriptor(self):
        device = DescribedDevice(32)
        reader = SvalReader(device)
        _, uid = reader.info()
        reader.read_profile(uid)
        self.assertTrue(all(len(packet) == 33 for packet in device.writes))
        keymap = [p for p in device.writes if p[6:8] == b"\xfe\x12"]
        self.assertEqual(keymap[0][10], 22)

    def test_probe_finds_64_without_descriptor(self):
        device = FakeDevice()
        device.size, device.strict_size = 64, True
        reader = SvalReader(device)
        self.assertIsNone(reader.report_size)
        reader.info()
        self.assertEqual(reader.report_size, 64)
        # The 32-byte bootstrap went unanswered; the 64-byte one was answered
        self.assertEqual([len(p) for p in device.writes[:2]], [33, 65])
        self.assertTrue(all(len(p) == 65 for p in device.writes[1:]))
        reader.layer_state()
        self.assertEqual(len(device.writes[-1]), 65)

    def test_probe_keeps_32_and_padding_boards_answer_at_32(self):
        for size in (32, 64):
            device = FakeDevice()
            device.size = size  # Windows pads a 32-byte write to the report length
            reader = SvalReader(device)
            reader.info()
            self.assertEqual(reader.report_size, size)
            self.assertEqual(len(device.writes[0]), 33)
            self.assertTrue(all(len(p) == size + 1 for p in device.writes[1:]))

    def test_windows_padded_write_count_is_a_complete_write(self):
        # hidapi on Windows returns the padded length (65) for any write to a 64-byte board.
        device = DescribedDevice(64)
        device.strict_size, device.padded_count = False, True
        reader = SvalReader(device)
        _, uid = reader.info()
        reader.read_profile(uid)
        # More than was asked for is still a complete write.
        device = FakeDevice()
        device.write_count = device.write
        device.write = lambda packet: device.write_count(packet) + 32
        self.assertEqual(SvalReader(device, report_size=32).info(), (3, device.uid))

    def test_probe_moves_on_when_the_write_count_shows_another_size(self):
        device = FakeDevice()
        device.size, device.padded_count = 64, True
        reader = SvalReader(device)
        reader.info()
        self.assertEqual(reader.report_size, 64)
        # The 33-byte write came back as 65, so the probe went straight to 64 bytes.
        self.assertEqual([len(p) for p in device.writes[:2]], [33, 65])

    def test_reply_of_the_wrong_length_rejected(self):
        device = FakeDevice()
        device.size = 64
        with self.assertRaisesRegex(ProtocolError, "length"):
            SvalReader(device, report_size=32).info()


if __name__ == "__main__":
    unittest.main()
