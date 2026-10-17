"""One HID owner; read the board profile before publishing live layer state."""
from threading import Event, Lock
import time
from PySide6.QtCore import QThread, Signal
from .protocol import SvalReader, ProtocolError, Cancelled, candidates, hid_backend, DEFAULT_LAYER_STATE_FLAG, POINTING_MOTION_FLAG2, UnsupportedCommand


class DeviceWorker(QThread):
    pressed = Signal(object)
    state = Signal(object)
    profile = Signal(object)
    status = Signal(str)
    # Each hand's pointing motion (POINTING_MOTION, a read), only while the overlay draws pointing.
    pointing = Signal(object)

    def __init__(self, selected, expected_uid=None, parent=None):
        super().__init__(parent)
        self.selected = selected
        self.expected_uid = expected_uid  # Pinned after first successful handshake.
        self.stop_event = Event()
        self.reload_event = Event()
        self.refresh_event = Event()
        self.press_lock = Lock()
        self.press_enabled = False
        self.press_generation = 0
        self.pointing_enabled = False

    # About 60 reads a second; the firmware counts motion only while someone reads within 1.5 s.
    POINTING_INTERVAL = .016
    # How often to look again for a pointing module the board didn't know yet (one 0x18 read).
    SETTLE_INTERVAL = 1.0

    def set_pointing_tracking(self, enabled):
        self.pointing_enabled = bool(enabled)

    def set_press_tracking(self, enabled):
        with self.press_lock:
            self.press_enabled = enabled
            self.press_generation += 1
            return self.press_generation

    def stop(self):
        self.stop_event.set()

    def reload(self):
        self.reload_event.set()

    def refresh(self):
        """Re-read the layout after an edit, keeping the board definition and the current layout on show."""
        self.refresh_event.set()

    def run(self):
        try:
            hid = hid_backend()
        except ImportError as exc:
            self.status.emit(f"Stopped · HID runtime unavailable: {exc}")
            return
        retry = .5
        while not self.stop_event.is_set():
            device = None
            try:
                self.status.emit("Connecting…")
                serial = self.selected.get("serial_number")
                devices = candidates(hid)
                matches = [d for d in devices if (d.get("serial_number") == serial if serial
                           else d["path"] == self.selected["path"])]
                if len(matches) != 1:
                    raise ProtocolError("Selected Svalboard is unavailable or ambiguous")
                device = hid.device()
                device.open_path(matches[0]["path"])
                reader = SvalReader(device, cancelled=self.stop_event.is_set)
                unavailable_generation = None
                version, uid = reader.info()
                if self.expected_uid is not None and uid != self.expected_uid:
                    self.status.emit("Stopped · reconnected board definition UID changed; select it again")
                    return
                self.expected_uid = uid
                self.reload_event.set()
                refresh_after, refresh_failures = 0.0, 0
                pointing_next, pointing_supported = 0.0, True
                settle_next = 0.0
                retry = .5
                while not self.stop_event.is_set():
                    if self.reload_event.is_set():
                        self.reload_event.clear()
                        self.refresh_event.clear()
                        profile = reader.read_profile(uid, self.status.emit)
                        reader.checkpoint()
                        self.profile.emit(profile)
                        mode = "automatic defaults" if reader.feature_flags & DEFAULT_LAYER_STATE_FLAG else "manual default (older firmware)"
                        self.status.emit(f"Connected · Sval v{version} · layout read from board; {mode}")
                    elif self.refresh_event.is_set() and time.monotonic() >= refresh_after:
                        self.refresh_event.clear()
                        try:
                            profile = reader.read_profile(uid, reuse_definition=True)
                        except ProtocolError as exc:
                            # Usually Keybard still writing: keep the shown layout and try again shortly.
                            refresh_failures += 1
                            if refresh_failures > 3:
                                raise
                            self.status.emit(f"Layout refresh deferred · {exc}")
                            refresh_after = time.monotonic() + .5
                            self.refresh_event.set()
                        else:
                            refresh_failures = 0
                            reader.checkpoint()
                            self.profile.emit(profile)
                            self.status.emit(f"Connected · Sval v{version} · layout refreshed from board")
                    cycle_start = time.monotonic()
                    self.state.emit(reader.layer_snapshot())
                    with self.press_lock:
                        enabled, generation = self.press_enabled, self.press_generation
                    if enabled and generation != unavailable_generation:
                        try:
                            positions = reader.pressed_keys()
                        except UnsupportedCommand:
                            # Keep layer tracking available on firmware without matrix reads.
                            self.pressed.emit((generation, None, time.monotonic()))
                            unavailable_generation = generation
                        else:
                            self.pressed.emit((generation, positions, time.monotonic()))
                    # A half that hadn't reported its pointing module at the profile read, or
                    # reported none in the first 35 s (the firmware probes again until 30 s after
                    # power-on): look again each second, and re-read the profile once it changes.
                    if reader.pointing_watching() and not self.refresh_event.is_set() and time.monotonic() >= settle_next:
                        settle_next = time.monotonic() + self.SETTLE_INTERVAL
                        if reader.pointing_settled():
                            self.refresh_event.set()
                    if self.pointing_enabled and pointing_supported and time.monotonic() >= pointing_next:
                        pointing_next = time.monotonic() + self.POINTING_INTERVAL
                        motion = None
                        try:
                            motion = reader.pointing_motion()
                        except UnsupportedCommand:
                            pointing_supported = False
                        if not reader.feature_flags2 & POINTING_MOTION_FLAG2:
                            pointing_supported = False  # older firmware: still devices, nothing said
                        if motion is not None:
                            self.pointing.emit(motion)
                    self.stop_event.wait(max(0, .008 - (time.monotonic() - cycle_start)))
            except Cancelled:
                return
            except (OSError, ValueError, ProtocolError) as exc:
                self.status.emit(f"Disconnected · {exc} · retrying")
            finally:
                if device is not None:
                    try:
                        device.close()
                    except OSError:
                        pass
            if not self.selected.get("serial_number"):
                self.status.emit("Disconnected · no stable serial; rescan and select the device")
                return
            if self.stop_event.wait(retry):
                return
            retry = min(5, retry * 2)
