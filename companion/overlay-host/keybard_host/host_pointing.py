"""Pointing devices in the overlay: the multiplier labels, the badge beside the
mouse cursor, and a scripted demo for review without a board.

The board's POINTING_MOTION (0x2D) says whether sniper or boost is on, not by how
much, so the factor comes from the keymap (Keybard's src/utils/pointing-multiplier.ts
does the same): SV_SNIPER_2/3/5 and their _TG forms divide by 2, 3 or 5, SV_BOOST_2/3/5
multiply. One factor in the keymap is shown; otherwise sniper x0.33 and boost x2.
"""
import math

QK_USER_0 = 0x7E40
SNIPER = {12: 2, 13: 3, 14: 5, 21: 2, 22: 3, 23: 5}
BOOST = {24: 2, 25: 3, 26: 5, 27: 2, 28: 3, 29: 5}


def factors(layers):
    """(sniper divisor, boost factor) used by the keymap's keys."""
    sniper, boost = set(), set()
    for layer in layers or ():
        for row in layer:
            for code in row:
                n = code - QK_USER_0
                if n in SNIPER: sniper.add(SNIPER[n])
                if n in BOOST: boost.add(BOOST[n])
    return (next(iter(sniper)) if len(sniper) == 1 else 3, next(iter(boost)) if len(boost) == 1 else 2)


def multiplier_text(sniper, boost, divisor=3, factor=2):
    """'×0.33', '×2', '×0.33 ×2' or '' for the modes that are on."""
    parts = []
    if sniper: parts.append(f'×{round(100 / divisor) / 100:g}')
    if boost: parts.append(f'×{factor}')
    return ' '.join(parts)


def demo_motion(t, dt):
    """A scripted POINTING_MOTION dict: the right trackball rolls, sniper on (as parsed from 0x2D)."""
    u = t % 8
    env = min(1, max(0, (u - .7) / .7)) * (1 - min(1, max(0, (u - 5.6) / 1.0)))
    vx = 1.25 * (math.sin(.9 * t) + .55 * math.sin(2.1 * t + 1)) * env
    vy = 1.25 * (math.cos(.7 * t + .3) + .45 * math.sin(1.7 * t)) * env
    counts = dt * 22 * 800 / 25.4
    still = dict(valid=True, scrolling=False, touchValid=False, fingers=0, dx=0, dy=0, touchX=0, touchY=0)
    return dict(sniper=True, boost=False, elapsedMs=int(dt * 1000), left=dict(still),
                right=dict(still, dx=int(round(vx * counts)), dy=int(round(vy * counts))))


try:
    from PySide6.QtCore import Qt, QTimer
    from PySide6.QtGui import QCursor, QColor, QFont, QPainter
    from PySide6.QtWidgets import QWidget

    class CursorBadge(QWidget):
        """The multiplier beside the mouse cursor while sniper or boost is on: a small,
        click-through, always-on-top label that follows the cursor (a Host setting, off by default)."""

        def __init__(self):
            super().__init__(None, Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.WindowDoesNotAcceptFocus | Qt.WindowTransparentForInput)
            self.setWindowTitle('Keybard · Pointer multiplier')
            self.setAttribute(Qt.WA_TranslucentBackground)
            self.setAttribute(Qt.WA_ShowWithoutActivating)
            self.setAttribute(Qt.WA_TransparentForMouseEvents)
            self.text = ''
            self.font_ = QFont('Consolas', 9); self.font_.setBold(True); self.setFont(self.font_)
            self.timer = QTimer(self); self.timer.timeout.connect(self.follow)

        def set_text(self, text):
            if text == self.text and self.isVisible() == bool(text): return
            self.text = text
            if not text:
                self.timer.stop(); self.hide(); return
            width = self.fontMetrics().horizontalAdvance(text) + 18
            self.setFixedSize(max(36, width), 20)
            self.follow(); self.show(); self.update()
            if not self.timer.isActive(): self.timer.start(16)

        def follow(self):
            pos = QCursor.pos()
            self.move(pos.x() + 16, pos.y() + 20)

        def paintEvent(self, event):
            p = QPainter(self)
            p.setRenderHint(QPainter.Antialiasing)
            p.setPen(Qt.NoPen); p.setBrush(QColor(255, 255, 255, 240))
            p.drawRoundedRect(self.rect().adjusted(0, 0, -1, -1), 9, 9)
            p.setPen(QColor('#111214')); p.setFont(self.font_)
            p.drawText(self.rect(), Qt.AlignCenter, self.text)
            p.end()
except ImportError:  # tests without Qt
    CursorBadge = None
