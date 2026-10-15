/**
 * The L-shaped picker (design fork, owner review: ?pickerShape=L|Lfull).
 *
 * Only the Standard Keys keyboard needs real width; every other picker is a
 * set of small items that reflows at any width. With an L shape, the side
 * panel keeps the editor and the small pickers, and the Standard Keys
 * keyboard moves into a tray under the layout that is the same surface as
 * the panel, joined at the bottom-left corner.
 *
 * - "L": the tray spans under the layout only; the panel keeps full height.
 * - "Lfull": the tray spans under the panel and the layout; the panel sits
 *   above it, shorter.
 *
 * The side-panel layout only. In the bottom bar the param has no effect.
 * This module is the one owner of the shape, the tray's state and its sizes.
 */

export const PICKER_SHAPES = ["rect", "L", "Lfull"] as const;
export type PickerShape = typeof PICKER_SHAPES[number];
export const PICKER_SHAPE_PARAM = "pickerShape";

/** The shape asked for in the URL; anything else is the usual rectangle. */
export function pickerShapeFromSearch(search: string): PickerShape {
    let value: string | null = null;
    try {
        value = new URLSearchParams(search).get(PICKER_SHAPE_PARAM);
    } catch {
        value = null;
    }
    return value === "L" || value === "Lfull" ? value : "rect";
}

/** The shape in effect: the bottom bar keeps its own tray, so the param does nothing there. */
export function effectivePickerShape(shape: PickerShape, layoutMode: string): PickerShape {
    return layoutMode === "sidebar" ? shape : "rect";
}

export const isLShape = (shape: PickerShape): boolean => shape === "L" || shape === "Lfull";

/**
 * The tray's state.
 * - hidden: no Standard Keys in play; the layout gets full height.
 * - open: the tray under the layout, which reflows into the space above it.
 * - handle: a slim bar labeled Standard Keys (multi-layer view, or collapsed by hand).
 * - overlay: expanded from the handle over the bottom of the layers, which keep their space.
 */
export type TrayState = "hidden" | "open" | "handle" | "overlay";

export interface TrayInputs {
    shape: PickerShape;
    /** The side panel is open. */
    panelOpen: boolean;
    /** A binding editor (combo, tap dance, macro...) is open. */
    editorOpen: boolean;
    activePanel: string | null | undefined;
    /** The picker category chosen while an editor is open. */
    pickerMode: string;
    /** Several layers shown at once (scrolling layers). */
    multiLayer: boolean;
    /** The tray was collapsed to its handle by hand (or expanded by hand in multi-layer view). */
    toggled: boolean;
}

/** True while Standard Keys are what is being picked from. */
export function standardKeysInPlay(i: Pick<TrayInputs, "panelOpen" | "editorOpen" | "activePanel" | "pickerMode">): boolean {
    if (!i.panelOpen) return false;
    return i.editorOpen ? i.pickerMode === "keyboard" : i.activePanel === "keyboard";
}

export function trayState(i: TrayInputs): TrayState {
    if (!isLShape(i.shape) || !standardKeysInPlay(i)) return "hidden";
    if (i.multiLayer) return i.toggled ? "overlay" : "handle";
    return i.toggled ? "handle" : "open";
}

/** Height the layout gives up for the tray: all of it when open, the handle otherwise. */
export function trayReserve(state: TrayState, trayHeight: number): number {
    if (state === "open") return trayHeight;
    if (state === "handle" || state === "overlay") return TRAY_HANDLE_PX;
    return 0;
}

/** Height the tray's surface shows. */
export function trayVisibleHeight(state: TrayState, trayHeight: number): number {
    if (state === "open" || state === "overlay") return trayHeight;
    if (state === "handle") return TRAY_HANDLE_PX;
    return 0;
}

