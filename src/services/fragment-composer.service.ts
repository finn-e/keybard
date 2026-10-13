/**
 * Fragment Composer Service
 *
 * Composes keyboard layouts from fragment definitions and user selections.
 * This enables dynamic layout rendering based on which physical components
 * (e.g., 5-key vs 6-key finger clusters) are installed or selected.
 */

import type { KeyboardInfo, FragmentInstance, FragmentWidget } from "../types/keyboard.types";
import type { KleService } from "./kle.service";
// Type-only: fragment.service imports isWidgetInstance from here at runtime.
import type { FragmentService } from "./fragment.service";
import { FRAGMENT_THUMB_GAP_REDUCTION_U } from "../constants/keyboard-visuals";

/**
 * A composed key layout entry with position and matrix information
 */
export interface ComposedKeyLayout {
    x: number;
    y: number;
    w: number;
    h: number;
    row: number;
    col: number;
    // Additional KLE properties that may be useful for rendering
    color?: string;
    textColor?: string[];
    labels?: string[];
    rotation_angle?: number;
    rotation_x?: number;
    rotation_y?: number;
}

/**
 * A widget instance (pointing slot) after composition. Composed units, like keys.
 * `fragmentName`/`widget` are null until hardware detection names one of the
 * instance's options.
 */
export interface ComposedWidget {
    instanceIdx: number;
    instanceId: string;
    side: "left" | "right";
    fragmentName: string | null;
    widget: FragmentWidget | null;
    x: number;
    y: number;
    w: number;
    h: number;
}

/** X/Y shift applied to each thumb cluster by applyPlacementCorrections. */
export interface ThumbCorrections {
    left: { dx: number; dy: number };
    right: { dx: number; dy: number };
}

const NO_DETECTION = 0xff;

/** Space kept between a pointing slot and the keys around it, in key units. */
export const POINTING_POCKET_MARGIN = 0.15;

/**
 * A pointing module's width as a share of its hand's finger span: on the board an
 * Azoteq TPS43 touchpad is 43 mm across under finger clusters that span about 90 mm.
 */
export const POINTING_SPAN_SHARE = 43 / 90;

/**
 * The square a hand's pointing module fills, as on the board: right under the ring
 * and middle finger clusters, centred on the gap between their bottom keys (X and C
 * on the left in QWERTY, "." and "," on the right), as large as the keys around it
 * allow (reaching down beside the thumb cluster), up to POINTING_SPAN_SHARE of the
 * hand's finger span. Null when the composition doesn't name those clusters.
 */
export function fitPointingPocket(
    kbinfo: KeyboardInfo,
    keys: Record<number, ComposedKeyLayout>,
    side: "left" | "right",
): { x: number; y: number; w: number; h: number } | null {
    const instances = kbinfo.composition?.instances ?? [];
    const clusterKeys = (id: string) => {
        const instance = instances.find((i) => i.id === id);
        if (!instance) return [];
        const cells = new Set<string>();
        for (const opt of instance.fragment_options ?? []) for (const [r, c] of opt.matrix_map ?? []) cells.add(`${r},${c}`);
        for (const [r, c] of instance.matrix_map ?? []) cells.add(`${r},${c}`);
        return Object.values(keys).filter((k) => cells.has(`${k.row},${k.col}`));
    };
    const bottomKey = (cluster: ComposedKeyLayout[]) =>
        cluster.reduce<ComposedKeyLayout | null>((low, k) => (!low || k.y + k.h > low.y + low.h ? k : low), null);
    const ring = bottomKey(clusterKeys(`${side}_ring`));
    const middle = bottomKey(clusterKeys(`${side}_middle`));
    const thumb = clusterKeys(`${side}_thumb`);
    if (!ring || !middle || thumb.length === 0) return null;

    const fingers = ["pinky", "ring", "middle", "index"].flatMap((f) => clusterKeys(`${side}_${f}`));
    const span = Math.max(...fingers.map((k) => k.x + k.w)) - Math.min(...fingers.map((k) => k.x));
    const [outer, inner] = side === "left" ? [ring, middle] : [middle, ring];
    const cx = (outer.x + outer.w + inner.x) / 2;
    const top = Math.max(ring.y + ring.h, middle.y + middle.h) + POINTING_POCKET_MARGIN;
    const all = Object.values(keys);
    const m = POINTING_POCKET_MARGIN;
    const fits = (size: number) =>
        all.every((k) => k.x >= cx + size / 2 + m || k.x + k.w <= cx - size / 2 - m || k.y >= top + size + m || k.y + k.h <= top - m);

    let lo = 0;
    let hi = POINTING_SPAN_SHARE * span;
    if (fits(hi)) lo = hi;
    else for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
    }
    if (lo < 1) return null;
    return { x: cx - lo / 2, y: top, w: lo, h: lo };
}

