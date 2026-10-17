import "./Keyboard.css";
import { cn } from "@/lib/utils";

import { getKeyLabel, getKeycodeName } from "@/utils/layers";
import React, { useCallback, useMemo, useEffect, useRef, useState } from "react";
import { MATRIX_COLS, UNIT_SIZE } from "../constants/svalboard-layout";
import { editorKeyLayout, editorYPos } from "@/utils/editor-key-layout";

import { useKeyBinding } from "@/contexts/KeyBindingContext";
import type { KeyboardInfo } from "../types/keyboard.types";
import { Key } from "./Key";
import { useLayoutSettings } from "@/contexts/LayoutSettingsContext";
import { useSettings } from "@/contexts/SettingsContext";
import { getLabelForKeycode } from "./Keyboards/layouts";
import {
    headerClasses,
    hoverHeaderClasses,
    hoverBackgroundClasses,
    hoverBorderClasses,
    colorClasses,
    isHexColor,
    textClassForHex,
    getColorByName
} from "@/utils/colors";
import { svalService } from "@/services/sval.service";
import { usePanels } from "@/contexts/PanelsContext";
import { useOpenBindingEditor } from "@/hooks/useOpenBindingEditor";
import { isBindingEditorOpen } from "@/lib/bindingSpotlight";
import { useChanges } from "@/hooks/useChanges";
import { usePreviewedLayerColors } from "@/hooks/useLayerColorPreview";
import { useIsDark } from "@/lib/theme";
import { useComboPreview, type PreviewFocus } from "@/contexts/ComboPreviewContext";
import { buildComboMembershipIndex, membershipCode, type ComboMembership } from "@/utils/combo-membership";
import { assignComboHues } from "@/utils/combo-hues";
import { keyComboAriaLabel } from "@/utils/combo-labels";
import { keyLabel } from "@/utils/key-inspect";
import { KeyInspector } from "@/components/combo/KeyInspector";
import { useFoldMotion } from "@/hooks/useFoldMotion";
import type { KeyComboProps } from "./Key";
import { dark3DLabelColor, needsDarkIndicatorOutline, screenedBackdropHex } from "./layer3DColors";
import { PointingLayer } from "./pointing-viz/PointingLayer";
import { placedKeyRects } from "@/utils/pointing-geometry";

const NO_MEMBERSHIPS: ComboMembership[] = [];

const TEXT_CLASS_TO_HEX: Record<string, string> = {
    "text-white": "#ffffff",
    "text-black": "#000000",
    "text-orange-800": "#9a3412",
    "text-gray-200": "#e5e7eb",
};

interface KeyboardProps {
    keyboard: KeyboardInfo;
    onKeyClick?: (layer: number, row: number, col: number) => void;
    selectedLayer: number;
    setSelectedLayer: (layer: number) => void;
    showTransparency?: boolean;
    onGhostNavigate?: (sourceLayer: number) => void;
    layerActiveState?: boolean[];
    instanceId?: string;
    show3DBackdrop?: boolean;
    activeLayerIndex?: number | null;
    isConnected?: boolean;
    isToggling3D?: boolean;
    showDropTargetHighlight?: boolean;
    isLayerDragActive?: boolean;
    /** Render the key inspector under this view (the primary view only, so it shows once). */
    showKeyInspector?: boolean;
    /** Draw each hand's pointing device (live). Only the primary layer view does, so stacked and 3D views don't each run their own. */
    showPointing?: boolean;
}

/**
 * Main Keyboard component for the Svalboard layout.
 * Renders individual keys, cluster backgrounds, and an information panel.
 */
