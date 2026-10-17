// Ball materials, sparkle and gloss for the physical pointing renderer.
// Values are the round 5 design prototype's (pointing-review-5/app.js), unchanged.
// These are the physical colors of the balls and the studio they sit in, not UI
// chrome, so they are literal colors rather than theme tokens.

export type BallId = "silver" | "red" | "black" | "pearl_blue" | "pearl_purple" | "pearl_white" | "pearl_black";

interface FlakeBall {
    name: string; mm: number; type: "flake"; base: string; metal: number; rough: number; coat: number; flake: number;
    tilt: number; hue: number; freq: number; rimDark: number; room?: number; flakeTint?: string; swatch: string;
    /** Body lightness (see bodyAt); omitted = the base color as is. */
    light?: number;
}
interface PearlBall {
    name: string; mm: number; type: "pearl"; deep: string; body: string; swirl: string; hi: string; swatch: string;
    contrast: number; area: number; vein?: number; room?: number; seed: [number, number, number];
}
export type Ball = FlakeBall | PearlBall;

export const BALLS: Record<BallId, Ball> = {
    silver:       { name: "Silver sparkle", mm: 44, type: "flake", base: "#cfcdca", metal: 1.0, rough: 0.5, coat: 0.0, flake: 1.0, tilt: 0.7, hue: 0.5, freq: 130, rimDark: 0.66, room: 0.9, swatch: "#c1bfbd", light: 1.0 },
    red:          { name: "Glossy red", mm: 44, type: "flake", base: "#b0081f", metal: 0.35, rough: 0.34, coat: 1.0, flake: 0.25, tilt: 0.3, hue: 0.0, freq: 220, rimDark: 0.3, flakeTint: "#ff3040", swatch: "#ad1931" },
    black:        { name: "Black sparkle", mm: 44, type: "flake", base: "#5c5d62", metal: 1.0, rough: 0.4, coat: 1.0, flake: 0.9, tilt: 0.5, hue: 0.25, freq: 240, rimDark: 0.6, room: 0.35, swatch: "#36373a" },
    pearl_blue:   { name: "Pearl blue", mm: 52, type: "pearl", deep: "#010a20", body: "#05315f", swirl: "#2f8fd2", hi: "#b4def7", swatch: "#0d5a92", contrast: 1.0, area: 0.24, seed: [7.3, 2.2, 0.4] },
    pearl_purple: { name: "Pearl purple", mm: 52, type: "pearl", deep: "#1a0d36", body: "#3b2774", swirl: "#9a8ad8", hi: "#ebe6ff", swatch: "#4b3f9a", contrast: 1.0, area: 0.24, seed: [3.1, 1.7, 8.2] },
    pearl_white:  { name: "Pearl white", mm: 52, type: "pearl", deep: "#d9dcdf", body: "#f3f4f4", swirl: "#c4c9cf", hi: "#ffffff", swatch: "#eceeef", contrast: 0.9, area: 0.26, vein: 1, room: 0.25, seed: [2.4, 5.5, 1.9] },
    pearl_black:  { name: "Pearl black", mm: 52, type: "pearl", deep: "#060708", body: "#16181c", swirl: "#525a65", hi: "#a0a8b3", swatch: "#2a2d32", contrast: 1.0, area: 0.30, seed: [9.1, 4.4, 6.6] },
};

export const MAT_ORDER: BallId[] = ["silver", "red", "black", "pearl_blue", "pearl_purple", "pearl_white", "pearl_black"];
export const DEFAULT_BALL: BallId = "silver";

export function isBallId(value: unknown): value is BallId {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(BALLS, value);
}

export const GLASS = { light: "#5d5f64", dark: "#4c4e53" } as const;
export const GROUND = { light: "#f1f2f2", dark: "#141517" } as const;

/* Sparkle tunables. Three flake layers per ball, [grain, flakes, glints]: see the prototype for
   what each field does. Silver was tuned against the photo-based render. */
