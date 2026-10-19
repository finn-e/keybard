import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { keyService } from "@/services/key.service";
import { AltRepeatKeyOptions, ComboOptions, LeaderOptions, type KeyboardInfo } from "@/types/keyboard.types";
import { buildKeyIndex, inspectKey, KEY_OVERRIDE_ENABLED, keyLabel, type Part, type Section } from "@/utils/key-inspect";

const code = (s: string) => Number(keyService.parse(s));
const ON = ComboOptions.ENABLED;

function makeKb(): KeyboardInfo {
    return {
        rows: 10, cols: 6, layers: 4,
        keymap: [
            ["KC_Q", "LCTL_T(KC_A)", "LT2(KC_SPACE)", "MO(1)", "TD(0)", "M0", "KC_BSPACE", "KC_G", "KC_E", "TD(9)", "KC_NO", "QK_USER_0"].map(code),
            ["KC_TRNS", "KC_TRNS", "KC_X", "KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_TRNS", "KC_TRNS"].map(code),
            [], [],
        ],
        combos: [
            { cmbid: 0, keys: ["KC_E", "KC_R", "KC_NO", "KC_NO"], output: "KC_ESCAPE", options: ON },
            { cmbid: 1, keys: ["KC_E", "KC_W", "KC_NO", "KC_NO"], output: "KC_A", options: ON },
            { cmbid: 2, keys: ["KC_E", "KC_D", "KC_NO", "KC_NO"], output: "KC_TAB", options: 0 },
            { cmbid: 3, keys: ["KC_E", "KC_F", "KC_NO", "KC_NO"], output: "KC_ENTER", options: ON },
            { cmbid: 4, keys: ["KC_E", "KC_S", "KC_NO", "KC_NO"], output: "KC_DELETE", options: ON },
            { cmbid: 5, keys: ["KC_NO", "KC_NO", "KC_NO", "KC_NO"], output: "KC_NO", options: 0 },
        ],
        tapdances: [
            { idx: 0, tap: "KC_A", hold: "KC_LCTRL", doubletap: "KC_NO", taphold: "KC_B", tapping_term: 200 },
        ],
        macros: [
            { mid: 0, actions: [["down", "KC_LCTRL"], ["tap", "KC_C"], ["up", "KC_LCTRL"], ["delay", 50]] },
        ],
        key_overrides: [
            { koid: 0, trigger: "KC_BSPACE", replacement: "KC_DELETE", layers: 0b101, trigger_mods: 1, negative_mod_mask: 0, suppressed_mods: 0, options: KEY_OVERRIDE_ENABLED },
            { koid: 1, trigger: "KC_NO", replacement: "KC_A", layers: 0xffff, trigger_mods: 0, negative_mod_mask: 0, suppressed_mods: 0, options: 0 },
        ],
        alt_repeat_keys: [
            { arkid: 0, keycode: "KC_E", alt_keycode: "KC_A", allowed_mods: 0, options: AltRepeatKeyOptions.ENABLED },
        ],
        leaders: [
            { ldrid: 0, sequence: ["KC_G", "KC_G", "KC_NO", "KC_NO", "KC_NO"], output: "KC_HOME", options: LeaderOptions.ENABLED },
        ],
        custom_keycodes: [{ name: "QK_USER_0", title: "Sniper mode", shortName: "Snipe" }],
        cosmetic: { layer: { "2": "Nav" }, tapdances: { "0": "Ctrl Tap" }, macros: { "0": "Copy" }, layer_colors: { "2": "blue" } },
    };
}

const at = (kb: KeyboardInfo, layer: number, pos: number, effective?: { code: number; layer: number }) =>
    inspectKey(kb, { layer, row: Math.floor(pos / kb.cols), col: pos % kb.cols, code: kb.keymap![layer][pos], effective });
const ids = (secs: Section[]) => secs.map(s => s.id);
const text = (parts: Part[]) => parts.map(p => (p.t === "chip" ? `[${p.label}]` : p.t === "text" ? p.text : p.t === "plus" ? "+" : "→")).join(" ");
const rows = (sec: Section | undefined) => (sec?.rows ?? []).map(r => `${r.label}: ${text(r.parts)}${r.off ? " (off)" : ""}${r.note ? ` · ${r.note}` : ""}`);

