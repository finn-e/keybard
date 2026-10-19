import { FC } from "react";
import { useKeyBinding } from "@/contexts/KeyBindingContext";
import { usePanels } from "@/contexts/PanelsContext";
import { DragItem } from "@/contexts/DragContext";
import EditorKey from "./EditorKey";

interface Props {
    label?: string;
    binding?: string;
    index: number;
    onDelete?: () => void;
    onDrop?: (item: DragItem) => void;
    onClick?: () => void;
}

const MacroEditorKey: FC<Props> = ({ label, binding, index, onDelete, onDrop, onClick }) => {
    const { selectMacroKey, selectedTarget } = useKeyBinding();
    const { itemToEdit: mid } = usePanels();

    const isSelected = selectedTarget?.type === "macro" && selectedTarget.macroId === mid && selectedTarget.macroIndex === index;
    const keycode = binding || "KC_NO";

    return (
        <div className="relative w-full">
            <div className="flex flex-row justify-start items-center gap-4 peer">
                <EditorKey
                    keycode={keycode}
                    selected={isSelected}
                    onClick={() => {
                        selectMacroKey(mid!, index);
                        onClick?.();
                    }}
                    onClear={onDelete}
                    // onDelete removes the whole action, so a drag-off does not.
                    clearOnDragOff={false}
                    onDrop={onDrop}
                    size="w-[60px] h-[60px]"
                    trashOffset="-left-10"
                    wrapperClassName="flex-shrink-0"
                    variant="default"
                    label={undefined}
                    labelClassName={undefined}
                    editorType="macro"
                    editorId={mid!}
                    editorSlot={index}
                />
                <div className="flex flex-row items-center flex-grow">
                    {label && <div className="font-medium text-gray-600 dark:text-neutral-300 px-2">{label}</div>}
                </div>
            </div>
        </div>
    );
};

export default MacroEditorKey;
