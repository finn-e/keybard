import { FC, ReactNode, useEffect, useId, useState } from "react";
import { ArrowRight } from "lucide-react";
import OnOffToggle from "@/components/ui/OnOffToggle";

import { useKeyBinding } from "@/contexts/KeyBindingContext";
import { usePanels } from "@/contexts/PanelsContext";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { DragItem } from "@/contexts/DragContext";
import { AltRepeatKeyOptions } from "@/types/keyboard.types";
import { useBindingChanges } from "@/hooks/useBindingChanges";
import EditorKey from "./EditorKey";
import { BAR_KEY_PX, BAR_KEY_SIZE, BAR_KEY_VARIANT, BarEnd, BarOptionsButton, BarRow, BarSep, BarSlot } from "./EditorBar";

const OPTIONS = [
    { label: "Default to alternate", bit: AltRepeatKeyOptions.DEFAULT_TO_ALT, description: "Use alternate key as default output" },
    { label: "Bidirectional", bit: AltRepeatKeyOptions.BIDIRECTIONAL, description: "Mapping works both ways" },
    { label: "Ignore mod handedness", bit: AltRepeatKeyOptions.IGNORE_MOD_HANDEDNESS, description: "Ignore left/right modifier distinction" },
] as const;

interface Props {
    /** The compact bar of the side-panel placement, with these controls at the row's end. */
    bar?: boolean;
    barEnd?: ReactNode;
}

