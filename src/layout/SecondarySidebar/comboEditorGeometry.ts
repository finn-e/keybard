import * as React from "react";

import { COMBO_EDITOR_MOVED_EVENT, type ComboEditorPlacement } from "@/lib/comboEditorPlacement";

/** Gap between the editor and the keyboard, panel or viewport edge. */
export const COMBO_EDITOR_GAP = 8;
/** Extra room before a card stops reserving canvas space, so it does not flip back and forth. */
const ANCHOR_HYSTERESIS = 64;

export interface Box { left: number; top: number; right: number; bottom: number }

export interface ComboEditorGeometryInput {
    placement: ComboEditorPlacement;
    /** The detail panel is a bottom bar rather than a side panel. */
    bottom: boolean;
    viewport: { width: number; height: number };
    canvas: Box;
    panel: Box | null;
    /** The editor's own rendered size. */
    editor: { width: number; height: number };
    /** Every key on the primary keyboard. */
    keys: Box[];
    /** Canvas controls (size, info) the floating editor should also stay clear of. */
    obstacles?: Box[];
    /** Keys on the keyboard that are this combo's trigger keys. */
    triggers: Box[];
    /** How far the canvas is scrolled, so the reserve decision ignores scrolling. */
    canvasScrollTop: number;
    /** Canvas space reserved now (the result of the previous pass). */
    currentReserve: number;
    /** Where the user moved the floating editor, if they did (or, for "half", where a drag is now). */
    manual: { x: number; y: number } | null;
    /** "half": the spot a drag snapped to, kept until the editor closes. */
    manualSpot?: string | null;
}

/** A place the "half" card can snap to. */
export interface ComboEditorSpot { id: string; label: string; left: number; top: number }

