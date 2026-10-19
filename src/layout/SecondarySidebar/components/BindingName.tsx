import { useRef, useState } from "react";
import { useBindingNames, type BindingNameKind } from "@/hooks/useBindingNames";

const KIND_LABEL: Record<BindingNameKind, string> = { macro: "Macro", tapdance: "Tap Dance", combo: "Combo" };

/** Editable binding name; action previews and the pencil still open the editor. */
export function BindingName({ kind, index, name, readOnly = false }: {
    kind: BindingNameKind;
    index: number;
    name?: string;
    readOnly?: boolean;
}) {
    const { renameBinding, nameError } = useBindingNames();
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState("");
    const busy = useRef(false);
    const button = useRef<HTMLButtonElement>(null);
    const label = `${KIND_LABEL[kind]} ${index}`;
    const finish = (restoreFocus = true) => {
        setEditing(false);
        if (restoreFocus) requestAnimationFrame(() => button.current?.focus());
    };
    const save = async (restoreFocus = true) => {
        if (busy.current) return;
        busy.current = true;
        if (await renameBinding(kind, index, value)) finish(restoreFocus);
        else busy.current = false;
    };
    if (readOnly) return <span className="truncate text-xs font-semibold">{name || label}</span>;
    return <div className="min-w-0 max-w-full relative" onClick={event => event.stopPropagation()}>
        {editing ? <input
            aria-label={`Rename ${label}`}
            className="w-full min-w-16 text-sm bg-kb-surface text-kb-ink border border-kb-ink rounded px-1"
            autoFocus value={value} onChange={event => setValue(event.target.value)}
            onBlur={() => { void save(false); }}
            onKeyDown={event => {
                if (event.key === "Enter") { event.preventDefault(); void save(); }
                if (event.key === "Escape") { event.preventDefault(); busy.current = true; finish(); }
            }}
        /> : <button ref={button} type="button" className="block max-w-full truncate text-xs font-semibold text-kb-ink hover:underline"
            aria-label={`Rename ${label}${name ? `: ${name}` : ""}`}
            onClick={() => { busy.current = false; setValue(name || ""); setEditing(true); }}>
            {name || label}
        </button>}
        {editing && nameError && <span role="alert" className="block text-xs text-red-600">{nameError}</span>}
    </div>;
}
