// Combo folded corner: the key's bottom-right corner reads as a folded-over page corner.
//
// - One combo: the whole fold is that combo's color.
// - Two or three: the fold is cut by lines from the key's corner to equal divisions of the fold
//   edge, so every piece meets the crease at the same width. Pieces are in combo-number order
//   (see foldLayout in src/utils/combo-fold.ts).
// - More than three: the lowest three plus a second sheet peeking out behind the fold.
// - A crease in black alpha (the header/footer band vocabulary) edges the fold; on light keys
//   it is stronger so the fold keeps a crisp edge.
// - A footer band owns the bottom edge, so on those keys the fold takes the top-right corner
//   (mirrored, so the spots keep their order from the horizontal edge).
// - The fold never touches a legend: on crowded keys it tucks in smaller.
// - Preview: member keys show a larger fold with only the previewed combos; every other fold
//   recedes to 22%.
//
// The prototype also had a "bands" split (pieces parallel to the crease). Only "cut" ships.
import React, { useLayoutEffect, useRef, useState } from "react";
import type { ComboMembership } from "@/utils/combo-membership";
import { hueToken, layerHexFor, luminance, toneFor } from "@/utils/combo-hues";
import {
    foldGeometry, foldLayout, foldPieces, foldSeams, foldStrip, pointsAttr, type KeySize,
} from "@/utils/combo-fold";

export interface ComboFoldProps {
    memberships: ComboMembership[];
    size: KeySize;
    /** Layer color as stored: a preset name, "primary", "sidebar" or "#rrggbb". */
    layerColor: string;
    /** Combo number -> hue index, for the whole keyboard. */
    hues: ReadonlyMap<number, number>;
    /** Combos being previewed, if any. */
    focusSet: ReadonlySet<number> | null;
    /** Changes whenever the key's legend changes, so the fold re-measures its room. */
    measureKey?: string;
}

/** "Combo 3 → KC_ESC; Combo 5 (disabled) → KC_TAB" */
export function describeMemberships(ms: ComboMembership[]) {
    return ms.map(c => `Combo ${c.index}${c.enabled ? "" : " (disabled)"} → ${c.output}`).join("; ");
}

// Largest leg (crease included) that keeps clear of every glyph in the key, for a fold in the
// bottom-right (or top-right) corner. Uses glyph boxes: cap height above the baseline.
function measureClearance(svg: SVGSVGElement, topCorner: boolean): number {
    const key = svg.parentElement;
    if (!key) return Infinity;
    const kr = key.getBoundingClientRect();
    // A transformed key (3D view) has a projected box; keep the default size there.
    if (!kr.width || Math.abs(kr.width - key.offsetWidth) > 1 || Math.abs(kr.height - key.offsetHeight) > 1) return Infinity;
    const x0 = kr.left + 1, y0 = kr.top + 1, W = kr.width - 2, H = kr.height - 2;
    let worst = -Infinity;
    const consider = (right: number, top: number, bottom: number) => {
        worst = Math.max(worst, topCorner ? (right - x0) - (top - y0) + H : (right - x0) + (bottom - y0));
    };
    const walker = document.createTreeWalker(key, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent?.trim() || svg.contains(n) || !n.parentElement) continue;
        const fs = parseFloat(getComputedStyle(n.parentElement).fontSize) || 12;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const rc of Array.from(range.getClientRects?.() ?? [])) {
            const base = rc.bottom - 0.242 * fs; // Inter descent
            consider(rc.right - 0.5, base - 0.727 * fs, base); // Inter cap height
        }
    }
    key.querySelectorAll("svg :is(path, rect, circle, line, polyline, polygon)").forEach(el => {
        if (svg.contains(el)) return;
        const rc = el.getBoundingClientRect();
        if (rc.width || rc.height) consider(rc.right + 1, rc.top - 1, rc.bottom + 1);
    });
    return worst === -Infinity ? Infinity : W + H - worst;
}

function ComboFoldInner({ memberships, size, layerColor, hues, focusSet, measureKey }: ComboFoldProps) {
    const ref = useRef<SVGSVGElement>(null);
    const [top, setTop] = useState(false);
    const [room, setRoom] = useState(Infinity);

    useLayoutEffect(() => {
        const svg = ref.current;
        if (!svg) return;
        const prev = svg.previousElementSibling;
        const footer = !!prev && prev.tagName === "SPAN" && prev.classList.contains("rounded-b-sm");
        setTop(footer);
        setRoom(measureClearance(svg, footer));
        let live = true;
        document.fonts?.ready.then(() => { if (live && ref.current) setRoom(measureClearance(ref.current, footer)); });
        return () => { live = false; };
    }, [size, measureKey]);

    const layerHex = layerHexFor(layerColor);
    const tone = toneFor(layerHex);
    const isMember = !!focusSet && memberships.some(m => focusSet.has(m.index));
    const recede = !!focusSet && !isMember;
    const { shown, overflow } = foldLayout(memberships, { focus: isMember ? focusSet : null });
    const n = shown.length;
    const g = foldGeometry(size, Number.isFinite(room) ? room : 1e6, isMember, overflow);
    const { L, crease, sheetPale, sheet, box } = g;
    const C = box; // key corner in svg coordinates

    const lightKey = luminance(layerHex) > 0.65;
    const creaseInk = lightKey ? "var(--kb-combo-fold-crease-strong)" : "var(--kb-combo-fold-crease)";
    const fill = (m: ComboMembership) => {
        const c = hueToken(hues.get(m.index) ?? m.index, tone);
        return m.enabled ? c : `color-mix(in srgb, ${c} 42%, ${layerHex})`;
    };

    const label = describeMemberships(memberships);
    return (
        <svg
            ref={ref}
            data-combo-fold=""
            data-combo-order={shown.map(m => m.index).join(",")}
            aria-hidden="true"
            className="absolute right-0 z-[4] pointer-events-none"
            width={box} height={box} viewBox={`0 0 ${box} ${box}`} overflow="visible"
            style={{
                ...(top ? { top: 0, transform: "scaleY(-1)" } : { bottom: 0 }),
                opacity: recede ? 0.22 : 1,
                transition: "opacity 160ms ease",
            }}
        >
            <title>{label}</title>
            {overflow && <>
                <path data-fold-part="sheet-edge" d={foldStrip(C, L + crease + sheetPale, L + crease + sheet)} fill={creaseInk} />
                <path data-fold-part="sheet" d={foldStrip(C, L + crease, L + crease + sheetPale)}
                    fill={tone === "deep" ? "var(--kb-combo-fold-sheet-on-light)" : "var(--kb-combo-fold-sheet)"} />
            </>}
            <path data-fold-part="crease" d={foldStrip(C, L, L + crease)} fill={creaseInk} />
            {foldPieces(C, L, n).map((pts, i) => (
                <polygon key={shown[i].index} data-fold-piece={shown[i].index} points={pointsAttr(pts)} fill={fill(shown[i])} />
            ))}
            {foldSeams(C, L, n).map(([a, b], k) => (
                <line key={"s" + k} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--kb-combo-fold-seam)" strokeWidth={1} />
            ))}
        </svg>
    );
}

// A failure here renders nothing instead of breaking the key.
class FoldBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch(e: unknown) { console.error("combo fold failed", e); }
    render() { return this.state.failed ? null : this.props.children; }
}

export function ComboFold(props: ComboFoldProps) {
    if (!props.memberships.length) return null;
    return <FoldBoundary><ComboFoldInner {...props} /></FoldBoundary>;
}

