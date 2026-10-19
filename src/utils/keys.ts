import { CODEMAP } from "@/constants/keygen";
import { customKeycodeShortName } from "@/constants/custom-keycode-labels";
import { keyService } from "@/services/key.service";
import { KeyboardInfo } from "@/types/keyboard.types";

/**
 * True if a keycode refers to a tap dance, e.g. "TD(3)" or its numeric form.
 * Tap dances must never contain other tap dances (see describeTapdance).
 */
export function isTapdanceKeycode(keystr: any): boolean {
    if (keystr === undefined || keystr === null) return false;
    let s: any = keystr;
    if (typeof s === "number") {
        s = keyService.stringify(s);
    }
    if (typeof s !== "string") return false;
    return /^TD\(\d+\)$/.test(keyService.canonical(s) as string);
}

const describeTapdance = (KBINFO: KeyboardInfo, tdid: number, tapdance?: any): string => {
    if (!tapdance) {
        tapdance = KBINFO.tapdances?.[tdid];
    }
    if (!tapdance) {
        return "";
    }
    const ret = [];
    for (const k of ["tap", "hold", "doubletap", "taphold"]) {
        const slot = tapdance[k];
        if (slot) {
            // A tap dance must never reference another tap dance. Recursing into one
            // (getKeyContents -> describeTapdance -> getKeyContents ...) blows the call
            // stack and white-screens the app, so show the raw reference instead.
            if (isTapdanceKeycode(slot)) {
                ret.push(typeof slot === "string" ? slot : keyService.stringify(slot));
            } else {
                ret.push(getKeyContents(KBINFO!, slot)!.str);
            }
        }
    }
    return ret.join(" ");
};

function describeMacro(KBINFO: KeyboardInfo, mid: any, macro?: any) {
    if (!macro) {
        macro = (KBINFO?.macros as any)?.[mid];
    }
    if (!macro) {
        return {
            str: "M" + mid,
            title: "M" + mid,
        };
    }
    if (macro.actions.length > 0) {
        const all = [];
        const title = [];
        let texts = [];
        const shorts = [];
        for (const act of macro.actions) {
            let mkey;
            if (act[0] === "delay") {
                mkey = act[1];
            } else {
                mkey = act[1].replace("KC_", "");
            }
            if (act[0] === "text") {
                texts.push(act[1]);
                title.push(act[1]);
            } else if (act[0] === "down") {
                all.push(mkey);
                if (mkey.length === 1) {
                    shorts.push(mkey);
                }
                title.push("down", act[1]);
            } else if (act[0] === "up") {
                all.push(mkey);
                title.push("up", act[1]);
                if (mkey.length === 1) {
                    shorts.push(mkey);
                }
            } else if (act[0] === "tap") {
                all.push(mkey);
                title.push("tap", act[1]);
                if (mkey.length === 1) {
                    shorts.push(mkey);
                }
            } else if (act[0] === "delay") {
                all.push(mkey);
                title.push("delay", act[1]);
                if (mkey.length === 1) {
                    shorts.push(mkey);
                }
            }
        }
        if (texts.length === 0) {
            texts = shorts;
        }
        if (texts.length === 0) {
            texts = ["M" + mid];
        }
        return {
            str: texts.join(""),
            title: title.join(" "),
        };
    }
    return {
        str: "M" + mid,
        title: "M" + mid,
    };
}

const LAYERKEYS: any = {
    MO: ["MO", "While pressed, activate layer: ", "key-layer key-layer-mo"],
    DF: ["DF", "Switch default layer: ", "key-layer key-layer-df"],
    PDF: ["PDF", "Sets a persistent default layer: ", "key-layer key-layer-df"],
    TG: ["TG", "Toggle layer: ", "key-layer key-layer-tg"],
    TT: ["TT", "Tap-Toggle: ", "key-layer key-layer-tt"],
    OSL: ["OSL", "Toggle layer active for one key: ", "key-layer key-layer-osl"],
    TO: ["TO", "Toggle all off but: ", "key-layer key-layer-to"],
};

