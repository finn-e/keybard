import React, { type ReactNode } from "react";
import OnOffToggle from "@/components/ui/OnOffToggle";
import { cn } from "@/lib/utils";
import type { SettingDefinition } from "@/types/settings.types";

/**
 * Label and help on the left, the control in a fixed column on the right
 * (190 px, 150 px in a narrow panel), so values line up down the page.
 */
export const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_150px] @md:grid-cols-[minmax(0,1fr)_190px] items-center gap-3";

interface Props {
    definition: SettingDefinition;
    label: string;
    description?: string;
    value: string | number | boolean;
    onChange: (value: string | number | boolean) => void;
    onAction: (action: string) => void;
    /** Marks search matches in the label and description. */
    highlight?: (text: string) => ReactNode;
}

const plain = (text: string): ReactNode => text;

export function RowText({ label, description, id, highlight = plain }: { label: string; description?: string; id?: string; highlight?: (text: string) => ReactNode }) {
    return (
        <div className="flex flex-col gap-0.5 min-w-0">
            <span id={id} className="text-sm text-kb-ink">{highlight(label)}</span>
            {description && <span className="text-xs text-muted-foreground">{highlight(description)}</span>}
        </div>
    );
}

const SettingRow: React.FC<Props> = ({ definition, label, description, value, onChange, onAction, highlight }) => {
    if (definition.type === "action") {
        return (
            <button
                type="button"
                aria-label={label}
                aria-description={description}
                onClick={() => definition.action && onAction(definition.action)}
                className="flex w-full flex-row items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left hover:bg-muted"
            >
                <RowText label={label} description={description} highlight={highlight} />
                <span aria-hidden="true" className="text-sm text-muted-foreground">&rsaquo;</span>
            </button>
        );
    }

    return (
        <div className={cn(ROW_GRID, "px-3 py-2.5")}>
            <RowText label={label} description={description} highlight={highlight} />
            <div className="flex justify-end min-w-0">
                {definition.type === "boolean" && (
                    <OnOffToggle label={label} description={description} value={value === true} onToggle={(v) => onChange(v)} />
                )}
                {definition.type === "select" && (
                    <select
                        aria-label={label}
                        aria-description={description}
                        value={String(value)}
                        onChange={(e) => onChange(e.target.value)}
                        className="h-8 w-full min-w-0 cursor-pointer rounded-md border border-input bg-kb-surface px-2 text-sm font-semibold text-kb-ink"
                    >
                        {definition.items?.map((item) => (
                            <option key={item.value} value={item.value}>
                                {item.label}
                            </option>
                        ))}
                    </select>
                )}
            </div>
        </div>
    );
};

export default SettingRow;
