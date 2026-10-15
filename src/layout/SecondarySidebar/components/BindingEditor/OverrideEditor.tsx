import { FC, useState, useEffect } from "react";
import { ArrowRight } from "lucide-react";
import OnOffToggle from "@/components/ui/OnOffToggle";

import { useKeyBinding } from "@/contexts/KeyBindingContext";
import { usePanels } from "@/contexts/PanelsContext";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { DragItem } from "@/contexts/DragContext";
import { cn } from "@/lib/utils";

import OverrideModifierSelector from "./OverrideModifierSelector";
import { KeyOverrideOptions, prepareOverrideForEdit, setOverrideTriggerMods } from "@/utils/key-override";
import type { KeyboardInfo, KeyOverrideEntry } from "@/types/keyboard.types";

const TABS = ["Trigger", "Negative", "Suppressed"] as const;
type TabType = typeof TABS[number];

// Bit meanings: QMK ko_option_t (quantum/process_keycode/process_key_override.h).
// "inverted" options show the opposite of the stored bit, so each label is
// true when its toggle is on.
const OPTIONS = [
    { label: "Activate on Trigger Down", bit: KeyOverrideOptions.ACTIVATION_TRIGGER_DOWN, inverted: false },
    { label: "Activate on Mod Down", bit: KeyOverrideOptions.ACTIVATION_REQUIRED_MOD_DOWN, inverted: false },
    { label: "Activate on Negative Mod Up", bit: KeyOverrideOptions.ACTIVATION_NEGATIVE_MOD_UP, inverted: false },
    { label: "Any One Trigger Mod", bit: KeyOverrideOptions.ONE_MOD, inverted: false },
    { label: "Re-press Trigger Key", bit: KeyOverrideOptions.NO_REREGISTER_TRIGGER, inverted: true },
    { label: "Stay Active on Other Keys", bit: KeyOverrideOptions.NO_UNREGISTER_ON_OTHER_KEY_DOWN, inverted: false },
] as const;





import { useBindingChanges } from "@/hooks/useBindingChanges";
import EditorKey from "./EditorKey";

