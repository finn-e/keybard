import { keyService } from "@/services/key.service";
import { ComboOptions, type ComboEntry } from "@/types/keyboard.types";
import { DEMO_COMBO_COUNT, FIXTURE_COMBOS, FIXTURE_LAYER_COLORS, FIXTURE_LAYERS } from "../fixtures/combos.fixture";

export function fixtureEntries(count: number): ComboEntry[] {
    return FIXTURE_COMBOS.slice(0, count).map((c, i) => ({
        cmbid: i,
        keys: c.keys,
        output: c.output,
        options: c.on ? ComboOptions.ENABLED : 0,
    }));
}

export const fixtureKeymap = (): number[][] => FIXTURE_LAYERS.map(l => l.map(k => Number(keyService.parse(k))));

export interface ComboKeyboard {
    name: string;
    combos: ComboEntry[];
    keymap: number[][];
    cosmetic: { layer_colors: Record<string, string> };
}

export const demoKeyboard = (): ComboKeyboard => ({
    name: "demo (12 combos)",
    combos: fixtureEntries(DEMO_COMBO_COUNT),
    keymap: fixtureKeymap(),
    cosmetic: { layer_colors: { ...FIXTURE_LAYER_COLORS } },
});

export const denseKeyboard = (): ComboKeyboard => ({
    name: "dense (20 combos)",
    combos: fixtureEntries(FIXTURE_COMBOS.length),
    keymap: fixtureKeymap(),
    cosmetic: { layer_colors: { ...FIXTURE_LAYER_COLORS } },
});

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(c => `KC_${c}`);
const LAYER_COLORS = ["green", "blue", "purple", "orange", "brown", "magenta", "yellow", "grey", "light-grey", "white"];

/**
 * A random layout: `keys` letter keys on one or two layers and up to `combos` combos of 2 to 4
 * keys. Combos that would give any combo more than `maxNeighbors` neighbors (combos sharing a
 * key) are dropped, so six hues are always enough to keep sharing combos apart.
 */
export function randomKeyboard(seed: number, opts: { keys?: number; combos?: number; maxNeighbors?: number } = {}): ComboKeyboard {
    const r = rng(seed);
    const nKeys = opts.keys ?? 6 + Math.floor(r() * 18);
    const target = opts.combos ?? 4 + Math.floor(r() * 24);
    const maxN = opts.maxNeighbors ?? 5;
    const pool = LETTERS.slice(0, nKeys);
    const chosen: string[][] = [];
    const shares = (a: string[], b: string[]) => a.some(k => b.includes(k));
    for (let tries = 0; chosen.length < target && tries < target * 20; tries++) {
        const size = 2 + Math.floor(r() * 3);
        const keys = new Set<string>();
        while (keys.size < Math.min(size, pool.length)) keys.add(pool[Math.floor(r() * pool.length)]);
        const cand = [...keys];
        const nb = chosen.filter(c => shares(c, cand));
        if (nb.length > maxN) continue;
        if (nb.some(c => chosen.filter(d => d !== c && shares(d, c)).length + 1 > maxN)) continue;
        chosen.push(cand);
    }
    const combos: ComboEntry[] = chosen.map((keys, i) => ({
        cmbid: i,
        keys: [...keys, "KC_NO", "KC_NO", "KC_NO", "KC_NO"].slice(0, 4),
        output: "KC_ESCAPE",
        options: r() < 0.85 ? ComboOptions.ENABLED : 0,
    }));
    const layer0 = pool.map(k => Number(keyService.parse(k)));
    const layer1 = pool.map(k => (r() < 0.5 ? 1 : Number(keyService.parse(k))));
    return {
        name: `random seed ${seed}`,
        combos,
        keymap: [layer0, layer1],
        cosmetic: { layer_colors: { "0": LAYER_COLORS[Math.floor(r() * LAYER_COLORS.length)], "1": LAYER_COLORS[Math.floor(r() * LAYER_COLORS.length)] } },
    };
}
