import React from "react";
import { cn } from "@/lib/utils";
import { useComboPreview, type PreviewFocus } from "@/contexts/ComboPreviewContext";

/**
 * Wraps a combo's row in the Combos list: hover or focus previews the combo on the layout,
 * click (or Enter / Space on the row) pins it, and the row is lit while its combo is previewed.
 * With combo indicators off it renders its children unchanged.
 */
export function ComboPreviewRow({ index, ariaLabel, className, children }: {
    index: number;
    ariaLabel: string;
    className?: string;
    children: React.ReactNode;
}) {
    const p = useComboPreview();
    if (!p.enabled) return <>{children}</>;
    const focus: PreviewFocus = { kind: "combo", id: `combo:${index}`, combos: [index] };
    const lit = !!p.focusSet?.has(index);
    return (
        <div
            data-combo-preview=""
            data-combo-row={index}
            data-lit={lit ? "true" : undefined}
            tabIndex={0}
            role="button"
            aria-label={ariaLabel}
            aria-pressed={p.isPinned(focus.id)}
            className={cn(
                "rounded-lg transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-kb-ink",
                lit && "bg-kb-combo-row-lit",
                p.isPinned(focus.id) && "shadow-[inset_0_0_0_1.5px_var(--kb-ink)]",
                className,
            )}
            onMouseEnter={() => p.enter(focus, true)}
            onMouseLeave={p.leave}
            onFocus={(e) => { if (e.target === e.currentTarget) p.focusIn(focus, e.currentTarget); }}
            onBlur={(e) => { if (e.target === e.currentTarget) p.blurOut(); }}
            onClick={() => p.togglePin(focus)}
            onKeyDown={(e) => {
                if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                e.preventDefault();
                e.stopPropagation();
                p.togglePin(focus);
            }}
        >
            {children}
        </div>
    );
}