describe("key inspector model", () => {
    const kb = makeKb();

    it("a plain key with nothing attached has a header and footer only", () => {
        const m = at(kb, 0, 0);
        expect(m.title).toBe("Q");
        expect(m.kind).toBe("");
        expect(m.before).toEqual([]);
        expect(m.after).toEqual([]);
        expect(m.combos).toEqual([]);
        expect(m.footer).toBe("Layer 0 · R0 C0 · Matrix 0");
    });

    it("mod-tap: Tap and Hold", () => {
        const m = at(kb, 0, 1);
        expect(m.kind).toBe("Mod-Tap");
        expect(rows(m.before[0])).toEqual(["Tap: [A]", "Hold: [Ctrl]"]);
    });

    it("layer-tap and layer keys name the layer, with its color", () => {
        const lt = at(kb, 0, 2);
        expect(lt.kind).toBe("Layer-Tap");
        expect(rows(lt.before[0])).toEqual(["Tap: [Space]", "Hold: [Layer 2 Nav]"]);
        expect(lt.before[0].rows[1].parts[0]).toMatchObject({ t: "chip", layer: 2 });
        const mo = at(kb, 0, 3);
        expect(mo.kind).toBe("Momentary Layer");
        expect(rows(mo.before[0])).toEqual(["Hold: [Layer 1]"]);
    });

    it("tap dance: lists each action that is set, then the tapping term", () => {
        const m = at(kb, 0, 4);
        expect(m.kind).toBe("Tap Dance");
        expect(ids(m.before)).toEqual(["tapdance"]);
        expect(m.before[0].title).toBe("Tap Dance 0");
        expect(m.before[0].titleNote).toBe("Ctrl Tap");
        expect(rows(m.before[0])).toEqual(["On Tap: [A]", "On Hold: [L Ctrl]", "Tap Then Hold: [B]", "Tapping Term: 200 ms"]);
        expect(rows(m.before[0]).join()).not.toContain("Double Tap");
    });

    it("tap dance that is not defined", () => {
        const m = at(kb, 0, 9);
        expect(m.before[0].title).toBe("Tap Dance 9");
        expect(rows(m.before[0])).toEqual([": Not Defined"]);
    });

    it("macro: steps and a short preview", () => {
        const m = at(kb, 0, 5);
        expect(m.kind).toBe("Macro");
        expect(m.before[0].title).toBe("Macro 0");
        expect(m.before[0].titleNote).toBe("Copy");
        expect(rows(m.before[0])[0]).toBe("Steps: 4 C");
        expect(rows(m.before[0])[1]).toBe(": Down [L Ctrl] Tap [C] Up [L Ctrl] Delay 50 ms");
    });

    it("custom keycode shows its name and description", () => {
        const m = at(kb, 0, 11);
        expect(m.kind).toBe("Custom");
        expect(rows(m.before[0])).toEqual(["Custom: [Snipe] · Sniper mode"]);
    });

    it("key overrides on the trigger, with mods, layers and off state", () => {
        const m = at(kb, 0, 6);
        expect(ids(m.after)).toContain("overrides");
        expect(rows(m.after.find(s => s.id === "overrides"))).toEqual(["Override 0: [Ctrl] + [Bksp] → [Del] · Layers 0, 2"]);
    });

    it("leaders that contain the key; alt repeat on the key", () => {
        expect(rows(at(kb, 0, 7).after.find(s => s.id === "leaders"))).toEqual(["Leader 0: [G] [G] → [Home]"]);
        expect(rows(at(kb, 0, 8).after.find(s => s.id === "altrepeat"))).toEqual(["Alt Repeat 0: [E] → [A]"]);
    });

    it("lists every combo the key is in, enabled or not, and skips empty combos", () => {
        const m = at(kb, 0, 8);
        expect(m.combos.map(c => c.index)).toEqual([0, 1, 2, 3, 4]);
        expect(m.combos[2].enabled).toBe(false);
    });

    it("Also Used In: outputs and slots elsewhere", () => {
        const a = inspectKey(kb, { layer: 0, row: 0, col: 1, code: code("KC_A") });
        const used = a.after.find(s => s.id === "used")!;
        // Override 1 has no trigger, so it is not a use.
        expect(text(used.rows[0].parts)).toBe("Alt Repeat 0 · Alternate Combo 1 · Output Tap Dance 0 · On Tap");
    });

    it("sections appear only with content, in a fixed order", () => {
        for (let pos = 0; pos < 12; pos++) {
            const m = at(kb, 0, pos);
            for (const s of [...m.before, ...m.after]) expect(s.rows.length).toBeGreaterThan(0);
            const order = ["overrides", "altrepeat", "leaders", "used"];
            const got = ids(m.after);
            expect(got).toEqual(order.filter(id => got.includes(id as never)));
        }
    });

    it("a transparent key describes the key it falls through to", () => {
        const m = at(kb, 1, 1, { code: code("LCTL_T(KC_A)"), layer: 0 });
        expect(m.title).toBe("A / Ctrl");
        expect(m.kind).toBe("Mod-Tap");
        expect(rows(m.before[0])).toEqual(["Falls Through: [A / Ctrl] · from Layer 0", "Tap: [A]", "Hold: [Ctrl]"]);
        expect(m.footer).toBe("Layer 1 · R0 C1 · Matrix 1 · From Layer 0");
        const td = at(kb, 1, 4, { code: code("TD(0)"), layer: 0 });
        expect(ids(td.before)).toEqual(["action", "tapdance"]);
        const e = at(kb, 1, 8, { code: code("KC_E"), layer: 0 });
        expect(e.combos).toHaveLength(5);
    });

    it("KC_NO reads None", () => {
        const m = at(kb, 0, 10);
        expect(m.title).toBe("None");
        expect(m.before).toEqual([]);
    });

    it("summary is one sentence-like line for screen readers", () => {
        expect(at(kb, 0, 1).summary).toBe("A / Ctrl, Mod-Tap: Tap A, Hold Ctrl. Layer 0.");
        expect(at(kb, 0, 8).summary).toContain("In 5 combos.");
    });

    it("reverse index finds each feature by keycode", () => {
        const ix = buildKeyIndex(kb);
        expect(ix.overrides.get(code("KC_BSPACE"))).toEqual([0]);
        expect(ix.overrides.has(code("KC_NO"))).toBe(false);
        expect(ix.leaders.get(code("KC_G"))).toEqual([0]);
        expect(ix.altRepeat.get(code("KC_E"))).toEqual([0]);
    });

    it("chip labels read like keys", () => {
        expect(keyLabel(kb, "KC_ESCAPE")).toBe("Esc");
        expect(keyLabel(kb, "RCTL_T(KC_B)")).toBe("B / Right Ctrl");
        expect(keyLabel(kb, "LCTL(KC_C)")).toBe("Ctrl C");
        expect(keyLabel(kb, "TD(3)")).toBe("TD 3");
        expect(keyLabel(kb, "OSM(MOD_LSFT)")).toBe("OSM Shift");
    });
});