function getEditableName(KBINFO: KeyboardInfo, type: any, index: number, def: any, skipidx: any) {
    if (KBINFO.cosmetic && !(type in KBINFO.cosmetic)) {
        return def;
    }
    let prefix = index + ": ";
    if (skipidx) {
        prefix = "";
    }
    if ((KBINFO.cosmetic as any)?.[type]?.[index]) {
        return prefix + (KBINFO.cosmetic as any)?.[type]?.[index];
    } else {
        return index;
    }
}

const masks = {
    0x100: ["Ctrl", "C"],
    0x200: ["Shft", "S"],
    0x400: ["Alt", "A"],
    0x800: ["GUI", "G"],
    0x1000: ["RHS", "R"],
};
// For modmask: Show "Shift A", "C+S A", "C+S+A A", etc.
export function showModMask(modids: any) {
    const allmods = [];
    for (const [k, v] of Object.entries(masks)) {
        if (modids & (k as any)) {
            allmods.push(v);
        }
    }
    if (allmods.length > 1) {
        return allmods.map((m) => m[1]).join("+");
    }
    return allmods.map((m) => m[0]).join("+");
}

export function getModMasks(modids: any) {
    const allmods = [];
    for (const [k, v] of Object.entries(masks)) {
        if (modids & (k as any)) {
            allmods.push(v[1]);
        }
    }
    return allmods;
}

