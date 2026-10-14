import { describe, expect, it } from "vitest";
import { FOLD_CAP, foldGeometry, foldLayout, foldPieces, foldSeams, hiddenOnKey, LARGE_SCALE, LEG, minRoom, MIN_LEG, restScale } from "@/utils/combo-fold";
import { assignComboHues, CB_HUES, HUES, textureOf } from "@/utils/combo-hues";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildComboMembershipIndex, membershipCode, type ComboMembership } from "@/utils/combo-membership";
import { demoKeyboard, denseKeyboard, randomKeyboard, type ComboKeyboard } from "./combo-test-helpers";

const m = (index: number, enabled = true): ComboMembership => ({ index, enabled, output: "KC_ESC", inputs: ["KC_A", "KC_B"] });

/** Every key of every layer, with the combos it shows (transparent keys inherit layer 0). */
function keysOf(kb: ComboKeyboard) {
    const index = buildComboMembershipIndex(kb.combos);
    const out: Array<{ id: string; ms: ComboMembership[] }> = [];
    kb.keymap.forEach((layer, l) => layer.forEach((code, pos) => {
        const c = membershipCode(code, l > 0 ? kb.keymap[0][pos] : undefined);
        const ms = index.get(c);
        if (ms?.length) out.push({ id: `${l}:${pos}`, ms });
    }));
    return out;
}

const KEYBOARDS: ComboKeyboard[] = [
    demoKeyboard(),
    denseKeyboard(),
    ...Array.from({ length: 60 }, (_, i) => randomKeyboard(1000 + i)),
];

