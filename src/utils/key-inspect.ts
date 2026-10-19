// Key inspector model: everything Keybard knows about one layout key, as a list of sections
// that the KeyInspector card renders. Pure, so it can be tested without React.
//
// Sections, in a fixed order, each present only when it has content:
//   Action (or "Tap Dance N" / "Macro N"), Combos, Key Overrides, Alt Repeat, Leaders,
//   Also Used In. The footer names the layer, position and matrix index.
import { keyService } from "@/services/key.service";
import { svalService } from "@/services/sval.service";
import { getLabelForKeycode } from "@/components/Keyboards/layouts";
import { AltRepeatKeyOptions, ComboOptions, LeaderOptions, type KeyboardInfo } from "@/types/keyboard.types";
import { decomposeKeycode, type Modifier } from "@/utils/modifierUtils";
import { comboTriggerCodes, type ComboMembership, type ComboMembershipIndex, buildComboMembershipIndex } from "@/utils/combo-membership";
import { knownShortName, shortKeyName } from "@/utils/combo-labels";

/** Key override "enabled" option bit (firmware ko_option_t). */
export const KEY_OVERRIDE_ENABLED = 1 << 7;

const KC_NO = 0;
const KC_TRNS = 1;
const ALL_LAYERS = 0xffff;

export interface InspectTarget {
    layer: number;
    row: number;
    col: number;
    /** Keycode stored at this position on this layer. */
    code: number;
    /** For a transparent key: the key it falls through to, and that key's layer. */
    effective?: { code: number; layer: number };
}

export type Part =
    | { t: "chip"; label: string; out?: boolean; layer?: number }
    | { t: "plus" }
    | { t: "arrow" }
    | { t: "text"; text: string; mono?: boolean };

export interface Row {
    label: string;
    parts: Part[];
    off?: boolean;
    note?: string;
}

export type SectionId = "action" | "tapdance" | "macro" | "combos" | "overrides" | "altrepeat" | "leaders" | "used";

export interface Section {
    id: SectionId;
    title: string;
    /** Cosmetic name, shown muted after the title. */
    titleNote?: string;
    off?: boolean;
    rows: Row[];
}

export interface Reference { label: string }

export interface KeyInspection {
    title: string;
    /** Kind label ("Mod-Tap", "Tap Dance", ...), empty for a plain key. */
    kind: string;
    /** Canonical keycode the inspector describes (the effective key for a transparent one). */
    keycode: string;
    /** Combos the described key triggers, ascending by combo number. */
    combos: ComboMembership[];
    /** Sections other than Combos, in display order; Combos goes after the first action section. */
    before: Section[];
    after: Section[];
    footer: string;
    /** One-sentence summary for screen readers. */
    summary: string;
}

// ---------------------------------------------------------------- labels

const MOD_LABEL: Record<Modifier, string> = { Ctrl: "Ctrl", Shift: "Shift", Alt: "Alt", Gui: "GUI" };
const modLabel = (m: Modifier, right: boolean) => (right ? "Right " : "") + MOD_LABEL[m];

/** 8-bit mod mask (LCTL LSFT LALT LGUI RCTL RSFT RALT RGUI), as key overrides store it. */
export function modMaskLabels(mask: number): string[] {
    const out: string[] = [];
    const mods: Modifier[] = ["Ctrl", "Shift", "Alt", "Gui"];
    mods.forEach((m, i) => { if (mask & (1 << i)) out.push(modLabel(m, false)); });
    mods.forEach((m, i) => { if (mask & (1 << (i + 4))) out.push(modLabel(m, true)); });
    return out;
}

const truncate = (s: string, n = 24) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** "Layer 2 Nav", or "Layer 2" when the layer has no name of its own. */
export function layerLabel(kb: KeyboardInfo, layer: number): string {
    const name = kb.cosmetic?.layer?.[String(layer)];
    const fallback = svalService.getLayerName(kb, layer);
    const own = name ?? (fallback.startsWith("Layer") ? undefined : fallback);
    return own && own !== `Layer ${layer}` && own !== String(layer) ? `Layer ${layer} ${truncate(own)}` : `Layer ${layer}`;
}

const toCode = (k: string | number | undefined | null): number => {
    if (k == null || k === "") return KC_NO;
    if (typeof k === "number") return k;
    const n = Number(keyService.parse(k));
    return Number.isFinite(n) ? n : KC_NO;
};
const toStr = (code: number) => String(keyService.stringify(code));

