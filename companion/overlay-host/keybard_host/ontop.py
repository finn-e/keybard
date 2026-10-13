"""Keep the overlay above ordinary windows on Windows.

Qt asks for an always-on-top window once, but Windows can still end up stacking it
below ordinary windows while it keeps the topmost style (seen with a maximized Chrome
window above it). The Host checks now and then and puts the overlay back on top when
an ordinary window is above it. Other always-on-top windows are left alone, so the
overlay doesn't fight the taskbar or other apps' floating windows for the top spot.
"""
import sys

GW_HWNDPREV = 3
GWL_EXSTYLE = -20
WS_EX_TOPMOST = 0x00000008
HWND_TOPMOST = -1
SWP_NOSIZE, SWP_NOMOVE, SWP_NOACTIVATE, SWP_NOOWNERZORDER = 0x0001, 0x0002, 0x0010, 0x0200

_user32 = None


def _api():
    global _user32
    if _user32 is None:
        import ctypes
        from ctypes import wintypes
        u = ctypes.WinDLL('user32', use_last_error=True)
        u.GetWindow.restype = wintypes.HWND; u.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
        u.GetWindowLongW.restype = ctypes.c_long; u.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
        u.IsWindowVisible.restype = wintypes.BOOL; u.IsWindowVisible.argtypes = [wintypes.HWND]
        u.SetWindowPos.restype = wintypes.BOOL
        u.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
        _user32 = u
    return _user32


def buried(hwnd, api=None):
    """Whether a visible ordinary (not always-on-top) window is stacked above hwnd."""
    u = api or _api()
    above = u.GetWindow(hwnd, GW_HWNDPREV)
    while above:
        if u.IsWindowVisible(above) and not (u.GetWindowLongW(above, GWL_EXSTYLE) & WS_EX_TOPMOST): return True
        above = u.GetWindow(above, GW_HWNDPREV)
    return False


def above(hwnd, other, api=None):
    """Whether other is stacked above hwnd."""
    u = api or _api()
    h = u.GetWindow(hwnd, GW_HWNDPREV)
    while h:
        if h == other: return True
        h = u.GetWindow(h, GW_HWNDPREV)
    return False


def keep_on_top(widgets, platform=None, api=None):
    """Put the widgets' windows back on top, in order (last ends up highest), if any is buried
    under an ordinary window or they're out of order among themselves."""
    if (platform or sys.platform) != 'win32': return False
    u = api or _api()
    handles = [int(w.winId()) for w in widgets if w.isVisible()]
    misordered = any(above(handles[i], later, u) for i in range(len(handles)) for later in handles[:i])
    if not misordered and not any(buried(h, u) for h in handles): return False
    for h in handles:
        u.SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER)
    return True
