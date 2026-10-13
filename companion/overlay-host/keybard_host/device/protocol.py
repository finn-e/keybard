"""Strictly read-only Sval v2/v3 client with the mandatory client wrapper."""
from dataclasses import dataclass, replace
import secrets
import sys
import time

from .board_layout import decode_definition, geometry_from_definition, keyless_instances
from .model import Profile, legend

USAGE_PAGE, USAGE = 0xFF61, 0x62
# Raw HID report length: 32 bytes on today's firmware, 64 on newer builds. It is
# read from the device's report descriptor (hidapi >= 0.14). When the binding
# can't give one, the first exchange probes: it writes 32 bytes, then 64 if that
# goes unanswered, and keeps the length of the first valid reply.
REPORT_SIZE = 32  # default, and the first size probed
SUPPORTED_REPORT_SIZES = (32, 64)
WRAPPER_OVERHEAD = 6  # [0xDD][client_id:4][protocol]
# Framing in front of a transfer's data, wrapper included: VIA keymap buffer
# [wrapper][cmd][offset:2][size] and Sval definition chunk [wrapper][cmd][offset:2][size].
CHUNK_HEADER = WRAPPER_OVERHEAD + 4
DEFAULT_LAYER_STATE_FLAG = 1 << 6
# Second feature byte: 0x16 appends the board's modifiers and Caps Word / Caps Lock.
MODIFIER_STATE_FLAG2 = 1 << 2
SHIFT_BITS = 0x22  # left and right Shift in the HID modifier byte
# Protocol -> command -> exact request argument length. No setter is expressible.
READ_COMMANDS = {
    0xDF: {0x00: 0, 0x01: 2, 0x0D: 0, 0x0E: 3, 0x16: 0, 0x18: 0, 0x19: 0, 0x1B: 3},
    0xFE: {0x02: 2, 0x11: 0, 0x12: 3},
}


@dataclass(frozen=True)
class LayerSnapshot:
    active: int
    default: int | None = None  # None means not advertised; zero is a valid mask.
    # The board's own Shift and Caps Lock, or None on firmware that doesn't report them.
    # Caps Word counts as Caps Lock: it capitalizes letters and leaves symbols alone.
    modifiers: dict | None = None


class ProtocolError(Exception):
    pass


class ClientExpired(ProtocolError):
    pass


class UnsupportedCommand(ProtocolError):
    pass


class Cancelled(Exception):
    pass


def report_size_from_descriptor(descriptor):
    """Bytes in the first output report of a HID report descriptor, or None.

    Walks the short items, tracking Report Size, Report Count and Report ID
    (with Push/Pop), and sums the Output items of the first report ID seen.
    """
    data = bytes(descriptor or b"")
    state = {"size": 0, "count": 0, "id": 0}
    stack, bits, first_id = [], {}, None
    i = 0
    while i < len(data):
        prefix = data[i]
        if prefix == 0xFE:  # long item: [0xFE][data size][tag][data]
            if i + 1 >= len(data):
                break
            i += 3 + data[i + 1]
            continue
        length = (0, 1, 2, 4)[prefix & 3]
        value = int.from_bytes(data[i + 1:i + 1 + length], "little")
        kind, tag = (prefix >> 2) & 3, prefix >> 4
        i += 1 + length
        if kind == 1:  # global
            if tag == 7:
                state["size"] = value
            elif tag == 8:
                state["id"] = value
            elif tag == 9:
                state["count"] = value
            elif tag == 10:
                stack.append(dict(state))
            elif tag == 11 and stack:
                state = stack.pop()
        elif kind == 0 and tag == 9:  # main: Output
            if first_id is None:
                first_id = state["id"]
            bits[state["id"]] = bits.get(state["id"], 0) + state["size"] * state["count"]
    if first_id is None:
        return None
    size = bits[first_id] // 8
    return size if size >= REPORT_SIZE else None


def device_report_size(device):
    """The device's raw HID report length from its descriptor, or None if unreadable."""
    get_descriptor = getattr(device, "get_report_descriptor", None)
    if get_descriptor is None:
        return None
    try:
        return report_size_from_descriptor(get_descriptor())
    except Exception:  # binding or OS can't read it: fall back to probing
        return None


def hid_backend(platform=sys.platform):
    # The hidapi wheel's default Linux backend is libusb, which reports no usage
    # pages and can detach the kernel keyboard driver. Use hidraw there.
    if platform.startswith("linux"):
        import hidraw
        return hidraw
    import hid
    return hid