export interface ComboEditorGeometry {
    left: number;
    top: number;
    /** Set for the full-width dock; the cards size to their content. */
    width?: number;
    maxWidth: number;
    /** Height to take from the bottom of the canvas so the editor never covers it. */
    reserve: number;
    /** "half": every spot the card may snap to, and the one it is in (unset while dragging). */
    spots?: ComboEditorSpot[];
    spot?: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

const intersects = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const unionBox = (boxes: Box[]): Box | null => boxes.length === 0 ? null : boxes.reduce((acc, b) => ({
    left: Math.min(acc.left, b.left),
    top: Math.min(acc.top, b.top),
    right: Math.max(acc.right, b.right),
    bottom: Math.max(acc.bottom, b.bottom),
}));

/**
 * Pure placement math for the underslung combo editor. All boxes are viewport
 * coordinates; the editor is drawn with position: fixed at the result.
 */
export function computeComboEditorGeometry(input: ComboEditorGeometryInput): ComboEditorGeometry {
    const { placement, bottom, viewport, canvas, panel, editor, keys, triggers, canvasScrollTop, currentReserve, manual, obstacles = [] } = input;
    const gap = COMBO_EDITOR_GAP;

    // The region the editor may use: the keyboard column, beside a side panel
    // or above a bottom panel.
    const regionLeft = Math.max(canvas.left, !bottom && panel ? panel.right + gap : canvas.left) + (bottom || !panel ? gap : 0);
    const regionRight = Math.min(canvas.right, viewport.width) - gap;
    const regionTop = canvas.top + gap;
    const regionBottom = (bottom && panel ? panel.top : viewport.height) - gap;
    const regionWidth = Math.max(0, regionRight - regionLeft);
    const width = Math.min(editor.width, regionWidth);
    const height = editor.height;

    // Where the canvas ends with no reserve: the viewport bottom, or the top of
    // a bottom panel. Derived from the layout, not measured, so a reserve that
    // is still animating never feeds back into the next one.
    const canvasBottom = regionBottom + gap;
    const reserveAbove = (top: number) => Math.max(0, Math.round(canvasBottom - (top - gap)));

    if (placement === "dock") {
        const top = regionBottom - height;
        return { left: regionLeft, top, width: regionWidth, maxWidth: regionWidth, reserve: reserveAbove(top) };
    }

    const keyboardBox = unionBox(keys);
    const triggerBox = unionBox(triggers);

    if (placement === "half") return halfGeometry(input, { regionLeft, regionRight, regionTop, regionBottom, regionWidth, width, height, reserveAbove, keyboardBox });

    if (placement === "anchored") {
        const anchor = triggerBox ?? keyboardBox;
        const centerX = anchor ? (anchor.left + anchor.right) / 2 : (regionLeft + regionRight) / 2;
        const left = clamp(centerX - width / 2, regionLeft, regionRight - width);
        if (!keyboardBox) {
            const top = regionBottom - height;
            return { left, top, maxWidth: regionWidth, reserve: reserveAbove(top) };
        }
        // Decide on the keyboard's unscrolled position so scrolling the canvas
        // does not toggle the reserve.
        const naturalTop = keyboardBox.bottom + canvasScrollTop + gap;
        const slack = currentReserve > 0 ? ANCHOR_HYSTERESIS : 0;
        const fits = naturalTop + height + slack <= regionBottom;
        if (fits) {
            const top = clamp(keyboardBox.bottom + gap, regionTop, regionBottom - height);
            return { left, top, maxWidth: regionWidth, reserve: 0 };
        }
        // Not enough room under the keyboard: sit at the bottom of the column
        // and take that height from the canvas, which then scrolls.
        const top = regionBottom - height;
        return { left, top, maxWidth: regionWidth, reserve: reserveAbove(top) };
    }

    // float
    const maxLeft = regionRight - width;
    const maxTop = regionBottom - height;
    if (manual) {
        return { left: clamp(manual.x, regionLeft, maxLeft), top: clamp(manual.y, regionTop, maxTop), maxWidth: regionWidth, reserve: 0 };
    }
    // Bottom corners, the same corners lifted above any canvas control under
    // them, then the top corners.
    const liftAbove = (left: number) => {
        const under = obstacles.filter(o => o.left < left + width && left < o.right && o.bottom > maxTop);
        return under.length ? Math.min(...under.map(o => o.top)) - gap - height : maxTop;
    };
    const corners = [
        { left: maxLeft, top: maxTop },
        { left: regionLeft, top: maxTop },
        { left: maxLeft, top: liftAbove(maxLeft) },
        { left: regionLeft, top: liftAbove(regionLeft) },
        { left: maxLeft, top: regionTop },
        { left: regionLeft, top: regionTop },
    ].map(c => ({ left: Math.max(regionLeft, c.left), top: Math.max(regionTop, c.top) }));
    // Corners are tested against the keys' unscrolled positions so scrolling
    // the canvas never toggles the reserve; once reserving, a corner must be
    // clear by a margin before the float lets go of it.
    const slack = currentReserve > 0 ? ANCHOR_HYSTERESIS : 0;
    const boxOf = (c: { left: number; top: number }): Box => ({ left: c.left, top: c.top - slack, right: c.left + width, bottom: c.top + height + slack });
    const naturalKeys = keys.map(k => ({ ...k, top: k.top + canvasScrollTop, bottom: k.bottom + canvasScrollTop }));
    const clearOfKeys = (c: { left: number; top: number }) => naturalKeys.every(k => !intersects(boxOf(c), k));
    const clearOfControls = (c: { left: number; top: number }) => obstacles.every(o => !intersects(boxOf(c), o));
    const clear = corners.find(c => clearOfKeys(c) && clearOfControls(c)) ?? corners.find(clearOfKeys);
    if (clear) return { left: clear.left, top: clear.top, maxWidth: regionWidth, reserve: 0 };
    // No corner is clear of the keyboard: settle in the bottom corner and take
    // that height from the canvas, as the dock does, rather than cover keys.
    return { left: corners[0].left, top: corners[0].top, maxWidth: regionWidth, reserve: reserveAbove(corners[0].top) };
}

interface Region {
    regionLeft: number; regionRight: number; regionTop: number; regionBottom: number; regionWidth: number;
    width: number; height: number; reserveAbove: (top: number) => number; keyboardBox: Box | null;
}

const centerX = (b: Box) => (b.left + b.right) / 2;

/**
 * "Under a Half": the compact card sits below the keyboard half that holds
 * fewer of the combo's keys (a tie goes left), so it never covers a key. When
 * there is no room under the keyboard it sits at the bottom of the column and
 * takes its height from the canvas, as the dock does. A drag snaps to the
 * nearest spot, which holds until the editor closes.
 */
function halfGeometry(input: ComboEditorGeometryInput, r: Region): ComboEditorGeometry {
    const { keys, triggers, canvasScrollTop, currentReserve, manual, manualSpot, obstacles = [] } = input;
    const { regionLeft, regionRight, regionTop, regionBottom, regionWidth, width, height, reserveAbove, keyboardBox } = r;
    const gap = COMBO_EDITOR_GAP;
    const maxLeft = regionRight - width;
    const maxTop = regionBottom - height;
    const clampLeft = (x: number) => clamp(x, regionLeft, maxLeft);

    if (!keyboardBox) {
        return { left: regionLeft, top: maxTop, maxWidth: regionWidth, reserve: reserveAbove(maxTop) };
    }
    const mid = centerX(keyboardBox);
    const leftHalf = unionBox(keys.filter(k => centerX(k) < mid)) ?? keyboardBox;
    const rightHalf = unionBox(keys.filter(k => centerX(k) >= mid)) ?? keyboardBox;

    // Decide on the keyboard's unscrolled position so scrolling never toggles
    // the reserve; once reserving, let go only with clear extra room.
    const slack = currentReserve > 0 ? ANCHOR_HYSTERESIS : 0;
    const naturalKeys = keys.map(k => ({ ...k, top: k.top + canvasScrollTop, bottom: k.bottom + canvasScrollTop }));
    const fitsUnderAll = keyboardBox.bottom + canvasScrollTop + gap + height + slack <= regionBottom;
    // With no room under the whole keyboard, the card can still sit under one
    // half, clear of every key above it (beside the other half's thumbs), so
    // the whole keyboard stays in view. Each spot then has its own top.
    const tuckTop = (left: number): number | null => {
        const above = naturalKeys.filter(k => k.right > left && k.left < left + width);
        const top = above.length ? Math.max(...above.map(k => k.bottom)) + gap : regionTop + canvasScrollTop;
        // No hysteresis here: the keys do not move when the reserve changes.
        return top + height <= regionBottom ? clamp(top - canvasScrollTop, regionTop, maxTop) : null;
    };
    // A tucked card slides outward from under its half until it clears the keys beside it.
    const tuck = (from: number, to: number): { left: number; top: number } | null => {
        const dir = to < from ? -1 : 1;
        for (let x = from; dir < 0 ? x > to : x < to; x += dir * 8) {
            const top = tuckTop(x);
            if (top !== null) return { left: x, top };
        }
        const top = tuckTop(to);
        return top === null ? null : { left: to, top };
    };
    const tucked = fitsUnderAll ? null : {
        left: tuck(clampLeft(leftHalf.left), regionLeft),
        right: tuck(clampLeft(rightHalf.right - width), maxLeft),
    };
    const belowLeft = tucked?.left?.left ?? clampLeft(leftHalf.left);
    const belowRight = tucked?.right?.left ?? clampLeft(rightHalf.right - width);
    const fits = fitsUnderAll || !!tucked?.left || !!tucked?.right;
    const rowTop = fitsUnderAll ? clamp(keyboardBox.bottom + gap, regionTop, maxTop) : maxTop;
    const reserve = fits ? 0 : reserveAbove(rowTop);
    // Corners are tested against the keys' unscrolled positions, as the float
    // does, so scrolling the canvas never adds or removes a spot.
    const boxAt = (left: number, top: number): Box => ({ left, top, right: left + width, bottom: top + height });
    const clearOfKeys = (left: number, top: number) => naturalKeys.every(k => !intersects(boxAt(left, top), k));
    const clearOfControls = (left: number, top: number) => obstacles.every(o => !intersects(boxAt(left, top), o));

    const raw: ComboEditorSpot[] = tucked && fits
        ? [
            ...(tucked.left ? [{ id: "below-left", label: "Below Left Half", left: tucked.left.left, top: tucked.left.top }] : []),
            ...(tucked.right ? [{ id: "below-right", label: "Below Right Half", left: tucked.right.left, top: tucked.right.top }] : []),
        ]
        : [
            { id: "below-left", label: "Below Left Half", left: belowLeft, top: rowTop },
            { id: "below-right", label: "Below Right Half", left: belowRight, top: rowTop },
            { id: "below-center", label: "Below the Keyboard", left: clampLeft(centerX(keyboardBox) - width / 2), top: rowTop },
        ];
    if (fitsUnderAll) {
        // Corners of the column, where they are clear of every key.
        for (const c of [
            { id: "bottom-left", label: "Bottom Left", left: regionLeft, top: maxTop },
            { id: "bottom-right", label: "Bottom Right", left: maxLeft, top: maxTop },
            { id: "top-left", label: "Top Left", left: regionLeft, top: regionTop },
            { id: "top-right", label: "Top Right", left: maxLeft, top: regionTop },
        ]) if (c.top >= regionTop && clearOfKeys(c.left, c.top)) raw.push({ ...c, left: Math.max(regionLeft, c.left) });
    }
    // Drop spots that sit almost on top of an earlier one (a narrow keyboard).
    const spots: ComboEditorSpot[] = [];
    for (const s of raw) {
        if (!spots.some(o => Math.abs(o.left - s.left) < width * 0.45 && Math.abs(o.top - s.top) < height * 0.6)) spots.push(s);
    }

    if (manual) {
        return { left: clampLeft(manual.x), top: clamp(manual.y, regionTop, maxTop), maxWidth: regionWidth, reserve, spots };
    }

    let chosen = manualSpot ? spots.find(s => s.id === manualSpot) : undefined;
    if (!chosen) {
        const leftCount = triggers.filter(t => centerX(t) < mid).length;
        const rightCount = triggers.length - leftCount;
        const first = rightCount < leftCount ? "below-right" : "below-left";
        const order = [first, first === "below-left" ? "below-right" : "below-left", "below-center"];
        const below = order.map(id => spots.find(s => s.id === id)).filter((s): s is ComboEditorSpot => !!s);
        chosen = below.find(s => clearOfControls(s.left, s.top)) ?? below[0] ?? spots[0];
    }
    return { left: chosen.left, top: chosen.top, maxWidth: regionWidth, reserve, spots, spot: chosen.id };
}

/** The spot nearest to where a dragged card was let go (the cards share one size). */
export function nearestSpot(spots: ComboEditorSpot[], at: { left: number; top: number }): ComboEditorSpot | null {
    let best: ComboEditorSpot | null = null;
    let bestDistance = Infinity;
    for (const s of spots) {
        const d = Math.hypot(s.left - at.left, s.top - at.top);
        if (d < bestDistance) { best = s; bestDistance = d; }
    }
    return best;
}

const toBox = (r: DOMRect): Box => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });

interface UseComboEditorGeometryOptions {
    placement: ComboEditorPlacement | null;
    bottom: boolean;
    workspaceRef: React.RefObject<HTMLElement | null>;
    panelRef: React.RefObject<HTMLElement | null>;
    canvasRef?: React.RefObject<HTMLElement | null>;
    getKeyboardElement?: () => HTMLElement | null;
    triggerKeycodes: string[];
    onReserveChange?: (px: number) => void;
}

/**
 * Measures the page and positions the combo editor (position: fixed) for the
 * active placement. It never moves the editor in the React tree, so drafts and
 * focus inside it survive placement changes.
 */
export function useComboEditorGeometry({
    placement, bottom, workspaceRef, panelRef, canvasRef, getKeyboardElement, triggerKeycodes, onReserveChange,
}: UseComboEditorGeometryOptions) {
    const [geometry, setGeometry] = React.useState<ComboEditorGeometry | null>(null);
    const reserveRef = React.useRef(0);
    const manualRef = React.useRef<{ x: number; y: number } | null>(null);
    const manualSpotRef = React.useRef<string | null>(null);
    const geometryRef = React.useRef<ComboEditorGeometry | null>(null);
    const frameRef = React.useRef(0);
    const triggerKey = triggerKeycodes.join(",");

    const measure = React.useCallback(() => {
        const workspace = workspaceRef.current;
        const canvas = canvasRef?.current ?? document.querySelector<HTMLElement>('[aria-label="Keyboard canvas"]');
        if (!placement || !workspace || !canvas) return;
        const keyboardEl = getKeyboardElement?.() ?? canvas;
        const keyEls = Array.from(keyboardEl.querySelectorAll<HTMLElement>("[data-keycode]"));
        const triggerSet = new Set(triggerKey ? triggerKey.split(",") : []);
        const next = computeComboEditorGeometry({
            placement,
            bottom,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            canvas: toBox(canvas.getBoundingClientRect()),
            panel: panelRef.current ? toBox(panelRef.current.getBoundingClientRect()) : null,
            editor: { width: workspace.offsetWidth, height: workspace.offsetHeight },
            keys: keyEls.map(el => toBox(el.getBoundingClientRect())),
            triggers: keyEls.filter(el => triggerSet.has(el.dataset.keycode ?? "")).map(el => toBox(el.getBoundingClientRect())),
            obstacles: Array.from(document.querySelectorAll<HTMLElement>("[data-combo-editor-avoid]"))
                .map(el => toBox(el.getBoundingClientRect())).filter(b => b.right > b.left),
            canvasScrollTop: canvas.scrollTop,
            currentReserve: reserveRef.current,
            manual: placement === "float" || placement === "half" ? manualRef.current : null,
            manualSpot: placement === "half" ? manualSpotRef.current : null,
        });
        geometryRef.current = next;
        setGeometry(prev => prev && prev.left === next.left && prev.top === next.top && prev.width === next.width
            && prev.maxWidth === next.maxWidth && prev.reserve === next.reserve && prev.spot === next.spot ? prev : next);
        if (next.reserve !== reserveRef.current) {
            reserveRef.current = next.reserve;
            onReserveChange?.(next.reserve);
        }
    }, [placement, bottom, workspaceRef, panelRef, canvasRef, getKeyboardElement, triggerKey, onReserveChange]);

    const schedule = React.useCallback(() => {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(measure);
    }, [measure]);

    React.useLayoutEffect(() => {
        if (!placement) {
            setGeometry(null);
            // Closing the editor forgets any drag: it opens at its default next time.
            manualRef.current = null;
            manualSpotRef.current = null;
            geometryRef.current = null;
            if (reserveRef.current !== 0) {
                reserveRef.current = 0;
                onReserveChange?.(0);
            }
            return;
        }
        measure();
        const canvas = canvasRef?.current ?? document.querySelector<HTMLElement>('[aria-label="Keyboard canvas"]');
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
        [workspaceRef.current, panelRef.current, canvas, getKeyboardElement?.() ?? null].forEach(el => el && observer?.observe(el));
        canvas?.addEventListener("scroll", schedule, { passive: true });
        window.addEventListener("resize", schedule);
        // Keys and layers re-render without resizing anything we observe.
        const settle = window.setInterval(schedule, 500);
        return () => {
            observer?.disconnect();
            canvas?.removeEventListener("scroll", schedule);
            window.removeEventListener("resize", schedule);
            window.clearInterval(settle);
            cancelAnimationFrame(frameRef.current);
        };
    }, [placement, measure, schedule, canvasRef, workspaceRef, panelRef, getKeyboardElement, onReserveChange]);

    // Tell the key inspector the card moved, so it can sit beside it.
    React.useEffect(() => {
        const frame = requestAnimationFrame(() => window.dispatchEvent(new Event(COMBO_EDITOR_MOVED_EVENT)));
        return () => cancelAnimationFrame(frame);
    }, [geometry]);

    // Release the reserved space when the editor unmounts.
    React.useEffect(() => () => { if (reserveRef.current !== 0) onReserveChange?.(0); }, [onReserveChange]);

    /**
     * Pointer drag, started from [data-float-drag-handle]. The float stays
     * where it is let go; "half" snaps to the nearest spot.
     */
    const onPointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
        if ((placement !== "float" && placement !== "half") || event.button !== 0) return;
        if (!(event.target instanceof Element) || !event.target.closest("[data-float-drag-handle]")) return;
        const workspace = workspaceRef.current;
        if (!workspace) return;
        const rect = workspace.getBoundingClientRect();
        const dx = event.clientX - rect.left;
        const dy = event.clientY - rect.top;
        event.preventDefault();
        const move = (e: PointerEvent) => {
            manualRef.current = { x: e.clientX - dx, y: e.clientY - dy };
            schedule();
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            if (placement !== "half" || !manualRef.current) return;
            const spot = nearestSpot(geometryRef.current?.spots ?? [], { left: manualRef.current.x, top: manualRef.current.y });
            manualRef.current = null;
            if (spot) manualSpotRef.current = spot.id;
            schedule();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }, [placement, workspaceRef, schedule]);

    const style: React.CSSProperties | undefined = placement && geometry ? {
        left: geometry.left,
        top: geometry.top,
        width: geometry.width,
        maxWidth: geometry.maxWidth,
    } : undefined;

    return { style, onPointerDown, regionWidth: geometry?.maxWidth ?? null, spot: geometry?.spot ?? null };
}
