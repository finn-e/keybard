// The layout choice before a reflash: Keep my layout (the default: back up, install, put it
// back), Reset to the default layout (the firmware's), or Wipe to a blank board (every key
// empty on every layer, nothing else set; no backup needed).

import { useId } from "react";

import type { Afterwards } from "@/services/updater/flow";

export const LAYOUT_CHOICES: Array<{ value: Afterwards; label: string }> = [
    { value: "restore", label: "Keep my layout" },
    { value: "defaults", label: "Reset to the default layout" },
    { value: "blank", label: "Wipe to a blank board" },
];

export interface LayoutChoiceProps {
    value: Afterwards;
    onChange: (value: Afterwards) => void;
    /** Keep my layout needs a backup: off until it's saved, and after it failed. */
    keepDisabled: boolean;
    /** The backup failed: say why Keep my layout is off. */
    noBackup?: boolean;
    /** The choices offered (the manual install can't wipe: it has no updater to ask). */
    choices?: Afterwards[];
}

export function LayoutChoice({ value, onChange, keepDisabled, noBackup, choices = ["restore", "defaults", "blank"] }: LayoutChoiceProps) {
    const group = useId();
    return (
        <fieldset className="flex flex-col gap-1" aria-label="Layout" data-testid="layout-choice">
            <legend className="mb-1 text-sm font-semibold">Layout</legend>
            {LAYOUT_CHOICES.filter((c) => choices.includes(c.value)).map((c) => {
                const disabled = c.value === "restore" && keepDisabled;
                return (
                    <label key={c.value} className={`flex items-center gap-2 text-sm ${disabled ? "text-muted-foreground" : ""}`}>
                        <input type="radio" name={group} value={c.value} checked={value === c.value} disabled={disabled} onChange={() => onChange(c.value)} />
                        {c.label}
                        {c.value === "restore" && noBackup && <span className="text-muted-foreground">· No backup</span>}
                    </label>
                );
            })}
        </fieldset>
    );
}
