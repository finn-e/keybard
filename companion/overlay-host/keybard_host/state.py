"""Validated, local host state. Trainer clients cannot emit HID commands."""
import copy
import json
import re
import secrets
from threading import RLock
from pathlib import Path

# The overlay's styles, offered in the Host's menus (Keybard's src/features/trainer/core.ts has the same).
_DARK = dict(fill='#14202b', fillAlpha=80, outline='#51606a', outlineAlpha=100,
    legend='#f0f5f7', legendAlpha=100, width=1, halo=False, changed='#8ce4d3', pressed='#ffd27a')
PRESETS = {
    'Dark': _DARK,
    'Subtle': dict(_DARK, fillAlpha=20, outlineAlpha=40, legendAlpha=80, halo=True),
    'Outline only': dict(_DARK, fillAlpha=0, outline='#dce5ec', outlineAlpha=90, halo=True),
    'Light': dict(_DARK, fill='#f3f5f7', fillAlpha=90, outline='#56616b', legend='#15202b'),
    'High contrast': dict(_DARK, fill='#000000', fillAlpha=90, outline='#ffffff', width=2, halo=True),
}
# Layer-change highlight choices; each sets the effect and its duration together.
EFFECTS = {'Off': dict(effect='Off'), 'Flash': dict(effect='Quick flash', duration=150), 'Fade': dict(effect='Short fade', duration=400)}

DEFAULTS = dict(layoutId='us', appearance=dict(PRESETS['Outline only']),
    effect='Short fade', duration=150, scale=100, hands='Both', highlightPressed=True, manualDefault=1,
    capitalAlphas=False, adaptiveContrast=False)


def _highlight_held_keys(config):
    # Hosts before version 1 saved highlightPressed: false on every connect, so a saved false
    # isn't a choice the user made: start everyone on the new default once.
    config['highlightPressed'] = True


# PREFERENCES_MIGRATIONS[n] upgrades a preferences config saved at version n to n + 1.
PREFERENCES_MIGRATIONS = [_highlight_held_keys]
PREFERENCES_VERSION = len(PREFERENCES_MIGRATIONS)


def validate_config(value):
    if not isinstance(value, dict) or set(value) - set(DEFAULTS):
        raise ValueError('Unknown host configuration fields')
    result = copy.deepcopy(DEFAULTS)
    for key, val in value.items():
        if key == 'appearance':
            if not isinstance(val, dict) or set(val) - set(DEFAULTS['appearance']):
                raise ValueError('Invalid appearance')
            for name, color in val.items():
                if name in ('fill', 'outline', 'legend', 'changed', 'pressed'):
                    if not isinstance(color, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', color): raise ValueError('Invalid color')
                elif name == 'halo':
                    if type(color) is not bool: raise ValueError('Invalid halo')
                elif type(color) not in (float, int) or not 0 <= color <= (4 if name == 'width' else 100):
                    raise ValueError('Invalid opacity/width')
                result['appearance'][name] = color
        elif key in ('duration', 'scale', 'manualDefault'):
            lo, hi = dict(duration=(50, 750), scale=(50, 150), manualDefault=(0, 0xffffffff))[key]
            if type(val) is not int or not lo <= val <= hi: raise ValueError('Invalid numeric preference')
            result[key] = val
        elif key == 'layoutId':
            if not isinstance(val, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,32}', val): raise ValueError('Invalid keyboard language')
            result[key] = val
        elif key in ('highlightPressed', 'capitalAlphas', 'adaptiveContrast'):
            if type(val) is not bool: raise ValueError('Invalid on/off preference')
            result[key] = val
        elif val not in dict(effect=('Off', 'Quick flash', 'Short fade'), hands=('Both', 'Left', 'Right'))[key]:
            raise ValueError('Invalid option')
        else:
            result[key] = val
    return result


def remembered_board(value):
    """The remembered board from preferences, or None unless it has a string serial and uid."""
    if isinstance(value, dict) and isinstance(value.get('serial'), str) and isinstance(value.get('uid'), str):
        return value
    return None


class HostState:
    def __init__(self, path):
        self.lock = RLock()
        self.path = Path(path)
        self.token = secrets.token_urlsafe(32)
        self.config = copy.deepcopy(DEFAULTS)
        self.remembered = None
        self.revision = 0
        self.layout_revision = 0
        self.board = None
        self.status = 'Waiting for a Svalboard'
        self.devices = []
        self.selected_device = None
        self.modifiers = None
        self.active = 0
        self.default = None
        self.valid = False
        self.pressed = []
        self.matrix_available = None
        self.practice_hidden = []
        self.practice_target = None
        self.practice_at = 0
        self.visible = True
        self.session = secrets.token_hex(12)
        try:
            saved = json.loads(self.path.read_text())
        except (OSError, ValueError):
            saved = {}
        if not isinstance(saved, dict): saved = {}
        try: self.config = validate_config(saved.get('config', {}))
        except (ValueError, TypeError, KeyError): pass
        self.remembered = remembered_board(saved.get('remembered'))
        version = saved.get('version', 0)
        if 'config' in saved and type(version) is int and 0 <= version < PREFERENCES_VERSION:
            for migrate in PREFERENCES_MIGRATIONS[version:]: migrate(self.config)
            try: self.save()
            except OSError: pass  # migrated in memory; saved with the next change

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(dict(version=PREFERENCES_VERSION, config=self.config, remembered=self.remembered)))
        temporary.replace(self.path)

    def configure(self, config, revision):
        checked = validate_config(config)
        with self.lock:
            if type(revision) is not int or revision != self.revision: raise RuntimeError('Configuration changed; refresh and try again')
            old = self.config
            self.config = checked
            try: self.save()
            except OSError:
                self.config = old
                raise
            self.revision += 1
            return self.revision

    def snapshot(self, known_layout=None):
        with self.lock:
            return copy.deepcopy(dict(apiVersion=1, config=self.config, revision=self.revision,
                layoutRevision=self.layout_revision, board=self.board if known_layout != self.layout_revision else None,
                status=self.status, devices=self.devices, selectedDevice=self.selected_device, active=self.active, default=self.default, valid=self.valid,
                modifiers=self.modifiers, practiceHidden=self.practice_hidden, practiceTarget=self.practice_target, pressed=self.pressed, matrixAvailable=self.matrix_available, visible=self.visible, session=self.session))


def serialize_profile(profile):
    # String UIDs retain all 64 bits across JSON/JavaScript.
    return dict(name=profile.name, uid=str(profile.uid), fingerprint=profile.fingerprint, rows=10, cols=6,
        keymap=[[code for row in layer for code in row] for layer in profile.layers],
        keylayout={str(k.row * 6 + k.col): dict(row=k.row, col=k.col, x=k.x, y=k.y, w=1, h=1) for k in profile.keys},
        cosmetic=dict(layer={str(i): profile.layer_name(i) for i in range(len(profile.layers))}),
        trainerLabels={str(code): profile.label(code) for layer in profile.layers for row in layer for code in row})