export interface Sparkle {
    F: number[]; minPx: number[]; tilt: number[]; cov: number[]; rough: number[]; rad: number[]; gain: number[];
    col: string; hue: number; rough0: number; lift: number; mottle: number; cloud: number; studio?: boolean;
}
export const SPARKLE: Record<"silver" | "black", Sparkle> = {
    silver: { F: [182, 104, 64], minPx: [1.25, 2.2, 3.6], tilt: [0.51, 1.08, 1.41], cov: [0.18, 0.76, 0.28],
              rough: [0.39, 0.03, 0.03], rad: [0, 0.19, 0.15], gain: [0.37, 1.56, 2.80], col: "#d4d6da", hue: 0.04,
              rough0: 0.90, lift: 0.65, mottle: 0.089, cloud: 0.08, studio: true },
    black:  { F: [182, 104, 64], minPx: [1.25, 2.2, 3.6], tilt: [0.51, 1.08, 1.41], cov: [0.40, 0.85, 0.50],
              rough: [0.39, 0.03, 0.03], rad: [0, 0.19, 0.15], gain: [0.35, 0.40, 0.30], col: "#8a8b90", hue: 0.03,
              rough0: 0.55, lift: 1.25, mottle: 0.16, cloud: 0.05 },
};

/** Sparkle density: one value from 0 to 1. SPARKLE above is silver at SPARKLE_R4. */
export const SPARKLE_R4 = 0.25;
export const SPARKLE_DEFAULT = 0.75;
/** The sparkle density Keybard and Keybard Overlay draw: fixed, not a setting. */
export const BALL_SPARKLE = SPARKLE_DEFAULT;
type SparkleEnd = Pick<Sparkle, "F" | "minPx" | "cov" | "gain" | "hue" | "mottle" | "lift">;
export const SPARKLE_ENDS: { lo: SparkleEnd; hi: SparkleEnd } = {
    lo: { F: [182, 80, 48], minPx: [1.4, 2.4, 4.0], cov: [0.18, 0.45, 0.10], gain: [0.37, 1.40, 2.60], hue: 0.03, mottle: 0.07, lift: 0.65 },
    hi: { F: [182, 150, 120], minPx: [1.0, 1.3, 1.6], cov: [0.80, 0.98, 0.95], gain: [0.70, 1.90, 3.80], hue: 0.14, mottle: 0.30, lift: 1.3 },
};
const SPK_KEYS = ["F", "minPx", "cov", "gain", "hue", "mottle", "lift"] as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

function spkSilver(d: number): Sparkle {
    const r4 = SPARKLE.silver;
    const [a, b, t] = d <= SPARKLE_R4
        ? [SPARKLE_ENDS.lo, r4, d / SPARKLE_R4] as const
        : [r4, SPARKLE_ENDS.hi, (d - SPARKLE_R4) / (1 - SPARKLE_R4)] as const;
    const o: Sparkle = { ...r4 };
    for (const k of SPK_KEYS) {
        const x = a[k], y = b[k];
        (o as unknown as Record<string, unknown>)[k] = Array.isArray(x)
            ? x.map((v, i) => v + ((y as number[])[i] - v) * t)
            : (x as number) + ((y as number) - (x as number)) * t;
    }
    return o;
}

/** The sparkle layers for a material at density d, or null for balls without multi-layer sparkle. */
export function spkAt(mat: BallId, density: number): Sparkle | null {
    const d = clamp01(density);
    if (mat === "silver") return spkSilver(d);
    if (mat !== "black") return null;
    const base = SPARKLE.black;
    // the other sparkle balls scale by silver's change from the default
    const s = spkSilver(d), s0 = spkSilver(SPARKLE_DEFAULT);
    return {
        ...base,
        F: base.F.map((v, i) => v * s.F[i] / s0.F[i]),
        minPx: base.minPx.map((v, i) => v * s.minPx[i] / s0.minPx[i]),
        cov: base.cov.map((v, i) => Math.min(1, v * s.cov[i] / s0.cov[i])),
        gain: base.gain.map((v, i) => v * Math.sqrt(s.gain[i] / s0.gain[i])),
    };
}

