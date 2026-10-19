"""Validated layout snapshots and QMK layer resolution; independent of UI/HID."""
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
from .geometry import KEYS

TRANSPARENT = {1, "KC_TRNS", "KC_TRANSPARENT", "_______"}
DISABLED = {0, "KC_NO", "XXXXXXX"}
MAX_FILE_BYTES = 4 * 1024 * 1024


@dataclass(frozen=True)
class Profile:
    name: str
    uid: int | None
    layers: tuple
    fingerprint: str
    demo: bool = False
    keys: tuple = KEYS
    layer_names: tuple = ()
    code_labels: tuple = ()
    from_board: bool = False
    # Each hand's pointing module, (('left', 'trackball'), ('right', None)), when the board reports it.
    pointing: tuple = ()

    def label(self, code):
        return dict(self.code_labels).get(code, legend(code))

    def layer_name(self, index):
        return dict(self.layer_names).get(index, f"Layer {index}")

    @classmethod
    def parse(cls, data: object, name: str = "Imported layout"):
        if not isinstance(data, dict):
            raise ValueError("Expected a Svalboard .svil/.vil JSON object")
        layers = data.get("layout")
        if not isinstance(layers, list) or not 1 <= len(layers) <= 32:
            raise ValueError("Layout must contain 1–32 layers")
        for layer in layers:
            if not isinstance(layer, list) or len(layer) != 10:
                raise ValueError("Svalboard layouts must have 10 matrix rows per layer")
            for row in layer:
                if not isinstance(row, list) or len(row) != 6:
                    raise ValueError("Svalboard layouts must have 6 columns per row")
                for code in row:
                    if type(code) is int and 0 <= code <= 65535:
                        continue
                    if isinstance(code, str) and 1 <= len(code) <= 96 and all(c.isprintable() for c in code):
                        continue
                    raise ValueError("Keycodes must be 16-bit integers or short printable strings")
        uid = data.get("uid")
        if uid is not None:
            if isinstance(uid, str):
                if not re.fullmatch(r"(?:0x[0-9a-fA-F]+|[0-9]+)", uid):
                    raise ValueError("UID must be a decimal integer or a 0x-prefixed hex string")
                uid = int(uid, 16 if uid.startswith("0x") else 10)
            if type(uid) is not int or not 0 <= uid < 2**64:
                raise ValueError("UID must be an unsigned 64-bit integer")
        frozen = tuple(tuple(tuple(row) for row in layer) for layer in layers)
        digest = hashlib.sha256(json.dumps(layers, separators=(",", ":")).encode()).hexdigest()
        return cls(name, uid, frozen, digest)

    @classmethod
    def load(cls, path):
        path = Path(path)
        with path.open("rb") as stream:
            raw = stream.read(MAX_FILE_BYTES + 1)
        if len(raw) > MAX_FILE_BYTES:
            raise ValueError("Layout file exceeds 4 MiB")
        try:
            data = json.loads(raw)
        except (ValueError, UnicodeError, RecursionError) as exc:
            raise ValueError("Layout is not valid JSON") from exc
        return cls.parse(data, path.stem)

    def resolve(self, row: int, col: int, active: int, default: int = 1):
        """Return (binding, source layer). Unknown active layers invalidate the view."""
        mask = active | default
        if not 0 <= mask < 2**len(self.layers):
            raise ValueError("Device reports a layer missing from this layout snapshot")
        for layer in range(len(self.layers) - 1, -1, -1):
            if mask & (1 << layer):
                code = self.layers[layer][row][col]
                if code not in TRANSPARENT:
                    return code, layer
        # QMK falls back to layer zero even with an empty default mask.
        return self.layers[0][row][col], 0


