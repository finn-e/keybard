import "./BindingEditorContainer.css";

import { FC, useCallback, useState, useEffect, useRef, KeyboardEvent } from "react";

import OnOffToggle from "@/components/ui/OnOffToggle";
import { usePanels } from "@/contexts/PanelsContext";
import { cn } from "@/lib/utils";
import { bindingEditorTitle } from "@/lib/bindingSpotlight";
import { X, GripHorizontal, GripVertical, Trash2 } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { DelayedTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

import { LeaderOptions, AltRepeatKeyOptions, ComboOptions } from "@/types/keyboard.types";
import { useBindingChanges } from "@/hooks/useBindingChanges";
import { Input } from "@/components/ui/input";
import AltRepeatEditor from "./AltRepeatEditor";
import LeaderEditor from "./LeaderEditor";
import ComboEditor from "./ComboEditor";
import MacroEditor from "./MacroEditor";
import OverrideEditor from "./OverrideEditor";
import TapdanceEditor from "./TapdanceEditor";
import { AnimatedHeight, BarDelete, BarToggle } from "./EditorBar";
import { useBindingNames } from "@/hooks/useBindingNames";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { getKeyContents } from "@/utils/keys";
import { Key } from "@/components/Key";
import { KeyContent } from "@/types/keyboard.types";
import { isOverrideEnabled, KeyOverrideOptions, prepareOverrideForEdit } from "@/utils/key-override";

interface Props {
    shouldClose?: boolean;
    inline?: boolean; // When true, renders inline without absolute positioning (for overlay mode)
    /** Single-row combo editor for the underslung placements. Combos only. */
    compact?: boolean;
    /** Close request for the compact header's close button. */
    onRequestClose?: () => void;
    /** Show a move handle in the compact header (floating placement). */
    movable?: boolean;
    /** Compact card: title row above the keys instead of one long row. */
    stacked?: boolean;
    /**
     * The compact bar of the side-panel placement, for every kind: one row of
     * labeled slots with on/off, any time field and delete at its end. No name,
     * icon or close button; the panel header has the name and the way back.
     */
    bar?: boolean;
}


const labels = {
    tapdances: "Tap Dance Keys",
    macros: "Macro Key",
    combos: "Combo",
    overrides: "Override",
    altrepeat: "Alt-Repeat Key",
    leaders: "Leader Sequence",
};



const BindingEditorContainer: FC<Props> = ({ shouldClose, inline = false, compact = false, onRequestClose, movable = false, stacked = false, bar = false }) => {
    const { itemToEdit, handleCloseEditor, bindingTypeToEdit } = usePanels();
    const [isClosing, setIsClosing] = useState(false);
    const [yOffset, setYOffset] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);

    const isDraggingRef = useRef(false);
    const startYRef = useRef(0);
    const startOffsetRef = useRef(0);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        isDraggingRef.current = true;
        setIsDragging(true);
        startYRef.current = e.clientY;
        startOffsetRef.current = yOffset;
        document.body.style.cursor = "ns-resize";
        e.preventDefault();
        e.stopPropagation();
    }, [yOffset]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDraggingRef.current) return;
            const deltaY = e.clientY - startYRef.current;
            setYOffset(startOffsetRef.current + deltaY);
        };

        const handleMouseUp = () => {
            if (isDraggingRef.current) {
                isDraggingRef.current = false;
                setIsDragging(false);
                document.body.style.cursor = "";
            }
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, []);

    useEffect(() => {
        if (shouldClose && !isClosing) {
            if (inline) handleCloseEditor();
            else setIsClosing(true);
        }
    }, [shouldClose, isClosing, inline, handleCloseEditor]);

    const handleAnimatedClose = useCallback(() => {
        if (isClosing) {
            return;
        }

        setIsClosing(true);
    }, [isClosing]);

    const handleAnimationEnd = useCallback(() => {
        if (isClosing) {
            handleCloseEditor();
        }
    }, [handleCloseEditor, isClosing]);

    const { keyboard, setKeyboard } = useKeyboard();
    const persistBinding = useBindingChanges();
    const { renameBinding, nameError } = useBindingNames();
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editTitleValue, setEditTitleValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    const getEditableTitleDefaults = () => {
        if (bindingTypeToEdit === "macros") {
            return { cosmeticKey: "macros" as const, defaultLabel: `Macro Key ${itemToEdit}` };
        }
        if (bindingTypeToEdit === "tapdances") {
            return { cosmeticKey: "tapdances" as const, defaultLabel: `Tap Dance Key ${itemToEdit}` };
        }
        if (bindingTypeToEdit === "combos") {
            return { cosmeticKey: "combos" as const, defaultLabel: `Combo ${itemToEdit}` };
        }
        return null;
    };

    const handleStartEditingTitle = () => {
        if (!keyboard || itemToEdit === null) return;
        const editConfig = getEditableTitleDefaults();
        if (!editConfig) return;
        const { cosmeticKey, defaultLabel } = editConfig;
        // A combo with no name starts empty, its number shown as the placeholder.
        const currentName = keyboard.cosmetic?.[cosmeticKey]?.[itemToEdit.toString()] || (cosmeticKey === "combos" ? "" : defaultLabel);
        setEditTitleValue(currentName);
        setIsEditingTitle(true);
    };

    const handleSaveTitle = async () => {
        if (itemToEdit === null) return;
        const config = getEditableTitleDefaults();
        if (!config) return;
        const kind = config.cosmeticKey === "macros" ? "macro" : config.cosmeticKey === "tapdances" ? "tapdance" : "combo";
        const value = editTitleValue.trim() === config.defaultLabel ? "" : editTitleValue;
        if (await renameBinding(kind, itemToEdit, value)) setIsEditingTitle(false);
    };

    const handleTitleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            handleSaveTitle();
        } else if (e.key === "Escape") {
            setIsEditingTitle(false);
        }
    };

    const handleClearAll = async () => {
        if (!keyboard || itemToEdit === null || !bindingTypeToEdit) return;

        setIsConfirmOpen(false);

        const updatedKeyboard = structuredClone(keyboard);

        switch (bindingTypeToEdit) {
            case "tapdances":
                if (updatedKeyboard.tapdances?.[itemToEdit]) {
                    updatedKeyboard.tapdances[itemToEdit] = {
                        ...updatedKeyboard.tapdances[itemToEdit],
                        tap: "KC_NO",
                        hold: "KC_NO",
                        doubletap: "KC_NO",
                        taphold: "KC_NO",
                        tapping_term: 200
                    };
                    setKeyboard(updatedKeyboard);
                    await persistBinding(updatedKeyboard, "tapdance", itemToEdit);
                }
                break;
            case "macros":
                if (updatedKeyboard.macros?.[itemToEdit]) {
                    updatedKeyboard.macros[itemToEdit].actions = [];
                    setKeyboard(updatedKeyboard);
                    await persistBinding(updatedKeyboard, "macro", itemToEdit);
                }
                break;
            case "combos":
                if (updatedKeyboard.combos?.[itemToEdit]) {
                    updatedKeyboard.combos![itemToEdit].keys = ["KC_NO", "KC_NO", "KC_NO", "KC_NO"];
                    updatedKeyboard.combos![itemToEdit].output = "KC_NO";
                    setKeyboard(updatedKeyboard);
                    await persistBinding(updatedKeyboard, "combo", itemToEdit);
                }
                break;
            case "overrides":
                if (updatedKeyboard.key_overrides?.[itemToEdit]) {
                    updatedKeyboard.key_overrides![itemToEdit] = {
                        ...updatedKeyboard.key_overrides![itemToEdit],
                        trigger: "KC_NO",
                        replacement: "KC_NO",
                        layers: 0xFFFF,
                        trigger_mods: 0,
                        negative_mod_mask: 0,
                        suppressed_mods: 0,
                        options: 0
                    };
                    setKeyboard(updatedKeyboard);
                    await persistBinding(updatedKeyboard, "override", itemToEdit);
                }
                break;
            case "altrepeat":
                if (updatedKeyboard.alt_repeat_keys?.[itemToEdit]) {
                    updatedKeyboard.alt_repeat_keys![itemToEdit] = {
                        ...updatedKeyboard.alt_repeat_keys![itemToEdit],
                        keycode: "KC_NO",
                        alt_keycode: "KC_NO",
                        allowed_mods: 0,
                        options: 0
                    };
                    setKeyboard(updatedKeyboard);
                    await persistBinding(updatedKeyboard, "altrepeat", itemToEdit);
                }
                break;
            case "leaders":
                if (updatedKeyboard.leaders?.[itemToEdit]) {
                    updatedKeyboard.leaders![itemToEdit] = {
                        ...updatedKeyboard.leaders![itemToEdit],
                        sequence: ["KC_NO", "KC_NO", "KC_NO", "KC_NO", "KC_NO"],
                        output: "KC_NO",
                        options: 0
                    };
                    setKeyboard(updatedKeyboard);
                    await persistBinding(updatedKeyboard, "leader", itemToEdit);
                }
                break;
        }


    };

    const getEditorTitle = () => {
        if (!keyboard || itemToEdit === null || !bindingTypeToEdit) return "Data";
        if (!(bindingTypeToEdit in labels)) return "Data";
        return bindingEditorTitle(bindingTypeToEdit, itemToEdit, keyboard.cosmetic);
    };

    const getHasContent = () => {
        if (!keyboard || itemToEdit === null || !bindingTypeToEdit) return false;

        switch (bindingTypeToEdit) {
            case "tapdances": {
                const td = keyboard.tapdances?.[itemToEdit];
                return !!td && (td.tap !== "KC_NO" || td.hold !== "KC_NO" || td.doubletap !== "KC_NO" || td.taphold !== "KC_NO");
            }
            case "macros": {
                const macro = keyboard.macros?.[itemToEdit];
                return !!macro && macro.actions.length > 0;
            }
            case "combos": {
                const combo = keyboard.combos?.[itemToEdit];
                return !!combo && (combo.keys.some(k => k !== "KC_NO") || combo.output !== "KC_NO");
            }
            case "overrides": {
                const override = keyboard.key_overrides?.[itemToEdit];
                return !!override && (override.trigger !== "KC_NO" || override.replacement !== "KC_NO");
            }
            case "altrepeat": {
                const ar = keyboard.alt_repeat_keys?.[itemToEdit];
                return !!ar && (ar.keycode !== "KC_NO" || ar.alt_keycode !== "KC_NO");
            }
            case "leaders": {
                const leader = keyboard.leaders?.[itemToEdit];
                return !!leader && (leader.sequence.some(k => k !== "KC_NO") || leader.output !== "KC_NO");
            }
            default:
                return false;
        }
    };

    const hasContent = getHasContent();

    // In inline mode, render without absolute positioning for overlay use
    const containerClasses = inline
        ? "flex flex-col w-full min-w-0"
        : cn("absolute top-1/2", bindingTypeToEdit === "overrides" ? "w-[600px] right-[-600px]" : bindingTypeToEdit === "combos" ? "w-[660px] right-[-660px]" : bindingTypeToEdit === "leaders" ? "w-[520px] right-[-520px]" : "w-[450px] right-[-450px]");

    const panelClasses = inline
        ? cn("bg-kb-gray-medium p-0 flex flex-col w-full min-w-[280px]")
        : cn(
            "binding-editor bg-kb-gray-medium rounded-r-2xl p-0 flex flex-col w-full shadow-[4px_0_16px_rgba(0,0,0,0.1)] overflow-hidden relative",
            "min-h-0",
            isClosing ? "binding-editor--exit" : "binding-editor--enter"
        );

    // Icon sizes: smaller for inline mode
    const iconSize = inline ? "w-10 h-10" : "w-14 h-14";
    const iconWidth = inline ? "w-10" : "w-14";

    const renderHeaderIcon = () => {
        if (!keyboard || itemToEdit === null) return null;

        const isDraggable = bindingTypeToEdit === "tapdances" || bindingTypeToEdit === "macros";
        const keycode = bindingTypeToEdit === "tapdances" ? `TD(${itemToEdit})` :
            bindingTypeToEdit === "macros" ? `M${itemToEdit}` : "KC_NO";

        const keyContents = getKeyContents(keyboard, keycode) as KeyContent;
        if (!isDraggable) {
            // For non-draggable types, we still use the Key representation but override the type/label
            (keyContents as any).type = (
                bindingTypeToEdit === "combos" ? "combo" :
                    bindingTypeToEdit === "leaders" ? "leaders" :
                        bindingTypeToEdit === "overrides" ? "override" :
                            bindingTypeToEdit === "altrepeat" ? "altrepeat" : "key"
            );
        }

        return (
            <div className={cn("flex flex-col items-start", iconWidth)}>
                <div className={cn("relative", iconSize)}>
                    <Key
                        isRelative
                        x={0}
                        y={0}
                        w={1}
                        h={1}
                        row={-1}
                        col={-1}
                        keycode={keycode}
                        label={itemToEdit.toString()}
                        keyContents={keyContents}
                        layerColor="sidebar"
                        variant={inline ? "small" : "default"}
                        disableTooltip={true}
                        disableDrag={!isDraggable}
                        disableHover={!isDraggable}
                        forceLabel={true}
                    />
                </div>

                {bindingTypeToEdit === "leaders" && keyboard?.leaders && itemToEdit !== null && (
                    <div className="mt-[20px]">
                        <OnOffToggle
                            label="Leader sequence enabled"
                            value={(keyboard.leaders[itemToEdit]?.options & LeaderOptions.ENABLED) !== 0}
                            onToggle={async (enabled) => {
                                const updatedKeyboard = structuredClone(keyboard);
                                let options = updatedKeyboard.leaders![itemToEdit].options;
                                if (enabled) options |= LeaderOptions.ENABLED;
                                else options &= ~LeaderOptions.ENABLED;
                                updatedKeyboard.leaders![itemToEdit].options = options;
                                setKeyboard(updatedKeyboard);
                                await persistBinding(updatedKeyboard, "leader", itemToEdit);
                            }}
                        />
                    </div>
                )}

                {bindingTypeToEdit === "overrides" && keyboard?.key_overrides && itemToEdit !== null && (
                    <div className="mt-[20px]">
                        <OnOffToggle
                            label="Override enabled"
                            value={isOverrideEnabled(keyboard.key_overrides[itemToEdit])}
                            onToggle={async (enabled) => {
                                const updatedKeyboard = structuredClone(keyboard);
                                const ovr = prepareOverrideForEdit(updatedKeyboard.key_overrides![itemToEdit], updatedKeyboard.layers);
                                if (enabled) ovr.options |= KeyOverrideOptions.ENABLED;
                                else ovr.options &= ~KeyOverrideOptions.ENABLED;
                                setKeyboard(updatedKeyboard);
                                await persistBinding(updatedKeyboard, "override", itemToEdit);
                            }}
                        />
                    </div>
                )}

                {bindingTypeToEdit === "altrepeat" && keyboard?.alt_repeat_keys && itemToEdit !== null && (
                    <div className="mt-[20px]">
                        <OnOffToggle
                            label="Alt-repeat enabled"
                            value={(keyboard.alt_repeat_keys[itemToEdit]?.options & AltRepeatKeyOptions.ENABLED) !== 0}
                            onToggle={async (enabled) => {
                                const updatedKeyboard = structuredClone(keyboard);
                                let options = updatedKeyboard.alt_repeat_keys![itemToEdit].options;
                                if (enabled) options |= AltRepeatKeyOptions.ENABLED;
                                else options &= ~AltRepeatKeyOptions.ENABLED;
                                updatedKeyboard.alt_repeat_keys![itemToEdit].options = options;
                                setKeyboard(updatedKeyboard);
                                await persistBinding(updatedKeyboard, "altrepeat", itemToEdit);
                            }}
                        />
                    </div>
                )}

                {bindingTypeToEdit === "combos" && keyboard?.combos && itemToEdit !== null && (
                    <div className="mt-[20px]">
                        <OnOffToggle
                            label="Combo enabled"
                            value={(keyboard.combos[itemToEdit]?.options & ComboOptions.ENABLED) !== 0}
                            onToggle={async (enabled) => {
                                const updatedKeyboard = structuredClone(keyboard);
                                let options = updatedKeyboard.combos![itemToEdit].options;
                                if (enabled) options |= ComboOptions.ENABLED;
                                else options &= ~ComboOptions.ENABLED;
                                updatedKeyboard.combos![itemToEdit].options = options;
                                setKeyboard(updatedKeyboard);
                                await persistBinding(updatedKeyboard, "combo", itemToEdit);
                            }}
                        />
                    </div>
                )}
            </div>
        );
    };

    const confirmDialog = (
        <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold">
                        Clear {getEditorTitle()}
                    </DialogTitle>
                </DialogHeader>
                <DialogFooter className="gap-3 sm:gap-4 mt-4">
                    <Button
                        variant="outline"
                        onClick={() => setIsConfirmOpen(false)}
                        className="rounded-full px-8 py-5 text-base border-slate-300 dark:border-neutral-500 hover:bg-slate-50 dark:hover:bg-neutral-700 transition-colors"
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={handleClearAll}
                        className="rounded-full px-8 py-5 text-base font-bold bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 transition-colors border-none"
                    >
                        Clear
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );

    const renderComboToggle = () => keyboard?.combos && itemToEdit !== null ? (
        <OnOffToggle
            label="Combo enabled"
            value={(keyboard.combos[itemToEdit]?.options & ComboOptions.ENABLED) !== 0}
            onToggle={async (enabled) => {
                const updatedKeyboard = structuredClone(keyboard);
                let options = updatedKeyboard.combos![itemToEdit].options;
                if (enabled) options |= ComboOptions.ENABLED;
                else options &= ~ComboOptions.ENABLED;
                updatedKeyboard.combos![itemToEdit].options = options;
                setKeyboard(updatedKeyboard);
                await persistBinding(updatedKeyboard, "combo", itemToEdit);
            }}
        />
    ) : null;

    // On/off for the kinds that have it, saved straight away.
    const enabledToggle = (() => {
        if (!keyboard || itemToEdit === null) return null;
        const save = async (updated: typeof keyboard, kind: "tapdance" | "leader" | "override" | "altrepeat" | "combo") => {
            setKeyboard(updated);
            await persistBinding(updated, kind, itemToEdit);
        };
        const flip = (options: number, bit: number, on: boolean) => on ? options | bit : options & ~bit;
        switch (bindingTypeToEdit) {
            case "leaders":
                if (!keyboard.leaders?.[itemToEdit]) return null;
                return <BarToggle label="Leader sequence enabled" value={(keyboard.leaders[itemToEdit].options & LeaderOptions.ENABLED) !== 0} onToggle={on => {
                    const u = structuredClone(keyboard); const e = u.leaders![itemToEdit]; e.options = flip(e.options, LeaderOptions.ENABLED, on); void save(u, "leader");
                }} />;
            case "overrides":
                if (!keyboard.key_overrides?.[itemToEdit]) return null;
                return <BarToggle label="Override enabled" value={isOverrideEnabled(keyboard.key_overrides[itemToEdit])} onToggle={on => {
                    const u = structuredClone(keyboard); const o = prepareOverrideForEdit(u.key_overrides![itemToEdit], u.layers); o.options = flip(o.options, KeyOverrideOptions.ENABLED, on); void save(u, "override");
                }} />;
            case "altrepeat":
                if (!keyboard.alt_repeat_keys?.[itemToEdit]) return null;
                return <BarToggle label="Alt-repeat enabled" value={(keyboard.alt_repeat_keys[itemToEdit].options & AltRepeatKeyOptions.ENABLED) !== 0} onToggle={on => {
                    const u = structuredClone(keyboard); const e = u.alt_repeat_keys![itemToEdit]; e.options = flip(e.options, AltRepeatKeyOptions.ENABLED, on); void save(u, "altrepeat");
                }} />;
            case "combos":
                if (!keyboard.combos?.[itemToEdit]) return null;
                return <BarToggle label="Combo enabled" value={(keyboard.combos[itemToEdit].options & ComboOptions.ENABLED) !== 0} onToggle={on => {
                    const u = structuredClone(keyboard); const e = u.combos![itemToEdit]; e.options = flip(e.options, ComboOptions.ENABLED, on); void save(u, "combo");
                }} />;
            default:
                return null;
        }
    })();

    if (bar) {
        const barEnd = (
            <>
                {enabledToggle}
                <BarDelete label={`Clear ${getEditorTitle()}`} enabled={hasContent} onClick={() => setIsConfirmOpen(true)} />
            </>
        );
        return (
            <div className="editor-bar w-full min-w-0" data-editor-bar={bindingTypeToEdit ?? ""}>
                <AnimatedHeight>
                    <div className="px-2.5 py-2">
                        {bindingTypeToEdit === "tapdances" && <TapdanceEditor bar barEnd={barEnd} />}
                        {bindingTypeToEdit === "combos" && <ComboEditor bar barEnd={barEnd} />}
                        {bindingTypeToEdit === "overrides" && <OverrideEditor bar barEnd={barEnd} />}
                        {bindingTypeToEdit === "macros" && <MacroEditor bar barEnd={barEnd} />}
                        {bindingTypeToEdit === "altrepeat" && <AltRepeatEditor bar barEnd={barEnd} />}
                        {bindingTypeToEdit === "leaders" && <LeaderEditor bar barEnd={barEnd} />}
                        {nameError && <p role="alert" className="pt-1 text-sm text-red-700 dark:text-red-400">{nameError}</p>}
                    </div>
                </AnimatedHeight>
                {confirmDialog}
            </div>
        );
    }

    // Compact single-combo editor: title, enabled, keys, clear and close in
    // one row that wraps when narrow. Placement is owned by the sidebar.
    if (compact && bindingTypeToEdit === "combos") {
        const title = (
            <div className="flex flex-row items-center gap-3 shrink-0">
                {movable && (
                    <span data-float-drag-handle aria-hidden="true" title="Move" className="cursor-move touch-none text-kb-gray-border dark:text-neutral-400 hover:text-kb-ink">
                        <GripVertical className="h-4 w-4" />
                    </span>
                )}
                <h3 className="text-base font-semibold leading-none whitespace-nowrap text-kb-ink">
                    {isEditingTitle ? (
                        <Input
                            ref={inputRef}
                            aria-label="Combo name"
                            placeholder={`Combo ${itemToEdit}`}
                            value={editTitleValue}
                            onChange={(e) => setEditTitleValue(e.target.value)}
                            onBlur={handleSaveTitle}
                            onKeyDown={handleTitleKeyDown}
                            className="h-7 py-0 px-1.5 text-base font-semibold w-[11rem] select-text"
                            autoFocus
                        />
                    ) : (
                        <button
                            type="button"
                            aria-label={`Rename ${getEditorTitle()}`}
                            title="Click to rename"
                            className="cursor-pointer rounded-md -mx-1 px-1 py-0.5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
                            onClick={handleStartEditingTitle}
                            data-combo-editor-title=""
                        >
                            {getEditorTitle()}
                        </button>
                    )}
                </h3>
                {renderComboToggle()}
            </div>
        );
        const nameAlert = nameError ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{nameError}</p> : null;
        const actions = (
            <div className="flex flex-row items-center gap-1 shrink-0 ml-auto">
                {hasContent && (
                    <DelayedTooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                aria-label={`Clear ${getEditorTitle()}`}
                                onClick={() => setIsConfirmOpen(true)}
                                className="rounded-full p-1.5 text-kb-gray-border dark:text-neutral-400 transition-all hover:bg-red-500 hover:text-white dark:hover:text-white focus:outline-none cursor-pointer"
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Clear {getEditorTitle()}</p>
                        </TooltipContent>
                    </DelayedTooltip>
                )}
                {onRequestClose && (
                    <Button type="button" variant="ghost" size="icon" aria-label="Close binding editor" className="h-8 w-8 rounded-full" onClick={onRequestClose}>
                        <X className="h-4 w-4" />
                    </Button>
                )}
            </div>
        );
        // Compact single-combo editor. Placement is owned by the sidebar; this
        // only lays out title, enabled, keys, clear and close.
        // One row: the error sits under the row, outside the flex line.
        return stacked ? (
            <div className="combo-compact-editor flex flex-col gap-1 w-full min-w-0 px-3 py-2">
                <div className="flex flex-row items-center gap-3">{title}{actions}</div>
                {nameAlert}
                <ComboEditor strip />
                {confirmDialog}
            </div>
        ) : (
            <div className="flex flex-col w-full min-w-0">
                <div className="combo-compact-editor flex flex-row items-center gap-x-4 w-full min-w-0 px-3 py-2">
                    {title}
                    <div className="min-w-0"><ComboEditor strip /></div>
                    {actions}
                </div>
                {nameAlert && <div className="px-3 pb-2">{nameAlert}</div>}
                {confirmDialog}
            </div>
        );
    }

    return (
        <div
            className={containerClasses}
            style={{
                ...(!inline ? { transform: `translateY(calc(-50% + ${yOffset}px))` } : { transform: `translateY(${yOffset}px)` }),
                transition: isDragging ? "none" : "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
            }}
        >
            <div className={panelClasses} onAnimationEnd={handleAnimationEnd}>
                {!inline && <div
                    className="w-full h-6 flex items-center justify-center cursor-ns-resize hover:bg-black/5 dark:hover:bg-white/5 transition-colors group z-20"
                    onMouseDown={handleMouseDown}
                >
                    <GripHorizontal className="h-4 w-4 text-gray-400 dark:text-neutral-400 group-hover:text-gray-600 dark:group-hover:text-neutral-300" />
                </div>}
                <div className={inline ? "p-3 pt-0" : "p-5 pt-0"}>
                    <div className={cn(
                        "flex flex-row w-full items-start justify-between",
                        inline ? "pr-3 pt-2 pb-2 pl-4" : "pt-2 pb-[6px] pl-[84px]"
                    )}>
                        <div className="flex flex-row items-start">
                            {renderHeaderIcon()}
                            <div className={cn("flex items-center", inline ? "h-10 pl-3" : "h-14 pl-[20px]")}>
                                <div className={cn("font-normal", inline ? "text-lg" : "text-xl")}>
                                    {bindingTypeToEdit === "macros" || bindingTypeToEdit === "tapdances" || bindingTypeToEdit === "combos" ? (
                                        isEditingTitle ? (
                                            <div className="flex items-center gap-2 bg-kb-surface rounded-md px-1 py-0.5 border border-kb-ink shadow-sm">
                                                <Input
                                                    ref={inputRef}
                                                    aria-label="Binding name"
                                                    value={editTitleValue}
                                                    onChange={(e) => setEditTitleValue(e.target.value)}
                                                    onBlur={handleSaveTitle}
                                                    onKeyDown={handleTitleKeyDown}
                                                    className="h-auto py-1 px-2 text-lg font-bold border-none focus-visible:ring-0 w-auto min-w-[130px] select-text"
                                                    autoFocus
                                                />
                                            </div>
                                        ) : (
                                            <button
                                                type="button"
                                                aria-label={`Rename ${getEditorTitle()}`}
                                                className="cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md px-2 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 text-left"
                                                onClick={handleStartEditingTitle}
                                                title="Click to rename"
                                            >
                                                {getEditorTitle()}
                                            </button>
                                        )
                                    ) : (
                                        getEditorTitle()
                                    )}
                                </div>
                            </div>
                        </div>
                        {!isEditingTitle && !inline && (
                            <div className="h-14 flex items-center">
                                <button
                                    type="button"
                                    aria-label="Close binding editor"
                                    onClick={handleAnimatedClose}
                                    className="rounded-sm p-1 text-kb-gray-border dark:text-neutral-400 transition-all hover:text-kb-ink dark:hover:text-kb-ink focus:outline-none focus:text-kb-ink dark:focus:text-kb-ink cursor-pointer"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                        )}

                    </div>
                    {nameError && <p role="alert" className="px-4 text-sm text-red-700 dark:text-red-400">{nameError}</p>}
                    {bindingTypeToEdit === "tapdances" && <TapdanceEditor />}
                    {bindingTypeToEdit === "combos" && <ComboEditor />}
                    {bindingTypeToEdit === "overrides" && <OverrideEditor />}
                    {bindingTypeToEdit === "macros" && <MacroEditor />}
                    {bindingTypeToEdit === "altrepeat" && <AltRepeatEditor />}
                    {bindingTypeToEdit === "leaders" && <LeaderEditor />}

                    {hasContent && (
                        <div className="flex justify-end mt-3">
                            <DelayedTooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        type="button"
                                        aria-label={`Clear ${getEditorTitle()}`}
                                        onClick={() => setIsConfirmOpen(true)}
                                        className="rounded-full p-1 text-kb-gray-border dark:text-neutral-400 transition-all hover:bg-red-500 hover:text-white dark:hover:text-white focus:outline-none cursor-pointer bg-kb-gray-medium"
                                    >
                                        <Trash2 className="h-5 w-5" />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Clear {getEditorTitle()}</p>
                                </TooltipContent>
                            </DelayedTooltip>
                        </div>
                    )}
                </div>
            </div>
            {confirmDialog}
        </div >
    );
};


export default BindingEditorContainer;