const OverrideEditor: FC = () => {
    const { keyboard, setKeyboard } = useKeyboard();
    const persistBinding = useBindingChanges();
    const { itemToEdit, setPanelToGoBack, setAlternativeHeader, initialEditorSlot } = usePanels();
    const { selectOverrideKey, selectedTarget } = useKeyBinding();
    const [activeTab, setActiveTab] = useState<TabType>("Trigger");

    const overrideIndex = itemToEdit!;
    const override = keyboard?.key_overrides?.[overrideIndex];

    useEffect(() => {
        selectOverrideKey(overrideIndex, initialEditorSlot || "trigger");
        setPanelToGoBack("overrides");
        setAlternativeHeader(true);
    }, []);

    const isSlotSelected = (slot: "trigger" | "replacement") => {
        return (
            selectedTarget?.type === "override" &&
            selectedTarget.overrideId === overrideIndex &&
            selectedTarget.overrideSlot === slot
        );
    };

    const getActiveMask = () => {
        if (!override) return 0;
        switch (activeTab) {
            case "Trigger": return override.trigger_mods;
            case "Negative": return override.negative_mod_mask;
            case "Suppressed": return override.suppressed_mods;
        }
    };

    // Every edit goes through here, so a blank slot picks up the new
    // override defaults (on, QMK default activations, all layers) on its
    // first change, and opening an empty override changes nothing.
    const cloneForEdit = (): [KeyboardInfo, KeyOverrideEntry] => {
        const updatedKeyboard = structuredClone(keyboard!);
        const ovr = updatedKeyboard.key_overrides![overrideIndex];
        prepareOverrideForEdit(ovr, updatedKeyboard.layers);
        return [updatedKeyboard, ovr];
    };

    const updateMask = async (newMask: number) => {
        if (!keyboard || !override) return;
        const [updatedKeyboard, ovr] = cloneForEdit();
        switch (activeTab) {
            case "Trigger": setOverrideTriggerMods(ovr, newMask); break;
            case "Negative": ovr.negative_mod_mask = newMask; break;
            case "Suppressed": ovr.suppressed_mods = newMask; break;
        }
        setKeyboard(updatedKeyboard);
        await persistBinding(updatedKeyboard, "override", overrideIndex);
    };

    const updateOption = async (bit: number, checked: boolean) => {
        if (!keyboard || !override) return;
        const [updatedKeyboard, ovr] = cloneForEdit();
        if (checked) ovr.options |= bit;
        else ovr.options &= ~bit;
        setKeyboard(updatedKeyboard);
        await persistBinding(updatedKeyboard, "override", overrideIndex);
    };

    const updateLayer = async (layer: number, active: boolean) => {
        if (!keyboard || !override) return;
        const [updatedKeyboard, ovr] = cloneForEdit();
        if (active) ovr.layers = (ovr.layers | (1 << layer)) >>> 0;
        else ovr.layers = (ovr.layers & ~(1 << layer)) >>> 0;
        setKeyboard(updatedKeyboard);
        await persistBinding(updatedKeyboard, "override", overrideIndex);
    };

    const clearKey = async (slot: "trigger" | "replacement") => {
        if (!keyboard || !override) return;
        const updatedKeyboard = structuredClone(keyboard);
        const ovr = updatedKeyboard.key_overrides![overrideIndex];
        if (slot === "trigger") ovr.trigger = "KC_NO";
        else ovr.replacement = "KC_NO";
        setKeyboard(updatedKeyboard);
        await persistBinding(updatedKeyboard, "override", overrideIndex);
    };

    const handleDrop = async (slot: "trigger" | "replacement", item: DragItem) => {
        if (item.editorType === "override" && item.editorId === itemToEdit && item.editorSlot !== undefined) {
            const sourceSlot = item.editorSlot as "trigger" | "replacement";
            const targetSlot = slot;
            if (sourceSlot === targetSlot) return;

            if (!keyboard || !override) return;
            const [updatedKeyboard, ovr] = cloneForEdit();

            const sourceVal = sourceSlot === "trigger" ? ovr.trigger : ovr.replacement;
            const targetVal = targetSlot === "trigger" ? ovr.trigger : ovr.replacement;

            if (sourceSlot === "trigger") ovr.trigger = targetVal;
            else ovr.replacement = targetVal;

            if (targetSlot === "trigger") ovr.trigger = sourceVal;
            else ovr.replacement = sourceVal;

            setKeyboard(updatedKeyboard);
            await persistBinding(updatedKeyboard, "override", overrideIndex);
        } else {
            updateOverrideAssignment(slot, item.keycode);
        }
    };

    const updateOverrideAssignment = async (slot: "trigger" | "replacement", keycode: string) => {
        if (!keyboard || !override) return;
        const [updatedKeyboard, ovr] = cloneForEdit();
        if (slot === "trigger") ovr.trigger = keycode;
        else ovr.replacement = keycode;
        setKeyboard(updatedKeyboard);
        await persistBinding(updatedKeyboard, "override", overrideIndex);
    };

    const currentMask = getActiveMask();

    const renderOverrideKey = (label: string, slot: "trigger" | "replacement") => {
        if (!override) return null;
        const keycode = slot === "trigger" ? override.trigger : override.replacement;
        const isSelected = isSlotSelected(slot);

        return (
            <div className="flex flex-col items-center gap-2 relative">
                <span className="text-sm font-bold text-slate-600 dark:text-neutral-300">{label}</span>
                <EditorKey
                    keycode={keycode}
                    selected={isSelected}
                    onClick={() => selectOverrideKey(overrideIndex, slot)}
                    onClear={() => clearKey(slot)}
                    onDrop={(item) => handleDrop(slot, item)}
                    size="w-[60px] h-[60px]"
                    // OverrideEditor renders trash at "-left-10" which is default for EditorKey
                    trashOffset="-left-10"
                    wrapperClassName="relative w-[60px] h-[60px] group/override-key"
                    variant="default"
                    label={undefined}
                    labelClassName={undefined}
                    editorType="override"
                    editorId={itemToEdit!}
                    editorSlot={slot}
                />
            </div>
        );
    };

    if (!override) return <div className="p-5">Override not found</div>;

    return (
        <div className="flex flex-col gap-2 py-6 pl-10 pb-16">
            {/* Active Switch */}
            {/* Active Toggle */}


            <div className="flex flex-row flex-wrap gap-4 justify-start items-center">
                {renderOverrideKey("Trigger", "trigger")}
                <div className="pt-6 text-kb-ink -mr-1">
                    <ArrowRight className="w-6 h-6" />
                </div>
                {renderOverrideKey("Replacement", "replacement")}
            </div>

            {/* Tabs */}
            <div className="flex flex-row flex-wrap gap-1 items-center bg-gray-200/50 dark:bg-neutral-700/50 p-1 rounded-lg border border-gray-400/50 dark:border-neutral-500/50 w-full mt-4">
                {TABS.map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={cn(
                            "flex-1 min-w-20 px-2 py-1.5 text-xs uppercase tracking-wider rounded-md transition-all font-bold border-none",
                            activeTab === tab
                                ? "bg-kb-active text-kb-active-fg shadow-md"
                                : "text-gray-500 dark:text-neutral-400 hover:text-kb-ink dark:hover:text-kb-ink hover:bg-white/50 dark:hover:bg-neutral-700"
                        )}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            {/* Modifiers Section */}
            <OverrideModifierSelector value={currentMask} onChange={updateMask} />

            {/* Layers Section */}
            <div className="flex flex-col gap-1.5">
                <span className="font-semibold text-lg text-kb-ink">Layers</span>
                <div className="grid grid-cols-[repeat(auto-fit,2.5rem)] gap-2 w-full">
                    {Array.from({ length: 16 }).map((_, i) => {
                        const isActive = (override.layers & (1 << i)) !== 0;
                        return (
                            <div
                                key={i}
                                className={cn(
                                    "w-10 h-10 flex items-center justify-center rounded-md cursor-pointer transition-colors text-sm font-medium",
                                    isActive
                                        ? "bg-kb-active text-kb-active-fg hover:bg-kb-surface dark:hover:bg-neutral-700 hover:text-kb-ink"
                                        : "bg-kb-gray-medium text-slate-700 dark:text-neutral-200 hover:bg-kb-surface dark:hover:bg-neutral-700 hover:text-kb-ink dark:hover:text-kb-ink"
                                )}
                                onClick={() => updateLayer(i, !isActive)}
                            >
                                {i}
                            </div>
                        );
                    })}
                </div>
            </div>



            {/* Options Switches */}
            <div className="flex flex-col gap-1 mt-2">
                {OPTIONS.map((opt) => (
                    <div key={opt.label} className="flex flex-row items-center justify-between py-1">
                        <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-medium text-slate-700 dark:text-neutral-200">{opt.label}</span>
                        </div>
                        <OnOffToggle
                            label={opt.label}
                            value={((override.options & opt.bit) !== 0) !== opt.inverted}
                            onToggle={(val) => updateOption(opt.bit, val !== opt.inverted)}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};

export default OverrideEditor;
