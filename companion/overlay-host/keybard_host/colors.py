"""The overlay's color setup: a small panel opened from the overlay and tray menus.

Every change applies at once through set_appearance; the overlay redraws live.
"""
from PySide6.QtCore import Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (QButtonGroup, QCheckBox, QColorDialog, QGridLayout, QHBoxLayout, QLabel,
                               QPushButton, QSlider, QWidget)

# (appearance key, label, opacity key or None)
ROWS = (('fill', 'Key fill', 'fillAlpha'), ('outline', 'Outline', 'outlineAlpha'), ('legend', 'Legend', 'legendAlpha'),
        ('changed', 'Layer change', None), ('pressed', 'Held keys', None))


class ColorsPanel(QWidget):
    def __init__(self, get_appearance, set_appearance, defaults, parent=None):
        super().__init__(parent, Qt.Tool | Qt.WindowStaysOnTopHint)
        self.setWindowTitle('Overlay colors')
        self.get_appearance, self.set_appearance, self.defaults = get_appearance, set_appearance, defaults
        grid = QGridLayout(self); grid.setHorizontalSpacing(10); grid.setVerticalSpacing(8); grid.setContentsMargins(14, 14, 14, 14)
        self.swatches, self.sliders, self.readouts = {}, {}, {}
        self.shown = None
        for row, (key, label, alpha) in enumerate(ROWS):
            grid.addWidget(QLabel(label), row, 0)
            swatch = QPushButton(); swatch.setFixedSize(28, 22); swatch.setAccessibleName(f'{label} color')
            swatch.clicked.connect(lambda _checked=False, k=key, l=label: self.pick(k, l))
            grid.addWidget(swatch, row, 1); self.swatches[key] = swatch
            if alpha:
                slider = QSlider(Qt.Horizontal); slider.setRange(0, 10); slider.setPageStep(1); slider.setMinimumWidth(140)
                slider.setAccessibleName(f'{label} opacity')
                slider.valueChanged.connect(lambda value, a=alpha: self.change(**{a: value * 10}))
                readout = QLabel(); readout.setMinimumWidth(36); readout.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
                grid.addWidget(slider, row, 2); grid.addWidget(readout, row, 3)
                self.sliders[alpha], self.readouts[alpha] = slider, readout
        row = len(ROWS)
        grid.addWidget(QLabel('Outline width'), row, 0)
        widths = QHBoxLayout(); widths.setSpacing(2); self.widths = QButtonGroup(self)
        for width in range(5):
            button = QPushButton(str(width)); button.setCheckable(True); button.setFixedWidth(30)
            button.setToolTip(f'{width} px' if width else 'No outline')
            self.widths.addButton(button, width); widths.addWidget(button)
        widths.addStretch()
        self.widths.idClicked.connect(lambda width: self.change(width=width))
        grid.addLayout(widths, row, 1, 1, 3)
        self.halo = QCheckBox('Outline shadow')
        self.halo.setToolTip('A contrasting shadow around legends and key outlines, readable on any background')
        self.halo.toggled.connect(lambda value: self.change(halo=value))
        grid.addWidget(self.halo, row + 1, 0, 1, 4)
        reset = QPushButton('Reset to default look'); reset.clicked.connect(lambda: self.set_appearance(dict(self.defaults)))
        grid.addWidget(reset, row + 2, 0, 1, 4)
        self.refresh()

    def change(self, **fields):
        current = self.get_appearance()
        if any(current.get(k) != v for k, v in fields.items()):
            self.set_appearance(dict(current, **fields))

    def pick(self, key, label):
        color = QColorDialog.getColor(QColor(self.get_appearance()[key]), self, label)
        if color.isValid(): self.change(**{key: color.name()})

    def refresh(self):
        """Show the current settings, however they changed, without echoing them back."""
        a = self.get_appearance()
        if a == self.shown: return
        self.shown = a
        for key, swatch in self.swatches.items():
            swatch.setStyleSheet(f'background:{a[key]};border:1px solid #888;border-radius:3px')
            swatch.setToolTip(a[key])
        for alpha, slider in self.sliders.items():
            slider.blockSignals(True); slider.setValue(round(a[alpha] / 10)); slider.blockSignals(False)
            self.readouts[alpha].setText(f'{a[alpha]}%')
        for button in self.widths.buttons(): button.setChecked(self.widths.id(button) == a['width'])
        self.halo.blockSignals(True); self.halo.setChecked(a['halo']); self.halo.blockSignals(False)