function mapGet<K extends string | number, V>(m: Map<K, V> | Record<string, V> | undefined, k: K): V | undefined {
    if (!m) return undefined;
    return m instanceof Map ? m.get(k) : (m as Record<string, V>)[String(k)];
}

/**
 * True for an instance drawn as a widget (zero keys): every fragment it can
 * resolve to has a `widget`. Such instances never add keys to keylayout, are not
 * user-selectable, and only hardware detection decides which option they show.
 */
export function isWidgetInstance(kbinfo: Pick<KeyboardInfo, "fragments">, instance: FragmentInstance): boolean {
    const fragments = kbinfo.fragments;
    if (!fragments) return false;
    if (instance.fragment) return Boolean(fragments[instance.fragment]?.widget);
    const options = instance.fragment_options ?? [];
    return options.length > 0 && options.every((opt) => Boolean(fragments[opt.fragment]?.widget));
}

/** Indices of the widget instances in a composition. */
export function widgetInstanceIndices(kbinfo: Pick<KeyboardInfo, "fragments" | "composition">): Set<number> {
    const out = new Set<number>();
    kbinfo.composition?.instances?.forEach((instance, idx) => {
        if (isWidgetInstance(kbinfo, instance)) out.add(idx);
    });
    return out;
}

export class FragmentComposerService {
    constructor(
        private kleService: KleService,
        private fragmentService: FragmentService
    ) {}

    /**
     * Compose a complete keyboard layout from fragment definitions
     *
     * @param kbinfo - Keyboard info with fragments and composition
     * @returns Record keyed by matrix position (row * cols + col)
     */
    composeLayout(kbinfo: KeyboardInfo): Record<number, ComposedKeyLayout> {
        // Check if keyboard has fragment composition
        if (!kbinfo.composition?.instances || !kbinfo.fragments) {
            return {};
        }

        // Apply GUI-side placement corrections for thumb clusters
        return this.applyPlacementCorrections(this.composeRawLayout(kbinfo), kbinfo);
    }

    /** Key instances expanded at their raw placements, before thumb corrections. Widget instances add nothing. */
    private composeRawLayout(kbinfo: KeyboardInfo): Record<number, ComposedKeyLayout> {
        const layout: Record<number, ComposedKeyLayout> = {};
        const instances = kbinfo.composition?.instances ?? [];
        for (let idx = 0; idx < instances.length; idx++) {
            const instance = instances[idx];
            if (isWidgetInstance(kbinfo, instance)) continue;
            Object.assign(layout, this.expandInstance(kbinfo, idx, instance, kbinfo.cols));
        }
        return layout;
    }

