"""A plain-text report for testers: system, display session, Qt and the boards it can see.

Run with --diagnose. It only enumerates HID devices and opens each Svalboard's Sval
collection to check permissions, then closes it again: it never sends anything to a
board. It needs no display, but reports more (screens, tray) when one is available.
"""
import os
from pathlib import Path
import platform
import sys

from .build import build_info

SVALBOARD_VID = 0x303A
SESSION_VARS = ('XDG_SESSION_TYPE', 'XDG_CURRENT_DESKTOP', 'DESKTOP_SESSION', 'WAYLAND_DISPLAY',
                'DISPLAY', 'QT_QPA_PLATFORM', 'XDG_RUNTIME_DIR', 'KEYBARD_OVERLAY_PLATFORM')
UDEV_RULE = Path('/etc/udev/rules.d/60-svalboard.rules')


def os_name():
    try:
        for line in Path('/etc/os-release').read_text(encoding='utf-8').splitlines():
            if line.startswith('PRETTY_NAME='): return line.split('=', 1)[1].strip().strip('"')
    except OSError:
        pass
    return platform.platform()


def system_lines():
    info = build_info()
    yield f"Keybard Overlay {info['version']} (Keybard {info['keybardCommit'] or 'unknown'})"
    yield f'OS: {os_name()}'
    yield f'Kernel: {platform.system()} {platform.release()} {platform.machine()}'
    yield f'Python: {sys.version.split()[0]} ({sys.executable})'
    for name in SESSION_VARS:
        yield f'{name}={os.environ.get(name, "")}'


def qt_lines():
    try:
        from PySide6 import __version__ as pyside
        from PySide6.QtCore import qVersion
        from PySide6.QtWidgets import QApplication, QSystemTrayIcon
    except ImportError as e:
        yield f'Qt: not importable ({e})'
        return
    yield f'PySide6 {pyside}, Qt {qVersion()}'
    try:
        from PySide6 import QtWebEngineWidgets  # noqa: F401
        yield 'Qt WebEngine: importable'
    except ImportError as e:
        yield f'Qt WebEngine: NOT importable ({e})'
    app = QApplication.instance() or QApplication(sys.argv[:1])
    yield f'Qt platform plugin: {app.platformName()}'
    for screen in app.screens():
        g = screen.geometry()
        yield f'Screen {screen.name()}: {g.width()}x{g.height()} at {g.x()},{g.y()}, scale {screen.devicePixelRatio()}'
    yield f'System tray available: {QSystemTrayIcon.isSystemTrayAvailable()}'


def hid_lines():
    from .device.protocol import USAGE, USAGE_PAGE, candidates, hid_backend
    try:
        hid = hid_backend()
    except ImportError as e:
        yield f'HID backend: not importable ({e})'
        return
    yield f'HID backend: {hid.__name__}'
    try:
        devices = list(hid.enumerate())
    except Exception as e:  # report, don't crash: the tester sends the report back
        yield f'HID enumerate failed: {e!r}'
        return
    ours = [d for d in devices if d.get('vendor_id') == SVALBOARD_VID]
    yield f'HID interfaces: {len(devices)} in all, {len(ours)} with Svalboard vendor ID 0x{SVALBOARD_VID:04x}'
    for d in ours:
        path = d.get('path')
        if isinstance(path, bytes): path = path.decode(errors='replace')
        yield (f"  {d.get('product_string') or '?'} pid=0x{d.get('product_id', 0):04x} "
               f"usage_page=0x{d.get('usage_page', 0):04x} usage=0x{d.get('usage', 0):02x} "
               f"interface={d.get('interface_number')} path={path}")
    found = candidates(hid)
    yield f'Sval collections (usage page 0x{USAGE_PAGE:04x}, usage 0x{USAGE:02x}): {len(found)}'
    for d in found:
        path = d['path']
        shown = path.decode(errors='replace') if isinstance(path, bytes) else path
        node = Path(shown) if str(shown).startswith('/dev/') else None
        mode = ''
        if node and node.exists():
            st = node.stat()
            mode = f' mode={oct(st.st_mode & 0o777)} uid={st.st_uid} gid={st.st_gid}'
        device = hid.device()
        try:
            device.open_path(path)
            result = 'opens OK'
        except Exception as e:
            result = f'CANNOT OPEN ({e}): install the udev rule, then unplug and replug the board'
        finally:
            try: device.close()
            except Exception: pass
        yield f'  {shown}{mode}: {result}'
    if sys.platform.startswith('linux'):
        yield f'udev rule {UDEV_RULE}: {"present" if UDEV_RULE.exists() else "MISSING"}'


def report():
    lines = ['== System'] + list(system_lines())
    for title, section in (('Qt', qt_lines), ('Boards', hid_lines)):
        lines.append(f'== {title}')
        try:
            lines.extend(section())
        except Exception as e:
            lines.append(f'{title} check failed: {e!r}')
    return '\n'.join(lines) + '\n'
