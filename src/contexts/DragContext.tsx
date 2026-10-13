import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import type { KeyProps } from "@/components/Key";
import { EditorKeyProps } from "@/layout/SecondarySidebar/components/EditorKey";
import { KeyContent } from "@/types/keyboard.types";
import type { LayerEntry } from "@/types/layer-library";

export interface DragItem {
    keycode: string;
    label: string;
    type: string;
    extra?: KeyContent;
    sourceId?: string;
    width?: number;
    height?: number;
    component?: "Key" | "EditorKey" | "Layer";
    props?: KeyProps | EditorKeyProps;
    row?: number;
    col?: number;
    layer?: number;
    /** Layer data when dragging an entire layer */
    layerData?: LayerEntry;
    /** Force assignment without wrapper-combine behavior */
    forceAssign?: boolean;

    // Editor context for internal swapping
    editorType?: string;
    editorId?: number | string;
    editorSlot?: number | string;
}

interface DragContextType {
    isDragging: boolean;
    draggedItem: DragItem | null;
    dragPosition: { x: number; y: number };
    startDrag: (item: DragItem, event: React.MouseEvent | MouseEvent) => void;
    dragSourceId: string | null;
    markDropConsumed: () => void;
}

export const DragContext = createContext<DragContextType | undefined>(undefined);

interface DragProviderProps {
    children: React.ReactNode;
    onUnhandledDrop?: (item: DragItem, event: MouseEvent) => void;
}

/**
 * Provides dragging state and handlers for global drag-and-drop operations.
 */
export const DragProvider: React.FC<DragProviderProps> = ({ children, onUnhandledDrop }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [draggedItem, setDraggedItem] = useState<DragItem | null>(null);
    const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
    const [dragSourceId, setDragSourceId] = useState<string | null>(null);

    const dragItemRef = useRef<DragItem | null>(null);
    const isDraggingRef = useRef(false);
    const dropConsumedRef = useRef(false);
    // Read the drop handler through a ref so handleMouseUp keeps a stable
    // identity. EditorLayout rebuilds onUnhandledDrop whenever the keymap
    // changes, and a new handleMouseUp re-ran the effect below, whose cleanup
    // removed the window listeners mid-drag. A drop onto a key changes the
    // keymap during the same mouseup, so the provider never saw the release
    // and the drag overlay stayed on screen.
    const onUnhandledDropRef = useRef(onUnhandledDrop);
    onUnhandledDropRef.current = onUnhandledDrop;

    const markDropConsumed = useCallback(() => {
        dropConsumedRef.current = true;
    }, []);

    const updatePosition = useCallback((x: number, y: number) => {
        setDragPosition({ x, y });
    }, []);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isDraggingRef.current) return;
        updatePosition(e.clientX, e.clientY);
    }, [updatePosition]);

    const handleMouseUp = useCallback((e: MouseEvent) => {
        if (isDraggingRef.current) {
            const onDrop = onUnhandledDropRef.current;
            if (!dropConsumedRef.current && onDrop && dragItemRef.current) {
                onDrop(dragItemRef.current, e);
            }

            setIsDragging(false);
            setDraggedItem(null);
            setDragSourceId(null);
            dragItemRef.current = null;
            isDraggingRef.current = false;
            dropConsumedRef.current = false;
        }

        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
    }, [handleMouseMove]);

    useEffect(() => {
        const cancel = () => {
            isDraggingRef.current = false;
            dragItemRef.current = null;
            dropConsumedRef.current = false;
            setIsDragging(false);
            setDraggedItem(null);
            setDragSourceId(null);
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape" && isDraggingRef.current) {
                event.preventDefault();
                cancel();
            }
        };
        window.addEventListener("keydown", onKey);
        window.addEventListener("blur", cancel);
        return () => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("blur", cancel);
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [handleMouseMove, handleMouseUp]);

    const startDrag = useCallback((item: DragItem, event: React.MouseEvent | MouseEvent) => {
        if (isDraggingRef.current) return;

        dragItemRef.current = item;
        setDraggedItem(item);
        if (item.sourceId) setDragSourceId(item.sourceId);

        dropConsumedRef.current = false;
        updatePosition(event.clientX, event.clientY);

        setIsDragging(true);
        isDraggingRef.current = true;

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
    }, [handleMouseMove, handleMouseUp, updatePosition]);

    const value = {
        isDragging,
        draggedItem,
        dragPosition,
        startDrag,
        dragSourceId,
        markDropConsumed
    };

    return <DragContext.Provider value={value}>{children}</DragContext.Provider>;
};

export const useDrag = (): DragContextType => {
    const context = useContext(DragContext);
    if (!context) {
        throw new Error("useDrag must be used within a DragProvider");
    }
    return context;
};