# QMK keycodes (the Sval v2/v3 numbering numeric_legend reads) for the names demo_profile uses.
_DEMO_CODES = {"KC_NO": 0, "KC_TRNS": 1, "KC_ENTER": 40, "KC_ESC": 41, "KC_BSPC": 42, "KC_TAB": 43,
               "KC_SPACE": 44, "KC_;": 51, "KC_/": 56, "KC_CAPS": 57, "KC_HOME": 74, "KC_PGUP": 75,
               "KC_DELETE": 76, "KC_END": 77, "KC_PGDN": 78, "KC_RIGHT": 79, "KC_LEFT": 80,
               "KC_DOWN": 81, "KC_UP": 82, "KC_LCTRL": 0xE0, "KC_LSHIFT": 0xE1, "KC_LALT": 0xE2,
               "KC_RGUI": 0xE7, "LT(1,KC_ENTER)": 0x4000 | 1 << 8 | 40, "MO(1)": 0x5221, "MO(2)": 0x5222}
_DEMO_CODES.update({f"KC_{c}": 4 + i for i, c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ")})
_DEMO_CODES.update({f"KC_{c}": 30 + i for i, c in enumerate("1234567890")})


def demo_code(name):
    return _DEMO_CODES[name]


def demo_profile():
    """Purpose-built illustration; deliberately not a factory Svalboard keymap."""
    base = [["KC_NO"] * 6 for _ in range(10)]
    for row, letters in zip((4, 3, 2, 1, 6, 7, 8, 9),
                            ("ZAQX1", "XSWD2", "CDE F".replace(" ", "") + "3", "VFRG4",
                             "MHUJ5", "KJIK6", "LOOL7", "P;P/8")):
        base[row][:5] = ["KC_" + c for c in letters]
    base[0] = ["KC_LCTRL", "KC_TAB", "KC_LSHIFT", "LT(1,KC_ENTER)", "KC_ESC", "KC_CAPS"]
    base[5] = ["KC_LALT", "KC_BSPC", "MO(1)", "KC_SPACE", "MO(2)", "KC_RGUI"]
    nav = [["KC_TRNS"] * 6 for _ in range(10)]
    nav[6][:5] = ["KC_DOWN", "KC_RIGHT", "KC_HOME", "KC_UP", "KC_LEFT"]
    nav[7][:5] = ["KC_PGDN", "KC_END", "KC_DELETE", "KC_PGUP", "KC_BSPC"]
    numbers = [["KC_TRNS"] * 6 for _ in range(10)]
    for row in (1, 2, 3, 4):
        numbers[row][:5] = ["KC_" + str((row + col) % 10) for col in range(5)]
    # Boards report numeric keycodes, and Keybard's renderer names numbers only: a name
    # string here would be drawn raw ("0xKC_D"). Encode the illustration the same way.
    layers = [[[demo_code(code) for code in row] for row in layer] for layer in (base, nav, numbers)]
    profile = Profile.parse({"layout": layers}, "Illustration · not your keymap")
    return Profile(profile.name, None, profile.layers, profile.fingerprint, True)


_NAMES = {
    "SPACE": "Space", "ENTER": "Enter", "ENT": "Enter", "ESCAPE": "Esc", "ESC": "Esc",
    "BSPACE": "Bksp", "BSPC": "Bksp", "TAB": "Tab", "DELETE": "Del", "DEL": "Del",
    "LEFT": "←", "RIGHT": "→", "UP": "↑", "DOWN": "↓", "HOME": "Home", "END": "End",
    "PGDOWN": "PgDn", "PGDN": "PgDn", "PGUP": "PgUp", "CAPSLOCK": "Caps", "CAPS": "Caps",
    "LCTRL": "Ctrl", "LCTL": "Ctrl", "RCTRL": "Ctrl", "RCTL": "Ctrl",
    "LSHIFT": "Shift", "LSFT": "Shift", "RSHIFT": "Shift", "RSFT": "Shift",
    "LALT": "Alt", "RALT": "Alt", "LGUI": "GUI", "RGUI": "GUI",
    "MINUS": "−", "EQUAL": "=", "LBRACKET": "[", "RBRACKET": "]", "BSLASH": "\\",
    "SCOLON": ";", "QUOTE": "'", "GRAVE": "`", "COMMA": ",", "DOT": ".", "SLASH": "/",
    "DQUO": '"', "COLN": ":", "EXLM": "!", "AT": "@", "HASH": "#", "DLR": "$",
    "PERC": "%", "CIRC": "^", "AMPR": "&", "ASTR": "*", "PLUS": "+",
}
_BASIC = dict(zip(range(4, 30), "ABCDEFGHIJKLMNOPQRSTUVWXYZ"))
_BASIC.update(dict(zip(range(30, 40), "1234567890")))
_BASIC.update({40: "Enter", 41: "Esc", 42: "Bksp", 43: "Tab", 44: "Space",
               79: "→", 80: "←", 81: "↓", 82: "↑"})


def legend(code):
    if code in TRANSPARENT:
        return "▽"
    if code in DISABLED:
        return "—"
    if type(code) is int:
        return numeric_legend(code)
    if code.startswith("KC_"):
        return _NAMES.get(code[3:], code[3:])
    match = re.fullmatch(r"LT\((\d+),\s*(.+)\)|LT(\d+)\((.+)\)", code)
    if match:
        layer, tap = (match[1], match[2]) if match[1] else (match[3], match[4])
        return f"{legend(tap)}\nL{layer} hold"
    match = re.fullmatch(r"([LR](?:CTL|CTRL|SFT|SHIFT|ALT|GUI))_T\((.+)\)", code)
    if match:
        return f"{legend(match[2])}\n{_NAMES.get(match[1], match[1])} hold"
    return code  # Unknown behavior stays explicit; never guess its output.


# QMK keycode encoding used by the supported Sval v2/v3 firmware family.
# Preserve unknown values as hex instead of guessing custom behaviors.
def numeric_legend(code):
    if code in _BASIC:
        return _BASIC[code]
    basic = {
        45: "−", 46: "=", 47: "[", 48: "]", 49: "\\", 50: "#",
        51: ";", 52: "'", 53: "`", 54: ",", 55: ".", 56: "/", 57: "Caps",
        70: "PrtSc", 71: "Scroll", 72: "Pause", 73: "Ins", 74: "Home",
        75: "PgUp", 76: "Del", 77: "End", 78: "PgDn", 83: "NumLk",
        84: "KP /", 85: "KP *", 86: "KP −", 87: "KP +", 88: "KP Enter",
        98: "KP 0", 99: "KP .", 101: "Menu", 103: "KP =",
        0xE0: "Ctrl", 0xE1: "Shift", 0xE2: "Alt", 0xE3: "GUI",
        0xE4: "R Ctrl", 0xE5: "R Shift", 0xE6: "R Alt", 0xE7: "R GUI",
    }
    if code in basic:
        return basic[code]
    if 58 <= code <= 69:
        return f"F{code - 57}"
    if 104 <= code <= 115:
        return f"F{code - 91}"
    if 89 <= code <= 97:
        return f"KP {code - 88}"
    if 0x0100 <= code <= 0x1FFF:
        return modifiers(code >> 8) + "+" + legend(code & 255)
    if 0x2000 <= code <= 0x3FFF:
        return f"{legend(code & 255)}\n{modifiers((code >> 8) & 31)} hold"
    if 0x4000 <= code <= 0x4FFF:
        return f"{legend(code & 255)}\nL{(code >> 8) & 15} hold"
    for start, name in ((0x5200, "TO"), (0x5220, "MO"), (0x5240, "DF"),
                        (0x5260, "TG"), (0x5280, "OSL"), (0x52C0, "TT")):
        if start <= code <= start + 31:
            return f"{name}({code - start})"
    if 0x52A0 <= code <= 0x52BF:
        return "OSM " + modifiers(code & 31)
    if 0x5700 <= code <= 0x57FF:
        return f"TD({code - 0x5700})"
    if 0x7700 <= code <= 0x777F:
        return f"Macro {code - 0x7700}"
    if 0x7680 <= code <= 0x76FF:
        return f"Macro {code - 0x7680 + 128}"
    return f"0x{code:04X}"


def modifiers(bits):
    side = "R " if bits & 16 else ""
    return "+".join(side + name for bit, name in ((1, "Ctrl"), (2, "Shift"), (4, "Alt"), (8, "GUI")) if bits & bit) or "None"
