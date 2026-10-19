import { FC, ReactNode, useEffect } from "react";
import { ArrowRight, ArrowRightFromLine } from "lucide-react";

import { useKeyBinding } from "@/contexts/KeyBindingContext";
import { useLayoutSettings } from "@/contexts/LayoutSettingsContext";
import { usePanels } from "@/contexts/PanelsContext";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { DragItem } from "@/contexts/DragContext";
import { cn } from "@/lib/utils";
import { useBindingChanges } from "@/hooks/useBindingChanges";
import EditorKey from "./EditorKey";
import { BAR_KEY_PX, BAR_KEY_SIZE, BAR_KEY_VARIANT, BarEnd, BarRow, BarSep, BarSlot } from "./EditorBar";

interface Props {
    /** The compact bar of the side-panel placement, with these controls at the row's end. */
    bar?: boolean;
    barEnd?: ReactNode;
}

const LeaderEditor: FC<Props> = ({ bar = false, barEnd }) => {
    const { keyboard, setKeyboard } = useKeyboard();
    const persistBinding = useBindingChanges();
    const { itemToEdit, setPanelToGoBack, setAlternativeHeader, initialEditorSlot } = usePanels();
    const { selectLeaderKey, selectedTarget } = useKeyBinding();
    const { layoutMode } = useLayoutSettings();

    const isHorizontal = layoutMode === "bottombar";
    const seqKeySize = bar ? BAR_KEY_SIZE : isHorizontal ? "w-[45px] h-[45px]" : "w-[50px] h-[50px]";
    const outputKeySize = seqKeySize;
    const keyVariant = bar ? BAR_KEY_VARIANT : isHorizontal ? "medium" : "default";

    const leaderIndex = itemToEdit!;
    const leaderEntry = keyboard?.leaders?.[leaderIndex];

    useEffect(() => {
        if (!keyboard?.leaders || itemToEdit === null) return;

        const entry = keyboard.leaders[itemToEdit];
        if (!entry) return;

        if (initialEditorSlot) {
            if (initialEditorSlot.type === "sequence") {
                selectLeaderKey(leaderIndex, "sequence", initialEditorSlot.index ?? 0);
            } else {
                selectLeaderKey(leaderIndex, "output");
            }
        } else {
            selectLeaderKey(leaderIndex, "sequence", 0);
        }
        setPanelToGoBack("leaders");
        setAlternativeHeader(true);
    }, [leaderIndex, selectLeaderKey, setPanelToGoBack, setAlternativeHeader, initialEditorSlot]);

    const isSlotSelected = (slot: "sequence" | "output", seqIndex?: number) => {
        return (
            selectedTarget?.type === "leaders" &&
            selectedTarget.leaderId === leaderIndex &&
            selectedTarget.leaderSlot === slot &&
            (slot === "output" || selectedTarget.leaderSeqIndex === seqIndex)
        );
    };

    const handleDrop = async (slot: "sequence" | "output", item: DragItem, seqIndex?: number) => {
        if (item.editorType === "leader" && item.editorId === itemToEdit && item.editorSlot !== undefined) {
            const sourceSlot = item.editorSlot as string | number; // "output" or number (index)
            const targetSlot: string | number = slot === "output" ? "output" : seqIndex!;

            if (sourceSlot === targetSlot) return;

            if (!keyboard || !leaderEntry) return;
            const updatedKeyboard = structuredClone(keyboard);
            const entry = updatedKeyboard.leaders![leaderIndex];

            // Helper to get/set value
            const getValue = (s: string | number) => {
                if (s === "output") return entry.output;
                return entry.sequence[s as number];
            };
            const setValue = (s: string | number, val: string) => {
                if (s === "output") entry.output = val;
                else entry.sequence[s as number] = val;
            };

            const sourceVal = getValue(sourceSlot);
            const targetVal = getValue(targetSlot);

            setValue(sourceSlot, targetVal);
            setValue(targetSlot, sourceVal);

            setKeyboard(updatedKeyboard);
            await persistBinding(updatedKeyboard, "leader", leaderIndex);
        } else {
            updateLeaderAssignment(slot, item.keycode, seqIndex);
        }
    };

    const updateLeaderAssignment = async (slot: "sequence" | "output", keycode: string, seqIndex?: number) => {
        if (!keyboard || !leaderEntry) return;
        const updatedKeyboard = structuredClone(keyboard);
        const entry = updatedKeyboard.leaders![leaderIndex];

        if (slot === "sequence" && seqIndex !== undefined) {
            entry.sequence[seqIndex] = keycode;
        } else if (slot === "output") {
            entry.output = keycode;
        }

        setKeyboard(updatedKeyboard);
        await persistBinding(updatedKeyboard, "leader", leaderIndex);
    };

    const clearKey = async (slot: "sequence" | "output", seqIndex?: number) => {
        if (!keyboard || !leaderEntry) return;
        const updatedKeyboard = structuredClone(keyboard);

        if (slot === "sequence" && seqIndex !== undefined) {
            // Remove the key at seqIndex and shift remaining keys left
            const seq = updatedKeyboard.leaders![leaderIndex].sequence;
            seq.splice(seqIndex, 1);
            // Pad back to 5 with KC_NO
            while (seq.length < 5) {
                seq.push("KC_NO");
            }
        } else if (slot === "output") {
            updatedKeyboard.leaders![leaderIndex].output = "KC_NO";
        }

        setKeyboard(updatedKeyboard);

        await persistBinding(updatedKeyboard, "leader", leaderIndex);
    };

    const renderSequenceKey = (seqIndex: number) => {
        if (!leaderEntry) return null;
        const keycode = leaderEntry.sequence?.[seqIndex] || "KC_NO";
        const isSelected = isSlotSelected("sequence", seqIndex);

        return (
            <div className="flex flex-col items-center gap-1 relative">
                {!bar && <span className={cn("font-medium text-kb-ink", isHorizontal ? "text-[10px]" : "text-xs")}>{seqIndex + 1}</span>}
                <EditorKey
                    trashCorner={bar}
                    unitSize={bar ? BAR_KEY_PX : undefined}
                    keycode={keycode}
                    selected={isSelected}
                    onClick={() => selectLeaderKey(leaderIndex, "sequence", seqIndex)}
                    onClear={() => clearKey("sequence", seqIndex)}
                    onDrop={(item) => handleDrop("sequence", item, seqIndex)}
                    size={seqKeySize}
                    // LeaderEditor sets trash top -2 right -2 which is different from default EditorKey
                    // EditorKey uses top-0 left-offset. 
                    // Let's stick to EditorKey default (left offset) for consistency, unless it breaks layout.
                    // The original used: "absolute -top-2 -right-2".
                    // EditorKey default is: "absolute -left-10 top-0".
                    // Let's try to override to match original if possible, but EditorKey trash is hard elements.
                    // Maybe just accept the new cleaner left-side trash? 
                    // Wait, sequence keys in sidebar might be tight.
                    // Original sidebar layout: `flex flex-row flex-wrap gap-4 items-end`.
                    // Keys are 50x50. Left trash (-left-10 = -2.5rem = -40px) might overlap previous key.
                    // Let's check visual overlap.
                    // Sequence: Key1 -> arrow -> Key2.
                    // If Key2 has trash on left, it might overlap arrow or Key1.
                    // Let's try to keep the original "top right" style by using classes, IF EditorKey allows.
                    // EditorKey structure: relative wrapper -> Key -> Trash holder.
                    // Trash holder class: `absolute ${trashOffset} top-0 h-full ...`
                    // I can pass `trashOffset="-right-2"` but top is fixed to `top-0`.
                    // Original was `-top-2 -right-2`.
                    // To support top offset, EditorKey would need updating.
                    // Let's just use the default left trash for now and see. 
                    // Actually, for "sequence" items which are in a row, left trash is risky.
                    // But also top-right trash often overlaps with the label or header of the *next* key or similar.
                    // Let's assume standard left trash is OK for "cleaner code" goal, uniformity.
                    variant={keyVariant}
                    wrapperClassName={`relative ${seqKeySize} group/leader-key`}
                    // We render label externally to control styling
                    label={undefined}
                    labelClassName={undefined}
                    editorType="leader"
                    editorId={itemToEdit!}
                    editorSlot={seqIndex}
                />
            </div>
        );
    };

    const renderOutputKey = () => {
        if (!leaderEntry) return null;
        const keycode = leaderEntry.output || "KC_NO";
        const isSelected = isSlotSelected("output");
        const trashOffset = isHorizontal ? "-left-8" : "-left-10";
        const trashSize = isHorizontal ? "w-3 h-3" : "w-4 h-4";

        return (
            <div className="flex flex-col items-center gap-1 relative">
                {!bar && <span className={cn("font-bold text-slate-600 dark:text-neutral-300", isHorizontal ? "text-xs" : "text-sm")}>Output</span>}
                <EditorKey
                    trashCorner={bar}
                    unitSize={bar ? BAR_KEY_PX : undefined}
                    keycode={keycode}
                    selected={isSelected}
                    onClick={() => selectLeaderKey(leaderIndex, "output")}
                    onClear={() => clearKey("output")}
                    onDrop={(item) => handleDrop("output", item)}
                    size={outputKeySize}
                    trashOffset={trashOffset}
                    trashSize={trashSize}
                    wrapperClassName={`relative ${outputKeySize} group/leader-output`}
                    variant={keyVariant}
                    label={undefined}
                    labelClassName={undefined}
                    editorType="leader"
                    editorId={itemToEdit!}
                    editorSlot="output"
                />
            </div>
        );
    };

    if (!leaderEntry) return <div className="p-5">Leader entry not found</div>;

    // Count how many sequence keys are filled
    const filledKeys = leaderEntry.sequence?.filter(k => k && k !== "KC_NO").length || 0;

    // Bar: the sequence so far plus one empty slot, then the output; controls at the end.
    if (bar) {
        return (
            <BarRow label="Leader sequence">
                {[0, 1, 2, 3, 4].filter(idx => idx <= filledKeys).map((idx) => [
                    idx > 0 && <BarSep key={`sep${idx}`}><ArrowRight /></BarSep>,
                    <BarSlot key={idx} label={`Key ${idx + 1}`}>{renderSequenceKey(idx)}</BarSlot>,
                ])}
                <BarSep><ArrowRightFromLine /></BarSep>
                <BarSlot label="Output">{renderOutputKey()}</BarSlot>
                <BarEnd>{barEnd}</BarEnd>
            </BarRow>
        );
    }

    // ==========================================
    // HORIZONTAL LAYOUT (Bottom Bar Mode)
    // ==========================================
    if (isHorizontal) {
        return (
            <div className="flex flex-col gap-1 px-4 py-2">
                {/* Keys row */}
                <div className="flex flex-row flex-wrap items-center gap-4">
                    {/* Sequence Keys */}
                    <div className="flex flex-row flex-wrap gap-1 items-end">
                        {[0, 1, 2, 3, 4].map((idx) => {
                            if (idx > filledKeys) return null;
                            return (
                                <div key={idx} className="flex items-center gap-0.5">
                                    {idx > 0 && <ArrowRight className="w-3 h-3 text-gray-400 dark:text-neutral-400" />}
                                    {renderSequenceKey(idx)}
                                </div>
                            );
                        })}
                    </div>

                    <ArrowRight className="w-5 h-5 text-gray-600 dark:text-neutral-300 flex-shrink-0" />

                    {/* Output Key */}
                    {renderOutputKey()}
                </div>

                {/* Info - below the keys */}
                <div className="text-xs text-muted-foreground">
                    Press Leader key, then type this sequence to trigger output.
                </div>
            </div>
        );
    }

    // ==========================================
    // VERTICAL LAYOUT (Sidebar Mode)
    // ==========================================
    return (
        <div className="flex flex-col gap-8 py-6 pl-10 pb-20">
            {/* Sequence & Output Keys */}
            <div className="flex flex-col gap-3">
                <span className="font-semibold text-sm text-slate-600 dark:text-neutral-300">Sequence (up to 5 keys)</span>
                <div className="flex flex-row flex-wrap gap-4 items-end">
                    {[0, 1, 2, 3, 4].map((idx) => {
                        // Only show slots up to filledKeys + 1 (to allow adding one more)
                        if (idx > filledKeys) return null;
                        return (
                            <div key={idx} className="flex flex-row items-end gap-4">
                                {idx > 0 && (
                                    <div className="h-[50px] flex items-center justify-center translate-y-1 translate-x-1">
                                        <ArrowRight className="w-5 h-5 text-kb-ink" />
                                    </div>
                                )}
                                {renderSequenceKey(idx)}
                            </div>
                        );
                    })}

                    {/* Output Key on same line */}
                    <div className="flex flex-row gap-4 items-end">
                        <div className="h-[50px] flex items-center justify-center translate-y-1 translate-x-1">
                            <ArrowRightFromLine className="w-5 h-5 text-kb-ink" />
                        </div>
                        {renderOutputKey()}
                    </div>
                </div>
            </div>

            {/* Info */}
            <div className="text-xs text-muted-foreground mt-2">
                Press the Leader key, then type this sequence to trigger the output keycode.
            </div>
        </div>
    );
};

export default LeaderEditor;