export const TRAY_MOTION_MS = 250;
export const TRAY_HANDLE_PX = 32;
/** Gap between the surface and the window edge, as the side panel has. */
export const TRAY_EDGE_PX = 8;
/** The surface's corner radius (the side panel's rounded-2xl). */
export const SURFACE_RADIUS_PX = 16;
/** The tray's header row and padding around the keyboard. */
const TRAY_CHROME_PX = 52;
/** Largest share of the window height the tray takes, and its cap. */
const TRAY_MAX_SHARE = 0.3;
const TRAY_MAX_PX = 280;
/** The Standard Keys keyboard's keys are 30px at scale 1; never smaller than 24px. */
export const QWERTY_KEY_PX = 30;
export const TRAY_MIN_KEY_PX = 24;
/** Largest tray key: about a real keyboard's key on screen, so a wide tray never blows it up past that. */
export const TRAY_MAX_KEY_PX = 64;
export const TRAY_MAX_SCALE = TRAY_MAX_KEY_PX / QWERTY_KEY_PX;
/** Room the layout keeps under its content, so nothing touches the tray. */
export const LAYOUT_MARGIN_PX = 8;
/** The canvas's size controls sit this far above its bottom edge (bottom-4). */
export const CANVAS_CONTROLS_INSET_PX = 16;

/** The tray's height for a window this tall. */
export function trayHeightFor(viewportHeight: number): number {
    return Math.round(Math.min(TRAY_MAX_PX, Math.max(160, viewportHeight * TRAY_MAX_SHARE)));
}

/** The open tray's height: its header plus the laid-out keyboard, within the budget. */
export function fittedTrayHeight(budget: number, contentHeight: number): number {
    return contentHeight > 0 ? Math.min(budget, TRAY_HANDLE_PX + Math.ceil(contentHeight)) : budget;
}

/** What the layout's canvas holds, measured from its top, at the key size in use. */
export interface LayoutExtent {
    /** Bottom of the last thing laid out in the canvas (the add-layer row under the keyboard). */
    contentBottom: number;
    /** Bottom of the keyboard itself. */
    keyboardBottom: number;
    /** Height of the size controls in the canvas's bottom-right corner. */
    controlsHeight: number;
}

/**
 * The canvas height the layout needs: all of its content plus a small margin,
 * with the size controls clear of the keyboard (they may sit beside the
 * add-layer row, which is on the left).
 */
export function layoutCanvasNeed(e: LayoutExtent): number {
    if (!(e.contentBottom > 0)) return 0;
    return Math.ceil(Math.max(
        e.contentBottom + LAYOUT_MARGIN_PX,
        e.keyboardBottom + LAYOUT_MARGIN_PX + e.controlsHeight + CANVAS_CONTROLS_INSET_PX,
    ));
}

export interface TraySizingInputs {
    viewportHeight: number;
    /** The canvas's top edge in the window. */
    canvasTop: number;
    /** The canvas height the layout needs (layoutCanvasNeed); 0 when unknown or not in play. */
    layoutNeed: number;
    /** Any other height reserved under the canvas (a combo editor below the keyboard). */
    reserveBelow?: number;
    /** The tray's keyboard as laid out, for the fallback size. */
    contentHeight: number;
}

export interface TraySizing {
    /** The open tray's height. */
    height: number;
    /** True when the tray takes all the room the layout leaves; false when it keeps the capped size. */
    fills: boolean;
    /** Room the keyboard has inside the tray. */
    keyboardHeight: number;
}

/**
 * The open tray's size. The layout keeps exactly what it needs at its key
 * size; the tray takes everything under that. When that would leave the tray
 * smaller than its usual budget (a tall layout, Normal keys, a short window),
 * the tray keeps the usual capped size and the layout makes do, as before.
 */
export function openTraySizing(i: TraySizingInputs): TraySizing {
    const budget = trayHeightFor(i.viewportHeight);
    const fill = i.layoutNeed > 0
        ? Math.floor(i.viewportHeight - TRAY_EDGE_PX - i.canvasTop - i.layoutNeed - (i.reserveBelow ?? 0))
        : 0;
    if (fill >= budget) return { height: fill, fills: true, keyboardHeight: trayKeyboardHeight(fill) };
    return { height: fittedTrayHeight(budget, i.contentHeight), fills: false, keyboardHeight: trayKeyboardHeight(budget) };
}