export const Keyboard: React.FC<KeyboardProps> = ({
    keyboard,
    selectedLayer,
    setSelectedLayer,
    showTransparency = false,
    onGhostNavigate,
    layerActiveState,
    instanceId,
    show3DBackdrop,
    activeLayerIndex,
    isToggling3D = false,
    showDropTargetHighlight = false,
    isLayerDragActive = false,
    showKeyInspector = false,
    showPointing = false,
}) => {
    const {
        selectKeyboardKey,
        selectedTarget,
        clearSelection,
        assignKeycode
    } = useKeyBinding();

    const { activePanel, itemToEdit } = usePanels();
    // A click on a fold piece opens that combo's editor, as its row in the Combos list does.
    // While any binding editor is open, folds are drawing only and a click on one is a click on
    // its key (it picks the key for the editor).
    const openBindingEditor = useOpenBindingEditor();
    const openComboEditor = useCallback((index: number) => openBindingEditor("combos", index), [openBindingEditor]);
    const foldOpens = isBindingEditorOpen(activePanel, itemToEdit) ? undefined : openComboEditor;
    const { hasPendingChangeForKey } = useChanges();
    const layerColorNames = usePreviewedLayerColors(keyboard.cosmetic?.layer_colors);

    // Combo folded corners and preview (one setting owns whether they show; see ComboPreviewContext).
    const comboPreview = useComboPreview();
    const comboMembershipIndex = useMemo(() => buildComboMembershipIndex(keyboard.combos), [keyboard.combos]);
    const comboHues = useMemo(
        () => assignComboHues(keyboard, comboPreview.palette),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [keyboard.combos, keyboard.keymap, keyboard.cosmetic?.layer_colors, comboPreview.palette],
    );
    // "Small" folds grow while the pointer moves over the layout (no re-render per move).
    const layoutRef = useRef<HTMLDivElement>(null);
    useFoldMotion(layoutRef, comboPreview.mode === "small");

    // The layout is one Tab stop (roving tabindex): arrows, Home and End move between keys.
    const [tabStopPos, setTabStopPos] = useState<number | null>(null);
    const navigateFrom = (fromPos: number, key: string) => {
        const root = layoutRef.current;
        if (!root) return;
        const els = Array.from(root.querySelectorAll<HTMLElement>("[data-inspect-pos]"));
        if (!els.length) return;
        const posOf = (el: HTMLElement) => Number(el.dataset.inspectPos);
        const byPos = [...els].sort((a, b) => posOf(a) - posOf(b));
        const cur = byPos.findIndex(el => posOf(el) === fromPos);
        let next: HTMLElement | undefined;
        if (key === "Home") next = byPos[0];
        else if (key === "End") next = byPos[byPos.length - 1];
        else if (key === "ArrowLeft") next = byPos[Math.max(0, cur - 1)];
        else if (key === "ArrowRight") next = byPos[Math.min(byPos.length - 1, cur + 1)];
        else if (cur >= 0) {
            // Up and Down: the geometrically nearest key above or below.
            const r0 = byPos[cur].getBoundingClientRect();
            const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
            const dir = key === "ArrowUp" ? -1 : 1;
            let best = Infinity;
            for (const el of els) {
                const r = el.getBoundingClientRect();
                const dy = (r.top + r.height / 2 - cy) * dir;
                if (dy <= r0.height / 4) continue;
                const d = dy + Math.abs(r.left + r.width / 2 - cx) * 2;
                if (d < best) { best = d; next = el; }
            }
        }
        if (!next) return;
        setTabStopPos(posOf(next));
        next.focus();
    };

    // The composed keylayout when the board has one, else the built-in schematic (shared with the trainer and Keybard Host).
    const { layout: keyboardLayout, fragment: useFragmentLayout } = useMemo(() => editorKeyLayout(keyboard), [keyboard.keylayout]);

    // Use keyboard's cols if available, otherwise fallback to constant
    const matrixCols = keyboard.cols || MATRIX_COLS;

    const { internationalLayout, keyVariant, fingerClusterSqueeze, is3DMode, isThumb3DOffsetActive, backdropOpacity } = useLayoutSettings();
    const { getSetting } = useSettings();
    const isTransmitting = useMemo(() =>
        itemToEdit !== null && ["tapdances", "combos", "macros", "overrides"].includes(activePanel || ""),
        [itemToEdit, activePanel]
    );
    const [show3DBackdrops, setShow3DBackdrops] = useState(is3DMode);
    const [backdropsVisible, setBackdropsVisible] = useState(is3DMode);
    const hasInitializedBackdropToggleRef = useRef(false);
    const visual3DActive = (show3DBackdrop ?? is3DMode) || isToggling3D;

    const currentUnitSize = useMemo(() =>
        keyVariant === 'small' ? 30 : keyVariant === 'medium' ? 45 : UNIT_SIZE,
        [keyVariant]
    );

    const getYPos = (y: number) => editorYPos(y, useFragmentLayout);

    const layoutValues = useMemo(
        () => Object.values(keyboardLayout) as Array<{ x: number; y: number; w: number; h: number; row?: number; col?: number }>,
        [keyboardLayout]
    );

    const clusterBounds = useMemo(() => {
        const clusterTopKeys = [
            { x: 1, y: 1.5 },   // Q
            { x: 3.5, y: 0 },   // W
            { x: 7, y: 0 },     // E
            { x: 9.5, y: 1.5 }, // R
            { x: 13.8, y: 1.5 }, // U
            { x: 16.3, y: 0 },  // I
            { x: 19.8, y: 0 },  // O
            { x: 22.3, y: 1.5 }, // P
        ];

        const findKeyByXY = (x: number, y: number): { x: number; y: number; w: number; h: number } | null => {
            let best: { x: number; y: number; w: number; h: number } | null = null;
            let bestDist = Infinity;
            layoutValues.forEach((k) => {
                const dx = Math.abs(k.x - x);
                const dy = Math.abs(k.y - y);
                const dist = dx + dy;
                if (dist < bestDist) {
                    bestDist = dist;
                    best = k;
                }
            });
            return bestDist <= 0.75 ? best : null;
        };

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        clusterTopKeys.forEach(({ x, y }) => {
            const top = findKeyByXY(x, y);
            const right = findKeyByXY(x + 1, y + 1);
            const bottom = findKeyByXY(x, y + 2);
            const left = findKeyByXY(x - 1, y + 1);
            const candidates: Array<{ x: number; y: number; w: number; h: number } | null> = [top, right, bottom, left];
            candidates.forEach((k) => {
                if (!k) return;
                const yPos = getYPos(k.y);
                minX = Math.min(minX, k.x);
                minY = Math.min(minY, yPos);
                maxX = Math.max(maxX, k.x + k.w);
                maxY = Math.max(maxY, yPos + k.h);
            });
        });

        if (!Number.isFinite(minX)) {
            return null;
        }

        return { minX, minY, maxX, maxY };
    }, [layoutValues, getYPos, useFragmentLayout]);

    // Some fragment combinations (for example 6-key index/pinky) extend finger keys lower
    // than our nominal cluster hull. Extend only the backdrop bottom so keys never overhang.
    const fingerBackdropBottomExtensionUnits = useMemo(() => {
        if (!clusterBounds) return 0;

        let fingerMaxY = -Infinity;
        layoutValues.forEach((k) => {
            const isThumbCluster = k.y >= 5;
            if (isThumbCluster) return;
            const yPos = getYPos(k.y);
            fingerMaxY = Math.max(fingerMaxY, yPos + k.h);
        });

        if (!Number.isFinite(fingerMaxY)) return 0;

        const overhang = fingerMaxY - clusterBounds.maxY;
        if (overhang <= 0) return 0;

        // Small safety margin avoids antialias/edge clipping in the projected 3D view.
        return overhang + 0.25;
    }, [clusterBounds, layoutValues, getYPos]);

    // Only apply backdrop/thumb extension for 6-key index/pinky fragment configurations.
    const hasSixKeyIndexOrPinky = useMemo(() => {
        const instances = keyboard.composition?.instances;
        const fragments = keyboard.fragments;
        if (!instances || !fragments) return false;

        const targetInstanceIds = new Set(["left_pinky", "right_pinky", "left_index", "right_index"]);
        const getFromMapLike = <K extends string | number, V>(
            mapOrObj: Map<K, V> | Record<string, V> | undefined,
            key: K
        ): V | undefined => {
            if (!mapOrObj) return undefined;
            if (mapOrObj instanceof Map) return mapOrObj.get(key);
            return (mapOrObj as Record<string, V>)[String(key)];
        };
        const getFragmentNameById = (fragmentId: number): string | undefined => {
            for (const [name, fragment] of Object.entries(fragments)) {
                if (fragment.id === fragmentId) return name;
            }
            return undefined;
        };

        for (let idx = 0; idx < instances.length; idx++) {
            const instance = instances[idx];
            if (!targetInstanceIds.has(instance.id)) continue;

            let fragmentName: string | undefined = instance.fragment;
            const options = instance.fragment_options ?? [];

            if (!fragmentName && options.length > 0) {
                const userSelection = getFromMapLike(keyboard.fragmentState?.userSelections, instance.id);
                if (userSelection && options.some(opt => opt.fragment === userSelection)) {
                    fragmentName = userSelection;
                }
            }

            if (!fragmentName && options.length > 0) {
                const eepromOptionIdx = getFromMapLike(keyboard.fragmentState?.eepromSelections, idx);
                if (typeof eepromOptionIdx === "number" && eepromOptionIdx >= 0 && eepromOptionIdx < options.length) {
                    fragmentName = options[eepromOptionIdx].fragment;
                }
            }

            if (!fragmentName && options.length > 0) {
                const hwFragmentId = getFromMapLike(keyboard.fragmentState?.hwDetection, idx);
                if (typeof hwFragmentId === "number" && hwFragmentId !== 0xff) {
                    const hwName = getFragmentNameById(hwFragmentId);
                    if (hwName && options.some(opt => opt.fragment === hwName)) {
                        fragmentName = hwName;
                    }
                }
            }

            if (!fragmentName && options.length > 0) {
                fragmentName = options.find(opt => opt.default)?.fragment ?? options[0].fragment;
            }

            if (!fragmentName) continue;

            const fragmentDef = fragments[fragmentName];
            const normalizedName = fragmentName.toLowerCase();
            const normalizedDesc = (fragmentDef?.description ?? "").toLowerCase();
            if (normalizedName.includes("finger_6") || /\b6[- ]?key\b/.test(normalizedDesc)) {
                return true;
            }
        }

        return false;
    }, [keyboard.composition, keyboard.fragments, keyboard.fragmentState]);

    const effectiveFingerBackdropExtensionUnits = hasSixKeyIndexOrPinky ? fingerBackdropBottomExtensionUnits : 0;

    const thumbClusterBounds = useMemo(() => {
        const hideThumbs2D = !visual3DActive && isThumb3DOffsetActive;
        if (hideThumbs2D) return null;
        const thumbKeys = layoutValues.filter((k) => k.y >= 5);

        if (thumbKeys.length === 0) return null;

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        thumbKeys.forEach((k) => {
            const yPos = getYPos(k.y);
            minX = Math.min(minX, k.x);
            minY = Math.min(minY, yPos);
            maxX = Math.max(maxX, k.x + k.w);
            maxY = Math.max(maxY, yPos + k.h);
        });

        if (!Number.isFinite(minX)) return null;

        return { minX, minY, maxX, maxY };
    }, [layoutValues, getYPos, visual3DActive, isThumb3DOffsetActive]);

    // Backdrop-only clamp: push thumb backdrop down just enough to avoid overlap.
    // Do not move thumb keys.
    const thumbBackdropNonOverlapPushUnits = useMemo(() => {
        if (!visual3DActive || !clusterBounds || !thumbClusterBounds) return 0;
        const fingerBackdropBottomUnits = clusterBounds.maxY + 0.5 + effectiveFingerBackdropExtensionUnits;
        const thumbBackdropTopBaseUnits = thumbClusterBounds.minY - 1;
        return Math.max(0, fingerBackdropBottomUnits - thumbBackdropTopBaseUnits);
    }, [visual3DActive, clusterBounds, thumbClusterBounds, effectiveFingerBackdropExtensionUnits]);

    // Calculate layout midline for squeeze positioning (center X of the keyboard)
    const layoutMidline = useMemo(() => {
        let maxX = 0;
        layoutValues.forEach((key) => {
            maxX = Math.max(maxX, key.x + key.w);
        });
        return maxX / 2;
    }, [layoutValues]);

    // Ref to store the selection before entering transmitting mode
    const savedSelection = useRef<{ layer: number; row: number; col: number } | null>(null);

    useEffect(() => {
        if (isTransmitting) {
            if (selectedTarget?.type === "keyboard" && typeof selectedTarget.row === "number" && typeof selectedTarget.col === "number") {
                savedSelection.current = {
                    layer: selectedTarget.layer ?? selectedLayer,
                    row: selectedTarget.row,
                    col: selectedTarget.col,
                };
                clearSelection();
            }
        } else if (savedSelection.current) {
            const { layer, row, col } = savedSelection.current;
            selectKeyboardKey(layer, row, col);
            savedSelection.current = null;
        }
    }, [isTransmitting, selectedTarget, selectedLayer, clearSelection, selectKeyboardKey]);

    const layerColor = useMemo(() =>
        layerColorNames?.[selectedLayer] || "primary",
        [layerColorNames, selectedLayer]
    );

    const layerKeymap = useMemo(() =>
        keyboard.keymap?.[selectedLayer] || [],
        [keyboard.keymap, selectedLayer]
    );
    // Until a key has been focused, the layout's Tab stop is its first key in matrix order.
    const firstKeyPos = useMemo(() => Math.min(...Object.keys(keyboardLayout).map(Number)), [keyboardLayout]);

    const isKeySelected = (row: number, col: number) => {
        return selectedTarget?.type === "keyboard" &&
            selectedTarget.layer === selectedLayer &&
            selectedTarget.row === row &&
            selectedTarget.col === col;
    };

    const handleKeyClick = (row: number, col: number) => {
        if (isTransmitting) {
            const pos = row * matrixCols + col;
            const keycode = layerKeymap[pos] || 0;
            const keycodeName = getKeycodeName(keycode);
            assignKeycode(keycodeName);
            return;
        }

        if (isKeySelected(row, col)) {
            clearSelection();
            return;
        }
        selectKeyboardKey(selectedLayer, row, col);
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const typingBindsKey = getSetting("typing-binds-key");
            if (typingBindsKey) return;

            if (!(e.key === "Delete" || e.key === "Backspace")) return;
            if (selectedTarget?.type !== "keyboard") return;

            // Ignore if user is typing in an input or textarea
            const target = e.target as HTMLElement;
            if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

            if (selectedTarget.layer === selectedLayer && typeof selectedTarget.row === 'number') {
                e.preventDefault();
                e.stopPropagation();
                const shouldTransparent = e.key === "Delete" || (e.key === "Backspace" && e.shiftKey);
                assignKeycode(shouldTransparent ? "KC_TRNS" : "KC_NO");
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedTarget, selectedLayer, assignKeycode, getSetting]);

    const layoutOffsets = useMemo(() => {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        const hideThumbs2D = !is3DMode && isThumb3DOffsetActive;

        layoutValues.forEach((key) => {
            const isThumbCluster = key.y >= 5;
            if (hideThumbs2D && isThumbCluster) {
                maxX = Math.max(maxX, key.x + key.w);
                return;
            }
            const yPos = getYPos(key.y);
            let xPos = key.x;
            if (fingerClusterSqueeze > 0) {
                const keyCenterX = key.x + key.w / 2;
                if (keyCenterX < layoutMidline) {
                    xPos = key.x + fingerClusterSqueeze;
                } else {
                    xPos = key.x - fingerClusterSqueeze;
                }
                xPos -= fingerClusterSqueeze;
            }
            minX = Math.min(minX, xPos);
            minY = Math.min(minY, yPos);
            maxX = Math.max(maxX, xPos + key.w);
            maxY = Math.max(maxY, yPos + key.h);
        });

        if (!Number.isFinite(minX)) {
            return { offsetX: 0, offsetY: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }

        const offsetX = minX < 0 ? -minX : 0;
        const offsetY = minY < 0 ? -minY : 0;
        return { offsetX, offsetY, minX, minY, maxX, maxY };
    }, [layoutValues, getYPos, fingerClusterSqueeze, layoutMidline, is3DMode, isThumb3DOffsetActive]);

    const keyboardSize = useMemo(() => {
        let maxX = 0;
        let maxY = 0;
        let minY = Infinity; // Top edge of keyboard
        const hideThumbs2D = !is3DMode && isThumb3DOffsetActive;

        layoutValues.forEach((key) => {
            const isThumbCluster = key.y >= 5;
            if (hideThumbs2D && isThumbCluster) {
                // Keep width from full layout, but reduce height when thumbs are hidden in 2D
                maxX = Math.max(maxX, key.x + key.w);
                return;
            }
            const yPos = getYPos(key.y);
            maxX = Math.max(maxX, key.x + key.w);
            maxY = Math.max(maxY, yPos + key.h);
            minY = Math.min(minY, yPos);
        });

        // Adjust width for squeeze (both sides squeezed toward center)
        const adjustedMaxX = maxX - (2 * fingerClusterSqueeze);
        const widthUnits = layoutOffsets.maxX - layoutOffsets.minX;
        const heightUnits = layoutOffsets.maxY - layoutOffsets.minY;

        // Badge position: horizontally centered, aligned with top keys (same Y level)
        const badgeCenterX = (adjustedMaxX / 2) * currentUnitSize;
        // Position at the same Y level as the top keys (center of the top row)
        const badgeCenterY = ((minY + layoutOffsets.offsetY) + 0.5) * currentUnitSize;

        return {
            width: Math.max(widthUnits, adjustedMaxX) * currentUnitSize,
            height: Math.max(heightUnits, maxY - minY) * currentUnitSize + 20,
            badgeCenterX,
            badgeCenterY,
        };
    }, [layoutValues, currentUnitSize, useFragmentLayout, fingerClusterSqueeze, is3DMode, isThumb3DOffsetActive, layoutOffsets]);

    const isActiveLayerBackdrop = typeof activeLayerIndex === "number" && activeLayerIndex === selectedLayer;
    const isLayerActive = typeof activeLayerIndex === "number"
        ? activeLayerIndex === selectedLayer
        : !!layerActiveState?.[selectedLayer];

    const layerBackdropColor = useMemo(() => {
        const layerName = layerColorNames?.[selectedLayer] || "green";
        const color = getColorByName(layerName)?.hex || "#099e7c";
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        const appliedOpacity = isActiveLayerBackdrop ? 0.65 : backdropOpacity;
        return `rgba(${r}, ${g}, ${b}, ${appliedOpacity})`;
    }, [layerColorNames, selectedLayer, backdropOpacity, isActiveLayerBackdrop]);
    const isBackdropDropTargetActive = is3DMode && isLayerDragActive;

    const layerDisplayName = useMemo(() => {
        return svalService.getLayerName(keyboard, selectedLayer);
    }, [keyboard, selectedLayer]);

    const layerHeaderTextColor = useMemo(() => {
        const layerName = layerColorNames?.[selectedLayer] || "green";
        return getColorByName(layerName)?.hex || "#099e7c";
    }, [layerColorNames, selectedLayer]);

    const layerTextColorClass = useMemo(() => {
        const layerName = layerColorNames?.[selectedLayer] || "green";
        if (isHexColor(layerName)) return textClassForHex(layerName);
        const classes = colorClasses[layerName] || colorClasses.primary;
        return classes.split(" ").find(c => c.startsWith("text-"));
    }, [layerColorNames, selectedLayer]);
    const keyTextColorHex = layerTextColorClass ? TEXT_CLASS_TO_HEX[layerTextColorClass] : undefined;
    const active3DIndicatorColor = isLayerActive ? (keyTextColorHex || layerHeaderTextColor) : layerHeaderTextColor;
    const useKeyTextColorFor3DLabel = isLayerActive
        ? !!layerTextColorClass
        : !!layerTextColorClass && layerTextColorClass !== "text-white" && layerTextColorClass !== "text-gray-200";
    const inactiveGrayTextLabelOverride = !isLayerActive && layerTextColorClass === "text-gray-200"
        ? "#000000"
        : undefined;
    // Dark mode only. The 3D layer label and its status ring/dot sit inside the top-left
    // corner of the layer backdrop, which dark mode screens over the page. Contrast is
    // measured against that composited backdrop (layer3DColors.ts). Light path unchanged.
    const isDark = useIsDark();
    const darkBackdropHex = useMemo(() => {
        if (!isDark) return undefined;
        const layerName = layerColorNames?.[selectedLayer] || "green";
        const layerHex = getColorByName(layerName)?.hex || "#099e7c";
        return screenedBackdropHex(layerHex, isActiveLayerBackdrop ? 0.65 : backdropOpacity);
    }, [isDark, layerColorNames, selectedLayer, isActiveLayerBackdrop, backdropOpacity]);
    const dark3DLabelColorValue = useMemo(() => {
        if (!darkBackdropHex) return undefined;
        const base = useKeyTextColorFor3DLabel
            ? (layerTextColorClass ? TEXT_CLASS_TO_HEX[layerTextColorClass] : undefined)
            : (inactiveGrayTextLabelOverride ?? active3DIndicatorColor);
        return base ? dark3DLabelColor(base, darkBackdropHex) : undefined;
    }, [darkBackdropHex, useKeyTextColorFor3DLabel, layerTextColorClass, inactiveGrayTextLabelOverride, active3DIndicatorColor]);
    const darkIndicatorOutline = !!darkBackdropHex && needsDarkIndicatorOutline(active3DIndicatorColor, darkBackdropHex)
        ? "0 0 0 1px var(--kb-gray-border)"
        : undefined;
    const isDefaultLayer = selectedLayer === 0;
    const showStatusRing = isDefaultLayer || isLayerActive;
    const useInsetDotStyle = isLayerActive && !isDefaultLayer;

    const getDarkLayerHex = (layerName: string) => {
        const layerHex = getColorByName(layerName)?.hex || "#099e7c";
        const r = parseInt(layerHex.slice(1, 3), 16);
        const g = parseInt(layerHex.slice(3, 5), 16);
        const b = parseInt(layerHex.slice(5, 7), 16);
        const darkenMultiplier = 0.7;
        const rd = Math.round(r * darkenMultiplier).toString(16).padStart(2, "0");
        const gd = Math.round(g * darkenMultiplier).toString(16).padStart(2, "0");
        const bd = Math.round(b * darkenMultiplier).toString(16).padStart(2, "0");
        return `#${rd}${gd}${bd}`;
    };


    const KC_TRNS = 1;
    const UNDERLAY_SCREEN_OFFSET_PX = 4;
    const LAYER_LABEL_PREPROJECTION_Y_SHIFT_PX = 8;
    const ISOMETRIC_ROTATE_Z_DEG = -45;
    const ISOMETRIC_ROTATE_X_DEG = 55;
    const BACKDROP_OPACITY_TRANSITION = "opacity 500ms ease-in-out";
    const THUMB_BACKDROP_TRANSITION = "opacity 500ms ease-in-out, transform 500ms ease-in-out";
    const KEY_3D_MOTION_TRANSITION = "top 500ms ease-in-out, left 500ms ease-in-out, transform 500ms ease-in-out, opacity 500ms ease-in-out";

    // Convert desired screen-space vertical drop into local XY offsets that cancel X drift
    // after rotateZ + rotateX in 3D view.
    const underlayLocalOffset = useMemo(() => {
        const zRad = (ISOMETRIC_ROTATE_Z_DEG * Math.PI) / 180;
        const xRad = (ISOMETRIC_ROTATE_X_DEG * Math.PI) / 180;
        const cosZ = Math.cos(zRad);
        const sinZ = Math.sin(zRad);
        const cosX = Math.cos(xRad);

        // Solve:
        //  screenDx = dx*cosZ - dy*sinZ = 0
        //  screenDy = (dx*sinZ + dy*cosZ) * cosX = UNDERLAY_SCREEN_OFFSET_PX
        const dy = UNDERLAY_SCREEN_OFFSET_PX / ((sinZ * sinZ / cosZ + cosZ) * cosX);
        const dx = dy * (sinZ / cosZ);
        return { dx, dy };
    }, []);

    // Helper to find effective keycode for transparency
    // Uses layerActiveState (UI/device) to decide which lower layers are "active".
    // Fallback is always Layer 0.
    const findEffectiveKey = (startLayer: number, pos: number) => {
        for (let l = startLayer - 1; l >= 0; l--) {
            const isActive = layerActiveState ? !!layerActiveState[l] : false;
            if (!isActive) continue;
            const keymap = keyboard.keymap?.[l];
            if (!keymap) continue;
            const code = keymap[pos];
            if (code !== KC_TRNS) {
                return {
                    keycode: code,
                    sourceLayer: l,
                    sourceLayerColor: layerColorNames?.[l] || "primary"
                };
            }
        }

        // Fallback to layer 0 key
        const baseLayer = 0;
        const keymap = keyboard.keymap?.[baseLayer];
        if (!keymap) return null;
        const code = keymap[pos];
        return {
            keycode: code,
            sourceLayer: baseLayer,
            sourceLayerColor: layerColorNames?.[baseLayer] || "primary"
        };
    };

    useEffect(() => {
        if (!hasInitializedBackdropToggleRef.current) {
            hasInitializedBackdropToggleRef.current = true;
            return;
        }

        let enterFrame = 0;
        let exitTimer = 0;

        if (is3DMode) {
            setShow3DBackdrops(true);
            setBackdropsVisible(false);
            enterFrame = requestAnimationFrame(() => {
                setBackdropsVisible(true);
            });
        } else {
            setBackdropsVisible(false);
            exitTimer = window.setTimeout(() => {
                setShow3DBackdrops(false);
            }, 500);
        }

        return () => {
            cancelAnimationFrame(enterFrame);
            window.clearTimeout(exitTimer);
        };
    }, [is3DMode]);

    return (
        <div className="p-4 pointer-events-none" data-keyboard-instance={instanceId}>
            <div
                ref={layoutRef}
                className="keyboard-layout relative pointer-events-none"
                style={{
                    width: `${keyboardSize.width}px`,
                    height: `${keyboardSize.height}px`,
                }}
            >
                {show3DBackdrops && clusterBounds && (
                    <div
                        className="absolute mix-blend-multiply dark:mix-blend-screen"
                        data-layer-backdrop="true"
                        data-layer-index={selectedLayer}
                        style={{
                            left: ((clusterBounds!.minX + layoutOffsets.offsetX) * currentUnitSize) - currentUnitSize,
                            top: ((clusterBounds!.minY + layoutOffsets.offsetY) * currentUnitSize) - currentUnitSize,
                            width: ((clusterBounds!.maxX - clusterBounds!.minX) * currentUnitSize) + (currentUnitSize * 3),
                            height:
                                ((clusterBounds!.maxY - clusterBounds!.minY) * currentUnitSize) +
                                (currentUnitSize * 1.5) +
                                (effectiveFingerBackdropExtensionUnits * currentUnitSize),
                            background: layerBackdropColor,
                            zIndex: -1,
                            pointerEvents: isBackdropDropTargetActive ? "auto" : "none",
                            opacity: backdropsVisible ? 1 : 0,
                            transition: BACKDROP_OPACITY_TRANSITION,
                        }}
                    >
                    </div>
                )}
                {(is3DMode || isToggling3D) && clusterBounds && (() => {
                    // Scale label offsets proportionally to key size so alignment works at all sizes.
                    const sizeRatio = currentUnitSize / UNIT_SIZE;
                    const labelPadX = 24 * sizeRatio;
                    const labelPadY = 8 * sizeRatio;
                    const labelYShift = LAYER_LABEL_PREPROJECTION_Y_SHIFT_PX * sizeRatio;
                    const indicatorSize = Math.round(28 * sizeRatio);
                    const dotSize = Math.round(18 * sizeRatio);
                    const fontSize = Math.max(12, Math.round(18 * sizeRatio));
                    return (
                        <div
                            className={cn(
                                "absolute font-normal select-none flex items-center gap-2 transition-opacity duration-500",
                                useKeyTextColorFor3DLabel && layerTextColorClass
                            )}
                            data-layer-label="true"
                            style={{
                                color: dark3DLabelColorValue ?? (useKeyTextColorFor3DLabel
                                    ? undefined
                                    : (inactiveGrayTextLabelOverride ?? active3DIndicatorColor)),
                                left: ((clusterBounds!.minX + layoutOffsets.offsetX) * currentUnitSize) - currentUnitSize + labelPadX,
                                top: ((clusterBounds!.minY + layoutOffsets.offsetY) * currentUnitSize) - currentUnitSize + labelPadY + labelYShift,
                                fontSize: `${fontSize}px`,
                                opacity: is3DMode ? 1 : 0,
                            }}
                        >
                            <span
                                className="relative rounded-full flex items-center justify-center flex-shrink-0"
                                style={{
                                    width: `${indicatorSize}px`,
                                    height: `${indicatorSize}px`,
                                    ...(showStatusRing ? { border: `2px solid ${active3DIndicatorColor}` } : {}),
                                    ...(showStatusRing && darkIndicatorOutline ? { boxShadow: darkIndicatorOutline } : {}),
                                }}
                            >
                                <span
                                    className="rounded-full shadow-sm"
                                    style={{
                                        width: `${dotSize}px`,
                                        height: `${dotSize}px`,
                                        ...(useInsetDotStyle
                                            ? {
                                                backgroundColor: "transparent",
                                                boxShadow: `inset 0 0 0 ${Math.round(6 * sizeRatio)}px ${active3DIndicatorColor}`
                                                    + (darkIndicatorOutline ? `, ${darkIndicatorOutline}` : ""),
                                            }
                                            : {
                                                backgroundColor: active3DIndicatorColor,
                                                ...(darkIndicatorOutline ? { boxShadow: darkIndicatorOutline } : {}),
                                            }),
                                    }}
                                />
                            </span>
                            <span>{layerDisplayName}</span>
                        </div>
                    );
                })()}
                {show3DBackdrops && clusterBounds && thumbClusterBounds && (
                    <div
                        className="absolute mix-blend-multiply dark:mix-blend-screen"
                        data-layer-backdrop="true"
                        data-layer-index={selectedLayer}
                        style={{
                            left: ((thumbClusterBounds!.minX + layoutOffsets.offsetX) * currentUnitSize) - currentUnitSize,
                            top: ((thumbClusterBounds!.minY + thumbBackdropNonOverlapPushUnits + layoutOffsets.offsetY) * currentUnitSize) - currentUnitSize,
                            width: ((thumbClusterBounds!.maxX - thumbClusterBounds!.minX) * currentUnitSize) + (currentUnitSize * 2),
                            height: ((thumbClusterBounds!.maxY - thumbClusterBounds!.minY) * currentUnitSize) + (currentUnitSize * 1.5),
                            background: layerBackdropColor,
                            zIndex: -1,
                            pointerEvents: isBackdropDropTargetActive ? "auto" : "none",
                            opacity: backdropsVisible ? 1 : 0,
                            transform: (visual3DActive && isThumb3DOffsetActive) ? "translateY(900px)" : undefined,
                            transition: THUMB_BACKDROP_TRANSITION,
                        }}
                    />
                )}
                {/* Pointing devices at true size beside the thumbs (2D only; they follow the squeeze). */}
                {showPointing && !visual3DActive && !isThumb3DOffsetActive && (
                    <PointingLayer keyboard={keyboard} unitPx={currentUnitSize} keys={placedKeyRects(layoutValues, {
                        getYPos, squeeze: fingerClusterSqueeze, midline: layoutMidline, offsetX: layoutOffsets.offsetX, offsetY: layoutOffsets.offsetY,
                    })} />
                )}
                {/* Keys */}
                {Object.entries(keyboardLayout).map(([matrixPos, layout]) => {
                    const pos = Number(matrixPos);
                    // Use row/col from layout if available (from fragments), otherwise calculate from position
                    const row = typeof layout.row === 'number' ? layout.row : Math.floor(pos / matrixCols);
                    const col = typeof layout.col === 'number' ? layout.col : pos % matrixCols;

                    let keycode = layerKeymap[pos] || 0;

                    // Transparency Logic
                    let effectiveKeycode = 0;
                    let effectiveLayerColor = "primary";
                    let isGhostKey = false;
                    let ghostSourceLayer = -1;

                    if (showTransparency && keycode === KC_TRNS && selectedLayer > 0) {
                        const effective = findEffectiveKey(selectedLayer, pos);
                        if (effective) {
                            effectiveKeycode = effective.keycode;
                            effectiveLayerColor = effective.sourceLayerColor;
                            isGhostKey = true;
                            ghostSourceLayer = effective.sourceLayer;
                        }
                    }

                    // Render Standard Key (or the underlying key if ghost is active)
                    const { label: defaultLabel, keyContents } = getKeyLabel(keyboard, keycode);
                    const keycodeName = getKeycodeName(keycode);
                    const label = getLabelForKeycode(keycodeName, internationalLayout) || defaultLabel;

                    // Inspector and combos for this key. A transparent key describes, and shows the
                    // combos of, the key it falls through to.
                    const effectiveKey = keycode === KC_TRNS && selectedLayer > 0 ? findEffectiveKey(selectedLayer, pos) : null;
                    const inherited = effectiveKey?.keycode;
                    const comboCode = membershipCode(Number(keycode), inherited == null ? undefined : Number(inherited));
                    const memberships = comboMembershipIndex.get(comboCode) ?? NO_MEMBERSHIPS;
                    const comboKeycode = getKeycodeName(comboCode);
                    const focus: PreviewFocus = {
                        kind: "key",
                        id: `${instanceId ?? "kb"}:${selectedLayer}:${row}:${col}`,
                        combos: memberships.map(m => m.index),
                        keycode: comboKeycode,
                        key: {
                            layer: selectedLayer, row, col, code: Number(keycode),
                            effective: effectiveKey ? { code: Number(effectiveKey.keycode), layer: effectiveKey.sourceLayer } : undefined,
                        },
                    };
                    const keyName = keyLabel(keyboard, comboCode > KC_TRNS ? comboCode : Number(keycode), internationalLayout);
                    const combo: KeyComboProps = {
                        memberships: comboPreview.enabled ? memberships : NO_MEMBERSHIPS,
                        hues: comboHues,
                        focusSet: comboPreview.focusSet,
                        mode: comboPreview.mode,
                        palette: comboPreview.palette,
                        ariaLabel: memberships.length ? keyComboAriaLabel(keyName, memberships, keyboard.cosmetic?.combos) : keyName,
                        pinned: comboPreview.isPinned(focus.id),
                        tabStop: (tabStopPos ?? firstKeyPos) === pos,
                        onOpenCombo: foldOpens,
                        comboNames: keyboard.cosmetic?.combos,
                        onNavigate: (key) => navigateFrom(pos, key),
                        onEnter: () => comboPreview.enter(focus),
                        onLeave: comboPreview.leave,
                        onFocus: (el) => { setTabStopPos(pos); comboPreview.focusIn(focus, el); },
                        onBlur: comboPreview.blurOut,
                        onToggle: () => {
                            // While a combo editor is open, clicks assign keys; they do not pin.
                            if (!isTransmitting) comboPreview.togglePin(focus);
                        },
                    };

                    // Styles for transmitting mode
                    const activeLayerColor = isTransmitting ? "sidebar" : layerColor;
                    const headerClass = headerClasses[activeLayerColor] || headerClasses["primary"];
                    const hoverHeaderClass = hoverHeaderClasses[activeLayerColor] || hoverHeaderClasses["primary"];
                    const keyHeaderClassFull = `${headerClass} ${hoverHeaderClass}`;

                    const keyHoverBg = isTransmitting ? hoverBackgroundClasses[layerColor] : undefined;
                    const keyHoverBorder = isTransmitting ? hoverBorderClasses[layerColor] : undefined;
                    const keyHoverLayerColor = isTransmitting ? layerColor : undefined;
                    const keyUnderlayColor = getDarkLayerHex(activeLayerColor);

                    const yPos = getYPos(layout.y) + layoutOffsets.offsetY;

                    // Apply finger cluster squeeze: shift keys toward center based on side
                    // Only squeeze finger cluster keys (y < 5), not thumb clusters (y >= 5)
                    let xPos = layout.x;
                    const isThumbCluster = layout.y >= 5;
                    if (!is3DMode && isThumb3DOffsetActive && isThumbCluster) {
                        return null;
                    }
                    if (fingerClusterSqueeze > 0) {
                        if (!isThumbCluster) {
                            const keyCenterX = layout.x + layout.w / 2;
                            if (keyCenterX < layoutMidline) {
                                // Left side: shift right (toward center)
                                xPos = layout.x + fingerClusterSqueeze;
                            } else {
                                // Right side: shift left (toward center)
                                xPos = layout.x - fingerClusterSqueeze;
                            }
                        }
                        // Offset ALL keys left to keep keyboard left-aligned
                        // (compensates for left finger cluster shifting right)
                        xPos -= fingerClusterSqueeze;
                    }
                    xPos += layoutOffsets.offsetX;

                    const isSelected = isKeySelected(row, col);
                    const isSelectedOrDropTarget = isSelected || showDropTargetHighlight;
                    const standardKeyClassName = isGhostKey
                        ? cn("transition-opacity duration-200 pointer-events-auto", isSelectedOrDropTarget ? "opacity-100" : "opacity-0 group-hover:opacity-100")
                        : "pointer-events-auto";

                    const THUMB_3D_SHIFT_PX = (is3DMode && isThumb3DOffsetActive) ? 900 : 0;
                    const underlayBorderRadius = keyVariant === "default" ? 6 : 5;
                    const underlayStyle: React.CSSProperties = {
                        position: "absolute",
                        left: `${(xPos * currentUnitSize) + (is3DMode ? underlayLocalOffset.dx : 0)}px`,
                        top: `${(yPos * currentUnitSize) + (is3DMode ? underlayLocalOffset.dy : UNDERLAY_SCREEN_OFFSET_PX)}px`,
                        width: `${layout.w * currentUnitSize}px`,
                        height: `${layout.h * currentUnitSize}px`,
                        borderRadius: `${underlayBorderRadius}px`,
                        border: `1px solid ${keyUnderlayColor}`,
                        backgroundColor: keyUnderlayColor,
                        opacity: 0.65,
                        pointerEvents: "none",
                        transition: is3DMode ? KEY_3D_MOTION_TRANSITION : undefined,
                        transform: is3DMode && isThumbCluster ? `translateY(${THUMB_3D_SHIFT_PX}px)` : undefined,
                    };
                    const standardKey = (
                        <Key
                            key={`${row}-${col}`}
                            x={xPos}
                            y={yPos}
                            w={layout.w}
                            h={layout.h}
                            keycode={keycodeName}
                            label={label}
                            combo={combo}
                            row={row}
                            col={col}
                            data-key-x={layout.x}
                            data-key-y={layout.y}
                            data-key-w={layout.w}
                            data-key-h={layout.h}
                            data-key-label={label}
                            data-keycode={keycodeName}
                            data-inspect-pos={pos}
                            selected={isSelectedOrDropTarget}
                            onClick={handleKeyClick}
                            onDoubleClick={isGhostKey ? () => {
                                if (onGhostNavigate) {
                                    onGhostNavigate(ghostSourceLayer);
                                } else {
                                    setSelectedLayer(ghostSourceLayer);
                                }
                            } : undefined}
                            keyContents={keyContents}
                            layerColor={activeLayerColor}
                            headerClassName={keyHeaderClassFull}
                            hoverBackgroundColor={keyHoverBg}
                            hoverBorderColor={keyHoverBorder}
                            hoverLayerColor={keyHoverLayerColor}
                            variant={keyVariant}
                            layerIndex={selectedLayer}
                            hasPendingChange={hasPendingChangeForKey(selectedLayer, row, col)}
                            disableTooltip={true}
                            className={standardKeyClassName}
                            style={is3DMode
                                ? {
                                    // In ghost-wrapper mode, wrapper already carries thumb translate.
                                    transform: (isThumbCluster && !isGhostKey) ? `translateY(${THUMB_3D_SHIFT_PX}px)` : undefined,
                                    transition: KEY_3D_MOTION_TRANSITION
                                }
                                : undefined}
                        />
                    );

                    if (!isGhostKey) {
                        return (
                            <React.Fragment key={`${row}-${col}-stack`}>
                                {is3DMode && <div aria-hidden="true" style={underlayStyle} />}
                                {standardKey}
                            </React.Fragment>
                        );
                    }

                    // Render Ghost Key Overlay
                    const isTrnsOrNo = Number(effectiveKeycode) === 1 || Number(effectiveKeycode) === 0 || Number.isNaN(Number(effectiveKeycode));
                    const { label: ghostDefaultLabel, keyContents: ghostKeyContents } = getKeyLabel(keyboard, effectiveKeycode);
                    const ghostKeycodeName = getKeycodeName(effectiveKeycode);

                    // Use empty label if TRNS/NO to avoid "0x0000" or "OXNAN"
                    // Also check for "0xNaN" string which might come from invalid keycode formatting
                    const isInvalidLabel =
                        ghostKeycodeName.toLowerCase() === "0xnan" ||
                        ghostDefaultLabel.toLowerCase() === "0xnan" ||
                        ghostKeycodeName.toLowerCase() === "0x0000" ||
                        ghostDefaultLabel.toLowerCase() === "0x0000";
                    const ghostLabel = (isTrnsOrNo || isInvalidLabel) ? "" : (getLabelForKeycode(ghostKeycodeName, internationalLayout) || ghostDefaultLabel);

                    // Styles for ghost key
                    const ghostLayerColor = isTransmitting ? "sidebar" : effectiveLayerColor;
                    const ghostHeaderClass = headerClasses[ghostLayerColor] || headerClasses["primary"];
                    const ghostHoverHeaderClass = hoverHeaderClasses[ghostLayerColor] || hoverHeaderClasses["primary"];
                    const ghostHeaderClassFull = `${ghostHeaderClass} ${ghostHoverHeaderClass}`;


                    // Calculate darker border color
                    const darkBorderColor = getDarkLayerHex(ghostLayerColor);

                    const ghostOverlay = (
                        <Key
                            key={`${row}-${col}-ghost`}
                            x={xPos}
                            y={yPos}
                            w={layout.w}
                            h={layout.h}
                            keycode={ghostKeycodeName}
                            label={ghostLabel}
                            combo={combo && { ...combo, interactive: false }}
                            row={row}
                            col={col}
                            onClick={handleKeyClick} // Clicking ghost selects the key slot on CURRENT layer
                            onDoubleClick={() => {
                                if (onGhostNavigate) {
                                    onGhostNavigate(ghostSourceLayer);
                                } else {
                                    setSelectedLayer(ghostSourceLayer);
                                }
                            }}
                            keyContents={ghostKeyContents}
                            layerColor={ghostLayerColor}
                            headerClassName={ghostHeaderClassFull}
                            // Ghost styles
                            className={cn("border-solid border-[3px] transition-opacity", isSelectedOrDropTarget ? "opacity-0" : "opacity-50 group-hover:opacity-0")}
                            // Override border color via style to match the specific darkened color
                            style={{ borderColor: darkBorderColor, pointerEvents: "none" }}
                            // Dragging a ghost key should behave like dragging the real transparent key slot
                            dragItemData={{
                                keycode: keycodeName,
                                label,
                                row,
                                col,
                                layer: selectedLayer,
                                extra: keyContents,
                                props: {
                                    x: 0,
                                    y: 0,
                                    w: layout.w,
                                    h: layout.h,
                                    row,
                                    col,
                                    keycode: keycodeName,
                                    label,
                                    keyContents,
                                    layerColor: activeLayerColor,
                                    headerClassName: keyHeaderClassFull,
                                    hoverBorderColor: keyHoverBorder,
                                    hoverBackgroundColor: keyHoverBg,
                                    hoverLayerColor: keyHoverLayerColor,
                                    isRelative: true,
                                    variant: keyVariant,
                                    className: "",
                                    selected: false,
                                    disableHover: true,
                                },
                            }}
                            variant={keyVariant}
                            layerIndex={selectedLayer} // Important: belongs to current layer logic
                            hasPendingChange={hasPendingChangeForKey(selectedLayer, row, col)}
                            disableTooltip={true}
                        />
                    );

                    const wrapperStyle: React.CSSProperties = {
                        position: 'absolute',
                        left: `${xPos * currentUnitSize}px`,
                        top: `${yPos * currentUnitSize}px`,
                        width: `${layout.w * currentUnitSize}px`,
                        height: `${layout.h * currentUnitSize}px`,
                        transition: is3DMode ? KEY_3D_MOTION_TRANSITION : undefined,
                        transform: (is3DMode && isThumbCluster) ? `translateY(${THUMB_3D_SHIFT_PX}px)` : undefined,
                    };

                    // The source layer is named in the key inspector ("Falls Through ... from Layer m").
                    return (
                        <div
                            key={`${row}-${col}-fragment`}
                            className="group pointer-events-auto"
                            style={wrapperStyle}
                            onDoubleClick={() => {
                                if (onGhostNavigate) {
                                    onGhostNavigate(ghostSourceLayer);
                                } else {
                                    setSelectedLayer(ghostSourceLayer);
                                }
                            }}
                        >
                            {React.cloneElement(standardKey, { x: 0, y: 0 })}
                            {React.cloneElement(ghostOverlay, { x: 0, y: 0 })}
                        </div>
                    );
                })}
                {showKeyInspector && (
                    <KeyInspector
                        keyboard={keyboard}
                        hues={comboHues}
                        className="absolute left-0 top-full mt-3 z-30 pointer-events-none"
                    />
                )}
            </div>

        </div>
    );
};
