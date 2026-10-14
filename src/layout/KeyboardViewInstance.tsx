import { useLayerClipboardActions } from "@/hooks/useLayerClipboardActions";
import { House } from "lucide-react";
import { FC, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Keyboard } from "@/components/Keyboard";
import { LayerNameBadge } from "@/components/LayerNameBadge";
import LayersActiveIcon from "@/components/icons/LayersActive";
import LayersDefaultIcon from "@/components/icons/LayersDefault";
import LayersMinusIcon from "@/components/icons/LayersMinusIcon";
import SquareArrowLeftIcon from "@/components/icons/SquareArrowLeft";
import SquareArrowRightIcon from "@/components/icons/SquareArrowRight";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { useKeyBinding } from "@/contexts/KeyBindingContext";
import { cn } from "@/lib/utils";
import { useLayoutSettings } from "@/contexts/LayoutSettingsContext";
import { svalService } from "@/services/sval.service";
import { KEYMAP } from "@/constants/keygen";
import { usePanels } from "@/contexts/PanelsContext";
import { LayerReorderDialog } from "@/components/LayerReorderDialog";
import { useLayerReorder, type LayerMoveConstraints } from "@/hooks/useLayerReorder";
import { allowedLayerMoves, layerGapTarget, pinnedLayer } from "@/utils/layer-permute";
import { LEGACY_FORWARD_ENTRY_MS, type LayerScenePose } from "./layer-scene";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface KeyboardViewInstanceProps {
    instanceId: string;
    selectedLayer: number;
    setSelectedLayer: (layer: number) => void;
    isPrimary: boolean;
    hideLayerTabs?: boolean;
    layerActiveState?: boolean[];
    onToggleLayerOn: (layer: number) => void;
    transparencyByLayer: Record<number, boolean>;
    onToggleTransparency: (layer: number, next: boolean) => void;
    showAllLayers: boolean;
    onToggleShowLayers: () => void;
    isLayerOrderReversed: boolean;
    onToggleLayerOrder: () => void;
    isOverviewSceneActive: boolean;
    show3DScene: boolean;
    scenePose: LayerScenePose;
    legacyForwardEntryActive?: boolean;
    isAllTransparencyActive: boolean;
    isTransparencyRestoring?: boolean;
    multiLayerHeaderOffset?: number;
    onRemove?: () => void;
    onGhostNavigate?: (sourceLayer: number) => void;
    isRevealing?: boolean;
    isHiding?: boolean;
    stackIndex?: number;
    baseBadgeOffsetY?: number | null;
    onBaseBadgeOffsetY?: (offset: number | null) => void;
    isLayerDragActive?: boolean;
    hoveredDropLayer?: number | null;
    onLayerDropHover?: (layer: number | null) => void;
    onLayerDrop?: (layer: number) => void;
}

/**
 * A self-contained keyboard view instance with its own layer tabs, layer badge, and keyboard.
 * Multiple instances can be stacked vertically, each showing a different layer independently.
 */
const LAYER_TAB_DRAG_TYPE = "application/x-keybard-layer";

/** A layer tab being dragged to a new position in the row. */
interface TabDrag {
    from: number;
    /** The other tabs, in display order. Gap k sits before shown[k]. */
    shown: number[];
    /** For each gap, the layer number a drop there gives, or null where a drop isn't allowed. */
    targets: (number | null)[];
    constraints: LayerMoveConstraints;
    /** Centres of the shown tabs once the dragged tab has left the row, to place the pointer between them. */
    centers: number[];
    width: number;
    collapsed: boolean;
    gap: number | null;
}