/** Room the keyboard has inside a tray this tall. */
export const trayKeyboardHeight = (trayHeight: number): number => Math.max(0, trayHeight - TRAY_CHROME_PX);

/**
 * The keyboard's scale in the tray: as large as fits its width and height,
 * keeping its shape, up to TRAY_MAX_KEY_PX keys, and never so small that keys
 * drop under 24px.
 */
export function trayKeyboardScale(availableWidth: number, availableHeight: number, naturalWidth: number, naturalHeight: number): number {
    if (!(naturalWidth > 0) || !(naturalHeight > 0)) return 1;
    const fit = Math.min(
        TRAY_MAX_SCALE,
        availableWidth > 0 ? availableWidth / naturalWidth : 1,
        availableHeight > 0 ? availableHeight / naturalHeight : TRAY_MAX_SCALE,
    );
    return Math.max(TRAY_MIN_KEY_PX / QWERTY_KEY_PX, fit);
}

export interface SurfaceGeometry {
    /** Left edge of the whole surface. */
    left: number;
    /** Where the panel's right edge meets the tray (the inner corner's x). */
    inner: number;
    /** Right edge of the tray. */
    right: number;
    top: number;
    /** The tray's top edge (the inner corner's y). */
    trayTop: number;
    bottom: number;
}

const n = (v: number) => Number(v.toFixed(2));

/**
 * The outline of the L: the panel (left..inner, top..bottom) and the tray
 * (inner..right, trayTop..bottom) as one shape, with rounded outer corners
 * and a concave fillet where the tray meets the panel. With no tray, the
 * panel's rounded rectangle. Lfull has the same outline: its panel is the
 * upper part of the vertical bar and the tray runs under it to the left edge.
 */
export function lSurfacePath(g: SurfaceGeometry, radius = SURFACE_RADIUS_PX): string {
    const { left: x0, inner: x1, right: x2, top: y0, trayTop: yT, bottom: y1 } = g;
    const trayH = y1 - yT;
    const r = Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2);
    if (!(trayH > 0.5) || !(x2 - x1 > 0.5)) {
        return [
            `M${n(x0 + r)},${n(y0)}`, `H${n(x1 - r)}`, `A${n(r)},${n(r)} 0 0 1 ${n(x1)},${n(y0 + r)}`,
            `V${n(y1 - r)}`, `A${n(r)},${n(r)} 0 0 1 ${n(x1 - r)},${n(y1)}`,
            `H${n(x0 + r)}`, `A${n(r)},${n(r)} 0 0 1 ${n(x0)},${n(y1 - r)}`,
            `V${n(y0 + r)}`, `A${n(r)},${n(r)} 0 0 1 ${n(x0 + r)},${n(y0)}`, "Z",
        ].join(" ");
    }
    // Tray corners shrink with a short tray; the fillet never runs past the panel's top corner.
    const rt = Math.min(radius, trayH / 2, (x2 - x1) / 2);
    const rf = Math.min(radius, trayH / 2, Math.max(0, yT - y0 - r));
    return [
        `M${n(x0 + r)},${n(y0)}`, `H${n(x1 - r)}`, `A${n(r)},${n(r)} 0 0 1 ${n(x1)},${n(y0 + r)}`,
        `V${n(yT - rf)}`, `A${n(rf)},${n(rf)} 0 0 0 ${n(x1 + rf)},${n(yT)}`,
        `H${n(x2 - rt)}`, `A${n(rt)},${n(rt)} 0 0 1 ${n(x2)},${n(yT + rt)}`,
        `V${n(y1 - rt)}`, `A${n(rt)},${n(rt)} 0 0 1 ${n(x2 - rt)},${n(y1)}`,
        `H${n(x0 + r)}`, `A${n(r)},${n(r)} 0 0 1 ${n(x0)},${n(y1 - r)}`,
        `V${n(y0 + r)}`, `A${n(r)},${n(r)} 0 0 1 ${n(x0 + r)},${n(y0)}`, "Z",
    ].join(" ");
}
