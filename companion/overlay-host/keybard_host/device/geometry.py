"""Svalboard key positions in key units, as Keybard's editor draws them.

The overlay must match Keybard's layout, so this follows Keybard exactly:
- a board whose definition has fragment KLE is composed like Keybard's
  FragmentComposerService (fragment KLE + placement, then the thumb clusters
  centered under the index clusters);
- anything else (the demo, layout files, older definitions) uses Keybard's
  bundled default layout, which is that composition with five-key fingers.
tests/test_keybard_layout.py checks both against layouts Keybard itself
produced (tests/fixtures/keybard-layouts.json, written by Keybard's
tests/trainer/host-overlay-layout.test.ts), so the two can't drift apart.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Key:
    row: int
    col: int
    x: float
    y: float
    cluster: str
    direction: str
    w: float = 1.0
    h: float = 1.0

    @property
    def hand(self):
        return "Left" if self.row < 5 else "Right"


CLUSTERS = {0: "Thumb", 5: "Thumb", 1: "Index", 6: "Index", 2: "Middle", 7: "Middle",
            3: "Ring", 8: "Ring", 4: "Pinky", 9: "Pinky"}
# Finger columns: south, east, center, north, west, then the second south.
DIRECTIONS = ["south", "east", "center", "north", "west", "second south"]


def _direction(row, col):
    return f"{col + 1}" if row in (0, 5) else DIRECTIONS[col]


# Keybard's bundled default layout (src/default-layouts/sval-default.svil): five-key
# finger clusters and the two thumb clusters, as the firmware definition places them.
FINGER_5 = [[{"x": 1}, "N"], ["W", "C", "E"], [{"x": 1}, "S"]]
THUMB_LEFT = [[{"w": 1.5}, "T1", "T2", {"w": 1.5}, "T3"], [{"x": -0.5, "w": 2}, "T4", "T5", {"w": 1.5}, "T6"]]
THUMB_RIGHT = [[{"w": 1.5}, "T1", "T2", {"w": 1.5}, "T3"], [{"w": 1.5}, "T4", "T5", {"w": 2}, "T6"]]
FINGER_ORDER = (3, 4, 2, 1, 0)  # N, W, C, E, S -> matrix columns
THUMB_LEFT_ORDER = (3, 5, 1, 4, 2, 0)  # T1..T6 -> matrix columns
THUMB_RIGHT_ORDER = (1, 5, 3, 0, 2, 4)
DEFAULT_FRAGMENTS = (
    [(FINGER_5, {"x": x, "y": y}, [[row, c] for c in FINGER_ORDER]) for row, x, y in
     [(4, 0, 1.5), (3, 2.5, 0), (2, 6, 0), (1, 8.5, 1.5), (6, 13.5, 1.5), (7, 16, 0), (8, 19.5, 0), (9, 22, 1.5)]]
    + [(THUMB_LEFT, {"x": 8, "y": 7}, [[0, c] for c in THUMB_LEFT_ORDER]),
       (THUMB_RIGHT, {"x": 13, "y": 7}, [[5, c] for c in THUMB_RIGHT_ORDER])])


def keys():
    return compose(DEFAULT_FRAGMENTS)


def keys_for_positions(positions):
    """The default layout, for fragment definitions without KLE: second souths below
    the souths and, when there are any, the thumbs one row lower (as composing does)."""
    from dataclasses import replace
    positions = set(positions)
    extra_fingers = any(row not in (0, 5) and col == 5 for row, col in positions)
    available = {(k.row, k.col): k for k in KEYS}
    for row in range(10):
        if row not in (0, 5):
            south = available[row, 0]
            available[row, 5] = replace(south, col=5, y=south.y + 1, direction="second south")
    selected = []
    for position in sorted(positions):
        key = available[position]
        if extra_fingers and key.row in (0, 5):
            key = replace(key, y=key.y + 1)
        selected.append(key)
    if not selected:
        raise ValueError("Board definition has no populated key positions")
    return tuple(selected)


def _number(value):
    if type(value) not in (int, float):
        raise ValueError("Unsupported fragment KLE value")
    return float(value)


def kle_keys(kle):
    """Key rectangles (x, y, w, h) of a KLE layout, in order, as Keybard's KleService
    deserializes them. Only position and size are read; rotation is not supported."""
    if not isinstance(kle, list):
        raise ValueError("Fragment KLE must be a list")
    out = []
    y = 0.0
    for row in kle:
        if not isinstance(row, list):
            continue  # metadata
        x, w, h = 0.0, 1.0, 1.0
        for item in row:
            if isinstance(item, str):
                out.append((x, y, w, h))
                x += w
                w = h = 1.0
            elif isinstance(item, dict):
                if any(item.get(k) for k in ("r", "rx", "ry")):
                    raise ValueError("Rotated fragment KLE is not supported")
                if item.get("x"): x += _number(item["x"])
                if item.get("y"): y += _number(item["y"])
                if item.get("w"): w = _number(item["w"])
                if item.get("h"): h = _number(item["h"])
            else:
                raise ValueError("Invalid fragment KLE item")
        y += 1
    return out


def compose(selected):
    """Keybard's composed layout for the chosen fragments.

    selected: (kle, placement, matrix_map) per keyed instance. Returns Keys; the
    thumb clusters (rows 0 and 5) get Keybard's placement corrections.
    """
    raw = {}
    for kle, placement, matrix_map in selected:
        if not isinstance(placement, dict):
            raise ValueError("Missing fragment placement")
        px, py = _number(placement.get("x", 0)), _number(placement.get("y", 0))
        for (x, y, w, h), (row, col) in zip(kle_keys(kle), matrix_map):
            raw[row, col] = [x + px, y + py, w, h]
    by_row = {}
    for (row, col), k in raw.items():
        by_row.setdefault(row, []).append(k)

    def edge(row, f, pick, empty):
        values = [f(k) for k in by_row.get(row, [])]
        return pick(values) if values else empty

    # FragmentComposerService.computeThumbCorrections, step for step.
    left_index_right = max(0, edge(1, lambda k: k[0] + k[2], max, 0))
    right_index_left = edge(6, lambda k: k[0], min, float("inf"))
    midline = (left_index_right + right_index_left) / 2
    left_thumb_right = max(0, edge(0, lambda k: k[0] + k[2], max, 0))
    right_thumb_left = edge(5, lambda k: k[0], min, float("inf"))
    gap_x = 0.4
    shift = {0: midline - gap_x / 2 - left_thumb_right, 5: midline + gap_x / 2 - right_thumb_left}
    index_bottom = max(max(0, edge(1, lambda k: k[1] + k[3], max, 0)), max(0, edge(6, lambda k: k[1] + k[3], max, 0)))
    thumb_top = min(edge(0, lambda k: k[1], min, float("inf")), edge(5, lambda k: k[1], min, float("inf")))
    gap_y = 1.0  # 1.0 + FRAGMENT_THUMB_GAP_REDUCTION_U (0)
    shift_y = index_bottom + gap_y - thumb_top
    finite = lambda n: n if n not in (float("inf"), float("-inf")) and n == n else 0.0
    result = []
    for (row, col), (x, y, w, h) in sorted(raw.items()):
        if row in (0, 5):
            x, y = x + finite(shift[row]), y + finite(shift_y)
        result.append(Key(row, col, x, y, CLUSTERS[row], _direction(row, col), w, h))
    if not result:
        raise ValueError("Board definition has no populated key positions")
    return tuple(result)


KEYS = keys()
