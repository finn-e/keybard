import "./SecondarySidebar.css";

import * as React from "react";
import { ArrowLeft, Pin, X } from "lucide-react";

import BindingEditorContainer from "./components/BindingEditor/BindingEditorContainer";
import EditorSidePanel from "./components/EditorSidePanel";
import { ComboEditorTitle } from "./components/ComboEditorTitle";
import BasicKeyboards from "./Panels/BasicKeyboards";
import LayersPanel from "./Panels/LayersPanel";
import MacrosPanel from "./Panels/MacrosPanel";
import SpecialKeysPanel from "./Panels/SpecialKeysPanel/SpecialKeysPanel";
import PointingPanel from "./Panels/PointingPanel";
import OneShotComposerPanel from "./Panels/OneShotComposerPanel";
import TapdancePanel from "./Panels/TapdancePanel";
import QmkKeyPanel from "./Panels/QmkKeysPanel";
import MousePanel from "./Panels/MousePanel";

import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { usePanels } from "@/contexts/PanelsContext";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { cn } from "@/lib/utils";
import { isPanelEditorPlacement, pinnedEditorTop, type ComboEditorPlacement } from "@/lib/comboEditorPlacement";
import { bindingEditorHeading, bindingEditorSubtitle, currentRailMode, effectivePickerMode, isBindingEditorOpen, RAIL_COLLAPSE_EASE, RAIL_COLLAPSE_MS, usablePickerCategories, type PickerMode } from "@/lib/bindingSpotlight";
import {
    EDITOR_REST_FRAME, isUsableRect, PANEL_EDITOR_EASE_OUT, PANEL_EDITOR_FADE_MS, PANEL_EDITOR_MOTION_MS,
    PANEL_PICKER_RISE_PX, pickerScrolledUnder, pinCueStyle, rowToEditorFrame, type MotionRect, type PanelEditorMotion,
} from "@/lib/panelEditorMotion";
import { isLShape, type PickerShape } from "@/lib/pickerShape";
import type { CustomUIMenuItem } from "@/types/keyboard.types";

import { getPanelTitle, PanelContent } from "../PanelContent";
import { useComboEditorGeometry } from "./comboEditorGeometry";

export const DETAIL_SIDEBAR_WIDTH = "32rem";
/** Narrower than this, the dock stacks its title row above the keys. */
const COMBO_DOCK_ONE_ROW_MIN = 660;
export const getDetailPanelHeight = (panel: string | null | undefined, height: number): string | number =>
    ["settings", "qmksettings", "scanlab", "quickstart", "about", "fragments", "layouts"].includes(panel ?? "")
        ? "min(60dvh, 36rem)" : height;

/**
 * Header component shown when in "Add Key" mode (Alternative Header).
 */
interface AlternativeHeaderProps {
    onBack?: () => void;
    menus?: CustomUIMenuItem[];
    /** Keep showing the editor's title after it closes (the picker overlay, while it leaves). */
    holdEditorTitle?: boolean;
    /** False while the rail's top-left corner is the editor's way out (?railMode=modal). */
    showBack?: boolean;
}