function plainLabel(code: number, s: string, intl: string): string {
    const known = knownShortName(s);
    if (known) return known;
    const intlLabel = getLabelForKeycode(s, intl);
    // Layouts name letters in lowercase; keys and chips show them as capitals.
    if (intlLabel) return intlLabel.length === 1 ? intlLabel.toUpperCase() : intlLabel.replace(/\n/g, " ");
    const def = keyService.define(code);
    if (def?.str && !/^0x/i.test(def.str)) return def.str.replace(/\n/g, " ");
    return shortKeyName(s);
}

/** Short label for a keycode as it reads on a chip: like the key's own legend. */
export function keyLabel(kb: KeyboardInfo | null | undefined, k: string | number, intl = "us"): string {
    const code = toCode(k);
    const s = typeof k === "string" && !/^\d+$/.test(k) ? String(keyService.canonical(k)) : toStr(code);
    if (code === KC_NO) return "None";
    if (code === KC_TRNS) return "Transparent";
    if (code < 0x100) return plainLabel(code, s, intl);
    const dk = decomposeKeycode(code);
    if (dk) {
        const mods = dk.modifiers.map(m => modLabel(m, dk.side === "right"));
        const base = keyLabel(kb, dk.baseKeycode, intl);
        if (dk.isModTap) return `${base === "None" ? "" : base + " / "}${mods.join("+")}`;
        // Shifted symbols stringify to their own name (KC_EXLM): read them as a key.
        if (!s.includes("(")) return plainLabel(code, s, intl);
        return `${mods.join("+")} ${base}`;
    }
    let m: RegExpExecArray | null;
    if (code >= 0x4000 && code <= 0x4fff) {
        const base = keyLabel(kb, code & 0xff, intl);
        return `${base === "None" ? "" : base + " / "}L${(code >> 8) & 0xf}`;
    }
    if ((m = /^(MO|TG|TT|OSL|TO|DF|PDF)\((\d+)\)$/.exec(s))) return `${m[1]} ${m[2]}`;
    if ((m = /^TD\((\d+)\)$/.exec(s))) return `TD ${m[1]}`;
    if ((m = /^M(\d+)$/.exec(s))) return `Macro ${m[1]}`;
    if (code >= 0x52a0 && code <= 0x52bf) return `OSM ${oneShotMods(code).join("+")}`;
    const user = customKeycode(kb, s);
    if (user) return user.shortName.replace(/\\n|\n/g, " ");
    const def = keyService.define(code);
    if (def?.str && !/^0x/i.test(def.str)) return def.str.replace(/\n/g, " ");
    return shortKeyName(s);
}

function oneShotMods(code: number): string[] {
    const bits = code & 0x1f;
    const right = !!(bits & 0x10);
    return (["Ctrl", "Shift", "Alt", "Gui"] as Modifier[]).filter((_, i) => bits & (1 << i)).map(m => modLabel(m, right));
}

function customKeycode(kb: KeyboardInfo | null | undefined, s: string) {
    let m: RegExpExecArray | null;
    let idx: number | null = null;
    if ((m = /^USER(\d+)$/.exec(s))) idx = parseInt(m[1], 10);
    else if ((m = /^QK_USER(?:_(\d+))?$/.exec(s))) idx = m[1] ? parseInt(m[1], 10) : 0;
    if (idx == null) return null;
    return kb?.custom_keycodes?.[idx] ?? null;
}

const chip = (kb: KeyboardInfo, k: string | number, intl: string, out = false): Part => ({ t: "chip", label: keyLabel(kb, k, intl), out });
const isSet = (k: string | undefined | null) => !!k && toCode(k) !== KC_NO;

// ---------------------------------------------------------------- reverse index

export interface KeyIndex {
    combos: ComboMembershipIndex;
    overrides: Map<number, number[]>;
    altRepeat: Map<number, number[]>;
    leaders: Map<number, number[]>;
    used: Map<number, Reference[]>;
}

const push = <T,>(m: Map<number, T[]>, code: number, v: T) => {
    if (code <= KC_TRNS) return;
    const l = m.get(code) ?? [];
    l.push(v);
    m.set(code, l);
};

