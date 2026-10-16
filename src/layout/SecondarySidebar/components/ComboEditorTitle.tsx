import { useRef, useState } from "react";
import { Pencil } from "lucide-react";

import { useKeyboard } from "@/contexts/KeyboardContext";
import { useBindingNames } from "@/hooks/useBindingNames";
import { cn } from "@/lib/utils";
import { comboName } from "@/utils/combo-names";

/**
 * The combo editor's title in the side panel header. A named combo's title is
 * its name, with "Combo N" as the small label under it; an unnamed combo's
 * title is "Combo N", with "Name this combo" under it. Clicking either one
 * renames in place: Enter or leaving the field saves, Escape cancels, and an
 * empty name removes it.
 */
export function ComboEditorTitle({ index, readOnly = false }: { index: number; readOnly?: boolean }) {
    const { keyboard } = useKeyboard();
    const name = comboName(keyboard?.cosmetic, index);
    const number = `Combo ${index}`;
    const [editing, setEditing] = useState(false);
    const opener = useRef<HTMLButtonElement>(null);

    const start = () => { if (!readOnly) setEditing(true); };
    const finish = (restoreFocus: boolean) => {
        setEditing(false);
        if (restoreFocus) requestAnimationFrame(() => opener.current?.focus());
    };

    const small = "mt-1.5 text-sm leading-tight";
    return (
        <div className="min-w-0 flex-1" data-combo-editor-title="">
            {editing ? (
                <ComboNameInput index={index} initial={name ?? ""} label={number} onDone={finish} />
            ) : (
                <h2 className="text-[22px] font-semibold leading-none text-kb-ink min-w-0">
                    {name && !readOnly ? (
                        <button
                            ref={opener}
                            type="button"
                            onClick={start}
                            title="Rename this combo"
                            aria-label={`${name}, rename ${number}`}
                            className="group/title inline-flex max-w-full items-center gap-2 rounded-md text-left cursor-text hover:underline decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                            data-combo-name=""
                        >
                            <span className="truncate">{name}</span>
                            <Pencil aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground opacity-60 group-hover/title:opacity-100 group-focus-visible/title:opacity-100" />
                        </button>
                    ) : (
                        <span className="block truncate">{name ?? number}</span>
                    )}
                </h2>
            )}
            {name || editing || readOnly ? (
                <p className={cn(small, "text-muted-foreground")} data-combo-number="">{number}</p>
            ) : (
                <button
                    ref={opener}
                    type="button"
                    onClick={start}
                    className={cn(small, "inline-flex items-center gap-1.5 rounded-md font-medium text-kb-ink underline decoration-dashed underline-offset-4 cursor-pointer hover:decoration-solid focus-visible:outline-2 focus-visible:outline-offset-2")}
                    data-combo-name-prompt=""
                >
                    <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                    Name this combo
                </button>
            )}
        </div>
    );
}

/** The name field, in the title's place while renaming. */
function ComboNameInput({ index, initial, label, onDone }: {
    index: number;
    initial: string;
    label: string;
    onDone: (restoreFocus: boolean) => void;
}) {
    const { renameBinding, nameError } = useBindingNames();
    const [value, setValue] = useState(initial);
    const busy = useRef(false);
    const save = async (restoreFocus: boolean) => {
        if (busy.current) return;
        busy.current = true;
        if (await renameBinding("combo", index, value)) onDone(restoreFocus);
        else busy.current = false;
    };
    return <>
        <input
            aria-label={`Name of ${label}`}
            placeholder="Name this combo"
            className="w-full max-w-[18rem] text-[22px] font-semibold leading-none text-kb-ink bg-kb-surface border border-kb-ink rounded-md px-1.5 py-0.5"
            autoFocus
            value={value}
            onChange={event => setValue(event.target.value)}
            onBlur={() => { void save(false); }}
            onKeyDown={event => {
                // The panel closes the editor on Escape; here it only cancels the rename.
                event.stopPropagation();
                if (event.key === "Enter") { event.preventDefault(); void save(true); }
                if (event.key === "Escape") { event.preventDefault(); busy.current = true; onDone(true); }
            }}
        />
        {nameError && <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">{nameError}</p>}
    </>;
}