/* Gloss: one value from 0 to 1 for every ball. It sets the clear coat on top of each ball. At
   GLOSS_PHOTO the coat matches the photographs; at 1 every ball wears the full lacquer; at 0 the
   coat is a faint satin. Keybard and Keybard Overlay draw every ball at BALL_GLOSS. */
export const GLOSS_PHOTO = 0.4;
/** The gloss Keybard and Keybard Overlay draw: the full lacquer, fixed, not a setting. */
export const BALL_GLOSS = 1;
interface Coat { coat: number; rough: number; rim: number; box: number; sheen: number }
const GLOSS_LACQUER: Coat = { coat: 1.0, rough: 0.03, rim: 1.0, box: 1.0, sheen: 1.0 };
const COAT_PHOTO: Record<BallId, Coat> = {
    silver:       { coat: 0.08, rough: 0.25, rim: 1.0, box: 1.0, sheen: 1.0 },
    red:          { coat: 1.0, rough: 0.03, rim: 0.15, box: 0.7, sheen: 1.0 },
    black:        { coat: 0.8, rough: 0.06, rim: 0.6, box: 0.78, sheen: 1.0 },
    pearl_blue:   { coat: 0.25, rough: 0.03, rim: 0.6, box: 0.5, sheen: 0.5 },
    pearl_purple: { coat: 0.5, rough: 0.03, rim: 0.6, box: 0.5, sheen: 0.5 },
    pearl_white:  { coat: 0.1, rough: 0.15, rim: 0.8, box: 1.0, sheen: 0.5 },
    pearl_black:  { coat: 0.38, rough: 0.03, rim: 0.6, box: 0.5, sheen: 0.5 },
};
export function coatAt(mat: BallId, gloss: number): Coat {
    const g = clamp01(gloss);
    const P = COAT_PHOTO[mat], L = GLOSS_LACQUER;
    const Mt: Coat = { coat: P.coat * 0.3, rough: Math.max(0.5, P.rough * 2), rim: P.rim * 0.4, box: P.box, sheen: P.sheen * 0.5 };   // satin end
    const [a, b, t] = g <= GLOSS_PHOTO ? [Mt, P, g / GLOSS_PHOTO] as const : [P, L, (g - GLOSS_PHOTO) / (1 - GLOSS_PHOTO)] as const;
    const mix = (x: number, y: number) => x + (y - x) * t;
    return { coat: mix(a.coat, b.coat), rough: Math.exp(mix(Math.log(a.rough), Math.log(b.rough))), rim: mix(a.rim, b.rim), box: mix(a.box, b.box), sheen: mix(a.sheen, b.sheen) };
}

/* Body lightness: a ball's "light" moves its body color (flake base), apart from the sparkle and
   the coat. At LIGHTNESS_DEFAULT nothing changes; above it the body mixes toward white, below it
   toward black. Silver is set at 1 (chosen on review); the others are as designed. */
export const LIGHTNESS_DEFAULT = 0.5;
/** A linear RGB body color at lightness l (0..1): unchanged at LIGHTNESS_DEFAULT. */
export function bodyAt(rgb: readonly number[], lightness: number | undefined): number[] {
    const l = clamp01(lightness ?? LIGHTNESS_DEFAULT);
    if (l === LIGHTNESS_DEFAULT) return [...rgb];
    if (l > LIGHTNESS_DEFAULT) {
        const t = ((l - LIGHTNESS_DEFAULT) / (1 - LIGHTNESS_DEFAULT)) * 0.85;   // stops short of flat white
        return rgb.map((v) => v + (1 - v) * t);
    }
    const k = 0.15 + 0.85 * (l / LIGHTNESS_DEFAULT);                            // stops short of flat black
    return rgb.map((v) => v * k);
}

/** Ball diameter in mm; the touchpad's glass is 43 x 40 mm. */
export const TOUCHPAD_MM = { w: 43, h: 40 } as const;
