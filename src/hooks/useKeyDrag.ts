import React, { useRef, useState, useMemo, useCallback } from "react";
import { DragItem, useDrag } from "@/contexts/DragContext";
import { useKeyBinding } from "@/contexts/KeyBindingContext";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { KeyContent } from "@/types/keyboard.types";
import { keyService } from "@/services/key.service";
import { UNIT_SIZE, MATRIX_COLS } from "@/constants/svalboard-layout";
import { useLayoutSettings } from "@/contexts/LayoutSettingsContext";

export interface UseKeyDragProps {
    uniqueId: string;
    keycode: string;
    label: string;
    row: number;
    col: number;
    layerIndex: number;
    layerColor: string;
    isRelative: boolean;
    keyContents?: KeyContent;
    w: number;
    h: number;
    dragW?: number;
    dragH?: number;
    variant: "default" | "medium" | "small";
    onClick?: (row: number, col: number) => void;
    disableHover?: boolean;
    disableDrag?: boolean;
    dragItemData?: Partial<DragItem>;
    unitSize?: number;
}

/**
 * Custom hook to handle drag and drop logic for a single key.
 */
export const useKeyDrag = (props: UseKeyDragProps) => {
    const {
        uniqueId, keycode, label, row, col, layerIndex, layerColor,
        isRelative, keyContents, w, h, dragW, dragH, variant, onClick, disableHover, disableDrag,
        dragItemData, unitSize
    } = props;

    const { startDrag, dragSourceId, isDragging, draggedItem, markDropConsumed } = useDrag();
    const { assignKeycodeTo, selectKeyboardKey, swapKeys, setHoveredKey, clearSelection } = useKeyBinding();
    const { keyboard } = useKeyboard();
    const { keyVariant } = useLayoutSettings();

    const startPosRef = useRef<{ x: number; y: number } | null>(null);
    const [isDragHover, setIsDragHover] = useState(false);

    const currentUnitSize = useMemo(() => {
        if (unitSize !== undefined) return unitSize;
        if (variant === "small") return 30;
        if (variant === "medium") return 45;
        return UNIT_SIZE;
    }, [variant, unitSize]);

    // Calculate the target unit size for the drag payload based on the global key variant
    const targetUnitSize = useMemo(() => {
        if (keyVariant === "small") return 30;
        if (keyVariant === "medium") return 45;
        return UNIT_SIZE;
    }, [keyVariant]);

    const isDragSource = dragSourceId === uniqueId;
    const canDrop = !isRelative && isDragging;

    const handleMouseEnter = useCallback(() => {
        if (canDrop) {
            setIsDragHover(true);
            selectKeyboardKey(layerIndex, row, col);
            onClick?.(row, col);
        }

        if (!disableHover) {
            setHoveredKey({ type: "keyboard", row, col, keycode, label });
        }
    }, [canDrop, selectKeyboardKey, layerIndex, row, col, onClick, disableHover, setHoveredKey, keycode, label]);

    const handleMouseLeave = useCallback(() => {
        if (canDrop) {
            setIsDragHover(false);
            clearSelection();
        }

        if (!disableHover) {
            setHoveredKey(null);
        }
    }, [canDrop, disableHover, setHoveredKey, clearSelection]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0 || disableDrag) return;

        startPosRef.current = { x: e.clientX, y: e.clientY };

        const checkDrag = (moveEvent: MouseEvent) => {
            const start = startPosRef.current;
            if (!start) return;

            const dx = moveEvent.clientX - start.x;
            const dy = moveEvent.clientY - start.y;

            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                // Clear keyboard selection when drag starts
                clearSelection();

                // Use drag dimensions if provided, otherwise use actual dimensions
                const effectW = dragW ?? w;
                const effectH = dragH ?? h;

                const dragPayload: DragItem = {
                    keycode,
                    label: label || keycode,
                    type: keyContents?.type || "keyboard",
                    extra: keyContents,
                    sourceId: uniqueId,
                    width: effectW * targetUnitSize,
                    height: effectH * targetUnitSize,
                    component: "Key",
                    props: {
                        x: 0, y: 0, w: effectW, h: effectH, keycode, label, row, col,
                        layerColor, keyContents, isRelative: true,
                        variant: keyVariant, className: "", selected: false, disableHover: true
                    },
                    row: isRelative ? undefined : row,
                    col: isRelative ? undefined : col,
                    layer: isRelative ? undefined : layerIndex,
                    ...dragItemData // Merge custom drag data overrides
                };

                startDrag(dragPayload, moveEvent);
                cleanup();
            }
        };

        const handleUp = () => cleanup();

        const cleanup = () => {
            startPosRef.current = null;
            window.removeEventListener("mousemove", checkDrag);
            window.removeEventListener("mouseup", handleUp);
        };

        window.addEventListener("mousemove", checkDrag);
        window.addEventListener("mouseup", handleUp);
    }, [keycode, label, keyContents, uniqueId, w, currentUnitSize, h, row, col, layerColor, variant, isRelative, layerIndex, startDrag, dragW, dragH, dragItemData]);

    const handleMouseUp = useCallback(() => {
        if (canDrop && isDragHover && draggedItem) {
            markDropConsumed();

            if (draggedItem.row !== undefined && draggedItem.col !== undefined && draggedItem.layer !== undefined) {
                if (draggedItem.row !== row || draggedItem.col !== col || draggedItem.layer !== layerIndex) {
                    swapKeys(
                        { type: "keyboard", row: draggedItem.row, col: draggedItem.col, layer: draggedItem.layer },
                        { type: "keyboard", row, col, layer: layerIndex }
                    );
                }
            } else {
                const dragKc = draggedItem.keycode;
                const dragNumeric = keyService.parse(dragKc);
                const matrixCols = keyboard!.cols || MATRIX_COLS;
                const matrixPos = row * matrixCols + col;
                const existingNumeric = keyboard?.keymap?.[layerIndex]?.[matrixPos] || 0;

                if (draggedItem.forceAssign) {
                    assignKeycodeTo({ type: "keyboard", layer: layerIndex, row, col }, dragKc);
                    setIsDragHover(false);
                    return;
                }

                // Check if the dragged item is a "wrapper" template (e.g., LCTL(KC_NO), LSFT_T(KC_NO), LT1(KC_NO))
                // OR if it's a smart preview being dragged from the sidebar (draggedItem.row is undefined)
                const isDragWrapper = (dragNumeric >= 0x0100 && dragNumeric <= 0x4FFF) &&
                    (dragNumeric & 0xFF) === 0;

                if (isDragWrapper && existingNumeric > 0) {
                    // Extract the "inner" part of the existing key (the basic key/keycode)
                    const basePart = existingNumeric & 0x00FF;

                    // Determine the types for combining logic
                    const dragType = dragNumeric & 0xF000;
                    const existingType = existingNumeric & 0xF000;

                    // Case 1: Both are same-category wrappers (e.g. both Modifiers or both Mod-Taps)
                    // We can combine their modifier masks bitwise.
                    const isModCategory = (t: number) => t === 0x0000 || t === 0x1000;
                    const isModTapCategory = (t: number) => t === 0x2000 || t === 0x3000;

                    if (isModCategory(dragType) && isModCategory(existingType)) {
                        // Combine plain modifiers (preserving existing base key)
                        assignKeycodeTo({ type: "keyboard", layer: layerIndex, row, col }, (dragNumeric | existingNumeric) & 0x1FFF);
                    } else if (isModTapCategory(dragType) && isModTapCategory(existingType)) {
                        // Combine mod-tap modifiers (preserving existing base key)
                        assignKeycodeTo({ type: "keyboard", layer: layerIndex, row, col }, (dragNumeric | existingNumeric) & 0x3FFF);
                    } else {
                        // Mixed types or first-time assignment: wrap existing base key with new modifier/type
                        // This handles LT(layer, basePart), MT(mods, basePart), etc.
                        assignKeycodeTo({ type: "keyboard", layer: layerIndex, row, col }, (dragNumeric & 0xFF00) | basePart);
                    }
                } else {
                    const dragKc = draggedItem.keycode;
                    assignKeycodeTo({ type: "keyboard", layer: layerIndex, row, col }, dragKc);
                }
            }

            setIsDragHover(false);
        }
    }, [canDrop, isDragHover, draggedItem, markDropConsumed, row, col, layerIndex, swapKeys, assignKeycodeTo, keyboard]);

    return {
        isDragSource,
        isDragHover,
        handleMouseEnter,
        handleMouseLeave,
        handleMouseDown,
        handleMouseUp,
        currentUnitSize,
    };
};
