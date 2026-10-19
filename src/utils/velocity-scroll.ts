// Velocity Scroll in POINTING_MOTION (0x2D): while SV_VELOCITY_SCROLL is held,
// the pointer's offset from where it was at key-down sets a scroll speed. The
// board reports the offset, the speed it sends at and the curve's tunables in a
// 24-byte block at payload offsets 29-52 (Svalboard QMK
// keyboards/svalboard/docs/protocol.md, "Velocity Scroll"), so Keybard draws the
// dead zone and the curve without knowing the build's values.

/** Marks the block (format 1); firmware without it leaves the byte zero. */
export const VELOCITY_SCROLL_MAGIC = 0x56;
/** The block's payload offset (after the format byte's place 0) and length. */
export const VELOCITY_SCROLL_OFF = 29;
export const VELOCITY_SCROLL_LEN = 24;

/** One device's curve, per axis: speed = gain * ((|offset| - dead) / 10 mm) ^ exponent, capped. */
export interface VelocityCurve {
    /** Dead zone per axis, mm. */
    deadMm: number;
    /** Notches/s at 10 mm past the dead zone. */
    gain: number;
    exponent: number;
    /** Speed cap, notches/s. */
    maxNps: number;
}

export interface VelocityScrollState {
    /** Velocity Scroll is held now. */
    held: boolean;
    /**
     * Which pad's finger sets the offset, or null when the relative pointers do
     * (a trackball or TrackPoint, or a pad with no finger down yet).
     */
    padHand: "left" | "right" | null;
    /** The axis lock tunable is on; lockedAxis is the axis it picked. */
    axisLock: boolean;
    lockedAxis: "none" | "vertical" | "horizontal";
    /** Offset from the anchor, mm: +x right, +y toward the user. */
    offsetMm: { x: number; y: number };
    /** The speed the board sends at, notches/s: +h right, +v up (before natural scroll). */
    speedNps: { h: number; v: number };
    ball: VelocityCurve;
    pad: VelocityCurve;
}

/** The build-time defaults (velocity_scroll.h), for the demo only: a board reports its own. */
export const VELOCITY_DEFAULTS: { ball: VelocityCurve; pad: VelocityCurve } = {
    ball: { deadMm: 0.8, gain: 12, exponent: 1.5, maxNps: 60 },
    pad: { deadMm: 1.5, gain: 16, exponent: 1.5, maxNps: 60 },
};

/**
 * Parses the block from a 0x2D payload view (offset 0 = the format byte), or
 * undefined when the reply is too short or the magic byte is not there.
 */
export function parseVelocityScroll(view: DataView, p: number): VelocityScrollState | undefined {
    if (view.byteLength < p + VELOCITY_SCROLL_OFF + VELOCITY_SCROLL_LEN) return undefined;
    const o = p + VELOCITY_SCROLL_OFF;
    if (view.getUint8(o) !== VELOCITY_SCROLL_MAGIC) return undefined;
    const flags = view.getUint8(o + 1);
    const s16 = (k: number) => view.getInt16(o + k, true);
    const u16 = (k: number) => view.getUint16(o + k, true);
    const maxNps = u16(10) / 100;
    const lock = (flags >> 4) & 3;
    return {
        held: (flags & 0x01) !== 0,
        padHand: (flags & 0x02) !== 0 ? ((flags & 0x04) !== 0 ? "right" : "left") : null,
        axisLock: (flags & 0x08) !== 0,
        lockedAxis: lock === 1 ? "vertical" : lock === 2 ? "horizontal" : "none",
        offsetMm: { x: s16(2) / 100, y: s16(4) / 100 },
        speedNps: { h: s16(6) / 100, v: s16(8) / 100 },
        ball: { deadMm: u16(12) / 100, gain: u16(14) / 100, exponent: u16(16) / 1000, maxNps },
        pad: { deadMm: u16(18) / 100, gain: u16(20) / 100, exponent: u16(22) / 1000, maxNps },
    };
}

/** Signed speed for an offset along one axis, notches/s (the firmware's sval_vs_speed). */
export function velocitySpeed(c: VelocityCurve, offsetMm: number): number {
    const past = Math.abs(offsetMm) - c.deadMm;
    if (past <= 0 || c.gain <= 0 || c.exponent <= 0) return 0;
    const nps = Math.min(c.maxNps, c.gain * Math.pow(past / 10, c.exponent));
    return offsetMm < 0 ? -nps : nps;
}

/** The offset where the speed first reaches the cap (the firmware's sval_vs_full_mm). */
export function velocityFullMm(c: VelocityCurve): number {
    if (c.gain <= 0 || c.exponent <= 0) return c.deadMm;
    return c.deadMm + 10 * Math.pow(c.maxNps / c.gain, 1 / c.exponent);
}

/** The offset where the speed reaches `nps` (inverse of velocitySpeed for nps > 0). */
export function velocityOffsetFor(c: VelocityCurve, nps: number): number {
    if (nps <= 0 || c.gain <= 0 || c.exponent <= 0) return c.deadMm;
    return c.deadMm + 10 * Math.pow(Math.min(nps, c.maxNps) / c.gain, 1 / c.exponent);
}

/** The state a held key would report for an offset (the demo and the Overlay's demo). */
export function velocityStateFor(offsetMm: { x: number; y: number }, padHand: "left" | "right" | null, curves = VELOCITY_DEFAULTS): VelocityScrollState {
    const c = padHand ? curves.pad : curves.ball;
    return {
        held: true, padHand, axisLock: false, lockedAxis: "none", offsetMm: { ...offsetMm },
        speedNps: { h: velocitySpeed(c, offsetMm.x), v: -velocitySpeed(c, offsetMm.y) },
        ball: curves.ball, pad: curves.pad,
    };
}

/**
 * The state from JSON (the Keybard Overlay relays it in its pointing events),
 * validated: undefined unless every number is finite and the curves are sane.
 */
export function velocityScrollFromJson(value: unknown): VelocityScrollState | undefined {
    if (!value || typeof value !== "object") return undefined;
    const v = value as Record<string, unknown>;
    const num = (o: unknown, k: string): number | null => {
        const x = o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined;
        return typeof x === "number" && Number.isFinite(x) ? x : null;
    };
    const curve = (o: unknown): VelocityCurve | null => {
        const deadMm = num(o, "deadMm"), gain = num(o, "gain"), exponent = num(o, "exponent"), maxNps = num(o, "maxNps");
        if (deadMm === null || gain === null || exponent === null || maxNps === null) return null;
        if (deadMm < 0 || gain < 0 || exponent < 0 || maxNps < 0) return null;
        return { deadMm, gain, exponent, maxNps };
    };
    const ox = num(v.offsetMm, "x"), oy = num(v.offsetMm, "y"), sh = num(v.speedNps, "h"), sv = num(v.speedNps, "v");
    const ball = curve(v.ball), pad = curve(v.pad);
    if (ox === null || oy === null || sh === null || sv === null || !ball || !pad) return undefined;
    const clamp = (x: number) => Math.max(-400, Math.min(400, x));
    return {
        held: v.held === true,
        padHand: v.padHand === "left" || v.padHand === "right" ? v.padHand : null,
        axisLock: v.axisLock === true,
        lockedAxis: v.lockedAxis === "vertical" || v.lockedAxis === "horizontal" ? v.lockedAxis : "none",
        offsetMm: { x: clamp(ox), y: clamp(oy) },
        speedNps: { h: clamp(sh), v: clamp(sv) },
        ball, pad,
    };
}