/** Reverse lookups by keycode, built once per keyboard change. */
export function buildKeyIndex(kb: KeyboardInfo): KeyIndex {
    const overrides = new Map<number, number[]>();
    const altRepeat = new Map<number, number[]>();
    const leaders = new Map<number, number[]>();
    const used = new Map<number, Reference[]>();
    (kb.key_overrides || []).forEach((o, i) => {
        push(overrides, toCode(o.trigger), i);
        if (toCode(o.trigger) > KC_TRNS) push(used, toCode(o.replacement), { label: `Override ${i} · Replacement` });
    });
    (kb.alt_repeat_keys || []).forEach((a, i) => {
        push(altRepeat, toCode(a.keycode), i);
        if (toCode(a.keycode) > KC_TRNS) push(used, toCode(a.alt_keycode), { label: `Alt Repeat ${i} · Alternate` });
    });
    (kb.leaders || []).forEach((l, i) => {
        const seq = new Set((l.sequence || []).map(toCode).filter(c => c > KC_TRNS));
        seq.forEach(c => push(leaders, c, i));
        if (seq.size) push(used, toCode(l.output), { label: `Leader ${i} · Output` });
    });
    (kb.combos || []).forEach((c, i) => {
        if (comboTriggerCodes(c).size) push(used, toCode(c.output), { label: `Combo ${i} · Output` });
    });
    (kb.tapdances || []).forEach((td, i) => {
        for (const [slot, name] of TD_SLOTS) push(used, toCode(td[slot]), { label: `Tap Dance ${i} · ${name}` });
    });
    (kb.macros || []).forEach((mc, i) => {
        const codes = new Set<number>();
        for (const [type, value] of mc.actions || []) {
            if ((type === "tap" || type === "down" || type === "up") && typeof value === "string") codes.add(toCode(value));
        }
        codes.forEach(c => push(used, c, { label: `Macro ${i}` }));
    });
    return { combos: buildComboMembershipIndex(kb.combos), overrides, altRepeat, leaders, used };
}

const TD_SLOTS = [["tap", "On Tap"], ["hold", "On Hold"], ["doubletap", "Double Tap"], ["taphold", "Tap Then Hold"]] as const;

// ---------------------------------------------------------------- action

const LAYER_FN: Record<string, [kind: string, row: string]> = {
    MO: ["Momentary Layer", "Hold"],
    TG: ["Toggle Layer", "Toggle"],
    TT: ["Tap-Toggle Layer", "Hold or Tap"],
    OSL: ["One Shot Layer", "One Shot"],
    TO: ["Switch to Layer", "Switch To"],
    DF: ["Default Layer", "Default"],
    PDF: ["Default Layer", "Persistent Default"],
};

const MACRO_VERB: Record<string, string> = { down: "Down", up: "Up", tap: "Tap", delay: "Delay", text: "Text" };
const MACRO_STEP_CAP = 6;

/** Text preview of a macro: its typed text, else its single-character keys. */
export function macroPreview(actions: [string, string | number][]): string {
    const texts: string[] = [];
    const shorts: string[] = [];
    for (const [type, value] of actions) {
        if (type === "text") texts.push(String(value));
        else if (type !== "delay") {
            const k = String(value).replace(/^KC_/, "");
            if (k.length === 1 && type !== "up") shorts.push(k);
        }
    }
    return (texts.length ? texts : shorts).join("");
}

interface Action { kind: string; sections: Section[] }