describe("foldLayout fill rule", () => {
    it("one combo fills the whole corner", () => {
        const { shown } = foldLayout([m(4)]);
        expect(shown.map(c => c.index)).toEqual([4]);
        const [piece] = foldPieces(20, 18, shown.length);
        // From the bottom edge (t = 0) to the right edge (t = 1): the whole fold.
        expect(piece[1]).toEqual({ x: 2, y: 20 });
        expect(piece[2]).toEqual({ x: 20, y: 2 });
        expect(foldSeams(20, 18, 1)).toEqual([]);
    });

    it("two combos split the corner in order 1, 2", () => {
        const { shown } = foldLayout([m(7), m(2)]);
        expect(shown.map(c => c.index)).toEqual([2, 7]);
        const pieces = foldPieces(20, 18, 2);
        // Spot 0 touches the bottom edge, spot 1 the right edge, meeting at the fold's midpoint.
        expect(pieces[0][1]).toEqual({ x: 2, y: 20 });
        expect(pieces[0][2]).toEqual({ x: 11, y: 11 });
        expect(pieces[1][1]).toEqual({ x: 11, y: 11 });
        expect(pieces[1][2]).toEqual({ x: 20, y: 2 });
        expect(foldSeams(20, 18, 2)).toHaveLength(1);
    });

    it("three combos: the first two take the first two spots, the third the last spot", () => {
        const { shown } = foldLayout([m(9), m(1), m(5)]);
        expect(shown.map(c => c.index)).toEqual([1, 5, 9]);
        const pieces = foldPieces(20, 18, 3);
        expect(pieces[0][1]).toEqual({ x: 2, y: 20 });
        expect(pieces[2][2]).toEqual({ x: 20, y: 2 });
        // Equal widths along the fold edge.
        const width = (p: typeof pieces[0]) => Math.hypot(p[2].x - p[1].x, p[2].y - p[1].y);
        expect(width(pieces[0])).toBeCloseTo(width(pieces[1]));
        expect(width(pieces[1])).toBeCloseTo(width(pieces[2]));
        expect(foldSeams(20, 18, 3)).toHaveLength(2);
    });

    it("more than three: the lowest three by combo number, and nothing else", () => {
        const layout = foldLayout([m(8), m(3), m(11), m(0), m(6)]);
        expect(FOLD_CAP).toBe(3);
        expect(layout.shown.map(c => c.index)).toEqual([0, 3, 6]);
        expect(Object.keys(layout)).toEqual(["shown"]);
        expect([...hiddenOnKey([m(8), m(3), m(11), m(0), m(6)])].sort((a, b) => a - b)).toEqual([8, 11]);
        expect(hiddenOnKey([m(1), m(2), m(3)]).size).toBe(0);
    });

    it("a member key in a preview draws only the previewed combos, in the same order", () => {
        const ms = [m(1), m(4), m(6), m(9), m(12)];
        expect(foldLayout(ms, { focus: new Set([12, 4]) }).shown.map(c => c.index)).toEqual([4, 12]);
        // A previewed combo past the cap still shows on its keys.
        expect(foldLayout(ms, { focus: new Set([12]) }).shown.map(c => c.index)).toEqual([12]);
        // Not a member: all combos stay (the fold recedes instead).
        expect(foldLayout(ms, { focus: new Set([99]) }).shown.map(c => c.index)).toEqual([1, 4, 6]);
    });

    it("the large fold has 1.7x legs, strokes that grow more slowly, and keeps clear of legends", () => {
        const small = foldGeometry("default", 1e6, 1);
        const large = foldGeometry("default", 1e6, LARGE_SCALE);
        expect(LARGE_SCALE).toBe(1.7);
        expect(large.L).toBeCloseTo(LEG.default * 1.7);
        expect(large.crease / small.crease).toBeGreaterThan(1);
        expect(large.crease / small.crease).toBeLessThan(large.L / small.L);
        expect(large.seam / small.seam).toBeLessThan(large.L / small.L);
        // Crowded key: the large fold tucks in, never below the minimum leg.
        const tight = foldGeometry("default", 20, LARGE_SCALE);
        expect(tight.L + tight.crease + tight.clear).toBeLessThanOrEqual(20 + 1e-9);
        expect(foldGeometry("default", 5, LARGE_SCALE).L).toBe(MIN_LEG.default);
        expect(minRoom("small")).toBeGreaterThan(MIN_LEG.small);
    });

    it("at rest the large drawing scales to the compact size, never larger than the large fold", () => {
        for (const size of ["default", "medium", "small"] as const) {
            const r = restScale(size, 1e6);
            const big = foldGeometry(size, 1e6, LARGE_SCALE), small = foldGeometry(size, 1e6, 1);
            expect(r * (big.L + big.crease)).toBeCloseTo(small.L + small.crease);
            expect(r).toBeLessThan(1);
            for (const room of [6, 10, 14, 18, 22, 26, 30, 40]) expect(restScale(size, room)).toBeLessThanOrEqual(1);
        }
    });
});

describe("order stability", () => {
    for (const kb of KEYBOARDS) {
        it(`${kb.name}: two combos sharing keys keep one relative order on every key`, () => {
            const keys = keysOf(kb);
            for (const focus of [null, ...kb.combos.map((_, i) => new Set([i]))]) {
                // pair "a,b" -> sign of (position of a - position of b), across keys where both are drawn
                const seen = new Map<string, number>();
                for (const k of keys) {
                    const isMember = !!focus && k.ms.some(c => focus.has(c.index));
                    const order = foldLayout(k.ms, { focus: isMember ? focus : null }).shown.map(c => c.index);
                    // Drawn left to right in ascending combo number.
                    expect([...order].sort((a, b) => a - b)).toEqual(order);
                    for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
                        const [a, b] = [order[i], order[j]].sort((x, y) => x - y);
                        const pair = `${a},${b}`;
                        const sign = Math.sign(order.indexOf(a) - order.indexOf(b));
                        if (seen.has(pair)) expect(seen.get(pair)).toBe(sign);
                        seen.set(pair, sign);
                    }
                }
                // Every pair is drawn lower number first.
                for (const sign of seen.values()) expect(sign).toBe(-1);
            }
        });
    }

    it("the random layouts include pairs drawn together on two or more keys", () => {
        let pairs = 0;
        for (const kb of KEYBOARDS) {
            const count = new Map<string, number>();
            for (const k of keysOf(kb)) {
                const order = foldLayout(k.ms).shown.map(c => c.index);
                for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
                    const pair = `${order[i]},${order[j]}`;
                    count.set(pair, (count.get(pair) ?? 0) + 1);
                }
            }
            pairs += [...count.values()].filter(n => n >= 2).length;
        }
        expect(pairs).toBeGreaterThan(20);
    });
});