    /**
     * Widget instances (pointing slots), placed like that side's thumb cluster:
     * raw placement plus the thumb correction applyPlacementCorrections gives that
     * side. Only hardware detection picks the fragment; EEPROM, user selections
     * and defaults are ignored.
     */
    composeWidgets(kbinfo: KeyboardInfo, hwDetection: Map<number, number>): ComposedWidget[] {
        const instances = kbinfo.composition?.instances;
        const fragments = kbinfo.fragments;
        if (!instances || !fragments) return [];
        const widgetIdx = widgetInstanceIndices(kbinfo);
        if (widgetIdx.size === 0) return [];

        const corrections = this.computeThumbCorrections(this.composeRawLayout(kbinfo));
        const keys = this.composeLayout(kbinfo);
        const out: ComposedWidget[] = [];
        for (const idx of widgetIdx) {
            const instance = instances[idx];
            const side = instance.id.startsWith("left_") ? "left" : instance.id.startsWith("right_") ? "right" : null;
            if (!side) continue;
            const options = instance.fragment
                ? [{ fragment: instance.fragment, placement: instance.placement ?? { x: 0, y: 0 } }]
                : instance.fragment_options ?? [];
            if (options.length === 0) continue;

            const detectedId = mapGet(hwDetection, idx);
            const detected = detectedId === undefined || detectedId === NO_DETECTION
                ? undefined
                : options.find((opt) => fragments[opt.fragment]?.id === detectedId);
            const sizeFrom = fragments[options[0].fragment]?.widget;
            const placement = options[0].placement;
            const { dx, dy } = corrections[side];
            const fitted = fitPointingPocket(kbinfo, keys, side);
            out.push({
                instanceIdx: idx,
                instanceId: instance.id,
                side,
                fragmentName: detected?.fragment ?? null,
                widget: detected ? fragments[detected.fragment]?.widget ?? null : null,
                ...(fitted ?? { x: placement.x + dx, y: placement.y + dy, w: sizeFrom?.w ?? 0, h: sizeFrom?.h ?? 0 }),
            });
        }
        return out;
    }

    /**
     * Expand a single fragment instance to key layouts
     */
    private expandInstance(
        kbinfo: KeyboardInfo,
        instanceIdx: number,
        instance: FragmentInstance,
        cols: number
    ): Record<number, ComposedKeyLayout> {
        const layout: Record<number, ComposedKeyLayout> = {};

        // Resolve which fragment to use for this instance
        const fragmentName = this.fragmentService.resolveFragment(kbinfo, instanceIdx, instance);
        if (!fragmentName) {
            return layout;
        }

        // Get fragment definition
        const fragment = kbinfo.fragments?.[fragmentName];
        if (!fragment?.kle) {
            console.warn(`Fragment "${fragmentName}" not found or has no KLE data`);
            return layout;
        }

        // Get placement and matrix map
        const { placement, matrixMap } = this.getPlacementAndMatrixMap(instance, fragmentName);
        if (!placement || !matrixMap) {
            console.warn(`Missing placement or matrix_map for instance "${instance.id}"`);
            return layout;
        }

        // Deserialize fragment KLE data
        let keys;
        try {
            const deserialized = this.kleService.deserialize(fragment.kle as any[]);
            keys = deserialized.keys;
        } catch (e) {
            console.error(`Failed to deserialize KLE for fragment "${fragmentName}":`, e);
            return layout;
        }

        // Map keys to matrix positions with placement offset
        for (let i = 0; i < keys.length && i < matrixMap.length; i++) {
            const key = keys[i];
            const [row, col] = matrixMap[i];
            const matrixPos = row * cols + col;

            layout[matrixPos] = {
                x: key.x + placement.x,
                y: key.y + placement.y,
                w: key.width,
                h: key.height,
                row,
                col,
                // Copy additional properties for rendering
                color: key.color,
                textColor: key.textColor?.filter((c): c is string => c !== undefined),
                labels: key.labels?.filter((l): l is string => l !== undefined),
                rotation_angle: key.rotation_angle,
                rotation_x: key.rotation_x,
                rotation_y: key.rotation_y,
            };
        }

        return layout;
    }

    /**
     * Get placement offset and matrix map for an instance
     *
     * For fixed instances, these come directly from the instance.
     * For selectable instances, we need to find the matching option.
     */
    private getPlacementAndMatrixMap(
        instance: FragmentInstance,
        fragmentName: string
    ): { placement: { x: number; y: number } | undefined; matrixMap: [number, number][] | undefined } {
        // Fixed instance - values come directly from instance
        if (instance.fragment) {
            return {
                placement: instance.placement,
                matrixMap: instance.matrix_map,
            };
        }

        // Selectable instance - find matching option
        if (instance.fragment_options) {
            const option = instance.fragment_options.find(opt => opt.fragment === fragmentName);
            if (option) {
                return {
                    placement: option.placement,
                    matrixMap: option.matrix_map,
                };
            }
        }

        return { placement: undefined, matrixMap: undefined };
    }

