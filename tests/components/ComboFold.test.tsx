import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComboFold, pieceLabel } from "@/components/combo/ComboFold";
import { FOLD_CORNER } from "@/utils/combo-fold";
import type { ComboMembership } from "@/utils/combo-membership";

const m = (index: number): ComboMembership => ({ index, enabled: true, output: "KC_ESC", inputs: ["LSFT(KC_F)", "KC_R"] });
const hues = new Map([[3, 0], [5, 1], [7, 2]]);

/** A key as Key.tsx draws it: optional header, legend, optional label band (footer), then the fold. */
function renderKey({ header = false, footer = false, combos = [m(3)], onOpen, tabbable = false, onKeyClick = vi.fn(), onKeyDown = vi.fn() }: {
    header?: boolean; footer?: boolean; combos?: ComboMembership[]; onOpen?: (i: number) => void; tabbable?: boolean;
    onKeyClick?: () => void; onKeyDown?: () => void;
} = {}) {
    const utils = render(
        <div data-keycap="" role="button" onClick={onKeyClick} onMouseDown={onKeyDown}>
            {header && <span className="rounded-t-sm">LSFT_T</span>}
            <div>F</div>
            {footer && <span className="rounded-t-none rounded-b-sm">LSFT</span>}
            <ComboFold memberships={combos} size="default" layerColor="primary" hues={hues} focusSet={null}
                onOpen={onOpen} tabbable={tabbable} names={{ "5": "Quick escape" }} />
        </div>,
    );
    const fold = utils.container.querySelector("svg[data-combo-fold]") as SVGSVGElement;
    return { ...utils, fold };
}

describe("fold corner", () => {
    it("is the bottom-right corner, the only placement", () => {
        expect(FOLD_CORNER).toEqual({ bottom: 0, right: 0 });
    });

    for (const [name, opts] of [
        ["a plain key", {}],
        ["a key with a label band along its bottom (LSFT)", { footer: true }],
        ["a key with a header and a label band", { header: true, footer: true }],
    ] as const) {
        it(`sits in the bottom-right corner on ${name}, never flipped to the top`, () => {
            const { fold } = renderKey(opts);
            expect(fold.style.bottom).toBe("0px");
            expect(fold.style.right).toBe("0px");
            expect(fold.style.top).toBe("");
            expect(fold.style.transform).toBe("");
        });
    }
});

describe("fold pieces are buttons", () => {
    it("are drawing only without onOpen", () => {
        const { fold } = renderKey({ footer: true });
        expect(fold.getAttribute("aria-hidden")).toBe("true");
        expect(fold.querySelector("[data-fold-action]")).toBeNull();
    });

    it("label each piece with its combo, and are Tab stops only on the layout's Tab stop", () => {
        const { fold, unmount } = renderKey({ combos: [m(3), m(5)], onOpen: vi.fn() });
        const pieces = [...fold.querySelectorAll("[data-fold-action]")];
        expect(pieces.map(p => p.getAttribute("aria-label"))).toEqual(["Edit Combo 3", "Edit Combo 5, Quick escape"]);
        expect(pieces.map(p => p.getAttribute("tabindex"))).toEqual(["-1", "-1"]);
        unmount();
        const again = renderKey({ combos: [m(3), m(5)], onOpen: vi.fn(), tabbable: true });
        expect([...again.fold.querySelectorAll("[data-fold-action]")].map(p => p.getAttribute("tabindex"))).toEqual(["0", "0"]);
        expect(pieceLabel(m(9))).toBe("Edit Combo 9");
    });

    it("a click on a piece opens that combo and does not reach the key", () => {
        const onOpen = vi.fn(), onKeyClick = vi.fn(), onKeyDown = vi.fn();
        const { fold } = renderKey({ footer: true, combos: [m(3), m(5), m(7)], onOpen, onKeyClick, onKeyDown });
        const piece = fold.querySelector('[data-fold-piece="5"]')!;
        fireEvent.mouseDown(piece);
        fireEvent.click(piece);
        expect(onOpen).toHaveBeenCalledWith(5);
        expect(onKeyClick).not.toHaveBeenCalled();
        expect(onKeyDown).not.toHaveBeenCalled();
    });

    it("Enter and Space on a piece open its combo; other keys do nothing", () => {
        const onOpen = vi.fn();
        const { fold } = renderKey({ combos: [m(3)], onOpen, tabbable: true });
        const piece = fold.querySelector('[data-fold-piece="3"]')!;
        fireEvent.keyDown(piece, { key: "a" });
        expect(onOpen).not.toHaveBeenCalled();
        fireEvent.keyDown(piece, { key: "Enter" });
        fireEvent.keyDown(piece, { key: " " });
        expect(onOpen.mock.calls).toEqual([[3], [3]]);
    });

    it("a click elsewhere on the key still reaches the key", () => {
        const onOpen = vi.fn(), onKeyClick = vi.fn();
        const { getByText } = renderKey({ footer: true, onOpen, onKeyClick });
        fireEvent.click(getByText("F"));
        expect(onKeyClick).toHaveBeenCalledTimes(1);
        expect(onOpen).not.toHaveBeenCalled();
    });
});