function describeAction(kb: KeyboardInfo, code: number, intl: string): Action {
    const s = toStr(code);
    let m: RegExpExecArray | null;
    if (code === KC_NO) return { kind: "", sections: [] };
    if (code === KC_TRNS) return { kind: "Transparent", sections: [] };
    if (code < 0x100) return { kind: "", sections: [] };

    const action = (rows: Row[]): Section[] => [{ id: "action", title: "Action", rows }];
    const modChips = (mods: string[]): Part[] => mods.flatMap((x, i) => (i ? [{ t: "plus" } as Part] : []).concat({ t: "chip", label: x }));

    const dk = decomposeKeycode(code);
    if (dk) {
        const mods = dk.modifiers.map(x => modLabel(x, dk.side === "right"));
        if (dk.isModTap) {
            const rows: Row[] = [];
            if (toCode(dk.baseKeycode) !== KC_NO) rows.push({ label: "Tap", parts: [chip(kb, dk.baseKeycode, intl)] });
            rows.push({ label: "Hold", parts: modChips(mods) });
            return { kind: "Mod-Tap", sections: action(rows) };
        }
        if (!s.includes("(")) return { kind: "", sections: [] };
        return { kind: "Modified Key", sections: action([{ label: "Sends", parts: [...modChips(mods), { t: "plus" }, chip(kb, dk.baseKeycode, intl)] }]) };
    }
    if (code >= 0x4000 && code <= 0x4fff) {
        const layer = (code >> 8) & 0xf;
        const rows: Row[] = [];
        if ((code & 0xff) !== KC_NO) rows.push({ label: "Tap", parts: [chip(kb, code & 0xff, intl)] });
        rows.push({ label: "Hold", parts: [{ t: "chip", label: layerLabel(kb, layer), layer }] });
        return { kind: "Layer-Tap", sections: action(rows) };
    }
    if ((m = /^(MO|TG|TT|OSL|TO|DF|PDF)\((\d+)\)$/.exec(s))) {
        const layer = Number(m[2]);
        const [kind, row] = LAYER_FN[m[1]];
        return { kind, sections: action([{ label: row, parts: [{ t: "chip", label: layerLabel(kb, layer), layer }] }]) };
    }
    if (code >= 0x52a0 && code <= 0x52bf) {
        return { kind: "One Shot Mod", sections: action([{ label: "One Shot", parts: modChips(oneShotMods(code)) }]) };
    }
    if ((m = /^TD\((\d+)\)$/.exec(s))) {
        const n = Number(m[1]);
        const td = kb.tapdances?.[n];
        const name = kb.cosmetic?.tapdances?.[String(n)];
        const sec: Section = { id: "tapdance", title: `Tap Dance ${n}`, titleNote: name ? truncate(name) : undefined, rows: [] };
        if (!td) sec.rows.push({ label: "", parts: [{ t: "text", text: "Not Defined" }] });
        else {
            sec.off = td.enabled === false;
            for (const [slot, label] of TD_SLOTS) if (isSet(td[slot])) sec.rows.push({ label, parts: [chip(kb, td[slot], intl)] });
            sec.rows.push({ label: "Tapping Term", parts: [{ t: "text", text: `${(td.tapping_term ?? 0) & 0x7fff} ms` }] });
        }
        return { kind: "Tap Dance", sections: [sec] };
    }
    if ((m = /^M(\d+)$/.exec(s))) {
        const n = Number(m[1]);
        const mc = kb.macros?.[n];
        const name = kb.cosmetic?.macros?.[String(n)];
        const sec: Section = { id: "macro", title: `Macro ${n}`, titleNote: name ? truncate(name) : undefined, rows: [] };
        const actions = mc?.actions || [];
        if (!mc) sec.rows.push({ label: "", parts: [{ t: "text", text: "Not Defined" }] });
        else {
            const preview = macroPreview(actions);
            sec.rows.push({ label: "Steps", parts: [{ t: "text", text: String(actions.length) }, ...(preview ? [{ t: "text", text: preview, mono: true } as Part] : [])] });
            if (actions.length) {
                const steps: Part[] = [];
                for (const [type, value] of actions.slice(0, MACRO_STEP_CAP)) {
                    steps.push({ t: "text", text: MACRO_VERB[type] ?? type });
                    if (type === "delay") steps.push({ t: "text", text: `${value} ms` });
                    else if (type === "text") steps.push({ t: "text", text: truncate(String(value), 16), mono: true });
                    else steps.push(chip(kb, String(value), intl));
                }
                if (actions.length > MACRO_STEP_CAP) steps.push({ t: "text", text: `+${actions.length - MACRO_STEP_CAP} More` });
                sec.rows.push({ label: "", parts: steps });
            }
        }
        return { kind: "Macro", sections: [sec] };
    }
    const user = customKeycode(kb, s);
    if (user) {
        return { kind: "Custom", sections: action([{ label: "Custom", parts: [{ t: "chip", label: user.shortName.replace(/\\n|\n/g, " ") }], note: user.title || undefined }]) };
    }
    return { kind: "", sections: [] };
}

// ---------------------------------------------------------------- inspection

export const ALSO_USED_CAP = 6;
export const ALSO_USED_LIST_MAX = 8;

const layersNote = (kb: KeyboardInfo, mask: number) => {
    const n = kb.layers ?? kb.keymap?.length ?? 16;
    const all = (1 << n) - 1;
    if (mask === ALL_LAYERS || (mask & all) === all) return undefined;
    const ls: number[] = [];
    for (let i = 0; i < 16; i++) if (mask & (1 << i)) ls.push(i);
    return ls.length ? `Layers ${ls.join(", ")}` : undefined;
};