    /**
     * Check if a keyboard has fragment composition defined
     */
    hasFragments(kbinfo: KeyboardInfo): boolean {
        return Boolean(kbinfo.fragments) &&
               Boolean(kbinfo.composition?.instances?.length);
    }

    /**
     * Apply placement corrections to thumb clusters to match GUI-side visual design.
     *
     * Alignment strategy:
     * - Calculate the midline between left and right index clusters
     * - Align left thumb's rightmost key edge symmetrically about midline
     * - Align right thumb's leftmost key edge symmetrically about midline
     *
     * This keeps the internal cluster structure intact while centering thumbs properly.
     * Pointing slots (composeWidgets) get the same shift as their side's thumb.
     *
     * @param layout - The raw composed layout (before corrections)
     * @returns Each thumb cluster's X/Y shift (0 when it can't be computed)
     */
    computeThumbCorrections(layout: Record<number, ComposedKeyLayout>): ThumbCorrections & {
        keysByRow: Record<number, number[]>;
        midline: number;
        maxIndexBottomEdge: number;
        desiredYGap: number;
    } {
        // Cluster row definitions for Svalboard
        const leftThumbRow = 0;
        const rightThumbRow = 5;
        const leftIndexRow = 1;   // Row containing V key
        const rightIndexRow = 6;  // Row containing M key

        // Group keys by matrix row
        const keysByRow: Record<number, number[]> = {};
        for (const [matrixPosStr, key] of Object.entries(layout)) {
            const matrixPos = Number(matrixPosStr);
            if (!keysByRow[key.row]) {
                keysByRow[key.row] = [];
            }
            keysByRow[key.row].push(matrixPos);
        }

        // Find the midline between left and right index clusters
        // Left index innermost key's right edge, right index innermost key's left edge
        let leftIndexRightEdge = 0;
        let rightIndexLeftEdge = Infinity;

        // Find rightmost edge of left index cluster
        for (const matrixPos of (keysByRow[leftIndexRow] || [])) {
            const key = layout[matrixPos];
            const rightEdge = key.x + key.w;
            if (rightEdge > leftIndexRightEdge) {
                leftIndexRightEdge = rightEdge;
            }
        }

        // Find leftmost edge of right index cluster
        for (const matrixPos of (keysByRow[rightIndexRow] || [])) {
            const key = layout[matrixPos];
            if (key.x < rightIndexLeftEdge) {
                rightIndexLeftEdge = key.x;
            }
        }

        // Calculate midline between index clusters
        const midline = (leftIndexRightEdge + rightIndexLeftEdge) / 2;

        // Find current thumb cluster edges
        let leftThumbRightEdge = 0;
        let rightThumbLeftEdge = Infinity;

        for (const matrixPos of (keysByRow[leftThumbRow] || [])) {
            const key = layout[matrixPos];
            const rightEdge = key.x + key.w;
            if (rightEdge > leftThumbRightEdge) {
                leftThumbRightEdge = rightEdge;
            }
        }

        for (const matrixPos of (keysByRow[rightThumbRow] || [])) {
            const key = layout[matrixPos];
            if (key.x < rightThumbLeftEdge) {
                rightThumbLeftEdge = key.x;
            }
        }

        // Calculate independent X shifts for each thumb cluster
        // This handles asymmetric configurations (e.g., 6-key thumb on left, 5-key finger on right)
        const desiredXGap = 0.4; // Gap between thumb clusters horizontally (in units)

        // Left thumb: align rightmost edge to be (desiredXGap/2) left of midline
        const leftThumbShiftX = (midline - desiredXGap / 2) - leftThumbRightEdge;

        // Right thumb: align leftmost edge to be (desiredXGap/2) right of midline
        const rightThumbShiftX = (midline + desiredXGap / 2) - rightThumbLeftEdge;

        // Calculate Y positioning dynamically based on index finger cluster bottom edges
        // Find bottom edge of left index cluster (max Y + height)
        let leftIndexBottomEdge = 0;
        for (const matrixPos of (keysByRow[leftIndexRow] || [])) {
            const key = layout[matrixPos];
            const bottomEdge = key.y + key.h;
            if (bottomEdge > leftIndexBottomEdge) {
                leftIndexBottomEdge = bottomEdge;
            }
        }

        // Find bottom edge of right index cluster
        let rightIndexBottomEdge = 0;
        for (const matrixPos of (keysByRow[rightIndexRow] || [])) {
            const key = layout[matrixPos];
            const bottomEdge = key.y + key.h;
            if (bottomEdge > rightIndexBottomEdge) {
                rightIndexBottomEdge = bottomEdge;
            }
        }

        // Find top edge of left thumb cluster (min Y)
        let leftThumbTopEdge = Infinity;
        for (const matrixPos of (keysByRow[leftThumbRow] || [])) {
            const key = layout[matrixPos];
            if (key.y < leftThumbTopEdge) {
                leftThumbTopEdge = key.y;
            }
        }

        // Find top edge of right thumb cluster
        let rightThumbTopEdge = Infinity;
        for (const matrixPos of (keysByRow[rightThumbRow] || [])) {
            const key = layout[matrixPos];
            if (key.y < rightThumbTopEdge) {
                rightThumbTopEdge = key.y;
            }
        }

        // Desired gap between index bottom and thumb top (in key units)
        const desiredYGap = 1.0 + FRAGMENT_THUMB_GAP_REDUCTION_U;

        // Use the maximum index cluster bottom edge so both thumbs stay horizontally aligned
        // If either index cluster is taller (e.g., 6-key), both thumbs move down together
        const maxIndexBottomEdge = Math.max(leftIndexBottomEdge, rightIndexBottomEdge);

        // Calculate a single Y shift for both thumb clusters to keep them aligned
        // Use the minimum thumb top edge to ensure proper gap from the tallest index cluster
        const minThumbTopEdge = Math.min(leftThumbTopEdge, rightThumbTopEdge);
        const thumbShiftY = (maxIndexBottomEdge + desiredYGap) - minThumbTopEdge;

        const finite = (n: number) => (Number.isFinite(n) ? n : 0);
        return {
            left: { dx: finite(leftThumbShiftX), dy: finite(thumbShiftY) },
            right: { dx: finite(rightThumbShiftX), dy: finite(thumbShiftY) },
            keysByRow,
            midline,
            maxIndexBottomEdge,
            desiredYGap,
        };
    }