describe("Also Used In caps", () => {
    const withUses = (n: number): KeyboardInfo => ({
        ...makeKb(),
        tapdances: Array.from({ length: n }, (_, i) => ({ idx: i, tap: "KC_Z", hold: "KC_NO", doubletap: "KC_NO", taphold: "KC_NO", tapping_term: 200 })),
    });
    const usedText = (kb: KeyboardInfo) => text(inspectKey(kb, { layer: 0, row: 0, col: 0, code: code("KC_Z") }).after.find(s => s.id === "used")!.rows[0].parts);
    it("lists up to six, then +N More, up to eight references", () => {
        expect(usedText(withUses(6)).split("Tap Dance").length - 1).toBe(6);
        expect(usedText(withUses(7))).toMatch(/Tap Dance 5 · On Tap \+1 More$/);
        expect(usedText(withUses(8))).toMatch(/\+2 More$/);
    });
    it("past eight, a count only", () => {
        expect(usedText(withUses(9))).toBe("Used in 9 places");
    });
});

describe("one hue assignment", () => {
    it("folds, inspector swatches and the Combos list all take hues from assignComboHues", () => {
        const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
        expect(read("src/components/Keyboard.tsx")).toMatch(/assignComboHues\(keyboard, comboPreview\.palette\)/);
        expect(read("src/components/Keyboard.tsx")).toMatch(/<KeyInspector[\s\S]*hues=\{comboHues\}/);
        expect(read("src/layout/SecondarySidebar/Panels/CombosPanel.tsx")).toMatch(/assignComboHues\(keyboard, comboPalette\)/);
    });
});

describe("one owner for key details", () => {
    const src = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
    it("the bottom-left info panel is gone in both layout modes", () => {
        expect(existsSync(resolve(process.cwd(), "src/components/InfoPanelWidget.tsx"))).toBe(false);
        const layout = src("src/layout/EditorLayout.tsx");
        expect(layout).not.toMatch(/showInfoPanel|InfoPanelWidget|Picked Key Info|No key selected/);
        expect(src("src/layout/EditorControls.tsx")).not.toMatch(/Show Key Info|showInfoToggle/);
    });
    it("the ghost-key layer tooltip is retired; the inspector names the source layer", () => {
        expect(src("src/components/Keyboard.tsx")).not.toMatch(/TooltipContent/);
    });
});
