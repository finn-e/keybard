import { useMemo, useSyncExternalStore } from "react";

/**
 * The key color being picked in the layer color dialog, shown on the layout
 * before Apply. It lives outside the keyboard state, so a preview never marks
 * the layout edited, reaches a backup, or outlasts Cancel.
 */
export type LayerColorPreview = { layer: number; color: string } | null;

let preview: LayerColorPreview = null;
const listeners = new Set<() => void>();

export function setLayerColorPreview(next: LayerColorPreview): void {
    if (next === preview || (next && preview && next.layer === preview.layer && next.color === preview.color)) return;
    preview = next;
    listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

export function useLayerColorPreview(): LayerColorPreview {
    return useSyncExternalStore(subscribe, () => preview);
}

/** A keyboard's layer color names (preset names or hex), with any preview applied. */
export function usePreviewedLayerColors(layerColors: Record<string, string> | undefined): Record<string, string> | undefined {
    const current = useLayerColorPreview();
    return useMemo(
        () => (current ? { ...layerColors, [current.layer.toString()]: current.color } : layerColors),
        [layerColors, current],
    );
}
