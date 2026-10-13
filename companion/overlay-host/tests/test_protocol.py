import unittest
import json
import lzma
import sys
import types
from unittest import mock
from keybard_host.device.protocol import SvalReader, ProtocolError, candidates, hid_backend, READ_COMMANDS, LayerSnapshot, DEFAULT_LAYER_STATE_FLAG, MODIFIER_STATE_FLAG2


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

    def write(self, packet):
        self.writes.append(packet)
        reply = bytearray(packet[1:])
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
                    offset, count = int.from_bytes(args[:2], "little"), args[2]
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
            reply[7:] = data.ljust(25, b"\0")
        if self.foreign:
            other = bytearray(reply)
            other[1:5] = (9999).to_bytes(4, "little")
            self.queue.append(other)
        self.queue.append(reply)
        return len(packet)

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


if __name__ == "__main__":
    unittest.main()