const AlternativeHeader = ({ onBack, menus, holdEditorTitle = false, showBack = true }: AlternativeHeaderProps) => {
    const { activePanel, handleCloseEditor, itemToEdit } = usePanels();
    const { keyboard } = useKeyboard();
    const editing = isBindingEditorOpen(activePanel, itemToEdit);
    // The item's custom name, if it has one; the header itself stays numbers-only.
    const subtitle = editing ? bindingEditorSubtitle(activePanel, itemToEdit, keyboard?.cosmetic) : null;

    const current = {
        title: editing ? bindingEditorHeading(activePanel, itemToEdit) : `Add Keys to ${getPanelTitle(activePanel, menus)}`,
        subtitle,
        // A combo's title is its name, renamed in place (ComboEditorTitle).
        combo: editing && activePanel === "combos" ? itemToEdit : null,
    };
    // The overlay leaving with the editor keeps the editor's title, so the old
    // "Add Keys to ..." title never shows on its way out.
    const lastEditing = React.useRef<typeof current | null>(null);
    if (editing) lastEditing.current = current;
    const holding = !editing && holdEditorTitle && !!lastEditing.current;
    const { title, subtitle: shownSubtitle, combo } = holding ? lastEditing.current! : current;
    const back = () => onBack ? onBack() : handleCloseEditor();

    return (
        <div className={cn("flex items-center justify-start gap-4", !showBack && "min-h-10")}>
            {/* The editor's way out: a click under the spotlight scrim pulses it (BindingSpotlight). */}
            {showBack && <button
                type="button"
                onClick={back}
                className="bg-transparent hover:bg-muted/60 rounded-full p-2 cursor-pointer transition-colors"
                aria-label="Go back"
                data-binding-editor-back={editing ? "" : undefined}
            >
                <ArrowLeft className="h-6 w-6 text-gray-500 dark:text-neutral-400" />
            </button>}
            {combo !== null ? <ComboEditorTitle index={combo} readOnly={holding} /> : <div>
                <h2 className="text-[22px] font-semibold leading-none text-kb-ink">
                    {title}
                </h2>
                {shownSubtitle && <p className="mt-1.5 text-sm leading-tight text-muted-foreground truncate max-w-[18rem]" data-binding-editor-subtitle>{shownSubtitle}</p>}
            </div>}
        </div>
    );
};

/**
 * Sits inside the side-panel editor. Its cleanup runs while the editor is
 * still in the page, so the exit motion can start from the editor's last
 * look and place.
 */
const EditorSnapshotProbe = ({ onLeave }: { onLeave: (editor: HTMLElement) => void }) => {
    const ref = React.useRef<HTMLSpanElement>(null);
    const leave = React.useRef(onLeave);
    leave.current = onLeave;
    React.useLayoutEffect(() => {
        const editor = ref.current?.closest<HTMLElement>("[data-editor-placement='panel']") ?? null;
        return () => {
            if (editor?.isConnected) leave.current(editor);
        };
    }, []);
    return <span ref={ref} hidden />;
};

/** A still copy of the editor that carries the motion, so the real one never leaves its place. */
function makeEditorGhost(source: HTMLElement, rect: MotionRect): HTMLElement {
    const ghost = source.cloneNode(true) as HTMLElement;
    ghost.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
    ghost.classList.remove("binding-workspace", "sticky");
    ghost.removeAttribute("tabindex");
    ghost.removeAttribute("aria-label");
    ghost.removeAttribute("data-editor-placement");
    ghost.setAttribute("aria-hidden", "true");
    ghost.setAttribute("inert", "");
    ghost.setAttribute("data-editor-ghost", "");
    Object.assign(ghost.style, {
        position: "fixed",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        margin: "0",
        zIndex: "30",
        pointerEvents: "none",
        overflow: "hidden",
        transformOrigin: "top left",
    });
    return ghost;
}

/**
 * The Secondary Sidebar (Detail Panel) slides in to show context-specific tools
 * like Layer management, Key settings, macros, etc.
 */
