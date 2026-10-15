import { FC, ReactNode, useEffect } from "react";
import { ArrowRightFromLine, Plus } from "lucide-react";

import { useKeyBinding } from "@/contexts/KeyBindingContext";
import { usePanels } from "@/contexts/PanelsContext";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { useLayoutSettings } from "@/contexts/LayoutSettingsContext";
import { DragItem } from "@/contexts/DragContext";
import { useBindingChanges } from "@/hooks/useBindingChanges";

import EditorKey from "./EditorKey";
import { BAR_KEY_PX, BAR_KEY_SIZE, BAR_KEY_VARIANT, BarEnd, BarRow, BarSep, BarSlot } from "./EditorBar";
import { ComboEntry } from "@/types/keyboard.types";

interface ComboEditorProps {
    /** One compact row for the underslung placements (dock, anchored, float). */
    strip?: boolean;
    /** The compact bar of the side-panel placement, with these controls at the row's end. */
    bar?: boolean;
    barEnd?: ReactNode;
}

const ComboEditor: FC<ComboEditorProps> = ({ strip = false, bar = false, barEnd }) => {
    const { keyboard, setKeyboard } = useKeyboard();
    const persistBinding = useBindingChanges();
    const { setPanelToGoBack, setAlternativeHeader, itemToEdit, initialEditorSlot } = usePanels();
    const { selectComboKey, selectedTarget } = useKeyBinding();
    const { layoutMode } = useLayoutSettings();
    const isHorizontal = layoutMode === "bottombar";
    const isCompact = strip || isHorizontal;
    const keySize = bar ? BAR_KEY_SIZE : isCompact ? "w-[45px] h-[45px]" : "w-[50px] h-[50px]";
    const keyVariant = bar ? BAR_KEY_VARIANT : isCompact ? "medium" : "default";

    // Fix type assertion
    const currCombo = keyboard?.combos?.[itemToEdit!] as ComboEntry;

    // Check if a specific combo slot is selected
    const isSlotSelected = (slot: number) => {
        return selectedTarget?.type === "combo" && selectedTarget.comboId === itemToEdit && selectedTarget.comboSlot === slot;
    };

    useEffect(() => {
        setPanelToGoBack("combos");
        setAlternativeHeader(true);
    }, [setPanelToGoBack, setAlternativeHeader]);

    // Auto-select the first key slot whenever the itemToEdit changes
    useEffect(() => {
        if (itemToEdit !== null) {
            selectComboKey(itemToEdit, initialEditorSlot ?? 0);
        }
    }, [itemToEdit, selectComboKey, initialEditorSlot]);

    const handleDrop = async (slot: number, item: DragItem) => {
        if (!keyboard?.combos || itemToEdit === null) return;

        // Check if we should swap (dragging from same combo editor)
        if (item.editorType === "combo" && item.editorId === itemToEdit && item.editorSlot !== undefined) {
            const sourceSlot = item.editorSlot as number;
            const targetSlot = slot;

            if (sourceSlot === targetSlot) return;

            const combos = [...keyboard.combos];

            if (combos[itemToEdit]) {
                const combo = { ...combos[itemToEdit] };
                const newKeys = [...combo.keys];

                // Get values
                const sourceVal = sourceSlot < 4 ? newKeys[sourceSlot] : combo.output;
                const targetVal = targetSlot < 4 ? newKeys[targetSlot] : combo.output;

                // Set values (Swap)
                if (sourceSlot < 4) newKeys[sourceSlot] = targetVal;
                else combo.output = targetVal;

                if (targetSlot < 4) newKeys[targetSlot] = sourceVal;
                else combo.output = sourceVal;

                combo.keys = newKeys;
                combos[itemToEdit] = combo;
            }
            const updatedKeyboard = { ...keyboard, combos };
            setKeyboard(updatedKeyboard);
            await persistBinding(updatedKeyboard, "combo", itemToEdit);
        } else {
            // Standard assignment (replace)
            const combos = [...keyboard.combos];
            if (combos[itemToEdit]) {
                const combo = { ...combos[itemToEdit] };
                if (slot < 4) {
                    const newKeys = [...combo.keys];
                    newKeys[slot] = item.keycode;
                    combo.keys = newKeys;
                } else {
                    combo.output = item.keycode;
                }
                combos[itemToEdit] = combo;
            }
            const updatedKeyboard = { ...keyboard, combos };
            setKeyboard(updatedKeyboard);
            await persistBinding(updatedKeyboard, "combo", itemToEdit);
        }
    };

    const updateComboAssignment = async (slot: number, keycode: string) => {
        if (!keyboard?.combos || itemToEdit === null) return;
        const combos = [...keyboard.combos];
        if (combos[itemToEdit]) {
            const combo = { ...combos[itemToEdit] };
            if (slot < 4) {
                const newKeys = [...combo.keys];
                newKeys[slot] = keycode;
                combo.keys = newKeys;
            } else {
                combo.output = keycode;
            }
            combos[itemToEdit] = combo;
        }
        const updatedKeyboard = { ...keyboard, combos };
        setKeyboard(updatedKeyboard);
        await persistBinding(updatedKeyboard, "combo", itemToEdit);
    };

    const renderComboKey = (keycode: string, slot: number) => {
        const isSelected = isSlotSelected(slot);
        const trashOffset = strip ? "-left-7" : isHorizontal ? "-left-8" : "-left-9";
        const trashSize = isCompact ? "w-3 h-3" : "w-4 h-4";

        return (
            <div className="flex flex-col items-center gap-1" role="group" aria-label={slot < 4 ? `Trigger key ${slot + 1}` : "Combo output"}>
                <EditorKey
                    keycode={keycode}
                    selected={isSelected}
                    onClick={() => selectComboKey(itemToEdit!, slot)}
                    onClear={() => {
                        selectComboKey(itemToEdit!, slot);
                        setTimeout(() => updateComboAssignment(slot, "KC_NO"), 0);
                    }}
                    onDrop={(item) => {
                        handleDrop(slot, item);
                    }}
                    size={keySize}
                    trashOffset={trashOffset}
                    trashSize={trashSize}
                    variant={keyVariant}
                    wrapperClassName={`relative ${keySize} group/key z-20`}
                    trashCorner={bar}
                    unitSize={bar ? BAR_KEY_PX : undefined}
                    // We don't use the built-in EditorKey label, we render it externally for consistent positioning in grid
                    label={undefined}
                    labelClassName={undefined}
                    editorType="combo"
                    editorId={itemToEdit!}
                    editorSlot={slot}
                />
            </div>
        );
    };

    if (!currCombo) return <div className="p-5">Combo entry not found</div>;

    // Bar: [k1] + [k2] + [k3] + [k4] -> output, labeled, controls at the end.
    if (bar) {
        return (
            <BarRow label="Combo keys">
                {[0, 1, 2, 3].map((slotIdx) => [
                    slotIdx > 0 && <BarSep key={`sep${slotIdx}`}><Plus /></BarSep>,
                    <BarSlot key={slotIdx} label={`Key ${slotIdx + 1}`}>{renderComboKey(currCombo.keys[slotIdx], slotIdx)}</BarSlot>,
                ])}
                <BarSep><ArrowRightFromLine /></BarSep>
                <BarSlot label="Output">{renderComboKey(currCombo.output, 4)}</BarSlot>
                <BarEnd>{barEnd}</BarEnd>
            </BarRow>
        );
    }

    // Strip layout: one compact row, [k1] + [k2] + [k3] + [k4] -> output.
    // It wraps between keys when the space is narrow.
    if (strip) {
        return (
            <div className="combo-strip flex flex-row flex-wrap items-center gap-x-2 gap-y-2 px-2 py-1" aria-label="Combo keys">
                {[0, 1, 2, 3].map((slotIdx) => (
                    <div key={slotIdx} className="flex flex-row items-center gap-2">
                        {slotIdx > 0 && <Plus aria-hidden="true" className="w-4 h-4 shrink-0 text-kb-ink" />}
                        {renderComboKey(currCombo.keys[slotIdx], slotIdx)}
                    </div>
                ))}
                <div className="flex flex-row items-center gap-2">
                    <ArrowRightFromLine aria-hidden="true" className="w-4 h-4 shrink-0 text-kb-ink" />
                    {renderComboKey(currCombo.output, 4)}
                </div>
            </div>
        );
    }

    // Horizontal layout: 2x2 grid of input keys + arrow + output
    if (isHorizontal) {
        return (
            <div className="flex flex-row flex-wrap items-center gap-4 pl-8 pr-2 py-3">
                <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-500 dark:text-neutral-400 mb-1">Input Keys</span>
                    <div className="grid grid-cols-2 gap-2">
                        {renderComboKey(currCombo.keys[0], 0)}
                        {renderComboKey(currCombo.keys[1], 1)}
                        {renderComboKey(currCombo.keys[2], 2)}
                        {renderComboKey(currCombo.keys[3], 3)}
                    </div>
                </div>
                <ArrowRightFromLine className="h-5 w-5 flex-shrink-0 text-gray-600 dark:text-neutral-300" />
                <div className="flex flex-col items-center">
                    <span className="text-xs font-medium text-slate-500 dark:text-neutral-400 mb-1">Output</span>
                    {renderComboKey(currCombo.output, 4)}
                </div>
            </div>
        );
    }

    // ==========================================
    // VERTICAL BAR MODE (Sidebar)
    // ==========================================

    return (
        <div className="flex flex-col gap-8 py-6 pl-10 pb-20">
            <div className="flex flex-col gap-3">
                <div className="flex flex-row flex-wrap gap-4 items-end">
                    {[0, 1, 2, 3].map((slotIdx) => (
                        <div key={slotIdx} className="flex flex-row items-end gap-4">
                            {slotIdx > 0 && (
                                <div className="h-[50px] flex items-center justify-center translate-y-1 translate-x-1">
                                    <Plus className="w-5 h-5 text-kb-ink" />
                                </div>
                            )}
                            {renderComboKey(currCombo.keys[slotIdx], slotIdx)}
                        </div>
                    ))}

                    {/* Output Key */}
                    <div className="flex flex-row gap-4 items-end">
                        <div className="h-[50px] flex items-center justify-center translate-y-1 translate-x-1">
                            <ArrowRightFromLine className="w-5 h-5 text-kb-ink" />
                        </div>
                        <div className="flex flex-col items-center gap-1 relative">
                            <span className="font-bold text-slate-600 dark:text-neutral-300 text-sm">Output</span>
                            {renderComboKey(currCombo.output, 4)}
                        </div>
                    </div>
                </div>
            </div>

            {/* Info */}
            <div className="text-xs text-muted-foreground mt-2">
                Set 2-4 keys to press simultaneously to get the output key.
            </div>
        </div>
    );
};

export default ComboEditor;
