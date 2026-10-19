import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keyboard } from "@/components/Keyboard";
import { ComboPreviewProvider, HOVER_DELAY_MS, LEAVE_DELAY_MS } from "@/contexts/ComboPreviewContext";
import { ComboPreviewRow } from "@/components/combo/ComboPreviewRow";
import { demoKeyboard } from "../utils/combo-test-helpers";
import { FOLD_IDLE_MS } from "@/lib/comboIndicators";
import { keyService } from "@/services/key.service";

const state = vi.hoisted(() => ({
    mode: "small" as string,
    colorblind: false,
    panels: { activePanel: null as string | null, itemToEdit: null as number | null },
    selectKeyboardKey: vi.fn(),
    openEditor: vi.fn(),
    assignKeycode: vi.fn(),
}));

vi.mock("@/contexts/LayoutSettingsContext", () => ({
    useLayoutSettings: () => ({
        internationalLayout: "us", keyVariant: "default", fingerClusterSqueeze: 0,
        is3DMode: false, isThumb3DOffsetActive: false, backdropOpacity: 0.45,
    }),
}));
vi.mock("@/contexts/SettingsContext", () => ({
    useSettings: () => ({
        getSetting: (name: string) => name === "combo-indicators" ? state.mode
            : name === "colorblind-combo-colors" ? state.colorblind : false,
    }),
}));
vi.mock("@/contexts/KeyBindingContext", () => ({
    useKeyBinding: () => ({ selectKeyboardKey: state.selectKeyboardKey, selectedTarget: null, clearSelection: vi.fn(), assignKeycode: state.assignKeycode }),
}));
vi.mock("@/contexts/PanelsContext", () => ({ usePanels: () => state.panels }));
vi.mock("@/hooks/useOpenBindingEditor", () => ({ useOpenBindingEditor: () => state.openEditor }));
vi.mock("@/hooks/useChanges", () => ({ useChanges: () => ({ hasPendingChangeForKey: () => false }) }));
vi.mock("@/hooks/useKeyDrag", () => ({
    useKeyDrag: () => ({
        handleMouseEnter: () => { }, handleMouseLeave: () => { }, handleMouseDown: () => { }, handleMouseUp: () => { },
        isDragHover: false, isDragSource: false, currentUnitSize: 60,
    }),
}));
vi.mock("@/components/ui/tooltip", () => ({
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/services/sval.service", () => ({ svalService: { getLayerName: (_k: unknown, l: number) => `Layer ${l}` } }));

const kb = demoKeyboard();

function renderAll() {
    return render(
        <ComboPreviewProvider>
            <Keyboard keyboard={kb as any} selectedLayer={0} setSelectedLayer={vi.fn()} instanceId="main" showKeyInspector />
            <ComboPreviewRow index={4} ariaLabel="Combo 4: D plus K gives Enter"><div>row 4</div></ComboPreviewRow>
            <button>elsewhere</button>
        </ComboPreviewProvider>,
    );
}

const keyEl = (code: string) => document.querySelector(`[data-keycode="${code}"]`) as HTMLElement;
const foldOf = (code: string) => keyEl(code).querySelector("svg[data-combo-fold]") as SVGSVGElement | null;
const order = (code: string) => foldOf(code)?.getAttribute("data-combo-order");
const readout = () => document.querySelector("[data-inspector-live] [data-combo-readout]");
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
    vi.useFakeTimers();
    state.mode = "small";
    state.colorblind = false;
    state.panels = { activePanel: null, itemToEdit: null };
    state.openEditor = vi.fn();
    state.assignKeycode.mockClear();
    state.selectKeyboardKey.mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe("combo folded corner on the layout", () => {
    it("draws each key's combos in combo-number order, three at most", () => {
        renderAll();
        expect(order("KC_J")).toBe("0");
        expect(order("KC_K")).toBe("0,1,4");
        // D is in combos 2, 3, 4 and 5: the lowest three, and nothing else.
        expect(order("KC_D")).toBe("2,3,4");
        expect(foldOf("KC_D")!.querySelectorAll("[data-fold-piece]")).toHaveLength(3);
        expect(foldOf("KC_Q")).toBeNull();
    });

    it("a click on a fold piece opens that combo's editor, not the key", () => {
        renderAll();
        const piece = foldOf("KC_D")!.querySelector('[data-fold-piece="3"]')!;
        fireEvent.click(piece);
        expect(state.openEditor).toHaveBeenCalledWith("combos", 3);
        expect(state.selectKeyboardKey).not.toHaveBeenCalled();
        expect(keyEl("KC_D").getAttribute("aria-pressed")).toBe("false");
        // Elsewhere on the key: as before (pins it), no editor.
        fireEvent.click(keyEl("KC_D"));
        expect(keyEl("KC_D").getAttribute("aria-pressed")).toBe("true");
        expect(state.openEditor).toHaveBeenCalledTimes(1);
    });

    it("while a binding editor is open, a fold is drawing only and a click on it picks the key", () => {
        state.panels = { activePanel: "macros", itemToEdit: 1 };
        renderAll();
        const fold = foldOf("KC_D")!;
        expect(fold.querySelector("[data-fold-action]")).toBeNull();
        expect(fold.getAttribute("aria-hidden")).toBe("true");
        expect([...fold.querySelectorAll("[data-fold-piece]")].some(p => p.hasAttribute("tabindex"))).toBe(false);
        fireEvent.click(fold.querySelector('[data-fold-piece="3"]')!);
        expect(state.openEditor).not.toHaveBeenCalled();
        expect(state.assignKeycode).toHaveBeenCalledWith("KC_D");
    });

    it("the Tab-stop key's fold pieces are Tab stops; Enter opens the combo", () => {
        renderAll();
        const stop = [...document.querySelectorAll<HTMLElement>("[data-inspect-pos]")].find(el => el.getAttribute("tabindex") === "0")!;
        const other = keyEl("KC_K");
        expect([...other.querySelectorAll("[data-fold-action]")].every(p => p.getAttribute("tabindex") === "-1")).toBe(true);
        act(() => { other.focus(); });
        expect([...other.querySelectorAll("[data-fold-action]")].every(p => p.getAttribute("tabindex") === "0")).toBe(true);
        expect(stop === other || stop.querySelectorAll('[data-fold-action][tabindex="0"]').length === 0).toBe(true);
        fireEvent.keyDown(other.querySelector('[data-fold-piece="1"]')!, { key: "Enter" });
        expect(state.openEditor).toHaveBeenCalledWith("combos", 1);
    });

    it("draws no overflow mark on a key with more than three combos", () => {
        renderAll();
        for (const code of ["KC_D", "KC_E"]) {
            const fold = foldOf(code)!;
            expect(fold.querySelector('[data-fold-part="sheet"], [data-fold-part="sheet-edge"]')).toBeNull();
            // The crease is the only part besides the pieces and seams.
            const parts = [...fold.querySelectorAll("[data-fold-part]")].map(e => e.getAttribute("data-fold-part"));
            expect(parts).toEqual(["crease"]);
            expect(fold.querySelectorAll("[data-fold-piece]")).toHaveLength(3);
            expect(fold.querySelectorAll("line")).toHaveLength(2);
        }
    });

    it("On scales folds toward the corner at rest; a saved Large or true is the same", () => {
        const restOf = (code: string) => (foldOf(code)!.querySelector("[data-fold-scale]") as SVGGElement).style.getPropertyValue("--kb-fold-rest");
        const { unmount } = renderAll();
        const rest = restOf("KC_J");
        expect(Number(rest)).toBeGreaterThan(0.4);
        expect(Number(rest)).toBeLessThan(1);
        unmount();
        for (const saved of ["large", true] as const) {
            (state as { mode: unknown }).mode = saved;
            const r = renderAll();
            expect(restOf("KC_J")).toBe(rest);
            r.unmount();
        }
    });

    it("pointer movement over the keyboard marks it active until the idle delay, without re-rendering", () => {
        renderAll();
        const layout = document.querySelector(".keyboard-layout") as HTMLElement;
        const fold = foldOf("KC_J");
        fireEvent.pointerMove(keyEl("KC_Q"), { pointerType: "mouse" });
        expect(layout.getAttribute("data-combo-motion")).toBe("active");
        tick(FOLD_IDLE_MS - 10);
        expect(layout.getAttribute("data-combo-motion")).toBe("active");
        tick(20);
        expect(layout.hasAttribute("data-combo-motion")).toBe(false);
        // Moving off the keyboard rests at once.
        fireEvent.pointerMove(keyEl("KC_Q"), { pointerType: "mouse" });
        fireEvent.pointerMove(screen.getByText("elsewhere"), { pointerType: "mouse", clientX: -50, clientY: -50 });
        expect(layout.hasAttribute("data-combo-motion")).toBe(false);
        // Keyboard focus on a combo key counts as activity.
        act(() => keyEl("KC_J").focus());
        expect(layout.getAttribute("data-combo-motion")).toBe("active");
        // Same fold element throughout: motion is an attribute, not a render.
        expect(foldOf("KC_J")).toBe(fold);
    });

    it("previewed keys stay large", () => {
        renderAll();
        const big = (code: string) => foldOf(code)!.querySelector("[data-fold-scale]")!.hasAttribute("data-fold-big");
        expect(big("KC_J")).toBe(false);
        fireEvent.mouseEnter(keyEl("KC_J"));
        tick(HOVER_DELAY_MS);
        expect(big("KC_J")).toBe(true);
        expect(big("KC_K")).toBe(true);
        expect(big("KC_E")).toBe(false);
    });

    it("a saved Large value grows and shrinks like On (Large is gone)", () => {
        state.mode = "large";
        renderAll();
        const layout = document.querySelector(".keyboard-layout") as HTMLElement;
        fireEvent.pointerMove(keyEl("KC_Q"), { pointerType: "mouse" });
        expect(layout.getAttribute("data-combo-motion")).toBe("active");
    });

    it("gives a combo the same color on every key it is on", () => {
        renderAll();
        const fillOn = (code: string, combo: number) => foldOf(code)!.querySelector(`[data-fold-piece="${combo}"]`)!.getAttribute("fill");
        expect(fillOn("KC_D", 4)).toBe(fillOn("KC_K", 4));
        expect(fillOn("KC_J", 0)).toBe(fillOn("KC_K", 0));
        const onK = ["0", "1", "4"].map(c => fillOn("KC_K", Number(c)));
        expect(new Set(onK).size).toBe(3);
    });

    it("makes every layout key a button with a description, and the layout one Tab stop", () => {
        renderAll();
        expect(keyEl("KC_J").getAttribute("role")).toBe("button");
        expect(keyEl("KC_J").getAttribute("aria-label")).toBe("J: in 1 combo. Combo 0: J plus K gives Esc");
        expect(keyEl("KC_Q").getAttribute("role")).toBe("button");
        expect(keyEl("KC_Q").getAttribute("aria-label")).toBe("Q");
        const stops = [...document.querySelectorAll("[data-inspect-pos]")].filter(el => el.getAttribute("tabindex") === "0");
        expect(stops).toHaveLength(1);
    });

    it.each([false, "off"] as const)("draws no folds and lights nothing when the setting is off (%s), but the inspector still shows", (off) => {
        (state as { mode: unknown }).mode = off;
        renderAll();
        expect(document.querySelector("svg[data-combo-fold]")).toBeNull();
        fireEvent.mouseEnter(keyEl("KC_J"));
        tick(HOVER_DELAY_MS);
        expect(readout()!.textContent).toContain("in 1 combo");
        // No corners are drawn, so there are no swatches to match.
        expect(readout()!.querySelector("[data-fold-glyph]")).toBeNull();
    });
});

describe("combo preview", () => {
    it("waits 250 ms on first hover, then switches between keys at once", () => {
        renderAll();
        fireEvent.mouseEnter(keyEl("KC_J"));
        tick(HOVER_DELAY_MS - 1);
        expect(readout()).toBeNull();
        tick(1);
        expect(readout()!.textContent).toContain("in 1 combo");
        // Partners light up with only the previewed combo; other folds recede.
        expect(order("KC_K")).toBe("0");
        expect(foldOf("KC_K")!.style.opacity).toBe("1");
        expect(foldOf("KC_D")!.style.opacity).toBe("0.22");

        fireEvent.mouseLeave(keyEl("KC_J"));
        fireEvent.mouseEnter(keyEl("KC_K"));
        expect(readout()!.textContent).toContain("in 3 combos");
        expect(order("KC_D")).toBe("4");
        expect(order("KC_L")).toBe("1");

        fireEvent.mouseLeave(keyEl("KC_K"));
        tick(LEAVE_DELAY_MS);
        expect(readout()).toBeNull();
        expect(foldOf("KC_D")!.style.opacity).toBe("1");
    });

    it("Esc that clears a hover preview is consumed, so it does not bind Esc to a selected key", () => {
        renderAll();
        fireEvent.mouseEnter(keyEl("KC_J"));
        tick(HOVER_DELAY_MS);
        expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(false);
        expect(readout()).toBeNull();
    });

    it("while a binding editor is open, Esc clears the preview without consuming it, so the same press closes the editor", () => {
        renderAll();
        fireEvent.mouseEnter(keyEl("KC_J"));
        tick(HOVER_DELAY_MS);
        document.documentElement.setAttribute("data-binding-spotlight", "");
        try {
            expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(true);
            expect(readout()).toBeNull();
        } finally {
            document.documentElement.removeAttribute("data-binding-spotlight");
        }
    });

    it("pins on click, keeps the pin after the pointer leaves, and Esc clears it", () => {
        renderAll();
        fireEvent.click(keyEl("KC_K"));
        expect(keyEl("KC_K").getAttribute("aria-pressed")).toBe("true");
        expect(readout()!.textContent).toContain("Pinned · Esc clears");
        fireEvent.mouseLeave(keyEl("KC_K"));
        tick(LEAVE_DELAY_MS + 10);
        expect(readout()!.textContent).toContain("in 3 combos");
        // Clicking keeps selecting the key as before.
        expect(state.selectKeyboardKey).toHaveBeenCalled();

        const notPrevented = fireEvent.keyDown(window, { key: "Escape" });
        // Esc that clears a pin is consumed, so it does not also bind Esc to a selected key.
        expect(notPrevented).toBe(false);
        expect(readout()).toBeNull();
        expect(keyEl("KC_K").getAttribute("aria-pressed")).toBe("false");
        // With nothing to clear, Esc passes through.
        expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(true);
    });

    it("clicking the pinned key again or empty space unpins; clicking another key moves the pin", () => {
        renderAll();
        fireEvent.click(keyEl("KC_K"));
        fireEvent.click(keyEl("KC_K"));
        act(() => { (document.activeElement as HTMLElement | null)?.blur(); });
        tick(LEAVE_DELAY_MS);
        expect(readout()).toBeNull();
        fireEvent.click(keyEl("KC_K"));
        fireEvent.click(keyEl("KC_Q"));
        expect(keyEl("KC_K").getAttribute("aria-pressed")).toBe("false");
        // A key in no combo pins too: the inspector describes every key.
        expect(keyEl("KC_Q").getAttribute("aria-pressed")).toBe("true");
        fireEvent.click(keyEl("KC_K"));
        fireEvent.click(document.body);
        expect(keyEl("KC_K").getAttribute("aria-pressed")).toBe("false");
    });

    it("a click outside unpins even where the app stops click propagation", () => {
        renderAll();
        const bar = document.createElement("div");
        bar.addEventListener("click", e => e.stopPropagation());
        document.body.appendChild(bar);
        fireEvent.click(keyEl("KC_K"));
        expect(keyEl("KC_K").getAttribute("aria-pressed")).toBe("true");
        fireEvent.click(bar);
        expect(keyEl("KC_K").getAttribute("aria-pressed")).toBe("false");
        bar.remove();
    });

    it("with a pinned card up, hovering another key replaces it at once", () => {
        renderAll();
        fireEvent.click(keyEl("KC_K"));
        fireEvent.mouseLeave(keyEl("KC_K"));
        tick(LEAVE_DELAY_MS + 10);
        fireEvent.mouseEnter(keyEl("KC_D"));
        expect(document.querySelector("[data-inspector-title]")!.textContent).toBe("D");
        fireEvent.mouseLeave(keyEl("KC_D"));
        tick(LEAVE_DELAY_MS + 10);
        expect(document.querySelector("[data-inspector-title]")!.textContent).toBe("K");
    });

    it("is keyboard accessible: focus previews at once, Enter pins, Esc clears until blur", () => {
        renderAll();
        act(() => keyEl("KC_J").focus());
        expect(readout()!.textContent).toContain("in 1 combo");
        fireEvent.keyDown(keyEl("KC_J"), { key: "Enter" });
        expect(keyEl("KC_J").getAttribute("aria-pressed")).toBe("true");
        fireEvent.keyDown(keyEl("KC_J"), { key: " " });
        expect(keyEl("KC_J").getAttribute("aria-pressed")).toBe("false");

        fireEvent.keyDown(window, { key: "Escape" });
        expect(readout()).toBeNull();
        // The element focused when Esc was pressed does not preview again until it blurs.
        fireEvent.focus(keyEl("KC_J"));
        expect(readout()).toBeNull();
        act(() => { keyEl("KC_J").blur(); });
        tick(LEAVE_DELAY_MS);
        act(() => keyEl("KC_J").focus());
        expect(readout()!.textContent).toContain("in 1 combo");
    });

    it("a combos-list row previews its combo at once and pins on click, without the inspector", () => {
        renderAll();
        const row = document.querySelector('[data-combo-row="4"]') as HTMLElement;
        fireEvent.mouseEnter(row);
        // The row already shows the combo; the inspector would only echo it.
        expect(readout()).toBeNull();
        expect(document.querySelector("[data-key-inspector]")).toBeNull();
        expect(order("KC_D")).toBe("4");
        expect(order("KC_K")).toBe("4");
        expect(foldOf("KC_J")!.style.opacity).toBe("0.22");
        expect(row.getAttribute("data-lit")).toBe("true");
        fireEvent.click(row);
        expect(row.getAttribute("aria-pressed")).toBe("true");
        fireEvent.mouseLeave(row);
        tick(LEAVE_DELAY_MS + 10);
        // Pinned: the layout keeps the combo lit, still with no inspector card.
        expect(readout()).toBeNull();
        expect(order("KC_D")).toBe("4");
        expect(row.getAttribute("data-lit")).toBe("true");
        act(() => row.focus());
        fireEvent.keyDown(row, { key: "Enter" });
        expect(row.getAttribute("aria-pressed")).toBe("false");
        expect(document.querySelector("[data-inspector-summary]")!.textContent).toBe("");
    });

    it("the inspector still shows for a layout key after a list row was hovered", () => {
        renderAll();
        const row = document.querySelector('[data-combo-row="4"]') as HTMLElement;
        fireEvent.mouseEnter(row);
        fireEvent.mouseEnter(keyEl("KC_K"));
        expect(document.querySelector("[data-inspector-title]")!.textContent).toBe("K");
    });

    it("an open combo editor counts as the previewed combo", () => {
        state.panels = { activePanel: "combos", itemToEdit: 6 };
        renderAll();
        // E is in combos 6 to 10; with combo 6 open, E and R show only combo 6.
        expect(order("KC_E")).toBe("6");
        expect(order("KC_R")).toBe("6");
        expect(foldOf("KC_J")!.style.opacity).toBe("0.22");
        // The readout is for hover and pin only; the editor already shows the combo.
        expect(readout()).toBeNull();
    });
});

describe("palette", () => {
    it("the colorblind setting swaps the palette tokens and adds the texture cue", () => {
        const { unmount } = renderAll();
        expect(document.documentElement.dataset.comboPalette).toBeUndefined();
        expect(document.querySelector("[data-fold-texture]")).toBeNull();
        unmount();
        state.colorblind = true;
        renderAll();
        expect(document.documentElement.dataset.comboPalette).toBe("colorblind");
        const textured = [...document.querySelectorAll("svg[data-combo-fold] [data-fold-texture]")];
        expect(textured.length).toBeGreaterThan(0);
        for (const el of textured) {
            expect(["lines", "dots"]).toContain(el.getAttribute("data-fold-texture"));
            const id = /url\(#(.+)\)/.exec(el.getAttribute("fill")!)![1];
            expect(el.closest("svg")!.querySelector(`pattern[id="${id}"]`)).not.toBeNull();
        }
        // Fills still come from the same hue tokens; the root attribute swaps their values.
        expect(foldOf("KC_J")!.querySelector("[data-fold-piece]")!.getAttribute("fill")).toMatch(/^var\(--kb-combo-fold-/);
    });
});

describe("readout", () => {
    it("lists every combo on a key with more than three, marking those not drawn", () => {
        renderAll();
        fireEvent.mouseEnter(keyEl("KC_E"));
        tick(HOVER_DELAY_MS);
        const lines = [...readout()!.querySelectorAll("[data-readout-combo]")];
        expect(lines.map(l => l.getAttribute("data-readout-combo"))).toEqual(["6", "7", "8", "9", "10"]);
        const notShown = lines.filter(l => l.querySelector("[data-readout-not-shown]")).map(l => l.getAttribute("data-readout-combo"));
        expect(notShown).toEqual(["9", "10"]);
        expect(lines[3].textContent).toContain("not shown on key");
    });

    it("lists chord keys and output for each combo", () => {
        renderAll();
        fireEvent.mouseEnter(keyEl("KC_E"));
        tick(HOVER_DELAY_MS);
        const text = readout()!.textContent!;
        expect(text).toContain("in 5 combos");
        expect(text).not.toContain("shown on the key");
        expect(text).toContain("Combo 10");
        expect(text).toContain("off");
        expect(screen.getByLabelText("Combo 7: W plus E gives =")).toBeTruthy();
    });

    it("shows a named combo's name in place of its number, and in its description", () => {
        const named = { ...kb, cosmetic: { ...kb.cosmetic, combos: { "7": "Equals" } } };
        render(
            <ComboPreviewProvider>
                <Keyboard keyboard={named as any} selectedLayer={0} setSelectedLayer={vi.fn()} instanceId="main" showKeyInspector />
            </ComboPreviewProvider>,
        );
        fireEvent.mouseEnter(keyEl("KC_E"));
        tick(HOVER_DELAY_MS);
        const line = readout()!.querySelector('[data-readout-combo="7"]')!;
        expect(line.querySelector("[data-readout-combo-name]")!.textContent).toBe("Equals");
        expect(line.textContent).not.toContain("Combo 7");
        expect(readout()!.querySelector('[data-readout-combo="6"]')!.textContent).toContain("Combo 6");
        expect(screen.getByLabelText("Equals (Combo 7): W plus E gives =")).toBeTruthy();
        // The key's own description names it too; the fold on the key does not change.
        expect(keyEl("KC_E").closest("[aria-label]")!.getAttribute("aria-label")).toContain("Equals (Combo 7)");
        expect(foldOf("KC_E")!.querySelector("title")!.textContent).not.toContain("Equals");
    });
});

describe("key inspector", () => {
    const live = () => document.querySelector("[data-inspector-live] [data-key-inspector]") as HTMLElement | null;
    const sections = () => [...live()!.querySelectorAll("[data-inspector-section]")].map(s => s.getAttribute("data-inspector-section"));

    function renderKb(board: any, extra?: ReactNode) {
        return render(
            <ComboPreviewProvider>
                <Keyboard keyboard={board} selectedLayer={0} setSelectedLayer={vi.fn()} instanceId="main" showKeyInspector />
                {extra}
            </ComboPreviewProvider>,
        );
    }

    it("shows a key in no combo too: header and footer, no sections", () => {
        renderAll();
        fireEvent.mouseEnter(keyEl("KC_Q"));
        tick(HOVER_DELAY_MS);
        expect(live()!.querySelector("[data-inspector-title]")!.textContent).toBe("Q");
        expect(sections()).toEqual([]);
        expect(live()!.querySelector("[data-inspector-footer]")!.textContent).toMatch(/^Layer 0 · R\d+ C\d+ · Matrix \d+$/);
    });

    it("combo swatches use the same hue as the key's folds", async () => {
        const { assignComboHues, HUES } = await import("@/utils/combo-hues");
        renderAll();
        fireEvent.mouseEnter(keyEl("KC_K"));
        tick(HOVER_DELAY_MS);
        const hues = assignComboHues(kb);
        const lines = [...live()!.querySelectorAll("[data-readout-combo]")];
        expect(lines.map(l => l.getAttribute("data-readout-combo"))).toEqual(["0", "1", "4"]);
        for (const l of lines) {
            const combo = Number(l.getAttribute("data-readout-combo"));
            const glyph = Number(l.querySelector("[data-fold-glyph]")!.getAttribute("data-fold-glyph"));
            expect(glyph).toBe(hues.get(combo));
            const fill = foldOf("KC_K")!.querySelector(`[data-fold-piece="${combo}"]`)!.getAttribute("fill")!;
            expect(fill).toContain(`--kb-combo-fold-${HUES[glyph].name}`);
        }
    });

    it("lists tap dance actions for a tap dance key, only the slots that are set", () => {
        const board = demoKeyboard() as any;
        const qPos = board.keymap[0].indexOf(Number(keyServiceParse("KC_Q")));
        board.keymap = board.keymap.map((l: number[]) => [...l]);
        board.keymap[0][qPos] = Number(keyServiceParse("TD(0)"));
        board.tapdances = [{ idx: 0, tap: "KC_A", hold: "KC_LSHIFT", doubletap: "KC_ESCAPE", taphold: "KC_NO", tapping_term: 180 }];
        renderKb(board);
        const el = document.querySelector('[data-keycode="TD(0)"]') as HTMLElement;
        fireEvent.mouseEnter(el);
        tick(HOVER_DELAY_MS);
        expect(sections()).toEqual(["tapdance"]);
        const t = live()!.textContent!;
        expect(t).toContain("Tap Dance 0");
        expect(t).toContain("On Tap");
        expect(t).toContain("On Hold");
        expect(t).toContain("Double Tap");
        expect(t).not.toContain("Tap Then Hold");
        expect(t).toContain("180 ms");
    });

    it("hovering caps a long combo list; pinning lists every combo", () => {
        const board = demoKeyboard() as any;
        const extra = ["KC_A", "KC_S", "KC_F", "KC_G"].map((k, i) => ({ cmbid: 12 + i, keys: ["KC_E", k, "KC_NO", "KC_NO"], output: "KC_TAB", options: 1 << 15 }));
        board.combos = [...board.combos, ...extra];
        renderKb(board);
        fireEvent.mouseEnter(keyEl("KC_E"));
        tick(HOVER_DELAY_MS);
        expect(live()!.querySelectorAll("[data-readout-combo]")).toHaveLength(6);
        expect(live()!.querySelector("[data-inspector-more-combos]")!.textContent).toBe("+3 More Combos");
        fireEvent.click(keyEl("KC_E"));
        expect(live()!.querySelectorAll("[data-readout-combo]")).toHaveLength(9);
        expect(live()!.querySelector("[data-inspector-more-combos]")).toBeNull();
    });

    it("announces focus and pin to screen readers, never mouse hover", () => {
        renderAll();
        const summary = () => document.querySelector("[data-inspector-summary]")!.textContent;
        fireEvent.mouseEnter(keyEl("KC_J"));
        tick(HOVER_DELAY_MS);
        expect(summary()).toBe("");
        expect(live()!.getAttribute("aria-hidden")).toBe("true");
        fireEvent.mouseLeave(keyEl("KC_J"));
        tick(LEAVE_DELAY_MS);
        act(() => keyEl("KC_J").focus());
        expect(summary()).toContain("J");
        expect(summary()).toContain("In 1 combo.");
    });

    it("arrow keys move between layout keys in matrix order", () => {
        renderAll();
        const keys = [...document.querySelectorAll<HTMLElement>("[data-inspect-pos]")]
            .sort((a, b) => Number(a.dataset.inspectPos) - Number(b.dataset.inspectPos));
        act(() => keys[0].focus());
        fireEvent.keyDown(keys[0], { key: "ArrowRight" });
        expect(document.activeElement).toBe(keys[1]);
        expect(keys[1].getAttribute("tabindex")).toBe("0");
        expect(keys[0].getAttribute("tabindex")).toBe("-1");
        fireEvent.keyDown(keys[1], { key: "End" });
        expect(document.activeElement).toBe(keys[keys.length - 1]);
        fireEvent.keyDown(keys[keys.length - 1], { key: "Home" });
        expect(document.activeElement).toBe(keys[0]);
    });

    it("one card: a secondary view drives the inspector under the primary view only", () => {
        render(
            <ComboPreviewProvider>
                <Keyboard keyboard={kb as any} selectedLayer={0} setSelectedLayer={vi.fn()} instanceId="main" showKeyInspector />
                <Keyboard keyboard={kb as any} selectedLayer={0} setSelectedLayer={vi.fn()} instanceId="second" />
            </ComboPreviewProvider>,
        );
        const second = document.querySelector('[data-keyboard-instance="second"] [data-keycode="KC_Q"]') as HTMLElement;
        fireEvent.mouseEnter(second);
        tick(HOVER_DELAY_MS);
        expect(document.querySelectorAll("[data-key-inspector]")).toHaveLength(1);
        expect(document.querySelector('[data-keyboard-instance="main"] [data-key-inspector]')).not.toBeNull();
    });
});

const keyServiceParse = (s: string) => keyService.parse(s);
