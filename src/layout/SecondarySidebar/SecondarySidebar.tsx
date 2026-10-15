import "./SecondarySidebar.css";

import * as React from "react";
import { ArrowLeft, X } from "lucide-react";

import BindingEditorContainer from "./components/BindingEditor/BindingEditorContainer";
import EditorSidePanel from "./components/EditorSidePanel";
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
import { cn } from "@/lib/utils";
import type { ComboEditorPlacement } from "@/lib/comboEditorPlacement";
import { effectivePickerMode, isBindingEditorOpen, usablePickerCategories, type PickerMode } from "@/lib/bindingSpotlight";
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
}

const AlternativeHeader = ({ onBack, menus }: AlternativeHeaderProps) => {
    const { activePanel, handleCloseEditor } = usePanels();

    const title = `Add Keys to ${getPanelTitle(activePanel, menus)}`;

    return (
        <div className="flex items-center justify-start gap-4">
            <button
                type="button"
                onClick={() => onBack ? onBack() : handleCloseEditor()}
                className="bg-transparent hover:bg-muted/60 rounded-full p-2 cursor-pointer transition-colors"
                aria-label="Go back"
            >
                <ArrowLeft className="h-6 w-6 text-gray-500 dark:text-neutral-400" />
            </button>
            <div>
                <h2 className="text-[22px] font-semibold leading-none text-kb-ink">
                    {title}
                </h2>
            </div>
        </div>
    );
};

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
}
const SecondarySidebar = ({ bottom = false, leftOffset, height = 230, comboPlacement, canvasRef, getKeyboardElement, onComboReserveChange }: SecondarySidebarProps) => {
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

    // A single combo's editor moves out of the keyboard's way (dock, anchored
    // or float). It stays in this tree; only CSS and fixed coordinates change.
    const comboActive = showPicker && activePanel === "combos" && !!comboPlacement;
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
            aria-label={getPanelTitle(activePanel, keyboard?.menus)}
            aria-hidden={state !== "expanded"}
            inert={state !== "expanded"}
            data-binding-open={showPicker ? "true" : undefined}
            data-placement={bottom ? "bottom" : "side"}
            data-combo-placement={comboActive ? comboPlacement : undefined}
            className={cn("detail-panel fixed z-[60] flex flex-col bg-kb-surface border shadow-lg min-h-0", bottom ? "bottom-panel bottom-0 right-0" : "top-2 bottom-2 rounded-2xl", state !== "expanded" && "hidden")}
            style={{
                left: leftOffset ?? primaryOffset,
                width: bottom ? undefined : `min(${DETAIL_SIDEBAR_WIDTH}, calc(100vw - ${leftOffset ?? primaryOffset} - 8px))`,
                height: bottom ? getDetailPanelHeight(activePanel, height) : undefined,
                maxHeight: "calc(100dvh - 16px)",
                "--panel-left": leftOffset ?? primaryOffset,
                "--panel-height": `${height}px`,
            } as React.CSSProperties}
        >
            <div className="absolute inset-0 bg-sidebar-background pointer-events-none" />
            <div hidden={showPicker && !bottom} className="px-4 py-3 shrink-0 z-10 bg-sidebar-background">
                {(alternativeHeader || showPicker) ? (
                    <AlternativeHeader menus={keyboard?.menus} />
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
            <div className="z-10 relative flex-1 min-h-0 overflow-auto overscroll-contain px-4 pb-4" data-panel-scroll-owner>
                <div hidden={showPicker}>
                    <PanelContent panel={activePanel} horizontal={bottom} />
                </div>
                {bottom && showPicker && comboActive && (
                    <EditorSidePanel horizontal className="pb-2" activeTab={pickerMode} onTabChange={setPickerMode} categories={pickerCategories} />
                )}
                {bottom && showPicker && <PanelContent panel={pickerMode} horizontal isPicker />}
            </div>

            {/* Overlay Panel for Key Picker */}
            <div
                className={cn(
                    "absolute top-0 bottom-0 left-0 -right-[2px] bg-kb-surface shadow-[4px_0_16px_rgba(0,0,0,0.1)] z-20 transition-all duration-500 ease-in-out flex flex-col",
                    showPicker && !bottom ? "translate-x-0 opacity-100" : "-translate-x-[120%] opacity-0 pointer-events-none"
                )}
                aria-hidden={!showPicker || bottom}
                inert={!showPicker || bottom}
                style={{ clipPath: "inset(-50px -300px -50px 0px)" }}
            >
                <div className="px-4 py-6 bg-kb-surface shrink-0">
                    <AlternativeHeader onBack={() => setIsClosingEditor(true)} menus={keyboard?.menus} />
                </div>

                <div className="absolute top-24 right-0 bottom-0 overflow-y-auto z-30">
                    <EditorSidePanel activeTab={pickerMode} onTabChange={setPickerMode} categories={pickerCategories} />
                </div>

                <div className="flex-1 min-h-0 overflow-auto overscroll-contain pl-4 pr-16 pb-4">
                    {pickerMode === "keyboard" && <BasicKeyboards isPicker />}
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
            {showPicker && <div
                ref={bindingRef}
                tabIndex={-1}
                className="binding-workspace z-30 bg-kb-gray-medium shadow-lg flex min-h-0"
                aria-label="Binding editor"
                data-combo-placement={comboActive ? comboPlacement : undefined}
                data-combo-spot={comboActive && comboGeometry.spot ? comboGeometry.spot : undefined}
                // Until it is measured the editor is transparent, not hidden:
                // a visibility-hidden element cannot take the opening focus.
                style={comboActive ? (comboGeometry.style ?? { opacity: 0, pointerEvents: "none" }) : undefined}
                onPointerDown={comboActive ? comboGeometry.onPointerDown : undefined}
            >
                {bottom && !comboActive && <div className="shrink-0 bg-kb-surface overflow-y-auto">
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