const AltRepeatEditor: FC<Props> = ({ bar = false, barEnd }) => {
    const [optionsOpen, setOptionsOpen] = useState(false);
    const optionsId = useId();
    const { keyboard, setKeyboard } = useKeyboard();
    const persistBinding = useBindingChanges();
    const { itemToEdit, setPanelToGoBack, setAlternativeHeader, initialEditorSlot } = usePanels();
    const { selectAltRepeatKey, selectedTarget } = useKeyBinding();

    const altRepeatIndex = itemToEdit!;
    const altRepeatEntry = keyboard?.alt_repeat_keys?.[altRepeatIndex];

    useEffect(() => {
        if (!keyboard?.alt_repeat_keys || itemToEdit === null) return;

        const entry = keyboard.alt_repeat_keys[itemToEdit];
        if (!entry) return;

        selectAltRepeatKey(altRepeatIndex, initialEditorSlot || "keycode");
        setPanelToGoBack("altrepeat");
        setAlternativeHeader(true);
    }, [altRepeatIndex, selectAltRepeatKey, setPanelToGoBack, setAlternativeHeader, initialEditorSlot]);

    const isSlotSelected = (slot: "keycode" | "alt_keycode") => {
        return (
            selectedTarget?.type === "altrepeat" &&
            selectedTarget.altRepeatId === altRepeatIndex &&
            selectedTarget.altRepeatSlot === slot
        );
    };

    const updateOption = async (bit: number, checked: boolean) => {
        if (!keyboard || !altRepeatEntry) return;
        const updatedKeyboard = structuredClone(keyboard);
        let options = updatedKeyboard.alt_repeat_keys![altRepeatIndex].options;
        if (checked) options |= bit;
        else options &= ~bit;
        updatedKeyboard.alt_repeat_keys![altRepeatIndex].options = options;
        setKeyboard(updatedKeyboard);

        await persistBinding(updatedKeyboard, "altrepeat", altRepeatIndex);
    };

    const clearKey = async (slot: "keycode" | "alt_keycode") => {
        if (!keyboard || !altRepeatEntry) return;
        const updatedKeyboard = structuredClone(keyboard);
        updatedKeyboard.alt_repeat_keys![altRepeatIndex][slot] = "KC_NO";
        setKeyboard(updatedKeyboard);

        await persistBinding(updatedKeyboard, "altrepeat", altRepeatIndex);
    };

    const handleDrop = async (slot: "keycode" | "alt_keycode", item: DragItem) => {
        if (!keyboard || !altRepeatEntry) return;

        const updatedKeyboard = structuredClone(keyboard);

        if (item.editorType === "altrepeat" && item.editorId === itemToEdit && item.editorSlot !== undefined) {
            const sourceSlot = item.editorSlot as "keycode" | "alt_keycode";
            const targetSlot = slot;
            if (sourceSlot === targetSlot) return;

            const entry = updatedKeyboard.alt_repeat_keys![altRepeatIndex];
            const sourceVal = entry[sourceSlot];
            const targetVal = entry[targetSlot];

            entry[sourceSlot] = targetVal;
            entry[targetSlot] = sourceVal;
        } else {
            updatedKeyboard.alt_repeat_keys![altRepeatIndex][slot] = item.keycode;
        }

        setKeyboard(updatedKeyboard);

        await persistBinding(updatedKeyboard, "altrepeat", altRepeatIndex);
    };

    if (!altRepeatEntry) return <div className="p-5">Alt-repeat entry not found</div>;

    const optionsList = (
        <div className="flex flex-col gap-1">
            {OPTIONS.map((opt) => (
                <div key={opt.bit} className="flex flex-row items-center justify-between gap-3 py-1">
                    <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-sm font-medium text-slate-700 dark:text-neutral-200">{opt.label}</span>
                        <span className="text-xs text-slate-500 dark:text-neutral-400">{opt.description}</span>
                    </div>
                    <OnOffToggle
                        label={opt.label}
                        value={(altRepeatEntry?.options & opt.bit) !== 0}
                        onToggle={(val) => updateOption(opt.bit, val)}
                    />
                </div>
            ))}
        </div>
    );

    if (bar) {
        const slot = (label: string, slotName: "keycode" | "alt_keycode") => (
            <BarSlot label={label}>
                <EditorKey
                    keycode={altRepeatEntry[slotName]}
                    selected={isSlotSelected(slotName)}
                    onClick={() => selectAltRepeatKey(altRepeatIndex, slotName)}
                    onClear={() => clearKey(slotName)}
                    onDrop={(item) => handleDrop(slotName, item)}
                    size={BAR_KEY_SIZE}
                    trashCorner
                    unitSize={BAR_KEY_PX}
                    variant={BAR_KEY_VARIANT}
                    wrapperClassName={`relative ${BAR_KEY_SIZE}`}
                    editorType="altrepeat"
                    editorId={itemToEdit!}
                    editorSlot={slotName}
                />
            </BarSlot>
        );
        return (
            <div className="flex flex-col gap-2">
                <BarRow label="Alt-repeat keys">
                    {slot("Trigger", "keycode")}
                    <BarSep><ArrowRight /></BarSep>
                    {slot("Alternate", "alt_keycode")}
                    <BarEnd>
                        <BarOptionsButton open={optionsOpen} onToggle={() => setOptionsOpen(o => !o)} controls={optionsId} />
                        {barEnd}
                    </BarEnd>
                </BarRow>
                {optionsOpen && <div id={optionsId} className="border-t border-kb-gray-border/40 pt-1">{optionsList}</div>}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2 py-6 pl-10 pb-20">

            {/* Key Slots */}
            <div className="flex flex-row flex-wrap gap-4 justify-start items-center">
                <div className="flex flex-col items-center gap-2 relative">
                    <span className="text-sm font-bold text-slate-600 dark:text-neutral-300">Trigger</span>
                    <EditorKey
                        keycode={altRepeatEntry.keycode}
                        selected={isSlotSelected("keycode")}
                        onClick={() => selectAltRepeatKey(altRepeatIndex, "keycode")}
                        onClear={() => clearKey("keycode")}
                        onDrop={(item) => handleDrop("keycode", item)}
                        editorType="altrepeat"
                        editorId={itemToEdit!}
                        editorSlot="keycode"
                    />
                </div>
                <div className="pt-6 text-kb-ink -mr-1">
                    <ArrowRight className="w-6 h-6" />
                </div>
                <div className="flex flex-col items-center gap-2 relative">
                    <span className="text-sm font-bold text-slate-600 dark:text-neutral-300">Alternate</span>
                    <EditorKey
                        keycode={altRepeatEntry.alt_keycode}
                        selected={isSlotSelected("alt_keycode")}
                        onClick={() => selectAltRepeatKey(altRepeatIndex, "alt_keycode")}
                        onClear={() => clearKey("alt_keycode")}
                        onDrop={(item) => handleDrop("alt_keycode", item)}
                        editorType="altrepeat"
                        editorId={itemToEdit!}
                        editorSlot="alt_keycode"
                    />
                </div>
            </div>

            {/* Options Switches */}
            <div className="flex flex-col gap-1 mt-2">
                <span className="font-semibold text-lg text-kb-ink">Options</span>
                {OPTIONS.map((opt) => (
                    <div key={opt.bit} className="flex flex-row items-center justify-between py-1">
                        <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-medium text-slate-700 dark:text-neutral-200">{opt.label}</span>
                            <span className="text-xs text-slate-500 dark:text-neutral-400">{opt.description}</span>
                        </div>
                        <OnOffToggle
                            value={(altRepeatEntry?.options & opt.bit) !== 0}
                            onToggle={(val) => updateOption(opt.bit, val)}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};

export default AltRepeatEditor;