interface SecondarySidebarProps {
    bottom?: boolean;
    leftOffset?: string;
    pickerMode?: PickerMode;
    height?: number;
    /** Where a single combo's editor sits (resolved by EditorLayout); unset keeps the shared placement. */
    comboPlacement?: ComboEditorPlacement;
    /** The keyboard canvas, which the combo editor stays out of. */
    canvasRef?: React.RefObject<HTMLElement | null>;
    /** The primary keyboard, whose keys the combo editor avoids or anchors to. */
    getKeyboardElement?: () => HTMLElement | null;
    /** Height the combo editor takes from the bottom of the canvas. */
    onComboReserveChange?: (px: number) => void;
    /** The L-shaped picker (?pickerShape=); the panel then draws no frame of its own, the L surface does. */
    pickerShape?: PickerShape;
}
const SecondarySidebar = ({ bottom = false, leftOffset, height = 230, comboPlacement, canvasRef, getKeyboardElement, onComboReserveChange, pickerShape = "rect" }: SecondarySidebarProps) => {
    const primarySidebar = useSidebar("primary-nav", { defaultOpen: false });
    const { activePanel, handleCloseDetails, state, alternativeHeader, itemToEdit, setItemToEdit, pickerMode: chosenPickerMode = "keyboard", setPickerMode } = usePanels();
    const { keyboard } = useKeyboard();

    const panelRef = React.useRef<HTMLElement>(null);
    const returnFocus = React.useRef<HTMLElement | null>(null);
    React.useEffect(() => {
        if (state !== "expanded") return;
        returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        panelRef.current?.focus({ preventScroll: true });
        return () => {
            if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
        };
    }, [state]);

    // Calculate dynamic offset based on primary sidebar state
    const primaryOffset = primarySidebar.state === "collapsed"
        ? "calc(var(--sidebar-width-icon) + var(--spacing)*4)"
        : "calc(var(--sidebar-width-base) + var(--spacing)*4)";

    const handleClose = React.useCallback(() => {
        setItemToEdit(null);
        handleCloseDetails();
    }, [handleCloseDetails, setItemToEdit]);

    // Check if we should show the key picker overlay
    // We show it if we are editing an item and we are in a panel that supports key picking
    const showPicker = isBindingEditorOpen(activePanel, itemToEdit);
    // The picker tabs and the rail's picker categories share one choice.
    const pickerCategories = React.useMemo(() => usablePickerCategories(activePanel), [activePanel]);
    const pickerMode: PickerMode = effectivePickerMode(chosenPickerMode, activePanel);

    const bindingRef = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        if (!showPicker) return;
        const source = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        bindingRef.current?.focus({ preventScroll: true });
        return () => {
            if (source?.isConnected && !source.closest('[hidden], [inert]')) source.focus({ preventScroll: true });
        };
    }, [showPicker]);

    // "In the side panel": every binding editor sits at the top of this panel,
    // pinned above the picker, so nothing covers the layout. The side layout
    // only; the bottom bar keeps its own arrangement.
    const panelPlacement = !bottom && isPanelEditorPlacement(comboPlacement);
    const panelEditor = showPicker && panelPlacement;
    const reducedMotion = usePrefersReducedMotion();
    // ?railMode=collapse: the panel follows the rail's edge as it narrows and comes back.
    const railMode = React.useMemo(currentRailMode, []);
    // ?railMode=modal: the rail is the picker selector and its top-left corner the
    // way out, so the panel drops its category strip and its back arrow while editing.
    const railModal = railMode === "modal";
    // The panel's own category strip only where the rail cannot switch the
    // picker: ?railMode=collapse puts the whole rail under the scrim. Otherwise
    // the rail's picker categories are the one selector.
    const categoryStrip = railMode === "collapse";
    const railMotion = railMode === "collapse" && !bottom && !reducedMotion
        ? `left ${RAIL_COLLAPSE_MS}ms ${RAIL_COLLAPSE_EASE}, width ${RAIL_COLLAPSE_MS}ms ${RAIL_COLLAPSE_EASE}`
        : undefined;
    const pinCue = React.useMemo(() => pinCueStyle(typeof window === "undefined" ? "" : window.location.search), []);

    // Entering and leaving the side-panel editor. Set while rendering, so the
    // first frame of the change already has it: entering keeps the list laid
    // out for one motion, leaving keeps the picker shown while it fades.
    const [motion, setMotion] = React.useState<PanelEditorMotion | null>(null);
    const [motionFor, setMotionFor] = React.useState(panelEditor);
    if (motionFor !== panelEditor) {
        setMotionFor(panelEditor);
        setMotion(panelPlacement && state === "expanded" ? (panelEditor ? "enter" : "exit") : null);
    }

    // A single combo's editor moves out of the keyboard's way (dock, anchored
    // or float). It stays in this tree; only CSS and fixed coordinates change.
    const comboActive = showPicker && activePanel === "combos" && !!comboPlacement && !isPanelEditorPlacement(comboPlacement);
    const comboEntry = comboActive && itemToEdit !== null ? keyboard?.combos?.[itemToEdit] : undefined;
    const triggerKeycodes = React.useMemo(
        () => (comboEntry?.keys ?? []).filter(k => k && k !== "KC_NO"),
        [comboEntry],
    );
    const comboGeometry = useComboEditorGeometry({
        placement: comboActive ? comboPlacement! : null,
        bottom,
        workspaceRef: bindingRef,
        panelRef,
        canvasRef,
        getKeyboardElement,
        triggerKeycodes,
        onReserveChange: onComboReserveChange,
    });

    const [isClosingEditor, setIsClosingEditor] = React.useState(false);
    const listHeaderRef = React.useRef<HTMLDivElement>(null);
    const overlayRef = React.useRef<HTMLDivElement>(null);
    const overlayHeaderRef = React.useRef<HTMLDivElement>(null);
    const railRef = React.useRef<HTMLDivElement>(null);
    const pickerBodyRef = React.useRef<HTMLDivElement>(null);

    // The list is hidden while an editor is open, which resets its scroll.
    // Remember where it was and put it back on the way out, so the list
    // returns showing the item that was edited.
    const listScrollRef = React.useRef<HTMLDivElement>(null);
    const listScrollTop = React.useRef(0);
    const onListScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
        if (!showPicker) listScrollTop.current = event.currentTarget.scrollTop;
    }, [showPicker]);
    React.useLayoutEffect(() => {
        if (showPicker || !listScrollRef.current) return;
        listScrollRef.current.scrollTop = listScrollTop.current;
    }, [showPicker]);

    // The pinned editor's sticky top: 0 unless it is taller than the panel
    // leaves room for, so the picker below always stays reachable.
    const pickerScrollRef = React.useRef<HTMLDivElement>(null);
    const [pinTop, setPinTop] = React.useState(0);
    React.useLayoutEffect(() => {
        if (!panelEditor) return;
        const scroller = pickerScrollRef.current;
        const editor = bindingRef.current;
        if (!scroller || !editor) return;
        const measure = () => setPinTop(pinnedEditorTop(scroller.clientHeight, editor.offsetHeight));
        measure();
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
        observer?.observe(scroller);
        observer?.observe(editor);
        return () => observer?.disconnect();
    }, [panelEditor]);

    // Shadow cue: on once picker content has scrolled beneath the pinned editor.
    const [pinnedUnder, setPinnedUnder] = React.useState(false);
    const onPickerScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
        if (!panelEditor) return;
        const under = pickerScrolledUnder(event.currentTarget.scrollTop, pinTop);
        setPinnedUnder(prev => prev === under ? prev : under);
    }, [panelEditor, pinTop]);
    React.useEffect(() => {
        if (!panelEditor) setPinnedUnder(false);
    }, [panelEditor]);

    // The item being edited, kept for the way back to its row.
    const editedIndex = React.useRef<number | null>(null);
    React.useLayoutEffect(() => {
        if (panelEditor) editedIndex.current = itemToEdit;
    }, [panelEditor, itemToEdit]);

    const editorSnapshot = React.useRef<{ rect: MotionRect; node: HTMLElement } | null>(null);
    const takeEditorSnapshot = React.useCallback((editor: HTMLElement) => {
        const r = editor.getBoundingClientRect();
        editorSnapshot.current = { rect: { left: r.left, top: r.top, width: r.width, height: r.height }, node: editor.cloneNode(true) as HTMLElement };
    }, []);

    const running = React.useRef<Animation[]>([]);
    const ghostRef = React.useRef<HTMLElement | null>(null);
    const liftedRow = React.useRef<HTMLElement | null>(null);
    const refreshFrame = React.useRef<number | null>(null);
    const stopMotion = React.useCallback(() => {
        if (refreshFrame.current !== null) cancelAnimationFrame(refreshFrame.current);
        refreshFrame.current = null;
        running.current.forEach(a => a.cancel());
        running.current = [];
        ghostRef.current?.remove();
        ghostRef.current = null;
        if (liftedRow.current) liftedRow.current.style.opacity = "";
        liftedRow.current = null;
    }, []);
    React.useEffect(() => stopMotion, [stopMotion]);

    // Declared after the list scroll restore above, so leaving measures the
    // row where the list will show it.
    React.useLayoutEffect(() => {
        stopMotion();
        if (!motion) return;
        const duration = reducedMotion ? PANEL_EDITOR_FADE_MS : PANEL_EDITOR_MOTION_MS;
        const easing = PANEL_EDITOR_EASE_OUT;
        const play = (el: Element | null | undefined, keyframes: Keyframe[], options: KeyframeAnimationOptions = {}) => {
            if (!el || typeof (el as HTMLElement).animate !== "function") return;
            running.current.push((el as HTMLElement).animate(keyframes, { duration, easing, fill: "both", ...options }));
        };
        const fadeIn: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
        const fadeOut: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];
        const rowFor = (index: number | null) => index === null ? null
            : listScrollRef.current?.querySelector<HTMLElement>(`[data-binding-row="${index}"]`) ?? null;
        const rectOf = (el: Element | null | undefined): MotionRect | null => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { left: r.left, top: r.top, width: r.width, height: r.height };
        };
        // The row's slot goes empty while its copy travels. Opacity, not
        // visibility: keycaps and toggles with transition-all would keep
        // showing through a hidden parent until their own transition ends.
        // A combo row's selection ring sits on its wrapper, so that goes too.
        const liftSlot = (row: HTMLElement) => {
            const slot = row.closest<HTMLElement>("[data-combo-row]") ?? row;
            slot.style.opacity = "0";
            liftedRow.current = slot;
        };
        const canAnimate = typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.animate === "function";
        const ghostFrom = (source: HTMLElement, rect: MotionRect) => {
            const ghost = makeEditorGhost(source, rect);
            panelRef.current?.appendChild(ghost);
            ghostRef.current = ghost;
            return ghost;
        };

        if (motion === "enter") {
            const editor = bindingRef.current;
            if (pickerScrollRef.current) pickerScrollRef.current.scrollTop = 0;
            play(listScrollRef.current, fadeOut, { duration: duration * 0.7 });
            play(listHeaderRef.current, fadeOut, { duration: duration * 0.7 });
            play(overlayHeaderRef.current, fadeIn);
            play(railRef.current, fadeIn);
            const row = reducedMotion ? null : rowFor(itemToEdit);
            const from = rectOf(row);
            const to = rectOf(editor);
            if (canAnimate && editor && row && isUsableRect(from) && isUsableRect(to)) {
                // The row lifts out of the list and grows into the pinned editor.
                const ghost = ghostFrom(editor, to);
                liftSlot(row);
                play(editor, [{ opacity: 0 }, { opacity: 0 }]);
                const grow = (target: MotionRect): Keyframe[] => [
                    { ...rowToEditorFrame(from, target), opacity: 0.9 },
                    { ...EDITOR_REST_FRAME, opacity: 1 },
                ];
                play(ghost, grow(to));
                // Some editors fill in their content right after they mount
                // (a macro's actions), so the first copy can be stale and
                // shorter. One frame on, copy the editor again and carry on
                // from the same point in the motion, so nothing pops at the end.
                if (typeof requestAnimationFrame === "function") {
                    const first = running.current[running.current.length - 1];
                    refreshFrame.current = requestAnimationFrame(() => {
                        refreshFrame.current = null;
                        const now = rectOf(editor);
                        if (ghostRef.current !== ghost || !editor.isConnected || !isUsableRect(now)) return;
                        const elapsed = Number(first?.currentTime ?? 0);
                        first?.cancel();
                        ghost.remove();
                        const fresh = ghostFrom(editor, now);
                        play(fresh, grow(now));
                        const next = running.current[running.current.length - 1];
                        if (next && Number.isFinite(elapsed)) next.currentTime = elapsed;
                    });
                }
            } else {
                play(editor, fadeIn);
            }
            play(pickerBodyRef.current, reducedMotion ? fadeIn : [
                { opacity: 0, transform: `translateY(${PANEL_PICKER_RISE_PX}px)` },
                { opacity: 1, transform: "translateY(0px)" },
            ], reducedMotion ? {} : { duration: duration * 0.8, delay: duration * 0.2 });
        } else {
            const snapshot = editorSnapshot.current;
            editorSnapshot.current = null;
            play(listScrollRef.current, fadeIn);
            play(listHeaderRef.current, fadeIn);
            play(overlayRef.current, fadeOut, { duration: duration * 0.7 });
            if (!reducedMotion) play(pickerBodyRef.current, [
                { transform: "translateY(0px)" },
                { transform: `translateY(${PANEL_PICKER_RISE_PX}px)` },
            ]);
            const row = reducedMotion ? null : rowFor(editedIndex.current);
            const to = rectOf(row);
            if (canAnimate && snapshot && row && isUsableRect(snapshot.rect) && isUsableRect(to)) {
                // The editor shrinks back into its row's place in the list.
                const ghost = ghostFrom(snapshot.node, snapshot.rect);
                liftSlot(row);
                play(ghost, [
                    { ...EDITOR_REST_FRAME, opacity: 1 },
                    { ...rowToEditorFrame(to, snapshot.rect), opacity: 0.9 },
                ]);
            }
        }
        const timer = setTimeout(() => setMotion(null), duration + 20);
        return () => clearTimeout(timer);
        // Runs once per motion; the values it reads are the ones of that frame.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [motion]);

    // Reset picker mode when picker closes
    React.useEffect(() => {
        if (!showPicker) {
            const timeout = setTimeout(() => setPickerMode?.("keyboard"), 500);
            return () => clearTimeout(timeout);
        }
    }, [showPicker, setPickerMode]);

    React.useEffect(() => {
        if (itemToEdit === null) setIsClosingEditor(false);
    }, [itemToEdit]);

    return (
        <aside
            ref={panelRef}
            tabIndex={-1}
            aria-label={showPicker ? bindingEditorHeading(activePanel, itemToEdit) : getPanelTitle(activePanel, keyboard?.menus)}
            aria-hidden={state !== "expanded"}
            inert={state !== "expanded"}
            data-binding-open={showPicker ? "true" : undefined}
            data-placement={bottom ? "bottom" : "side"}
            data-combo-placement={comboActive ? comboPlacement : undefined}
            data-editor-placement={panelEditor ? "panel" : undefined}
            data-editor-motion={motion ?? undefined}
            data-picker-shape={!bottom && isLShape(pickerShape) ? pickerShape : undefined}
            // A lit surface while editing: flat on the scrim (see the spotlight rules in index.css).
            data-spotlight-surface={showPicker ? (bottom ? "flat" : "rounded") : undefined}
            className={cn("detail-panel fixed z-[60] flex flex-col bg-kb-surface border shadow-lg min-h-0", bottom ? "bottom-panel bottom-0 right-0" : "top-2 bottom-2 rounded-2xl", state !== "expanded" && "hidden")}
            style={{
                left: leftOffset ?? primaryOffset,
                width: bottom ? undefined : `min(${DETAIL_SIDEBAR_WIDTH}, calc(100vw - ${leftOffset ?? primaryOffset} - 8px))`,
                height: bottom ? getDetailPanelHeight(activePanel, height) : undefined,
                maxHeight: "calc(100dvh - 16px)",
                transition: railMotion,
                "--panel-left": leftOffset ?? primaryOffset,
                "--panel-height": `${height}px`,
            } as React.CSSProperties}
        >
            <div className="absolute inset-0 bg-sidebar-background pointer-events-none" />
            <div
                ref={listHeaderRef}
                hidden={showPicker && !bottom && motion !== "enter"}
                inert={motion === "enter"}
                className="px-4 py-3 shrink-0 z-10 bg-sidebar-background"
            >
                {/* Entering, the list's own title fades out under the editor's. */}
                {(alternativeHeader || showPicker) && motion !== "enter" ? (
                    <AlternativeHeader menus={keyboard?.menus} showBack={!(railModal && showPicker)} />
                ) : (
                    <div className="flex items-center justify-between gap-4 pt-1.5">
                        <div>
                            <h2 className="text-[22px] font-semibold leading-none text-kb-ink">
                                {getPanelTitle(activePanel, keyboard?.menus)}
                            </h2>
                        </div>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="shrink-0 rounded-full"
                            onClick={handleClose}
                            aria-label="Close details panel"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                )}
            </div>
            <div ref={listScrollRef} onScroll={onListScroll} className="z-10 relative flex-1 min-h-0 overflow-auto overscroll-contain px-4 pb-4" data-panel-scroll-owner>
                <div hidden={showPicker && motion !== "enter"} inert={motion === "enter"}>
                    <PanelContent panel={activePanel} horizontal={bottom} trayPortal={!showPicker} />
                </div>
                {categoryStrip && bottom && showPicker && comboActive && (
                    <EditorSidePanel horizontal className="pb-2" activeTab={pickerMode} onTabChange={setPickerMode} categories={pickerCategories} />
                )}
                {bottom && showPicker && <PanelContent panel={pickerMode} horizontal isPicker />}
            </div>

            {/* Overlay Panel for Key Picker */}
            {/* In the side panel this layer never moves and has no background of
                its own: the panel's frame stays put and only its contents animate.
                Hidden by opacity as well as visibility: keycaps with transition-all
                would otherwise stay visible through "invisible" until their own
                transition ends, flashing the picker over the list. */}
            <div
                ref={overlayRef}
                className={panelPlacement
                    ? cn("absolute inset-0 z-20 flex flex-col rounded-[inherit]", !(showPicker || motion === "exit") && "invisible opacity-0 pointer-events-none")
                    : cn(
                        "absolute inset-y-0 left-0 right-0 bg-kb-surface z-20 transition-all duration-500 ease-in-out flex flex-col",
                        showPicker && !bottom ? "translate-x-0 opacity-100" : "-translate-x-[120%] opacity-0 pointer-events-none"
                    )}
                aria-hidden={!showPicker || bottom}
                inert={!showPicker || bottom}
                data-picker-overlay=""
                style={panelPlacement ? undefined : { clipPath: "inset(-50px -300px -50px 0px)" }}
            >
                <div ref={overlayHeaderRef} className={cn("px-4 py-6 shrink-0", panelPlacement ? motion === "exit" && "invisible" : "bg-kb-surface")}>
                    <AlternativeHeader onBack={() => setIsClosingEditor(true)} menus={keyboard?.menus} holdEditorTitle showBack={!railModal} />
                </div>

                {categoryStrip && <div ref={railRef} data-picker-rail="" className="absolute top-24 right-0 bottom-0 overflow-y-auto z-30">
                    <EditorSidePanel activeTab={pickerMode} onTabChange={setPickerMode} categories={pickerCategories} />
                </div>}

                <div ref={pickerScrollRef} onScroll={onPickerScroll} className={cn("flex-1 min-h-0 overflow-auto overscroll-contain pl-4 pb-4", categoryStrip ? "pr-16" : "pr-4")} data-panel-editor-scroll={panelEditor ? "" : undefined}>
                    {panelEditor && <div
                        ref={bindingRef}
                        tabIndex={-1}
                        // Flat inside the lit panel: a tint, no shadow of its own beyond the pin cue.
                        className="binding-workspace sticky z-30 mb-3 flex flex-col rounded-xl border border-transparent bg-kb-gray-medium"
                        aria-label="Binding editor"
                        data-editor-placement="panel"
                        data-pin-cue={pinCue}
                        data-pinned-under={pinnedUnder ? "true" : undefined}
                        style={{ top: pinTop }}
                    >
                        <EditorSnapshotProbe onLeave={takeEditorSnapshot} />
                        {pinCue === "notch" && <Pin aria-hidden="true" className="pin-cue-glyph" />}
                        {/* The compact bar: no close button here, the header's back arrow is the way out. */}
                        <BindingEditorContainer shouldClose={isClosingEditor} inline bar />
                    </div>}
                    {/* Fills the pinned editor's rounded top corners with the panel's
                        background, so picker content scrolling beneath never shows there.
                        It sits after the editor (and behind it) and sticks to the same
                        top before any content can reach those corners. */}
                    {panelEditor && <div aria-hidden="true" data-pin-cap="" className="sticky z-[29] h-3 -mt-3 bg-kb-surface" style={{ top: pinTop }} />}
                    {/* Keyed by category: a rail switch swaps only this, with a short crossfade. */}
                    <div key={pickerMode} ref={pickerBodyRef} className={panelPlacement ? "panel-picker-swap" : undefined} data-picker-body={pickerMode}>
                    {pickerMode === "keyboard" && <BasicKeyboards isPicker trayPortal={showPicker} />}
                    {pickerMode === "layers" && <LayersPanel isPicker />}
                    {pickerMode === "macros" && <MacrosPanel isPicker />}
                    {pickerMode === "qmk" && <QmkKeyPanel isPicker />}
                    {pickerMode === "oneshot" && <OneShotComposerPanel isPicker />}
                    {pickerMode === "special" && <SpecialKeysPanel isPicker />}
                    {pickerMode === "pointing" && <PointingPanel isPicker />}
                    {pickerMode === "mouse" && <MousePanel isPicker />}
                    {pickerMode === "tapdances" && <TapdancePanel isPicker />}
                    </div>
                </div>
            </div>
            {showPicker && !panelEditor && <div
                ref={bindingRef}
                tabIndex={-1}
                // The combo card is a lit surface of its own; the side workspace keeps its tint.
                className={cn("binding-workspace z-30 flex min-h-0", comboActive ? "bg-kb-surface" : "bg-kb-gray-medium")}
                aria-label="Binding editor"
                data-combo-placement={comboActive ? comboPlacement : undefined}
                data-combo-spot={comboActive && comboGeometry.spot ? comboGeometry.spot : undefined}
                // Until it is measured the editor is transparent, not hidden:
                // a visibility-hidden element cannot take the opening focus.
                style={comboActive ? (comboGeometry.style ?? { opacity: 0, pointerEvents: "none" }) : undefined}
                onPointerDown={comboActive ? comboGeometry.onPointerDown : undefined}
            >
                {categoryStrip && bottom && !comboActive && <div className="shrink-0 bg-kb-surface overflow-y-auto">
                    <EditorSidePanel activeTab={pickerMode} onTabChange={setPickerMode} categories={pickerCategories} />
                </div>}
                <div className="relative min-w-0 flex-1 overflow-auto overscroll-contain" data-binding-scroll-owner>
                    {!comboActive && <Button type="button" variant="ghost" size="icon" aria-label="Close binding editor"
                        className="sticky top-1 left-full z-40 bg-kb-gray-medium"
                        onClick={() => setIsClosingEditor(true)}><X className="h-4 w-4" /></Button>}
                    <BindingEditorContainer
                        shouldClose={isClosingEditor}
                        inline
                        compact={comboActive}
                        movable={comboActive && (comboPlacement === "float" || comboPlacement === "half")}
                        stacked={comboActive && (comboPlacement !== "dock" || (comboGeometry.regionWidth ?? Infinity) < COMBO_DOCK_ONE_ROW_MIN)}
                        onRequestClose={comboActive ? () => setIsClosingEditor(true) : undefined}
                    />
                </div>
            </div>}
        </aside>
    );
};

export default SecondarySidebar;
