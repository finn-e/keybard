import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keyboard } from "@/components/Keyboard";
import { ComboPreviewProvider, HOVER_DELAY_MS, LEAVE_DELAY_MS } from "@/contexts/ComboPreviewContext";
import { ComboPreviewRow } from "@/components/combo/ComboPreviewRow";
import { demoKeyboard } from "../utils/combo-test-helpers";

const state = vi.hoisted(() => ({
    indicatorsOn: true,
    panels: { activePanel: null as string | null, itemToEdit: null as number | null },
    selectKeyboardKey: vi.fn(),
}));

vi.mock("@/contexts/LayoutSettingsContext", () => ({
    useLayoutSettings: () => ({
        internationalLayout: "us", keyVariant: "default", fingerClusterSqueeze: 0,
        is3DMode: false, isThumb3DOffsetActive: false, backdropOpacity: 0.45,
    }),
}));
vi.mock("@/contexts/SettingsContext", () => ({
    useSettings: () => ({ getSetting: (name: string) => name === "show-combo-indicators" ? state.indicatorsOn : false }),
}));
vi.mock("@/contexts/KeyBindingContext", () => ({
    useKeyBinding: () => ({ selectKeyboardKey: state.selectKeyboardKey, selectedTarget: null, clearSelection: vi.fn(), assignKeycode: vi.fn() }),
}));
vi.mock("@/contexts/PanelsContext", () => ({ usePanels: () => state.panels }));
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
            <Keyboard keyboard={kb as any} selectedLayer={0} setSelectedLayer={vi.fn()} instanceId="main" showComboReadout />
            <ComboPreviewRow index={4} ariaLabel="Combo 4: D plus K gives Enter"><div>row 4</div></ComboPreviewRow>
            <button>elsewhere</button>
        </ComboPreviewProvider>,
    );
}

const keyEl = (code: string) => document.querySelector(`[data-keycode="${code}"]`) as HTMLElement;
const foldOf = (code: string) => keyEl(code).querySelector("svg[data-combo-fold]") as SVGSVGElement | null;
const order = (code: string) => foldOf(code)?.getAttribute("data-combo-order");
const readout = () => document.querySelector("[data-combo-readout]");
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
    vi.useFakeTimers();
    state.indicatorsOn = true;
    state.panels = { activePanel: null, itemToEdit: null };
});
afterEach(() => { vi.useRealTimers(); });

describe("combo folded corner on the layout", () => {
    it("draws each key's combos in combo-number order, three at most", () => {
        renderAll();
        expect(order("KC_J")).toBe("0");
        expect(order("KC_K")).toBe("0,1,4");
        // D is in combos 2, 3, 4 and 5: the lowest three plus the second sheet.
        expect(order("KC_D")).toBe("2,3,4");
        expect(foldOf("KC_D")!.querySelector('[data-fold-part="sheet"]')).not.toBeNull();
        expect(foldOf("KC_K")!.querySelector('[data-fold-part="sheet"]')).toBeNull();
        expect(foldOf("KC_Q")).toBeNull();
    });

    it("gives a combo the same color on every key it is on", () => {
        renderAll();
        const fillOn = (code: string, combo: number) => foldOf(code)!.querySelector(`[data-fold-piece="${combo}"]`)!.getAttribute("fill");
        expect(fillOn("KC_D", 4)).toBe(fillOn("KC_K", 4));
        expect(fillOn("KC_J", 0)).toBe(fillOn("KC_K", 0));
        const onK = ["0", "1", "4"].map(c => fillOn("KC_K", Number(c)));
        expect(new Set(onK).size).toBe(3);
    });

    it("makes keys in a combo focusable buttons with a description", () => {
        renderAll();
        expect(keyEl("KC_J").getAttribute("tabindex")).toBe("0");
        expect(keyEl("KC_J").getAttribute("role")).toBe("button");
        expect(keyEl("KC_J").getAttribute("aria-label")).toBe("J: in 1 combo. Combo 0: J plus K gives Esc");
        expect(keyEl("KC_Q").getAttribute("tabindex")).toBeNull();
    });

    it("draws nothing and adds no tab stops when the setting is off", () => {
        state.indicatorsOn = false;
        renderAll();
        expect(document.querySelector("svg[data-combo-fold]")).toBeNull();
        expect(keyEl("KC_J").getAttribute("tabindex")).toBeNull();
        fireEvent.mouseEnter(keyEl("KC_J"));
        tick(HOVER_DELAY_MS);
        expect(readout()).toBeNull();
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

    it("clicking the pinned key again, a key in no combo, or empty space unpins", () => {
        renderAll();
        fireEvent.click(keyEl("KC_K"));
        fireEvent.click(keyEl("KC_K"));
        expect(readout()).toBeNull();
        fireEvent.click(keyEl("KC_K"));
        fireEvent.click(keyEl("KC_Q"));
        expect(keyEl("KC_K").getAttribute("aria-pressed")).toBe("false");
        fireEvent.click(keyEl("KC_K"));
        fireEvent.click(document.body);
        expect(keyEl("KC_K").getAttribute("aria-pressed")).toBe("false");
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

    it("a combos-list row previews its combo at once and pins on click", () => {
        renderAll();
        const row = document.querySelector('[data-combo-row="4"]') as HTMLElement;
        fireEvent.mouseEnter(row);
        expect(readout()!.textContent).toContain("Combo 4");
        expect(order("KC_D")).toBe("4");
        expect(order("KC_K")).toBe("4");
        expect(foldOf("KC_J")!.style.opacity).toBe("0.22");
        expect(row.getAttribute("data-lit")).toBe("true");
        fireEvent.click(row);
        expect(row.getAttribute("aria-pressed")).toBe("true");
        fireEvent.mouseLeave(row);
        tick(LEAVE_DELAY_MS + 10);
        expect(readout()!.textContent).toContain("Pinned · Esc clears");
        act(() => row.focus());
        fireEvent.keyDown(row, { key: "Enter" });
        expect(row.getAttribute("aria-pressed")).toBe("false");
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

describe("readout", () => {
    it("lists chord keys and output for each combo", () => {
        renderAll();
        fireEvent.mouseEnter(keyEl("KC_E"));
        tick(HOVER_DELAY_MS);
        const text = readout()!.textContent!;
        expect(text).toContain("in 5 combos · 3 shown on the key");
        expect(text).toContain("Combo 10");
        expect(text).toContain("off");
        expect(screen.getByLabelText("Combo 7: W plus E gives =")).toBeTruthy();
    });
});
