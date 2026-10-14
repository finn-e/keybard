// Readout for a combo preview: the hovered, focused or pinned key (or combos-list row), and
// each of its combos as chord keys and output. It overlays the space under the layout, so
// showing it never moves anything, and it is empty while nothing is previewed.
import React from "react";
import { cn } from "@/lib/utils";
import type { ComboEntry } from "@/types/keyboard.types";
import { useComboPreview } from "@/contexts/ComboPreviewContext";
import { comboInputs, type ComboMembership } from "@/utils/combo-membership";
import { comboSentence, shortKeyName } from "@/utils/combo-labels";
import { FOLD_CAP } from "@/utils/combo-fold";
import { ComboOptions } from "@/types/keyboard.types";
import { FoldGlyph } from "./FoldGlyph";

function membershipOf(combos: ComboEntry[], index: number): ComboMembership | null {
    const c = combos[index];
    if (!c) return null;
    return { index, enabled: !!(c.options & ComboOptions.ENABLED), output: c.output, inputs: comboInputs(c) };
}

function Chip({ children, out = false }: { children: React.ReactNode; out?: boolean }) {
    return (
        <span className={cn(
            "inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-[5px] text-[11px] font-semibold uppercase whitespace-nowrap",
            "bg-kb-combo-chip border border-kb-combo-chip-border text-kb-ink",
            out && "font-bold",
        )}>{children}</span>
    );
}

export function ComboLine({ c, hue }: { c: ComboMembership; hue: number }) {
    return (
        <li className="flex items-center gap-2 min-h-6 text-[13px]" data-readout-combo={c.index}>
            <span className="inline-flex w-[18px] h-4 items-center justify-center"><FoldGlyph hue={hue} disabled={!c.enabled} /></span>
            <span className="text-muted-foreground tabular-nums min-w-[62px] text-[12.5px]">Combo {c.index}</span>
            <span className="inline-flex items-center gap-[3px] flex-wrap" aria-label={comboSentence(c)}>
                {c.inputs.map((x, i) => (
                    <React.Fragment key={i}>
                        {i > 0 && <span className="text-muted-foreground text-[11px]" aria-hidden="true">+</span>}
                        <Chip>{shortKeyName(x)}</Chip>
                    </React.Fragment>
                ))}
                <span className="text-muted-foreground mx-0.5" aria-hidden="true">→</span>
                <Chip out>{shortKeyName(c.output)}</Chip>
            </span>
            {!c.enabled && <span className="text-[11px] text-muted-foreground border border-kb-combo-chip-border rounded-full px-1.5">off</span>}
        </li>
    );
}

export function ComboReadout({ combos, hues, className }: {
    combos: ComboEntry[];
    hues: ReadonlyMap<number, number>;
    className?: string;
}) {
    const { enabled, active, isPinned } = useComboPreview();
    if (!enabled) return null;

    let body: React.ReactNode = null;
    if (active) {
        const list = active.combos.map(i => membershipOf(combos, i)).filter((c): c is ComboMembership => !!c);
        const pinned = isPinned(active.id);
        let title: string;
        let meta: string;
        if (active.kind === "combo") {
            const c = list[0];
            title = `Combo ${active.combos[0]}`;
            meta = c ? `${c.inputs.length} keys${c.enabled ? "" : " · off"}` : "";
        } else {
            title = shortKeyName(active.keycode);
            meta = `in ${list.length} combo${list.length === 1 ? "" : "s"}` + (list.length > FOLD_CAP ? ` · ${FOLD_CAP} shown on the key` : "");
        }
        body = (
            <div
                className="pointer-events-none rounded-[10px] border border-kb-combo-chip-border bg-kb-surface text-kb-ink shadow-md px-3.5 py-3 max-w-[560px]"
                data-combo-readout=""
            >
                <div className="flex items-baseline gap-2.5 flex-wrap text-[13px] text-muted-foreground">
                    <strong className="text-kb-ink font-semibold text-sm">{title}</strong>
                    <span>{meta}</span>
                    {pinned && <span className="ml-auto text-xs">Pinned · Esc clears</span>}
                </div>
                {list.length > 0 && (
                    <ul className="list-none mt-2 p-0 grid gap-1">
                        {list.map(c => <ComboLine key={c.index} c={c} hue={hues.get(c.index) ?? 0} />)}
                    </ul>
                )}
            </div>
        );
    }
    return <div aria-live="polite" className={className}>{body}</div>;
}