export function inspectKey(kb: KeyboardInfo, target: InspectTarget, index: KeyIndex = buildKeyIndex(kb), intl = "us"): KeyInspection {
    const fallsThrough = target.code === KC_TRNS && target.effective && target.effective.code > KC_TRNS;
    const code = fallsThrough ? target.effective!.code : target.code;
    const keycode = toStr(code);
    const act = describeAction(kb, code, intl);

    const before: Section[] = [];
    if (fallsThrough) {
        const ft: Row = { label: "Falls Through", parts: [chip(kb, code, intl)], note: `from ${layerLabel(kb, target.effective!.layer)}` };
        const own = act.sections.find(x => x.id === "action");
        if (own) own.rows.unshift(ft);
        else before.push({ id: "action", title: "Action", rows: [ft] });
    }
    before.push(...act.sections);

    const combos = code > KC_TRNS ? index.combos.get(code) ?? [] : [];
    const after: Section[] = [];

    const ovr = (index.overrides.get(code) ?? []).map(i => {
        const o = kb.key_overrides![i];
        const mods = modMaskLabels(o.trigger_mods || 0);
        const parts: Part[] = [];
        mods.forEach(x => { parts.push({ t: "chip", label: x }, { t: "plus" }); });
        parts.push(chip(kb, o.trigger, intl), { t: "arrow" }, chip(kb, o.replacement, intl, true));
        return { label: `Override ${i}`, parts, off: !(o.options & KEY_OVERRIDE_ENABLED), note: layersNote(kb, o.layers) } as Row;
    });
    if (ovr.length) after.push({ id: "overrides", title: "Key Overrides", rows: ovr });

    const ark = (index.altRepeat.get(code) ?? []).map(i => {
        const a = kb.alt_repeat_keys![i];
        return { label: `Alt Repeat ${i}`, parts: [chip(kb, a.keycode, intl), { t: "arrow" }, chip(kb, a.alt_keycode, intl, true)], off: !(a.options & AltRepeatKeyOptions.ENABLED) } as Row;
    });
    if (ark.length) after.push({ id: "altrepeat", title: "Alt Repeat", rows: ark });

    const ldr = (index.leaders.get(code) ?? []).map(i => {
        const l = kb.leaders![i];
        const seq = (l.sequence || []).filter(isSet);
        return { label: `Leader ${i}`, parts: [...seq.map(k => chip(kb, k, intl)), { t: "arrow" }, chip(kb, l.output, intl, true)], off: !(l.options & LeaderOptions.ENABLED) } as Row;
    });
    if (ldr.length) after.push({ id: "leaders", title: "Leaders", rows: ldr });

    const used = code > KC_TRNS ? index.used.get(code) ?? [] : [];
    if (used.length) {
        const parts: Part[] = used.length <= ALSO_USED_LIST_MAX
            ? [...used.slice(0, ALSO_USED_CAP).map(r => ({ t: "text", text: r.label } as Part)),
                ...(used.length > ALSO_USED_CAP ? [{ t: "text", text: `+${used.length - ALSO_USED_CAP} More` } as Part] : [])]
            : [{ t: "text", text: `Used in ${used.length} places` }];
        after.push({ id: "used", title: "Also Used In", rows: [{ label: "", parts }] });
    }

    const cols = kb.cols || 1;
    const footer = [
        layerLabel(kb, target.layer),
        `R${target.row} C${target.col}`,
        `Matrix ${target.row * cols + target.col}`,
        ...(fallsThrough ? [`From ${layerLabel(kb, target.effective!.layer)}`] : []),
    ].join(" · ");

    const title = target.code === KC_TRNS && !fallsThrough ? "Transparent" : keyLabel(kb, code, intl);
    const kind = target.code === KC_TRNS && !fallsThrough ? "" : act.kind;

    const partText = (p: Part) => (p.t === "chip" ? p.label : p.t === "text" ? p.text : p.t === "plus" ? "plus" : "gives");
    const firstRows = before.flatMap(sec => sec.rows.filter(r => r.label).map(r => `${r.label} ${r.parts.map(partText).join(" ")}`));
    const summary = [
        `${title}${kind ? `, ${kind}` : ""}${firstRows.length ? `: ${firstRows.join(", ")}` : ""}.`,
        combos.length ? `In ${combos.length} combo${combos.length === 1 ? "" : "s"}.` : "",
        ovr.length ? `${ovr.length} key override${ovr.length === 1 ? "" : "s"}.` : "",
        `${layerLabel(kb, target.layer)}.`,
    ].filter(Boolean).join(" ");

    return { title, kind, keycode, combos, before, after, footer, summary };
}

/** Is a combo enabled (bit 15)? Shared with the inspector's combo rows. */
export const comboEnabled = (options: number) => !!(options & ComboOptions.ENABLED);
