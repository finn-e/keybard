"""Every connected Svalboard at once, and which one the overlay shows.

The overlay reads every Svalboard on the computer: each board's layout, layer,
held keys and pointing motion. It shows one board's keys at a time, chosen like
this (Follower.choose):

* The board in use is shown. Using a board means a held key, or pointing or
  touch motion (MOTION_COUNTS or more counts in one read, or a finger on a pad).
* No flicker: the overlay moves to another board only while that board is in
  use and the shown board has been idle for QUIET seconds. Using two boards at
  once keeps the one already shown.
* Boards with keys come first. A board whose keymap is blank (a pointing tester
  with no keys) is shown only when no board with keys is connected.
* A keyless board's touchpads or trackballs are drawn in the shown layout while
  it's in use: its devices take the place of the shown board's on their hands,
  with its motion and touches, and the shown board's keys keep showing. They go
  back LEND_HOLD seconds after its last motion, or as soon as the shown board's
  own pointing device moves. So typing on one board while touching a pad tester
  shows the typing board's held keys and the tester's touches together.
* Before any board is used, the board shown last time is preferred (the
  preferences' "remembered" board), then the first board ready.
* "Show this board only" pins one board (by serial): only it is shown, with no
  borrowed devices, and the overlay waits while it's unplugged.
"""
from dataclasses import dataclass, field
import hashlib
from .device.model import DISABLED, TRANSPARENT

QUIET = 1.0
LEND_HOLD = 3.0
MOTION_COUNTS = 3


def device_keys(devices):
    """A stable id for each enumerated board: from its USB serial, so it survives
    a firmware update re-enumerating the board, else from its HID path."""
    serials = [d.get('serial_number') for d in devices]
    out = {}
    for d in devices:
        serial = d.get('serial_number')
        if serial and serials.count(serial) == 1:
            source = b'serial:' + serial.encode('utf-8', 'replace')
        else:
            path = d['path']
            source = b'path:' + (path if isinstance(path, bytes) else str(path).encode())
        out[hashlib.sha256(source).hexdigest()[:20]] = d
    return out


def has_keys(board):
    """Whether a serialized board has any key assigned on any layer (not blank, KC_NO or KC_TRNS)."""
    if not board or not board.get('keylayout'): return False
    return any(code not in DISABLED and code not in TRANSPARENT for layer in board.get('keymap') or () for code in layer)


def kinds(board):
    """Each hand's pointing module from a serialized board: {'left': 'touchpad', ...} without the empty hands."""
    return {side: kind for side, kind in ((board or {}).get('pointing') or {}).items() if kind}


def motion_used(motion):
    """Whether a POINTING_MOTION read shows someone using a device: real movement, or a finger on a pad."""
    if not motion: return False
    for side in ('left', 'right'):
        hand = motion.get(side) or {}
        if abs(hand.get('dx', 0)) + abs(hand.get('dy', 0)) >= MOTION_COUNTS or hand.get('contacts'):
            return True
    return False


@dataclass(eq=False)
class Board:
    """One connected board, as the overlay knows it."""
    key: str
    device: dict
    order: int = 0
    worker: object = None
    board: dict | None = None      # the serialized profile; None until the first read
    ready: bool = False            # profile read and still connected
    loading: bool = False          # reading its layout again (Reload)
    active: int = 0
    default: int | None = None
    valid: bool = False
    pressed: list = field(default_factory=list)
    matrix_available: bool | None = None
    modifiers: dict | None = None
    status: str = 'Connecting…'
    last_state: float = 0.0
    last_press: float = 0.0
    used: float = 0.0              # last held key or pointing motion
    moved: float = 0.0             # last pointing motion
    generation: int = 0
    revision: int = 0              # bumped with each profile read

    @property
    def serial(self): return self.device.get('serial_number') or ''

    @property
    def name(self): return self.device.get('product_string') or (self.board or {}).get('name') or 'Svalboard'

    @property
    def keyed(self): return has_keys(self.board)

    def summary(self):
        return dict(id=self.key, name=self.name, serial=self.serial, status=self.status, ready=self.ready,
                    keys=self.keyed, pointing=kinds(self.board))


class Follower:
    """Picks the board the overlay shows, and a keyless board whose devices it borrows."""

    def __init__(self, preferred=None, pinned=None):
        self.preferred = preferred   # serial shown before any board is used
        self.pinned = pinned         # serial (or id) of the one board to show, or None
        self.shown = None
        self.lender = None

    def pinned_board(self, boards):
        return next((b for b in boards.values() if self.pinned in (b.serial, b.key)), None)

    def choose(self, boards, now):
        """Update and return (shown id, lender id) for the boards {id: Board}."""
        ready = [b for b in sorted(boards.values(), key=lambda b: b.order) if b.ready and b.board is not None]
        if self.pinned is not None:
            board = self.pinned_board(boards)
            self.shown = board.key if board is not None and board in ready else None
            self.lender = None
            return self.shown, self.lender
        candidates = [b for b in ready if b.keyed] or ready
        current = boards.get(self.shown)
        if current not in candidates:
            current = None
        if current is None or not any(b.used for b in candidates):
            # Nothing used yet: the board shown last time, then the first one ready.
            preferred = next((b for b in candidates if self.preferred and b.serial == self.preferred), None)
            if current is None or (preferred is not None and not current.used):
                current = max(candidates, key=lambda b: (b.used, b is preferred, -b.order), default=None)
        else:
            challenger = max((b for b in candidates if b is not current), key=lambda b: b.used, default=None)
            if challenger is not None and now - challenger.used < QUIET and now - current.used >= QUIET:
                current = challenger
        self.shown = current.key if current is not None else None
        self.lender = self.choose_lender(current, ready, now)
        return self.shown, self.lender

    def choose_lender(self, shown, ready, now):
        if shown is None or not shown.keyed:
            return None
        lenders = [b for b in ready if b is not shown and not b.keyed and kinds(b.board)]
        lender = next((b for b in lenders if b.key == self.lender), None)
        if lender is not None:
            # Kept while in use; handed back when idle, or when the shown board's own device moves.
            if now - lender.moved < LEND_HOLD and not (shown.moved > lender.moved and now - lender.moved >= QUIET):
                return lender.key
            lender = None
        recent = [b for b in lenders if b.moved and now - b.moved < QUIET]
        if recent and now - shown.moved >= QUIET:
            return max(recent, key=lambda b: b.moved).key
        return None


def composite(shown, lender):
    """The board the overlay draws: the shown board, with the lender's devices on the lender's hands."""
    if shown is None or shown.board is None: return None
    board = dict(shown.board)
    if lender is not None and lender.board is not None:
        pointing = dict(board.get('pointing') or {})
        pointing.update(kinds(lender.board))
        board['pointing'] = pointing
    return board


def lent_sides(lender):
    """The hands whose devices come from the lender."""
    return tuple(side for side in ('left', 'right') if side in kinds(lender.board)) if lender is not None else ()
