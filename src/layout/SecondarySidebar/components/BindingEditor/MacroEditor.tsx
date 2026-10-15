import { FC, ReactNode, useEffect, useState, useRef } from "react";

import PlusIcon from "@/components/icons/Plus";
import { useKeyBinding } from "@/contexts/KeyBindingContext";
import { usePanels } from "@/contexts/PanelsContext";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { DragItem } from "@/contexts/DragContext";
import { MacroAction } from "@/types/keyboard.types";
import { ArrowDown, ArrowRight, Plus, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import MacroEditorKey from "./MacroEditorKey";
import MacroEditorText from "./MacroEditorText";
import { useBindingChanges } from "@/hooks/useBindingChanges";
import { isEditorInput } from "@/utils/editor-input";
import EditorKey from "./EditorKey";
import { BAR_KEY_PX, BAR_KEY_SIZE, BAR_KEY_VARIANT, BarEnd, BarRow, BarSep, BarSlot } from "./EditorBar";

const ADD_TYPES = [
    { type: "tap", label: "Key Tap" },
    { type: "down", label: "Key Down" },
    { type: "up", label: "Key Up" },
    { type: "text", label: "Text" },
    { type: "delay", label: "Delay" },
] as const;

interface Props {
    /** The compact bar of the side-panel placement, with these controls at the row's end. */
    bar?: boolean;
    barEnd?: ReactNode;
}

/** A text or delay action's field in the bar, with a remove button on hover. */
const BarTextAction: FC<{ type: string; value: string | number; onChange: (value: string) => void; onDelete: () => void; autoFocus: boolean }> = ({ type, value, onChange, onDelete, autoFocus }) => {
    const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
    useEffect(() => {
        if (autoFocus && ref.current) {
            ref.current.focus();
            const len = String(value).length;
            ref.current.setSelectionRange?.(len, len);
        }
    }, [autoFocus]);
    const label = type === "delay" ? "Delay (ms)" : "Text";
    return (
        <BarSlot label={label}>
            <div className="relative group/action">
                {type === "text" ? (
                    <Textarea
                        ref={ref}
                        aria-label="Macro text"
                        rows={1}
                        value={String(value)}
                        onChange={(e) => onChange(e.target.value)}
                        className="w-36 min-h-10 resize-none px-2 py-2 bg-kb-surface text-kb-ink text-sm select-text"
                    />
                ) : (
                    <Input
                        ref={ref}
                        aria-label="Macro delay in milliseconds"
                        value={String(value)}
                        onChange={(e) => onChange(e.target.value)}
                        className="w-16 h-10 px-1 text-center bg-kb-surface text-kb-ink text-sm select-text"
                    />
                )}
                <button
                    type="button"
                    aria-label={`Remove ${label.toLowerCase()}`}
                    onClick={onDelete}
                    className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-kb-gray-medium text-gray-400 dark:text-neutral-400 hover:bg-red-500 hover:text-white opacity-0 group-hover/action:opacity-100 focus-visible:opacity-100 transition-opacity"
                >
                    <X className="w-3 h-3" />
                </button>
            </div>
        </BarSlot>
    );
};

const MacroEditor: FC<Props> = ({ bar = false, barEnd }) => {
    const [actions, setActions] = useState<MacroAction[]>([]);
    const [focusIndex, setFocusIndex] = useState<number | null>(null);
    const hasAppliedInitialSelection = useRef(false);
    const { keyboard, setKeyboard } = useKeyboard();
    const { itemToEdit, setPanelToGoBack, setAlternativeHeader, initialEditorSlot } = usePanels();
    const { selectComboKey: _selectComboKey, selectMacroKey, selectedTarget, clearSelection } = useKeyBinding();
    const persistBinding = useBindingChanges();

    useEffect(() => {
        setPanelToGoBack("macros");
        setAlternativeHeader(true);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!e.defaultPrevented && !isEditorInput(e.target) && (e.key === "Delete" || e.key === "Backspace")) {
                e.preventDefault();
                // Ensure we are not typing in an input
                const target = e.target as HTMLElement;
                if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

                if (selectedTarget && selectedTarget.type === "macro" && selectedTarget.macroId === itemToEdit) {
                    const indexToDelete = selectedTarget.macroIndex;
                    if (indexToDelete !== undefined && indexToDelete >= 0 && indexToDelete < actions.length) {
                        e.preventDefault();
                        const newActions = actions.map(action => [...action] as MacroAction);
                        newActions.splice(indexToDelete, 1);
                        void updateActions(newActions);
                        clearSelection();
                    }
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedTarget, actions, itemToEdit, clearSelection]);

    // Load macros
    useEffect(() => {
        if (!keyboard?.macros || itemToEdit === null) return;
        const currMacro = keyboard.macros[itemToEdit];
        const newActions = currMacro?.actions || [];

        // Only update local state if different from keyboard state
        if (JSON.stringify(newActions) !== JSON.stringify(actions)) {
            setActions(newActions);
        }
    }, [itemToEdit, keyboard]);

    // Reset initial selection flag when itemToEdit changes
    useEffect(() => {
        hasAppliedInitialSelection.current = false;
    }, [itemToEdit]);

    // Handle initial selection
    useEffect(() => {
        if (initialEditorSlot !== null && initialEditorSlot !== undefined && actions.length > 0 && !hasAppliedInitialSelection.current) {
            const index = initialEditorSlot;
            const action = actions[index];
            if (action) {
                hasAppliedInitialSelection.current = true;
                const [type] = action;
                if (["text", "delay"].includes(type)) {
                    setFocusIndex(index);
                    selectMacroKey(itemToEdit!, -1) // Clear key selection if any
                } else {
                    selectMacroKey(itemToEdit!, index);
                    setFocusIndex(null);
                }
            }
        }
    }, [initialEditorSlot, actions, itemToEdit, selectMacroKey]);

    // Manual helper to update both local state and keyboard context
    const updateActions = async (newActions: MacroAction[]) => {
        setActions(newActions);

        if (!keyboard || itemToEdit === null) return;

        const updatedKeyboard = { ...keyboard };

        // Properly shallow copy the macros array
        if (!updatedKeyboard.macros) {
            updatedKeyboard.macros = [];
        } else {
            updatedKeyboard.macros = [...updatedKeyboard.macros];
        }

        updatedKeyboard.macros[itemToEdit] = {
            ...(updatedKeyboard.macros[itemToEdit] || {}),
            mid: itemToEdit,
            actions: newActions,
        };
        setKeyboard(updatedKeyboard);

        await persistBinding(updatedKeyboard, "macro", itemToEdit);
    };

    const handleAddItem = (type: string) => {
        const newAction: MacroAction = [type, ""];
        const newActions: MacroAction[] = [...actions, newAction];
        updateActions(newActions);

        if (["down", "up", "tap"].includes(type)) {
            // Need to update local selection context after state update
            setTimeout(() => {
                selectMacroKey(itemToEdit!, newActions.length - 1);
            }, 0);
        } else if (["text", "delay"].includes(type)) {
            setFocusIndex(newActions.length - 1);
        }
    };

    const handleDeleteItem = (index: number) => {
        const newActions = actions.map(action => [...action] as MacroAction);
        newActions.splice(index, 1);
        updateActions(newActions);
        clearSelection();
    };

    const handleTextChange = (index: number, value: string | number) => {
        const newActions = actions.map(action => [...action] as MacroAction);
        newActions[index][1] = value;
        updateActions(newActions);
    };

    const AddButton = ({ type, label }: { type: string; label: string }) => {
        return (
            <button
                className="bg-kb-active cursor-pointer text-kb-active-fg pl-[19px] pr-[22px] py-2 rounded-full hover:bg-gray-600 dark:hover:bg-neutral-300 transition flex flex-row gap-2 items-center"
                onClick={() => handleAddItem(type)}
            >
                <PlusIcon className="h-5 w-5" /> {label}
            </button>
        );
    };
    const handleDrop = (index: number, item: DragItem) => {
        if (item.editorType === "macro" && item.editorId === itemToEdit && item.editorSlot !== undefined) {
            const sourceIndex = item.editorSlot as number;
            const targetIndex = index;
            if (sourceIndex === targetIndex) return;

            const newActions = actions.map(action => [...action] as MacroAction);
            // Swap action values
            const temp = newActions[sourceIndex];
            newActions[sourceIndex] = newActions[targetIndex];
            newActions[targetIndex] = temp;

            updateActions(newActions);
            // Update selection to follow the swapped item if needed, 
            // but usually simplistic swap is enough visually.
        } else {
            const newActions = actions.map(action => [...action] as MacroAction);
            if (newActions[index]) {
                newActions[index][1] = item.keycode;
                updateActions(newActions);
            }
        }
    };

    // Bar: the actions in order in one row that wraps, an add menu, controls at the end.
    if (bar) {
        return (
            <BarRow label="Macro actions">
                {actions.map((item, index) => {
                    const [type, value] = item;
                    const isKey = ["down", "up", "tap"].includes(type);
                    return [
                        index > 0 && <BarSep key={`sep${index}`}><ArrowRight /></BarSep>,
                        isKey ? (
                            <BarSlot key={index} label={type.charAt(0).toUpperCase() + type.slice(1)}>
                                <EditorKey
                                    keycode={(value as string) || "KC_NO"}
                                    selected={selectedTarget?.type === "macro" && selectedTarget.macroId === itemToEdit && selectedTarget.macroIndex === index}
                                    onClick={() => {
                                        selectMacroKey(itemToEdit!, index);
                                        setFocusIndex(null);
                                    }}
                                    onClear={() => handleDeleteItem(index)}
                                    clearOnDragOff={false}
                                    onDrop={(dragged) => handleDrop(index, dragged)}
                                    size={BAR_KEY_SIZE}
                                    trashCorner
                                    unitSize={BAR_KEY_PX}
                                    variant={BAR_KEY_VARIANT}
                                    wrapperClassName={`relative ${BAR_KEY_SIZE}`}
                                    editorType="macro"
                                    editorId={itemToEdit!}
                                    editorSlot={index}
                                />
                            </BarSlot>
                        ) : (
                            <BarTextAction
                                key={index}
                                type={type}
                                value={value}
                                onChange={(v) => handleTextChange(index, v)}
                                onDelete={() => handleDeleteItem(index)}
                                autoFocus={index === focusIndex}
                            />
                        ),
                    ];
                })}
                {actions.length > 0 && <BarSep><ArrowRight /></BarSep>}
                <BarSlot label="Add">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                aria-label="Add a macro action"
                                className="w-10 h-10 flex items-center justify-center rounded-md border-2 border-dashed border-kb-gray-border text-kb-ink hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            {ADD_TYPES.map(({ type, label }) => (
                                <DropdownMenuItem key={type} onSelect={() => handleAddItem(type)}>{label}</DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </BarSlot>
                <BarEnd>{barEnd}</BarEnd>
            </BarRow>
        );
    }

    return (
        <div
            className="flex flex-col items-start pl-10 gap-1 pt-5 pb-20 w-full"
            onClick={(e) => {
                // Should only clear if clicking the background, not a child element
                if (e.target === e.currentTarget) {
                    clearSelection();
                    setFocusIndex(null);
                }
            }}
        >
            <div className="flex flex-col gap-1 w-full">
                {actions.map((item, index) => (
                    <div className="flex flex-col gap-1 w-full" key={index}>
                        {item[0] === "text" && (
                            <MacroEditorText
                                type="text"
                                value={item[1]}
                                onChange={(value) => handleTextChange(index, value)}
                                onDelete={() => handleDeleteItem(index)}
                                autoFocus={index === focusIndex}
                            />
                        )}
                        {item[0] === "delay" && (
                            <MacroEditorText
                                type="delay"
                                value={item[1]}
                                onChange={(value) => handleTextChange(index, value)}
                                onDelete={() => handleDeleteItem(index)}
                                autoFocus={index === focusIndex}
                            />
                        )}
                        {["down", "up", "tap"].includes(item[0]) && (
                            <MacroEditorKey
                                binding={item[1] as string}
                                index={index}
                                label={item[0].charAt(0).toUpperCase() + item[0].slice(1)}
                                onDelete={() => handleDeleteItem(index)}
                                onDrop={(draggedItem) => handleDrop(index, draggedItem)}
                                onClick={() => {
                                    selectMacroKey(itemToEdit!, index);
                                    setFocusIndex(null);
                                }}
                            />
                        )}
                        {index < actions.length - 1 && <ArrowDown className="w-6 h-6 text-kb-ink ml-[18px]" />}
                    </div>
                ))}
            </div>
            <div className="flex flex-col gap-[14px]">
                {actions.length > 0 && <ArrowDown className="w-6 h-6 text-kb-ink ml-[18px]" />}
                <AddButton type="tap" label="Key Tap" />
                <AddButton type="down" label="Key Down" />
                <AddButton type="up" label="Key Up" />
                <AddButton type="text" label="Text" />
                <AddButton type="delay" label="Delay" />
            </div>
        </div>
    );
};

export default MacroEditor;