export function getKeyContents(KBINFO: KeyboardInfo, keystr: any): any {
    if (keystr === undefined || keystr === null) {
        return undefined;
    }
    let m;

    keystr = keyService.canonical(keystr);

    // Special handling for HYPR_T which keyService often fails to parse
    m = keystr.match(/^HYPR_T\((.*)\)$/);
    if (m) {
        const innerKey = m[1];
        const kckey = getKeyContents(KBINFO, innerKey);
        // Fallback for inner title
        let kctitle = kckey?.title || innerKey;
        if (kctitle === "KC_NO" || innerKey === "KC_NO") {
            kctitle = "Selected Key";
        }

        return {
            type: "modtap",
            mods: "HYPR",
            modids: 0, // No valid ID available, but we don't need it for display
            top: "HYPR",
            str: kckey?.str || innerKey,
            title: "Hyper + " + kctitle,
        };
    }

    const keyid = keyService.parse(keystr);

    if (keyid === 0) {
        const def = keyService.define("KC_NO");
        return def ? { ...def, top: "KC_NO" } : def;
    }

    if (!keyid) {
        console.log("invalid", keystr);
        return {
            str: "??Invld??",
            title: "Invalid key string",
        };
    }

    // Handle USER keys with custom keycodes (legacy Vial range: USER00-USER63)
    m = keystr.match(/^USER(\d+)$/);
    if (m) {
        const userIndex = parseInt(m[1], 10);
        if (KBINFO.custom_keycodes && KBINFO.custom_keycodes[userIndex]) {
            const custom = KBINFO.custom_keycodes[userIndex];
            return {
                type: "user",
                str: customKeycodeShortName(custom),
                title: custom.title,
                top: keystr,
            };
        }
        // Fallback to default if not found
        const def = keyService.define(keystr);
        return def ? { ...def, top: keystr } : def;
    }

    // Handle QK_USER keys with custom keycodes (QMK/Svil range: QK_USER_0-QK_USER_31)
    m = keystr.match(/^QK_USER(?:_(\d+))?$/);
    if (m) {
        const userIndex = m[1] ? parseInt(m[1], 10) : 0;
        if (KBINFO.custom_keycodes && KBINFO.custom_keycodes[userIndex]) {
            const custom = KBINFO.custom_keycodes[userIndex];
            return {
                type: "user",
                str: customKeycodeShortName(custom),
                title: custom.title,
                top: keystr,
            };
        }
        // Fallback to default if not found
        const def = keyService.define(keystr);
        return def ? { ...def, top: keystr } : def;
    }

    if (keystr.startsWith("KC_") && (keyid & 0xff00) === 0) {
        const def = keyService.define(keystr);
        return def ? { ...def, top: keystr } : def;
    }

    m = keystr.match(/^OSM\((.*)\)$/);
    if (m) {
        const rawMods = m[1].replace(/MOD_/g, "");
        const parts = rawMods.split("|");
        // For multiple modifiers, abbreviate: LCTL|LALT → "LCA", RSFT|RGUI → "RSG"
        let osmStr = rawMods;
        if (parts.length > 1) {
            const side = parts[0]?.[0] || ""; // "L" or "R"
            const abbrevMap: Record<string, string> = { CTL: "C", SFT: "S", ALT: "A", GUI: "G" };
            const letters = parts.map((p: string) => abbrevMap[p.slice(1)] || p.slice(1, 2)).join("");
            osmStr = side + letters;
        }
        return {
            type: "OSM",
            top: "OSM",
            str: osmStr,
            title: keystr,
        };
    }

    m = keystr.match(/^(\w+)\((\d+)\)$/);
    if (m) {
        if (keyid in CODEMAP) {
            // TODO: MO(), etc with custom layer names.
            const mkey = keyService.define(keyid);
            const lname = getEditableName(KBINFO, "layer", m[2], m[2], true);
            if (m[1] in LAYERKEYS) {
                const ldesc = LAYERKEYS[m[1]];
                return {
                    type: "layer",
                    layertext: ldesc[0],
                    top: keystr,
                    str: lname,
                    title: ldesc[1] + lname,
                };
            }
            if (m[1] === "TD") {
                const desc = describeTapdance(KBINFO, m[2]);
                return {
                    type: "tapdance",
                    top: keystr,
                    tdid: m[2],
                    str: desc,
                    title: `Tap Dance ${m[2]} - ${desc}`,
                };
            }
            return {
                type: "other",
                str: lname,
                top: m[1] + "()",
                title: mkey?.title,
            };
        }
    }
    m = keystr.match(/^LT(\d+)\((.*)\)$/);
    if (m) {
        let lname = getEditableName(KBINFO, "layer", m[1], m[1], true);
        if (m[2] === "kc") {
            return {
                type: "layerhold",
                layertext: `Hold(${lname})`,
                str: "",
                title: `Layer ${lname} on hold, Selected Key otherwise.`,
            };
        } else {
            const kckey = keyService.define(m[2]);
            return {
                type: "layerhold",
                layertext: `Hold(${m[1]})`,
                str: kckey?.str,
                title: `Layer ${lname} on hold, ${m[2]} otherwise.`,
            };
        }
    }



    m = keystr.match(/^M(\d+)$/);
    if (m) {
        const desc = describeMacro(KBINFO, m[1]);
        return {
            type: "macro",
            str: desc.str,
            top: keystr,
            title: desc.title,
        };
    }

    m = keystr.match(/^(\w+_T)\((.*)\)$/);
    if (m) {
        let modmask = keyid & 0xff00;
        let kcmask = keyid & 0x00ff;
        if (modmask in CODEMAP && kcmask in CODEMAP) {
            const modkey = keyService.define(modmask);
            const kckey = keyService.define(kcmask);
            const modstr = modkey?.str.replace("(kc)", "").replace("\n", " ").trim();
            let kctitle = kckey?.title;
            if (kctitle === "KC_NO") {
                kctitle = "Selected Key";
            }
            return {
                type: "modtap",
                mods: modstr,
                modids: modmask,
                top: modstr,
                str: kckey?.str,
                title: modkey?.title,
            };
        }
    }

    m = keystr.match(/^(\w+)\((.*)\)$/);
    if (m) {
        let modmask = keyid & 0xff00;
        let kcmask = keyid & 0x00ff;
        if (modmask in CODEMAP && kcmask in CODEMAP) {
            const modkey = keyService.define(modmask);
            const kckey = keyService.define(kcmask);
            const modstr = modkey?.str.replace("(kc)", "").replace("\n", " ").trim();
            let kctitle = kckey?.title;
            if (kctitle === "KC_NO") {
                kctitle = "Selected Key";
            }
            return {
                type: "modmask",
                mods: modstr,
                modids: modmask,
                top: modstr,
                str: kckey?.str,
                title: modkey?.title + " + " + kctitle,
            };
        }
    }

    if (keyid in CODEMAP) {
        const def = keyService.define(keyid);
        const top = typeof keystr === "string" ? keystr : (CODEMAP[keyid] as string);
        return def ? { ...def, top } : def;
    }
    return {
        str: keystr,
        title: "Unknown: " + keystr,
    };
}