describe("combo hues", () => {
    for (const kb of KEYBOARDS) {
        it(`${kb.name}: one hue per combo on every key, never shared on a key`, () => {
            const hues = assignComboHues(kb);
            const keys = keysOf(kb);
            const hueOnKey = new Map<number, Set<number>>();
            for (const k of keys) {
                const onThisKey = k.ms.map(c => hues.get(c.index));
                for (const [i, c] of k.ms.entries()) {
                    expect(onThisKey[i]).toBeTypeOf("number");
                    const s = hueOnKey.get(c.index) ?? new Set<number>();
                    s.add(onThisKey[i]!);
                    hueOnKey.set(c.index, s);
                }
                // Combos sharing a key (at most six here) never share a hue.
                if (k.ms.length <= HUES.length) expect(new Set(onThisKey).size).toBe(onThisKey.length);
            }
            for (const s of hueOnKey.values()) expect(s.size).toBe(1);
        });
    }

    it("is stable for the same keyboard and recomputed when combos change", () => {
        const kb = denseKeyboard();
        expect(assignComboHues(kb)).toBe(assignComboHues(kb));
        const changed = { ...kb, combos: kb.combos.slice(0, 5) };
        expect(assignComboHues(changed)).not.toBe(assignComboHues(kb));
        expect(assignComboHues(changed).size).toBe(5);
    });

    it("judges clashes against the palette on screen and keeps the same invariants", () => {
        for (const kb of KEYBOARDS.slice(0, 10)) {
            const hues = assignComboHues(kb, "colorblind");
            expect(hues).not.toBe(assignComboHues(kb));
            for (const k of keysOf(kb)) {
                const onKey = k.ms.map(c => hues.get(c.index));
                if (k.ms.length <= CB_HUES.length) expect(new Set(onKey).size).toBe(onKey.length);
            }
        }
    });

    it("textures follow the hue slot: plain, lines, dots", () => {
        expect([0, 1, 2, 3, 4, 5].map(textureOf)).toEqual(["plain", "lines", "dots", "plain", "lines", "dots"]);
    });

    it("tokens in src/index.css match both palettes", () => {
        const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
        const rootStart = css.indexOf(":root {");
        const rootBlock = css.slice(rootStart, css.indexOf("}", rootStart));
        const cbStart = css.indexOf(':root[data-combo-palette="colorblind"]');
        expect(cbStart).toBeGreaterThan(0);
        const cbBlock = css.slice(cbStart, css.indexOf("}", cbStart));
        const val = (block: string, name: string) => new RegExp(`--kb-combo-fold-${name}:\\s*(#[0-9a-f]{6})`, "i").exec(block)?.[1]?.toLowerCase();
        for (const [block, table] of [[rootBlock, HUES], [cbBlock, CB_HUES]] as const) {
            for (const h of table) {
                expect(val(block, h.name)).toBe(h.light);
                expect(val(block, h.name + "-deep")).toBe(h.deep);
            }
        }
        expect(CB_HUES[3].light).toBe("#fffeab");
        expect(CB_HUES[4].deep).toBe("#aa2964");
    });

    it("no combos, no hues", () => {
        expect(assignComboHues(null).size).toBe(0);
        expect(assignComboHues({ combos: [] }).size).toBe(0);
    });
});