    /**
     * Apply placement corrections to thumb clusters (see computeThumbCorrections).
     *
     * @param layout - The composed layout to correct
     * @param _kbinfo - Keyboard info (unused, kept for API compatibility)
     * @returns Corrected layout with thumb clusters in the right positions
     */
    applyPlacementCorrections(
        layout: Record<number, ComposedKeyLayout>,
        _kbinfo: KeyboardInfo
    ): Record<number, ComposedKeyLayout> {
        const leftThumbRow = 0;
        const rightThumbRow = 5;
        const { left, right, keysByRow, midline, maxIndexBottomEdge, desiredYGap } = this.computeThumbCorrections(layout);
        const thumbShiftY = left.dy;
        const leftThumbShiftX = left.dx;
        const rightThumbShiftX = right.dx;

        const correctedLayout = { ...layout };

        // Apply corrections to both thumb clusters
        for (const row of [leftThumbRow, rightThumbRow]) {
            const clusterKeys = keysByRow[row] || [];
            if (clusterKeys.length === 0) continue;

            const isLeftThumb = row === leftThumbRow;

            // Use independent X shifts but shared Y shift to keep thumbs horizontally aligned
            const shiftX = isLeftThumb ? leftThumbShiftX : rightThumbShiftX;

            for (const matrixPos of clusterKeys) {
                const key = correctedLayout[matrixPos];
                correctedLayout[matrixPos] = {
                    ...key,
                    x: key.x + shiftX,
                    y: key.y + thumbShiftY,
                };
            }

            console.log(`Thumb cluster row ${row}: shiftX=${shiftX.toFixed(2)}, shiftY=${thumbShiftY.toFixed(2)}`);
        }

        console.log(`Midline: ${midline.toFixed(2)}, maxIndexBottom: ${maxIndexBottomEdge.toFixed(2)}, desiredYGap: ${desiredYGap.toFixed(2)}`);

        return correctedLayout;
    }
}