def candidates(hid_module):
    # Product IDs vary across Svalboards and firmware builds. Match the dedicated
    # Sval collection, as Keybard does; never probe keyboard or pointer collections.
    result, seen = [], set()
    for device in hid_module.enumerate():
        if device.get("usage_page") != USAGE_PAGE or device.get("usage") != USAGE:
            continue
        path = device.get("path")
        if path is None or path in seen:
            continue
        seen.add(path)
        result.append(device)
    return result


class SvalReader:
    def __init__(self, device, clock=time.monotonic, cancelled=lambda: False, report_size=None):
        self.device = device
        # None until known: then the first exchange probes 32, then 64
        self.report_size = report_size or device_report_size(device)
        self.clock = clock
        self.cancelled = cancelled
        self.client_id = 0
        self.renew_at = 0
        self.feature_flags = 0
        self.feature_flags2 = 0
        self.load_deadline = None
        # The last board definition read: it only changes with new firmware, so a refresh reuses it.
        self.cached_definition = None

    def checkpoint(self):
        if self.cancelled():
            raise Cancelled()
        if self.load_deadline is not None and self.clock() > self.load_deadline:
            raise ProtocolError("Loading the board layout timed out")

    def _exchange(self, request, accept):
        self.checkpoint()
        sizes = (self.report_size,) if self.report_size else SUPPORTED_REPORT_SIZES
        sent = False
        for size in sizes:
            if len(request) > size:
                raise ProtocolError("Oversized request")
            packet = b"\0" + request.ljust(size, b"\0")
            written = self.device.write(packet)
            # Windows hidapi pads a short write to the device's report length and
            # returns that count, so more than asked is a complete write. While the
            # size is unknown, any other count means this is not the device's size.
            if self.report_size:
                if written < len(packet):
                    raise ProtocolError("Incomplete HID write")
            elif written != len(packet):
                continue
            sent = True
            deadline = self.clock() + .25
            while self.clock() < deadline:
                self.checkpoint()
                reply = bytes(self.device.read(self.report_size or max(SUPPORTED_REPORT_SIZES), 30))
                if not reply:
                    continue
                if (len(reply) != self.report_size if self.report_size
                        else len(reply) not in SUPPORTED_REPORT_SIZES):
                    raise ProtocolError("Malformed HID report length")
                result = accept(reply)
                if result is not None:
                    self.report_size = self.report_size or len(reply)
                    return result
        if not sent:
            raise ProtocolError("Incomplete HID write")
        raise ProtocolError("Svalboard response timed out")

    def chunk_size(self):
        """Data bytes per keymap or definition chunk: 22 at 32 bytes, 54 at 64."""
        return (self.report_size or REPORT_SIZE) - CHUNK_HEADER

    def bootstrap(self):
        nonce = secrets.token_bytes(20)
        prefix = b"\xdd\0\0\0\0" + nonce

        def accept(reply):
            if reply[:25] != prefix:
                return None
            client = int.from_bytes(reply[25:29], "little")
            ttl = int.from_bytes(reply[29:31], "little")
            if client in (0, 0xFFFFFFFF) or ttl < 66:
                raise ProtocolError("Invalid Sval client lease")
            return client, ttl

        self.client_id, ttl = self._exchange(prefix, accept)
        self.renew_at = self.clock() + min(50, (ttl - 65.536) / 2)

    def _read(self, command, args=b"", protocol=0xDF):
        allowed = READ_COMMANDS.get(protocol, {})
        if command not in allowed or len(args) != allowed[command]:
            raise ValueError("Command or argument length is outside the trainer read allowlist")
        if protocol == 0xFE and command == 0x02 and args != b"\x03\x00":
            raise ValueError("Only the read-only switch matrix at row zero is allowed")
        for attempt in range(2):
            self.checkpoint()
            if not self.client_id or self.clock() >= self.renew_at:
                self.bootstrap()
            prefix = b"\xdd" + self.client_id.to_bytes(4, "little")

            def accept(reply):
                if reply[:5] != prefix:
                    return None
                if reply[5] == 0xFF:
                    if reply[6] == 1:
                        raise ClientExpired("Sval client lease expired")
                    raise ProtocolError(f"Sval wrapper error {reply[6]}")
                if reply[5] != protocol:
                    return None
                if reply[6] == 0xFF:
                    raise UnsupportedCommand(f"Board does not support read command {protocol:02X}:{command:02X}")
                if reply[6] != command:
                    return None
                data = reply[7:]
                echo_length = (3 if protocol == 0xFE and command == 0x12 else
                               2 if (protocol == 0xDF and command in (0x01, 0x0E)) or (protocol == 0xFE and command == 0x02) else
                               1 if protocol == 0xDF and command == 0x1B else 0)
                if data[:echo_length] != args[:echo_length]:
                    return None
                return data

            try:
                return self._exchange(prefix + bytes((protocol, command)) + args, accept)
            except ClientExpired:
                self.client_id = 0
                if attempt:
                    raise
        raise ProtocolError("Unable to obtain client lease")

    def info(self):
        data = self._read(0x00)
        version = int.from_bytes(data[:4], "little")
        if version not in (2, 3):
            raise ProtocolError(f"Sval protocol {version} is not supported")
        self.feature_flags = data[12]
        self.feature_flags2 = data[17] if len(data) > 17 else 0
        return version, int.from_bytes(data[4:12], "little")

    def layer_state(self):
        return int.from_bytes(self._read(0x16)[:4], "little")

    def layer_snapshot(self):
        data = self._read(0x16)
        default = (int.from_bytes(data[4:8], "little")
                   if self.feature_flags & DEFAULT_LAYER_STATE_FLAG else None)
        modifiers = None
        if self.feature_flags2 & MODIFIER_STATE_FLAG2:
            mods, status = data[8], data[9]
            modifiers = dict(shift=bool(mods & SHIFT_BITS), capsLock=bool(status & 2) != bool(status & 1))
        return LayerSnapshot(int.from_bytes(data[:4], "little"), default, modifiers)

    def pressed_keys(self):
        # VIA GET_KEYBOARD_VALUE / SWITCH_MATRIX_STATE, row offset zero.
        # Svalboard's 10 rows × 6 columns fit in ten bytes after the two echoes.
        data = self._read(0x02, b"\x03\x00", protocol=0xFE)
        rows = data[2:12]
        if any(row & 0xC0 for row in rows):
            raise ProtocolError("Invalid Svalboard matrix column bits")
        return frozenset((row, col) for row, bits in enumerate(rows)
                         for col in range(6) if bits & (1 << col))

    def definition(self):
        size = int.from_bytes(self._read(0x0D)[:4], "little")
        if not 1 <= size <= 65536:
            raise ProtocolError("Board definition exceeds the 16-bit transfer range")
        payload = bytearray()
        while len(payload) < size:
            count = min(self.chunk_size(), size - len(payload))
            args = len(payload).to_bytes(2, "little") + bytes((count,))
            data = self._read(0x0E, args)
            # The firmware may send less than asked (it caps chunks at 22 bytes), never none
            got = data[2]
            if not 1 <= got <= count:
                raise ProtocolError("Truncated board definition chunk")
            payload.extend(data[3:3 + got])
        return decode_definition(payload)

    def fragment_state(self, command):
        if command not in (0x18, 0x19):
            raise ValueError("Not a fragment read")
        data = self._read(command)
        if data[0] > 21:
            raise ProtocolError("Invalid fragment state count")
        return tuple(data[1:1 + data[0]])

    def keymap(self):
        count = self._read(0x11, protocol=0xFE)[0]
        if not 1 <= count <= 32:
            raise ProtocolError("Board layer count must be 1–32")
        size = count * 10 * 6 * 2
        raw = bytearray()
        while len(raw) < size:
            amount = min(self.chunk_size(), size - len(raw))
            args = len(raw).to_bytes(2, "big") + bytes((amount,))
            data = self._read(0x12, args, protocol=0xFE)
            raw.extend(data[3:3 + amount])
        return count, bytes(raw)

    def labels(self, kind, limit):
        """Read sparse v2/v3 UTF-8 labels, requiring strictly advancing indices."""
        labels = {}
        start = 0
        while start < limit:
            data = self._read(0x1B, bytes((kind,)) + start.to_bytes(2, "little"))
            found, index = data[1], int.from_bytes(data[2:4], "little")
            if found not in (0, 1):
                raise ProtocolError("Invalid label lookup response")
            if not found:
                break
            if not start <= index < limit:
                raise ProtocolError("Invalid label lookup index")
            try:
                label = data[4:20].split(b"\0", 1)[0].decode("utf-8")
            except UnicodeError as exc:
                raise ProtocolError("Invalid UTF-8 board label") from exc
            labels[index] = "".join(c for c in label if c.isprintable())
            start = index + 1
        return labels

    def read_profile(self, uid, progress=lambda message: None, reuse_definition=False):
        """Publishable only after all reads succeed; no partial layout escapes.

        reuse_definition skips re-reading the board definition (about a third of the
        transfer) when one was read on this connection; everything else is read again.
        """
        self.load_deadline = self.clock() + 60
        try:
            if reuse_definition and self.cached_definition is not None:
                definition = self.cached_definition
            else:
                progress("Reading board definition…")
                definition = self.cached_definition = self.definition()
            has_fragments = "fragments" in definition or "fragment_schema_version" in definition
            hardware = self.fragment_state(0x18) if has_fragments else ()
            selections = self.fragment_state(0x19) if has_fragments else ()
            keys = geometry_from_definition(definition, hardware, selections)
            progress("Reading keymap from board…")
            previous = self.keymap()
            for _ in range(3):
                self.checkpoint()
                current = self.keymap()
                if current == previous:
                    break
                previous = current
            else:
                raise ProtocolError("Keymap changed during loading; finish editing and reload")
            count, raw = current
            layers = [[[int.from_bytes(raw[2 * ((layer * 10 + row) * 6 + col):
                                           2 * ((layer * 10 + row) * 6 + col) + 2], "big")
                        for col in range(6)] for row in range(10)] for layer in range(count)]
            name = definition.get("name", "Svalboard")
            if not isinstance(name, str) or not name or len(name) > 128 or not name.isprintable():
                name = "Svalboard"
            profile = Profile.parse({"uid": uid, "layout": layers}, name + " · board")
            progress("Reading layer and behavior labels…")
            layer_names = self.labels(0, count)
            td_names = self.labels(1, 256)
            macro_names = self.labels(2, 256)
            code_labels = {}
            custom = definition.get("customKeycodes", [])
            if not isinstance(custom, list) or len(custom) > 64:
                raise ValueError("Invalid custom keycode definitions")
            for index, item in enumerate(custom):
                if not isinstance(item, dict):
                    raise ValueError("Invalid custom keycode definition")
                label = item.get("shortName") or item.get("name")
                if not isinstance(label, str) or not 1 <= len(label) <= 128 or any(not c.isprintable() and c != "\n" for c in label):
                    raise ValueError("Invalid custom keycode label")
                code_labels[0x7E00 + index] = label
                if index < 32:
                    code_labels[0x7E40 + index] = label
            used_codes = {code for layer in layers for row in layer for code in row}
            for code in sorted(used_codes):
                if 0x5700 <= code <= 0x57FF:
                    index = code - 0x5700
                    data = self._read(0x01, index.to_bytes(2, "little"))
                    values = [int.from_bytes(data[i:i + 2], "little") for i in (2, 4, 6, 8)]
                    # Keep TD references explicit to avoid recursive definitions.
                    actions = [f"{name}: {legend(value)}" for name, value in zip(
                        ("tap", "hold", "double", "tap-hold"), values) if value]
                    title = td_names.get(index, f"TD({index})")
                    code_labels[code] = title + ("\n" + " / ".join(actions) if actions else "")
                index = code - 0x7700 if 0x7700 <= code <= 0x777F else code - 0x7680 + 128
                if (0x7700 <= code <= 0x777F or 0x7680 <= code <= 0x76FF) and index in macro_names:
                    code_labels[code] = f"Macro {index}\n{macro_names[index]}"
            # Recheck identity and geometry selection around the transfer.
            if self.info()[1] != uid:
                raise ProtocolError("Board identity changed during loading")
            if has_fragments:
                keyless = keyless_instances(definition)
                def keyed(state):
                    return tuple(v for i, v in enumerate(state) if i not in keyless)
                if (keyed(hardware) != keyed(self.fragment_state(0x18))
                        or keyed(selections) != keyed(self.fragment_state(0x19))):
                    raise ProtocolError("Cluster selection changed during loading; reload")
            return replace(profile, keys=keys, layer_names=tuple(layer_names.items()),
                           code_labels=tuple(code_labels.items()), from_board=True)
        finally:
            self.load_deadline = None