const KeyboardViewInstance: FC<KeyboardViewInstanceProps> = ({
    instanceId,
    selectedLayer,
    setSelectedLayer,
    isPrimary,
    hideLayerTabs = false,
    layerActiveState,
    onToggleLayerOn,
    transparencyByLayer,
    onToggleTransparency,
    showAllLayers,
    onToggleShowLayers,
    isLayerOrderReversed,
    onToggleLayerOrder,
    isOverviewSceneActive,
    show3DScene,
    scenePose,
    legacyForwardEntryActive = false,
    isAllTransparencyActive,
    isTransparencyRestoring = false,
    multiLayerHeaderOffset = 0,
    onRemove,
    onGhostNavigate,
    isRevealing = false,
    isHiding = false,
    stackIndex = 0,
    baseBadgeOffsetY = null,
    onBaseBadgeOffsetY,
    isLayerDragActive = false,
    hoveredDropLayer = null,
    onLayerDropHover,
    onLayerDrop,
}) => {
    const { keyboard, activeLayerIndex, isConnected, defaultLayerIndex } = useKeyboard();
    const transparentKeyGlyph = KEYMAP["KC_TRNS"]?.str || "▽";
    const { clearSelection } = useKeyBinding();
    const { copy, paste, clipboardError } = useLayerClipboardActions();
    const { activePanel } = usePanels();
    const { is3DMode, keyVariant } = useLayoutSettings();
    const badgeRowRef = useRef<HTMLDivElement | null>(null);
    const [badgeOffsetY, setBadgeOffsetY] = useState(() => {
        if (!show3DScene) return 0;
        if (baseBadgeOffsetY !== null) return baseBadgeOffsetY;
        const unitSize = keyVariant === "small" ? 30 : keyVariant === "medium" ? 45 : 60;
        return unitSize * 7.7;
    });
    const [badgeTransitionEnabled, setBadgeTransitionEnabled] = useState(false);
    const hasMeasuredRef = useRef(false);
    const hasInitialized3DToggleRef = useRef(false);
    const cachedBaseOffset = useRef<number | null>(null);
    const [layerAnimatingIn, setLayerAnimatingIn] = useState(() => !isPrimary && legacyForwardEntryActive);
    const [isToggling3D, setIsToggling3D] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const TOGGLE_3D_TRANSITION_MS = 500;
    const LEGACY_FORWARD_ENTRY_TRANSITION = `opacity ${LEGACY_FORWARD_ENTRY_MS}ms ease-in-out, transform ${LEGACY_FORWARD_ENTRY_MS}ms ease-in-out`;
    const LEGACY_FORWARD_ENTRY_TRANSFORM_TRANSITION = `transform ${LEGACY_FORWARD_ENTRY_MS}ms ease-in-out`;
    const transitionDurationMs = scenePose.transitionMs ?? 500;
    const transitionEasing = scenePose.easing;
    const effectiveTransitionMs = transitionDurationMs > 0
        ? transitionDurationMs
        : (isToggling3D ? TOGGLE_3D_TRANSITION_MS : 0);
    const sceneTransitionStyle = effectiveTransitionMs > 0
        ? `opacity ${effectiveTransitionMs}ms ${transitionEasing}, transform ${effectiveTransitionMs}ms ${transitionEasing}`
        : "none";
    const transformTransitionStyle = effectiveTransitionMs > 0
        ? `transform ${effectiveTransitionMs}ms ${transitionEasing}`
        : "none";
    const badgeUnitSize = keyVariant === "small" ? 30 : keyVariant === "medium" ? 45 : 60;
    const badgeBaseGuess = badgeUnitSize * 7.7;
    const nonPrimaryBadgeOffsetY = (baseBadgeOffsetY ?? badgeBaseGuess) + scenePose.projectedY;
    const useLegacyForwardEntry = show3DScene && legacyForwardEntryActive && !isPrimary;
    const isLegacyForwardEntryAnimating = show3DScene && legacyForwardEntryActive && !isPrimary && layerAnimatingIn;
    const renderedBadgeOffsetY = show3DScene && stackIndex !== 0
        ? nonPrimaryBadgeOffsetY
        : badgeOffsetY;

    useEffect(() => {
        if (isPrimary) return;
        if (!legacyForwardEntryActive) {
            setLayerAnimatingIn(false);
            return;
        }

        let raf1 = 0;
        let raf2 = 0;
        setLayerAnimatingIn(true);
        raf1 = requestAnimationFrame(() => {
            raf2 = requestAnimationFrame(() => {
                setLayerAnimatingIn(false);
            });
        });

        return () => {
            cancelAnimationFrame(raf1);
            cancelAnimationFrame(raf2);
        };
    }, [isPrimary, legacyForwardEntryActive]);

    useEffect(() => {
        if (!hasInitialized3DToggleRef.current) {
            hasInitialized3DToggleRef.current = true;
            return;
        }

        setIsToggling3D(true);
        setBadgeTransitionEnabled(true);
        if (show3DScene) {
            hasMeasuredRef.current = false;
        }

        const timer = setTimeout(() => {
            setIsToggling3D(false);
            if (!show3DScene) {
                hasMeasuredRef.current = false;
            }
        }, TOGGLE_3D_TRANSITION_MS);
        return () => clearTimeout(timer);
    }, [show3DScene]);

    useLayoutEffect(() => {
        if (!show3DScene) return;

        if (stackIndex === 0) {
            const unitSize = keyVariant === "small" ? 30 : keyVariant === "medium" ? 45 : 60;
            const guess = unitSize * 7.7;
            const initialOffset = cachedBaseOffset.current ?? guess;
            setBadgeOffsetY(initialOffset);
        }
    }, [show3DScene, stackIndex, keyVariant]);

    useEffect(() => {
        if (show3DScene) return;

        setBadgeOffsetY(0);

        const resetTimer = window.setTimeout(() => {
            setBadgeTransitionEnabled(false);
            if (stackIndex === 0) {
                onBaseBadgeOffsetY?.(null);
                cachedBaseOffset.current = null;
            }
        }, Math.max(effectiveTransitionMs, TOGGLE_3D_TRANSITION_MS));

        return () => window.clearTimeout(resetTimer);
    }, [show3DScene, stackIndex, onBaseBadgeOffsetY, effectiveTransitionMs]);

    useLayoutEffect(() => {
        if (!show3DScene || stackIndex !== 0) return;
        const container = containerRef.current;
        const badgeEl = badgeRowRef.current;
        if (!container || !badgeEl) return;

        const measureBase = () => {
            const labelEl = container.querySelector('[data-layer-label="true"]') as HTMLElement | null;
            if (!labelEl) return null;
            const badgeRect = badgeEl.getBoundingClientRect();
            const labelRect = labelEl.getBoundingClientRect();

            const computedTransform = window.getComputedStyle(badgeEl).transform;
            let currentTranslateY = 0;
            if (computedTransform && computedTransform !== 'none') {
                const matrix = new DOMMatrix(computedTransform);
                currentTranslateY = matrix.m42;
            }

            const badgeNaturalCenter = (badgeRect.top + badgeRect.height / 2) - currentTranslateY;
            const labelCenter = labelRect.top + (labelRect.height / 2);
            return labelCenter - badgeNaturalCenter;
        };

        let correctionRafId = 0;

        const snapMeasuredOffset = () => {
            const desiredOffset = measureBase();
            if (desiredOffset === null) return;

            const cached = cachedBaseOffset.current;
            cachedBaseOffset.current = desiredOffset;
            onBaseBadgeOffsetY?.(desiredOffset);
            hasMeasuredRef.current = true;

            if (cached !== null && Math.abs(desiredOffset - cached) <= 2) {
                return;
            }

            setBadgeTransitionEnabled(false);
            setBadgeOffsetY(desiredOffset);
            correctionRafId = requestAnimationFrame(() => {
                setBadgeTransitionEnabled(true);
            });
        };

        const settleTimer = window.setTimeout(snapMeasuredOffset, 500);
        const handleResize = () => {
            if (!hasMeasuredRef.current) return;
            snapMeasuredOffset();
        };
        window.addEventListener('resize', handleResize);
        return () => {
            window.clearTimeout(settleTimer);
            cancelAnimationFrame(correctionRafId);
            window.removeEventListener('resize', handleResize);
        };
    }, [show3DScene, stackIndex, onBaseBadgeOffsetY, keyVariant]);

    const [isHudMode, setIsHudMode] = useState(false);
    const [suppressTransparencyHover, setSuppressTransparencyHover] = useState(false);
    const layerOrderClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const KC_TRNS = 1;
    const isTransparencyActive = !!transparencyByLayer[selectedLayer];
    const tabRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());
    const reorder = useLayerReorder((newOf) => setSelectedLayer(newOf[selectedLayer] ?? selectedLayer));
    const [tabDrag, setTabDrag] = useState<TabDrag | null>(null);
    // Measure the remaining tabs once the dragged one has collapsed out of the row.
    useLayoutEffect(() => {
        if (!tabDrag?.collapsed || tabDrag.centers.length) return;
        const centers = tabDrag.shown.map((layer) => {
            const rect = tabRefs.current.get(layer)?.getBoundingClientRect();
            return rect ? rect.left + rect.width / 2 : 0;
        });
        setTabDrag((drag) => drag && drag.from === tabDrag.from ? { ...drag, centers } : drag);
    }, [tabDrag]);
    const prevTabRectsRef = useRef<Map<number, DOMRect>>(new Map());
    const prevDisplayOrderRef = useRef<number[] | null>(null);
    const prevVisibleIdsRef = useRef<Set<number>>(new Set());
    const prevShowAllLayersRef = useRef<boolean>(showAllLayers);
    const prevIsLayerOrderReversed = useRef<boolean>(isLayerOrderReversed);
    const TAB_FLIP_STAGGER_MS = 25;
    const TAB_FLIP_DURATION_MS = 260;
    const TAB_REVEAL_DURATION_MS = 260;

    // Briefly suppress hover styles after restoring transparency to avoid a flash
    useEffect(() => {
        if (isAllTransparencyActive || isTransparencyRestoring) return;
        setSuppressTransparencyHover(true);
        const t = setTimeout(() => setSuppressTransparencyHover(false), 120);
        return () => clearTimeout(t);
    }, [isAllTransparencyActive, isTransparencyRestoring]);

    if (!keyboard) return null;

    const isLayoutDropTarget = isLayerDragActive && hoveredDropLayer === selectedLayer;
    const isLayerDropSurfaceActive = isLayerDragActive && !is3DMode;

    const handleDropHoverEnter = () => {
        if (!isLayerDragActive) return;
        onLayerDropHover?.(selectedLayer);
    };

    const handleDropHoverLeave = () => {
        if (!isLayerDragActive || hoveredDropLayer !== selectedLayer) return;
        onLayerDropHover?.(null);
    };

    const handleDropOnLayer = () => {
        if (!isLayerDragActive) return;
        onLayerDrop?.(selectedLayer);
    };

    const handleSelectLayer = (layer: number) => () => {
        setSelectedLayer(layer);
        clearSelection();
    };

    const toggleShowLayers = () => {
        onToggleShowLayers();
    };

    const shouldRenderLayerTab = (i: number) => {
        const layerData = keyboard.keymap?.[i];
        const isTransparentLayer = layerData ? layerData.every((keycode) => keycode === KC_TRNS) : true;
        const isLayerActive = typeof activeLayerIndex === "number"
            ? activeLayerIndex === i
            : !!layerActiveState?.[i];

        const shouldHideTransparent = !showAllLayers;
        if (shouldHideTransparent && isTransparentLayer && i !== selectedLayer && !isLayerActive) {
            return false;
        }
        return true;
    };

    /** Gaps a drop is allowed in, worked out for the layer being dragged. */
    const gapTargets = (from: number, shown: number[], constraints: LayerMoveConstraints) => {
        const allowed = allowedLayerMoves(keyboard, from, constraints.fixed);
        return Array.from({ length: shown.length + 1 }, (_, gap) => {
            const to = layerGapTarget(from, shown, gap);
            return to !== null && allowed.has(to) ? to : null;
        });
    };

    const startTabDrag = (from: number, e: React.DragEvent<HTMLButtonElement>) => {
        e.dataTransfer.setData(LAYER_TAB_DRAG_TYPE, String(from));
        e.dataTransfer.effectAllowed = "move";
        const shown = displayOrder.filter((layer) => layer !== from);
        const constraints = reorder.guessConstraints(keyboard);
        setTabDrag({
            from, shown, constraints, targets: gapTargets(from, shown, constraints),
            centers: [], width: e.currentTarget.getBoundingClientRect().width, collapsed: false, gap: null,
        });
        // Collapse the tab only after the browser has taken its drag image.
        requestAnimationFrame(() => setTabDrag((drag) => drag && drag.from === from ? { ...drag, collapsed: true } : drag));
        // The board knows its default layer; until it answers, every layer that could be the default stays put.
        void reorder.loadConstraints(keyboard).then((loaded) =>
            setTabDrag((drag) => drag && drag.from === from ? { ...drag, constraints: loaded, targets: gapTargets(from, shown, loaded) } : drag));
    };

    const dragOverTabs = (e: React.DragEvent<HTMLDivElement>) => {
        if (!tabDrag || !tabDrag.centers.length) return;
        const gap = tabDrag.centers.filter((center) => e.clientX > center).length;
        const allowed = tabDrag.targets[gap] !== null;
        if (allowed) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
        }
        const next = allowed ? gap : null;
        if (next !== tabDrag.gap) setTabDrag({ ...tabDrag, gap: next });
    };

    const dropOnTabs = (e: React.DragEvent<HTMLDivElement>) => {
        if (!tabDrag) return;
        e.preventDefault();
        const to = tabDrag.gap === null ? null : tabDrag.targets[tabDrag.gap];
        const { from, constraints } = tabDrag;
        setTabDrag(null);
        if (to !== null) reorder.prepare(from, to, constraints);
    };

    const renderLayerTab = (i: number) => {
        if (!shouldRenderLayerTab(i)) return null;

        const layerShortName = svalService.getLayerNameNoLabel(keyboard, i);
        const isActive = selectedLayer === i;
        const isDropTarget = isLayerDragActive && hoveredDropLayer === i;
        const canMove = i !== pinnedLayer(keyboard);
        const isDragged = tabDrag?.from === i;
        const isDefault = isConnected && defaultLayerIndex === i;
        const isLayerActive = typeof activeLayerIndex === "number"
            ? activeLayerIndex === i
            : !!layerActiveState?.[i];

        return (
            <ContextMenu key={`${instanceId}-layer-tab-${i}`}>
                <ContextMenuTrigger asChild>
                    <button
                        ref={(el) => {
                            if (el) {
                                tabRefs.current.set(i, el);
                            } else {
                                tabRefs.current.delete(i);
                            }
                        }}
                        onClick={handleSelectLayer(i)}
                        title={isDefault ? "Default layer: the keyboard starts on it" : undefined}
                        aria-label={isDefault ? `${layerShortName}, default layer` : undefined}
                        onDoubleClick={(e) => {
                            e.stopPropagation();
                            onToggleLayerOn(i);
                        }}
                        // Drag a tab to a gap between two others to move the layer there.
                        draggable={canMove && !isLayerDragActive}
                        onDragStart={(e) => startTabDrag(i, e)}
                        onDragEnd={() => setTabDrag(null)}
                        onMouseEnter={() => {
                            if (!isLayerDragActive) return;
                            onLayerDropHover?.(i);
                        }}
                        onMouseLeave={() => {
                            if (!isLayerDragActive || hoveredDropLayer !== i) return;
                            onLayerDropHover?.(null);
                        }}
                        onMouseUp={() => {
                            if (!isLayerDragActive) return;
                            onLayerDrop?.(i);
                        }}
                        className={cn(
                            "px-4 py-1 rounded-full transition-colors text-sm font-medium cursor-pointer border-none outline-none whitespace-nowrap",
                            isDropTarget
                                ? "bg-red-500 text-white shadow-md scale-105 ring-2 ring-red-500 ring-offset-1 ring-offset-background"
                                : isActive
                                    ? "bg-gray-800 text-white dark:bg-neutral-200 dark:text-neutral-900 shadow-md scale-105"
                                    : "bg-transparent text-gray-600 dark:text-neutral-300 hover:bg-gray-200 dark:hover:bg-neutral-700",
                            isDropTarget && "hover:bg-red-500",
                            isDragged && tabDrag?.collapsed && "w-0 -ml-1 px-0 opacity-0 overflow-hidden",
                            isHudMode && !isActive && !isLayerActive && "text-gray-300 dark:text-neutral-400"
                        )}
                    >
                        <span className={cn("select-none inline-flex items-center gap-1", isLayerActive && "underline underline-offset-2")}>
                            {isDefault && <House aria-hidden className="h-3.5 w-3.5 shrink-0" />}
                            {layerShortName}
                        </span>
                    </button>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-56">
                    <ContextMenuItem onSelect={() => copy(i)}>
                        Copy Layer
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => { void paste(i); }}>
                        Paste Layer
                    </ContextMenuItem>
                    {isConnected && defaultLayerIndex != null && (
                        <ContextMenuItem
                            disabled={isDefault || !reorder.canSetDefault}
                            onSelect={() => { void reorder.makeDefault(i); }}
                        >
                            {isDefault ? "Default Layer" : reorder.canSetDefault ? "Make Default Layer" : "Make Default Layer (needs newer firmware)"}
                        </ContextMenuItem>
                    )}
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => onToggleLayerOn(i)}>
                        {isLayerActive ? "Turn Layer Off" : "Turn Layer On"}
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>
        );
    };

    const allLayerIds = Array.from({ length: keyboard.layers || 16 }, (_, i) => i);
    const visibleLayerIds = useMemo(
        () => allLayerIds.filter(shouldRenderLayerTab),
        [keyboard.layers, keyboard.keymap, showAllLayers, selectedLayer, layerActiveState, activeLayerIndex]
    );
    const displayOrder = useMemo(
        () => (isLayerOrderReversed ? [...visibleLayerIds].reverse() : visibleLayerIds),
        [isLayerOrderReversed, visibleLayerIds]
    );

    useLayoutEffect(() => {
        const currentRects = new Map<number, DOMRect>();
        visibleLayerIds.forEach((layerId) => {
            const el = tabRefs.current.get(layerId);
            if (!el) return;
            currentRects.set(layerId, el.getBoundingClientRect());
        });

        const prevRects = prevTabRectsRef.current;
        const prevDisplayOrder = prevDisplayOrderRef.current;
        const hasSameOrder =
            !!prevDisplayOrder &&
            prevDisplayOrder.length === displayOrder.length &&
            prevDisplayOrder.every((layerId, index) => layerId === displayOrder[index]);

        if (prevRects.size > 0 && !hasSameOrder) {
            // Stagger from the leftmost visible tab, regardless of order
            const delayOrder = [...displayOrder];
            const delayIndexByLayer = new Map<number, number>();
            delayOrder.forEach((layerId, index) => {
                delayIndexByLayer.set(layerId, index);
            });

            // First frame: pin tabs to their previous positions
            displayOrder.forEach((layerId) => {
                const el = tabRefs.current.get(layerId);
                const prev = prevRects.get(layerId);
                const next = currentRects.get(layerId);
                if (!el || !prev || !next) return;
                const deltaX = prev.left - next.left;
                if (Math.abs(deltaX) < 0.5) return;
                el.style.transition = "none";
                el.style.transform = `translateX(${deltaX}px)`;
            });

            // Force reflow once after all transforms are set
            void document.body.offsetHeight;

            // Second frame: animate to the new positions with stagger
            displayOrder.forEach((layerId) => {
                const el = tabRefs.current.get(layerId);
                const prev = prevRects.get(layerId);
                const next = currentRects.get(layerId);
                if (!el || !prev || !next) return;
                const deltaX = prev.left - next.left;
                if (Math.abs(deltaX) < 0.5) return;
                const delayIndex = delayIndexByLayer.get(layerId) ?? 0;
                const delayMs = delayIndex * TAB_FLIP_STAGGER_MS;
                requestAnimationFrame(() => {
                    el.style.transition = `transform ${TAB_FLIP_DURATION_MS}ms ease-in-out ${delayMs}ms`;
                    el.style.transform = "translateX(0px)";
                });
            });
        }

        prevTabRectsRef.current = currentRects;
        prevDisplayOrderRef.current = displayOrder;
        prevIsLayerOrderReversed.current = isLayerOrderReversed;
    }, [
        displayOrder,
        visibleLayerIds,
    ]);

    useLayoutEffect(() => {
        const prevVisible = prevVisibleIdsRef.current;
        const currentVisible = new Set(visibleLayerIds);
        const showAllToggledOn = !prevShowAllLayersRef.current && showAllLayers;
        const leftmostId = displayOrder[0];
        const leftmostRect = leftmostId !== undefined
            ? (tabRefs.current.get(leftmostId)?.getBoundingClientRect() ?? null)
            : null;

        if (showAllToggledOn && leftmostRect) {
            // Stagger from the leftmost visible tab, regardless of order
            const delayOrder = [...displayOrder];
            const delayIndexByLayer = new Map<number, number>();
            delayOrder.forEach((layerId, index) => {
                delayIndexByLayer.set(layerId, index);
            });

            visibleLayerIds.forEach((layerId) => {
                if (prevVisible.has(layerId)) return;
                const el = tabRefs.current.get(layerId);
                if (!el) return;
                const nextRect = el.getBoundingClientRect();
                const deltaX = leftmostRect.left - nextRect.left;
                const delayIndex = delayIndexByLayer.get(layerId) ?? 0;
                const delayMs = delayIndex * TAB_FLIP_STAGGER_MS;
                el.style.transition = "none";
                el.style.transform = `translateX(${deltaX}px)`;
                el.style.opacity = "0";
                void el.offsetWidth;
                requestAnimationFrame(() => {
                    el.style.transition = `transform ${TAB_REVEAL_DURATION_MS}ms ease-in-out ${delayMs}ms, opacity ${TAB_REVEAL_DURATION_MS}ms ease-in-out ${delayMs}ms`;
                    el.style.transform = "translateX(0px)";
                    el.style.opacity = "1";
                });
            });
        }

        prevVisibleIdsRef.current = currentVisible;
        prevShowAllLayersRef.current = showAllLayers;
    }, [visibleLayerIds, showAllLayers]);

    const isSelectedLayerActive = isConnected
        ? activeLayerIndex === selectedLayer
        : !!layerActiveState?.[selectedLayer];
    const effectiveRootOpacity = isLegacyForwardEntryAnimating ? 0 : scenePose.opacity;
    const effectiveRootTransform = isLegacyForwardEntryAnimating
        ? `translateY(calc(-100% * ${stackIndex}))`
        : `translateY(${scenePose.rootTranslateY}px)`;
    const effectiveRootTransition = useLegacyForwardEntry
        ? LEGACY_FORWARD_ENTRY_TRANSITION
        : ((show3DScene || isToggling3D) ? sceneTransitionStyle : "opacity 200ms ease-in-out");
    const effectiveBadgeOffsetY = isLegacyForwardEntryAnimating
        ? (baseBadgeOffsetY ?? badgeBaseGuess)
        : renderedBadgeOffsetY;
    const effectiveBadgeTransition = useLegacyForwardEntry
        ? LEGACY_FORWARD_ENTRY_TRANSFORM_TRANSITION
        : (badgeTransitionEnabled ? transformTransitionStyle : "none");
    const effectiveKeyboardTranslateZ = isLegacyForwardEntryAnimating ? 0 : scenePose.translateZ;
    const effectiveKeyboardTransition = useLegacyForwardEntry
        ? LEGACY_FORWARD_ENTRY_TRANSFORM_TRANSITION
        : transformTransitionStyle;

    return (
        <div
            ref={containerRef}
            data-keyboard-view-instance={instanceId}
            className="w-full flex-shrink-0 pointer-events-none"
            style={{
                opacity: (isRevealing || isHiding) ? 0 : effectiveRootOpacity,
                transform: effectiveRootTransform,
                transition: effectiveRootTransition,
            }}
        >
            {clipboardError && <p role="alert" className="pointer-events-auto text-sm text-red-700 dark:text-red-400">{clipboardError}</p>}
            <LayerReorderDialog reorder={reorder} />
            {/* Layer Controls Row: Hide-blank-layers toggle + layer tabs + (optional) remove button */}
            {!hideLayerTabs && !isOverviewSceneActive && !show3DScene && (
                <div
                    className="flex items-center gap-2 pl-5 pb-2 whitespace-nowrap pointer-events-auto overflow-x-auto overscroll-x-contain [&>*]:shrink-0"
                    style={isPrimary && multiLayerHeaderOffset > 0 ? { marginTop: -multiLayerHeaderOffset } : undefined}
                >
                    <div className="flex items-center gap-1">
                        <Tooltip delayDuration={500}>
                            <TooltipTrigger asChild>
                                <button
                                    onClick={toggleShowLayers}
                                    disabled={activePanel === "matrixtester"}
                                    className={cn(
                                        "p-2 rounded-full transition-colors flex-shrink-0",
                                        activePanel === "matrixtester"
                                            ? "text-gray-400 dark:text-neutral-400 cursor-not-allowed opacity-30"
                                            : "text-kb-ink hover:bg-gray-200 dark:hover:bg-neutral-700"
                                    )}
                                    aria-label={showAllLayers ? "Hide Transparent Layers" : "Show All Layers"}
                                >
                                    {!showAllLayers ? <LayersActiveIcon className="h-5 w-5" /> : <LayersDefaultIcon className="h-5 w-5" />}
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                                {showAllLayers ? "Hide Transparent Layers" : "Show All Layers"}
                            </TooltipContent>
                        </Tooltip>

                    </div>

                    <div
                        className={cn("flex items-center gap-1", activePanel === "matrixtester" && "opacity-30 pointer-events-none")}
                        onDragOver={dragOverTabs}
                        onDragLeave={(e) => {
                            if (tabDrag && !e.currentTarget.contains(e.relatedTarget as Node | null)) setTabDrag({ ...tabDrag, gap: null });
                        }}
                        onDrop={dropOnTabs}
                    >
                        {displayOrder.map((i) => {
                            const gap = tabDrag ? tabDrag.shown.indexOf(i) : -1;
                            return (
                                <Fragment key={`${instanceId}-layer-slot-${i}`}>
                                    {gap >= 0 && <LayerTabGap open={tabDrag!.gap === gap} width={tabDrag!.width} />}
                                    {renderLayerTab(i)}
                                </Fragment>
                            );
                        })}
                        {tabDrag && <LayerTabGap open={tabDrag.gap === tabDrag.shown.length} width={tabDrag.width} />}
                    </div>

                    <Tooltip delayDuration={500}>
                        <TooltipTrigger asChild>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (layerOrderClickTimer.current) {
                                        clearTimeout(layerOrderClickTimer.current);
                                        layerOrderClickTimer.current = null;
                                    }
                                    if (e.detail >= 2) {
                                        setIsHudMode((prev) => !prev);
                                        return;
                                    }
                                    layerOrderClickTimer.current = setTimeout(() => {
                                        onToggleLayerOrder();
                                        layerOrderClickTimer.current = null;
                                    }, 200);
                                }}
                                className={cn(
                                    "p-2 rounded-full transition-colors",
                                    isHudMode
                                        ? "bg-kb-active text-kb-gray"
                                        : "text-gray-500 dark:text-neutral-400 hover:text-gray-800 dark:hover:text-neutral-100 hover:bg-gray-200 dark:hover:bg-neutral-700"
                                )}
                                aria-label="Reverse Layer Order"
                            >
                                {isLayerOrderReversed
                                    ? <SquareArrowRightIcon className="h-5 w-5" />
                                    : <SquareArrowLeftIcon className="h-5 w-5" />}
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                            Flip Layer View
                        </TooltipContent>
                    </Tooltip>

                    {/* Remove button for non-primary views */}
                    {!isPrimary && onRemove && (
                        <Tooltip delayDuration={500}>
                            <TooltipTrigger asChild>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onRemove(); }}
                                    className="p-2 rounded-full transition-colors text-gray-400 dark:text-neutral-400 hover:text-kb-ink hover:bg-gray-200 dark:hover:bg-neutral-700 ml-auto mr-4 flex-shrink-0"
                                    aria-label="Hide layer view"
                                    disabled={selectedLayer === 0}
                                    data-remove-view={instanceId}
                                >
                                    <LayersMinusIcon className="h-5 w-5" />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                                Hide Layer
                            </TooltipContent>
                        </Tooltip>
                    )}
                </div>
            )}

            <div
                data-layer-drop-surface={selectedLayer}
                data-drop-surface-active={isLayerDropSurfaceActive ? "true" : "false"}
                className={cn(
                    "relative isolate rounded-lg",
                    isLayerDropSurfaceActive ? "pointer-events-auto" : "pointer-events-none"
                )}
                onMouseEnter={handleDropHoverEnter}
                onMouseLeave={handleDropHoverLeave}
                onMouseUp={handleDropOnLayer}
            >
                {/* Layer Name Badge Row */}
                <div
                    ref={badgeRowRef}
                    className="relative z-20 pl-5 pt-[7px] pb-2 flex items-center gap-2 pointer-events-auto"
                    style={{
                        transform: `translateY(${effectiveBadgeOffsetY}px)`,
                        transition: effectiveBadgeTransition,
                    }}
                >
                    <div style={{ marginLeft: -20 }}>
                        <LayerNameBadge
                            selectedLayer={selectedLayer}
                            isActive={isSelectedLayerActive}
                            onToggleLayerOn={onToggleLayerOn}
                            // TODO: when firmware reports default layer, pass it here.
                            defaultLayerIndex={0}
                            trailingAction={selectedLayer !== 0 && (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button
                                            onClick={() => {
                                                if (selectedLayer === 0) return;
                                                const next = !isTransparencyActive;
                                                onToggleTransparency(selectedLayer, next);
                                            }}
                                            disabled={activePanel === "matrixtester" || isTransparencyRestoring}
                                            className={cn(
                                                "w-8 h-8 rounded-full transition-all duration-150 flex-shrink-0 ml-[-4px] flex items-center justify-center",
                                                activePanel === "matrixtester"
                                                    ? "text-gray-400 dark:text-neutral-400 cursor-not-allowed opacity-30"
                                                    : isTransparencyActive
                                                        ? "opacity-100 bg-kb-active hover:bg-gray-800 dark:hover:bg-neutral-300"
                                                        : cn(
                                                            "opacity-0 pointer-events-none scale-95",
                                                            !suppressTransparencyHover && "group-hover/layer-badge:opacity-100 group-hover/layer-badge:pointer-events-auto group-hover/layer-badge:scale-100 hover:bg-gray-200 dark:hover:bg-neutral-700"
                                                        ),
                                                isTransparencyRestoring && "invisible pointer-events-none"
                                            )}
                                            aria-label={isTransparencyActive ? "Show Transparent Keys" : "Hide Transparent Keys"}
                                        >
                                            <span className={cn(
                                                "text-base leading-none font-semibold translate-y-[1px]",
                                                isTransparencyActive ? "text-kb-gray" : "text-kb-ink"
                                            )}>
                                                {transparentKeyGlyph}
                                            </span>
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                        {isTransparencyActive ? "Show Transparent Keys" : "Hide Transparent Keys"}
                                    </TooltipContent>
                                </Tooltip>
                            )}
                        />
                    </div>
                </div>
                {/* Keyboard */}
                <div
                    className={cn(
                        "relative z-0 flex items-start justify-center max-w-full pointer-events-none",
                        show3DScene && "keyboard-3d-wrapper"
                    )}
                    style={show3DScene
                        ? {
                            transformStyle: "preserve-3d",
                        }
                        : undefined
                    }
                >
                    <div
                        className={cn(
                            "pointer-events-none",
                            show3DScene && "keyboard-3d-active"
                        )}
                        style={{
                            transform: show3DScene
                                ? `rotateX(${scenePose.rotateX}deg) rotateZ(${scenePose.rotateZ}deg) translateZ(${effectiveKeyboardTranslateZ}px)`
                                : "rotateX(0deg) rotateZ(0deg) translateZ(0px)",
                            transition: effectiveKeyboardTransition,
                        }}
                    >
                        <Keyboard
                            keyboard={keyboard}
                            selectedLayer={selectedLayer}
                            setSelectedLayer={setSelectedLayer}
                            showTransparency={isTransparencyActive}
                            onGhostNavigate={onGhostNavigate}
                            layerActiveState={layerActiveState}
                            instanceId={instanceId}
                            show3DBackdrop={show3DScene}
                            activeLayerIndex={activeLayerIndex}
                            isConnected={isConnected}
                            isToggling3D={isToggling3D}
                            showDropTargetHighlight={isLayoutDropTarget}
                            isLayerDragActive={isLayerDragActive}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default KeyboardViewInstance;

/** The space that opens between two layer tabs where a dragged layer will land. */
function LayerTabGap({ open, width }: { open: boolean; width: number }) {
    return (
        <span
            aria-hidden
            className="-ml-1 flex h-7 items-center justify-center transition-[width] duration-150 ease-out"
            style={{ width: open ? width : 0 }}
        >
            {open && <span className="h-6 w-1 rounded-full bg-primary" />}
        </span>
    );
}
