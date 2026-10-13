import type { DragItem } from "@/contexts/DragContext";

type Assign = (target: { type: "keyboard"; row: number; col: number; layer: number }, keycode: string, options?: { skipAdvance?: boolean }) => void;

/** Dragging a layout key off the layout into blank space makes it a blank key (KC_NO). */
export function blankKeyOnDrop(assign: Assign) {
    return (item: DragItem) => {
        if (item.row === undefined || item.col === undefined || item.layer === undefined) return;
        assign({ type: "keyboard", row: item.row, col: item.col, layer: item.layer }, "KC_NO", { skipAdvance: true });
    };
}
