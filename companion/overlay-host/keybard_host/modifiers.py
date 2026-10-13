"""Read host modifier flags only; never capture keys or inject input.

Wayland has no portable global modifier query. Return None there so the
renderer retains static keycap legends instead of inventing a state.
"""
import ctypes
import os
import sys


class ModifierReader:
    def __init__(self):
        self.read = lambda: None
        self.display = None
        try:
            if sys.platform == 'win32':
                user = ctypes.WinDLL('user32', use_last_error=True)
                user.GetAsyncKeyState.argtypes = [ctypes.c_int]
                user.GetAsyncKeyState.restype = ctypes.c_short
                user.GetKeyState.argtypes = [ctypes.c_int]
                user.GetKeyState.restype = ctypes.c_short
                self.read = lambda: dict(shift=bool(user.GetAsyncKeyState(0x10) & 0x8000),
                                         capsLock=bool(user.GetKeyState(0x14) & 1))
            elif sys.platform == 'darwin':
                core = ctypes.CDLL('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
                core.CGEventSourceFlagsState.argtypes = [ctypes.c_int]
                core.CGEventSourceFlagsState.restype = ctypes.c_uint64
                def mac():
                    flags = core.CGEventSourceFlagsState(0)
                    return dict(shift=bool(flags & 0x20000), capsLock=bool(flags & 0x10000))
                self.read = mac
            elif os.environ.get('DISPLAY') and not os.environ.get('WAYLAND_DISPLAY'):
                class XkbState(ctypes.Structure):
                    _fields_ = [('group', ctypes.c_ubyte), ('locked_group', ctypes.c_ubyte),
                                ('base_group', ctypes.c_ushort), ('latched_group', ctypes.c_ushort),
                                ('mods', ctypes.c_ubyte), ('base_mods', ctypes.c_ubyte),
                                ('latched_mods', ctypes.c_ubyte), ('locked_mods', ctypes.c_ubyte),
                                ('compat_state', ctypes.c_ubyte), ('grab_mods', ctypes.c_ubyte),
                                ('compat_grab_mods', ctypes.c_ubyte), ('lookup_mods', ctypes.c_ubyte),
                                ('compat_lookup_mods', ctypes.c_ubyte), ('ptr_buttons', ctypes.c_ushort)]
                self.x11 = ctypes.CDLL('libX11.so.6')
                self.x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
                self.x11.XOpenDisplay.restype = ctypes.c_void_p
                self.x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
                self.x11.XkbGetState.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.POINTER(XkbState)]
                self.x11.XkbGetState.restype = ctypes.c_int
                self.display = self.x11.XOpenDisplay(None)
                if self.display:
                    def x11():
                        state = XkbState()
                        if self.x11.XkbGetState(self.display, 0x100, ctypes.byref(state)) != 0: return None
                        return dict(shift=bool(state.mods & 1), capsLock=bool(state.locked_mods & 2))
                    self.read = x11
        except (OSError, AttributeError):
            pass

    def close(self):
        if self.display:
            self.x11.XCloseDisplay(self.display)
            self.display = None
        self.read = lambda: None
