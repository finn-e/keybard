// Combo folded corner: the key's bottom-right corner reads as a folded-over page corner.
//
// - One combo: the whole fold is that combo's color.
// - Two or three: the fold is cut by lines from the key's corner to equal divisions of the fold
//   edge, so every piece meets the crease at the same width. Pieces are in combo-number order
//   (see foldLayout in src/utils/combo-fold.ts).
// - More than three: the lowest three, and no other mark; the readout lists them all.
// - A crease in black alpha (the header/footer band vocabulary) edges the fold; on light keys
//   it is stronger so the fold keeps a crisp edge.
// - A footer band owns the bottom edge, so on those keys the fold takes the top-right corner
//   (mirrored, so the spots keep their order from the horizontal edge).
// - Size: the fold is drawn at its large size, which is what keeps clear of legends, so nothing
//   collides at any point of the animation. In "small" mode it is scaled toward the key corner
//   at rest and grows while the pointer moves over the keyboard (CSS in src/index.css; the
//   layout carries data-combo-motion). A previewed key's fold stays large.
// - Where even the smallest large fold would touch a legend (L SHIFT on small keys), the
//   legend shrinks in 5% steps, down to 80%.
// - Colorblind palette: each piece also carries a texture (plain, fine lines parallel to the
//   crease, dots) in low-strength ink picked by the piece's lightness.
// - Preview: member keys show only the previewed combos; every other fold recedes to 22%.
import React, { useId, useLayoutEffect, useRef, useState } from "react";
import type { ComboMembership } from "@/utils/combo-membership";
import { cueInk, hexFor, hueToken, layerHexFor, luminance, textureOf, toneFor, type ComboPalette } from "@/utils/combo-hues";
import type { ComboIndicatorMode } from "@/lib/comboIndicators";
import {
    foldGeometry, foldLayout, foldPieces, foldSeams, foldStrip, LARGE_SCALE, LEGEND_STEPS, minRoom,
    pointsAttr, restScale, texturePeriod, type KeySize,
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
    /** "small" scales the fold down at rest; "large" keeps it large. */
    mode?: ComboIndicatorMode;
    palette?: ComboPalette;
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

/** Text elements of the key outside the fold (its legends). */
function legendElements(svg: SVGSVGElement): HTMLElement[] {
    const key = svg.parentElement;
    if (!key) return [];
    const set = new Set<HTMLElement>();
    const walker = document.createTreeWalker(key, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (n.textContent?.trim() && el && !svg.contains(el)) set.add(el);
    }
    return [...set];
}

const mixHex = (a: string, b: string, t: number) => {
    const p = (h: string) => { const n = parseInt(h.replace("#", ""), 16) || 0; return [n >> 16, (n >> 8) & 255, n & 255]; };
    const A = p(a), B = p(b);
    return "#" + A.map((x, i) => Math.round(x * t + B[i] * (1 - t)).toString(16).padStart(2, "0")).join("");
};

type Pattern = { id: string; kind: "lines" | "dots"; ink: string };

function ComboFoldInner({ memberships, size, layerColor, hues, focusSet, mode = "small", palette = "default", measureKey }: ComboFoldProps) {
    const ref = useRef<SVGSVGElement>(null);
    const uid = "kb-fold-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const [top, setTop] = useState(false);
    const [room, setRoom] = useState(Infinity);

    useLayoutEffect(() => {
        const svg = ref.current;
        if (!svg) return;
        const prev = svg.previousElementSibling;
        const footer = !!prev && prev.tagName === "SPAN" && prev.classList.contains("rounded-b-sm");
        setTop(footer);
        // Legend fit: only when even the smallest large fold would touch a legend.
        let shrunk: Array<{ el: HTMLElement; inline: string }> = [];
        const restore = () => { shrunk.forEach(o => { o.el.style.fontSize = o.inline; }); shrunk = []; };
        const fit = () => {
            const s = ref.current;
            if (!s) return;
            restore();
            let r = measureClearance(s, footer);
            const need = minRoom(size);
            if (Number.isFinite(r) && r < need) {
                const els = legendElements(s)
                    .map(el => ({ el, inline: el.style.fontSize, px: parseFloat(getComputedStyle(el).fontSize) || 0 }))
                    .filter(o => o.px > 0);
                shrunk = els.map(({ el, inline }) => ({ el, inline }));
                for (const f of LEGEND_STEPS) {
                    els.forEach(o => { o.el.style.fontSize = (o.px * f).toFixed(2) + "px"; });
                    r = measureClearance(s, footer);
                    if (r >= need) break;
                }
            }
            setRoom(r);
        };
        fit();
        let live = true;
        document.fonts?.ready.then(() => { if (live) fit(); });
        // Keys can still be settling (resizing or mid-transition) when first measured: measure
        // again when the key's box changes, and for a few frames while it reads as transformed.
        let frames = 0, raf = 0;
        const settle = () => {
            raf = 0;
            const s = ref.current;
            if (!live || !s || ++frames > 40) return;
            if (Number.isFinite(measureClearance(s, footer))) { fit(); return; }
            raf = requestAnimationFrame(settle);
        };
        raf = requestAnimationFrame(settle);
        const key = svg.parentElement;
        const ro = typeof ResizeObserver !== "undefined" && key ? new ResizeObserver(() => { if (live) fit(); }) : null;
        if (ro && key) ro.observe(key);
        return () => { live = false; if (raf) cancelAnimationFrame(raf); ro?.disconnect(); restore(); };
    }, [size, measureKey]);

    const layerHex = layerHexFor(layerColor);
    const tone = toneFor(layerHex);
    const isMember = !!focusSet && memberships.some(m => focusSet.has(m.index));
    const recede = !!focusSet && !isMember;
    const { shown } = foldLayout(memberships, { focus: isMember ? focusSet : null });
    const n = shown.length;
    const roomPx = Number.isFinite(room) ? room : 1e6;
    // Drawn at the large size; "small" mode scales it toward the corner at rest (src/index.css).
    const { L, crease, seam, box } = foldGeometry(size, roomPx, LARGE_SCALE);
    const rest = mode === "small" ? restScale(size, roomPx) : 1;
    const C = box; // key corner in svg coordinates

    const lightKey = luminance(layerHex) > 0.65;
    const creaseInk = lightKey ? "var(--kb-combo-fold-crease-strong)" : "var(--kb-combo-fold-crease)";
    const hueOf = (m: ComboMembership) => hues.get(m.index) ?? m.index;
    const fill = (m: ComboMembership) => {
        const c = hueToken(hueOf(m), tone);
        return m.enabled ? c : `color-mix(in srgb, ${c} 42%, ${layerHex})`;
    };

    // Texture cue: colorblind palette only. One pattern per texture and ink in this fold.
    const textured = palette === "colorblind";
    const period = texturePeriod(size);
    const patterns = new Map<string, Pattern>();
    const textureOfPiece = (m: ComboMembership): Pattern | null => {
        const kind = textureOf(hueOf(m));
        if (!textured || kind === "plain") return null;
        const hex = hexFor(hueOf(m), layerHex, palette);
        const ink = cueInk(m.enabled ? hex : mixHex(hex, layerHex, 0.42));
        const id = `${uid}-${kind}-${ink.includes("light") ? "l" : "d"}`;
        const p = patterns.get(id) ?? { id, kind, ink };
        patterns.set(id, p);
        return p;
    };
    const pieceTextures = shown.map(textureOfPiece);

    const label = describeMemberships(memberships);
    const scaleStyle = { transformOrigin: `${C}px ${C}px`, "--kb-fold-rest": rest.toFixed(4) } as React.CSSProperties;
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
            {patterns.size > 0 && (
                <defs>
                    {[...patterns.values()].map(p => (
                        <pattern key={p.id} id={p.id} width={period} height={period} patternUnits="userSpaceOnUse"
                            patternTransform={p.kind === "lines" ? "rotate(45)" : undefined}>
                            {p.kind === "lines"
                                ? <rect x={0} y={0} width={Math.max(0.6, period * 0.36)} height={period} fill={p.ink} />
                                : <circle cx={period / 2} cy={period / 2} r={Math.max(0.55, period * 0.24)} fill={p.ink} />}
                        </pattern>
                    ))}
                </defs>
            )}
            <g data-fold-scale="" data-fold-big={isMember ? "" : undefined} style={scaleStyle}>
                <path data-fold-part="crease" d={foldStrip(C, L, L + crease)} fill={creaseInk} />
                {foldPieces(C, L, n).map((pts, i) => {
                    const tex = pieceTextures[i];
                    return (
                        <React.Fragment key={shown[i].index}>
                            <polygon data-fold-piece={shown[i].index} points={pointsAttr(pts)} fill={fill(shown[i])} />
                            {tex && <polygon data-fold-texture={tex.kind} points={pointsAttr(pts)} fill={`url(#${tex.id})`} />}
                        </React.Fragment>
                    );
                })}
                {foldSeams(C, L, n).map(([a, b], k) => (
                    <line key={"s" + k} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--kb-combo-fold-seam)" strokeWidth={seam} />
                ))}
            </g>
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

