// Folded-corner combo colors.
//
// Each combo owns one hue for the whole keyboard: every key it is on, its Combos panel swatch
// and its preview. Each hue has two tones, chosen by the key it sits on, the way Keybard
// switches legend ink between white and black: a light tone on mid and dark layer colors, a
// deep tone on light ones (orange, yellow, light gray, white). No red or pink-red, which
// belongs to "selected".
//
// Assignment (greedy, most constrained combo first, computed once per combo list):
//   1. never a hue already used by a combo that shares a trigger key with this one;
//   2. avoid hues that clash with a layer color the combo's keys are shown on
//      (hue within 35 degrees, or luminance contrast under 1.5:1; under 1.3:1 is never used);
//   3. among what is left, the least used hue so far, so the layout spreads its colors.
// Hue is the only thing this decides. Where a combo sits in a key's corner is its rank by
// combo number on that key (see combo-fold.ts), never its color.
import { getColorByName, isHexColor } from "@/utils/colors";
import type { ComboEntry } from "@/types/keyboard.types";
import { comboTriggerCodes } from "./combo-membership";

export interface Hue { name: string; light: string; deep: string }

/** Light and deep tones; the same values live as --kb-combo-fold-* tokens in src/index.css. */
export const HUES: Hue[] = [
    { name: "amber", light: "#ffb24a", deep: "#d77300" },
    { name: "violet", light: "#bfa2ff", deep: "#7a5ae6" },
    { name: "sky", light: "#74c4ff", deep: "#2b8be0" },
    { name: "lemon", light: "#f6e35a", deep: "#ad8a00" },
    { name: "orchid", light: "#f59ce6", deep: "#c24aa8" },
    { name: "mint", light: "#6ee6ac", deep: "#13a86a" },
];

export type Tone = "light" | "deep";

export const hueToken = (hue: number, tone: Tone) =>
    `var(--kb-combo-fold-${HUES[hue % HUES.length].name}${tone === "deep" ? "-deep" : ""})`;

const DEFAULT_LAYER_HEX = "#099e7c";
const SIDEBAR_HEX = "#3e3e3e";

/** Hex for a layer color as Keybard stores it: a preset name, "primary", "sidebar" or "#rrggbb". */
export function layerHexFor(name: string | undefined): string {
    if (!name || name === "primary") return DEFAULT_LAYER_HEX;
    if (name === "sidebar") return SIDEBAR_HEX;
    if (isHexColor(name)) return name;
    return getColorByName(name)?.hex ?? DEFAULT_LAYER_HEX;
}

const lin = (c: number) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const rgb = (h: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
    const n = m ? parseInt(m[1], 16) : 0;
    return [n >> 16, (n >> 8) & 255, n & 255];
};
export const luminance = (h: string) => {
    const [r, g, b] = rgb(h);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a: string, b: string) => {
    const x = luminance(a) + 0.05, y = luminance(b) + 0.05;
    return Math.max(x, y) / Math.min(x, y);
};
function hueAngle(h: string): number | null {
    const [r, g, b] = rgb(h).map(v => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 0.25) return null; // grays have no hue to clash with
    const H = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (H * 60 + 360) % 360;
}

/** Light keys (orange, yellow, light gray, white) take the deep tone. */
export const toneFor = (layerHex: string): Tone => luminance(layerHex) > 0.4 ? "deep" : "light";
export const hexFor = (hue: number, layerHex: string) => HUES[hue][toneFor(layerHex)];

/** 0 = fine, 1 = weak (avoid), 2 = never. */
export function clash(hue: number, layerHex: string): 0 | 1 | 2 {
    const c = hexFor(hue, layerHex);
    const cr = contrast(c, layerHex);
    if (cr < 1.3) return 2;
    const a = hueAngle(c), b = hueAngle(layerHex);
    if (a != null && b != null && Math.min(Math.abs(a - b), 360 - Math.abs(a - b)) < 35) return 2;
    return cr < 1.5 ? 1 : 0;
}

export interface KeyboardLike {
    combos?: ComboEntry[];
    keymap?: number[][];
    cosmetic?: { layer_colors?: Record<string, string> };
}

type CacheEntry = { keymap: unknown; colorsKey: string; hues: Map<number, number> };
const cache = new WeakMap<object, CacheEntry>();

/** Combo slot -> hue index for the whole keyboard (DSatur-style greedy coloring). */
export function assignComboHues(kb: KeyboardLike | null | undefined): Map<number, number> {
    const out = new Map<number, number>();
    if (!kb?.combos?.length) return out;
    const colorsKey = JSON.stringify(kb.cosmetic?.layer_colors ?? {});
    const hit = cache.get(kb.combos);
    if (hit && hit.keymap === kb.keymap && hit.colorsKey === colorsKey) return hit.hues;

    const layerHex = (l: number) => layerHexFor(kb.cosmetic?.layer_colors?.[String(l)] || "green");
    const nodes = kb.combos.map((c, slot) => ({ slot, codes: comboTriggerCodes(c) })).filter(n => n.codes.size);
    const shownOn = new Map<number, Set<string>>();
    for (const n of nodes) {
        const s = new Set<string>();
        (kb.keymap || []).forEach((layer, l) => { if (layer?.some(code => n.codes.has(code))) s.add(layerHex(l)); });
        if (!s.size) s.add(layerHex(0));
        shownOn.set(n.slot, s);
    }
    const nbrs = new Map<number, number[]>(nodes.map(n => [
        n.slot,
        nodes.filter(m => m !== n && [...m.codes].some(c => n.codes.has(c))).map(m => m.slot),
    ]));
    const uses = HUES.map(() => 0);
    const left = new Set(nodes.map(n => n.slot));
    while (left.size) {
        // Most constrained first: most distinct hues among colored neighbors, then most neighbors, then lowest slot.
        const sat = (slot: number) => new Set(nbrs.get(slot)!.filter(m => out.has(m)).map(m => out.get(m))).size;
        const slot = [...left].sort((a, b) => sat(b) - sat(a) || nbrs.get(b)!.length - nbrs.get(a)!.length || a - b)[0];
        const taken = new Set(nbrs.get(slot)!.filter(m => out.has(m)).map(m => out.get(m)!));
        const score = (h: number) => {
            let worst = 0;
            shownOn.get(slot)!.forEach(hex => { worst = Math.max(worst, clash(h, hex)); });
            return (taken.has(h) ? 100 : 0) + worst * 10 + uses[h] / 100;
        };
        const hue = HUES.map((_, h) => h).sort((a, b) => score(a) - score(b) || a - b)[0];
        out.set(slot, hue);
        uses[hue]++;
        left.delete(slot);
    }
    cache.set(kb.combos, { keymap: kb.keymap, colorsKey, hues: out });
    return out;
}
