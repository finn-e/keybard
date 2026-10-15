import { FC, ReactNode, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Trash2 } from "lucide-react";

import OnOffToggle from "@/components/ui/OnOffToggle";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { cn } from "@/lib/utils";

/**
 * The compact editor bar: every binding editor in the side panel ("panel"
 * placement) is one row of labeled slots with its controls at the row's end.
 * Its height follows its content; long content wraps to more rows.
 */

/** Key size of a bar slot, and the Key variant drawn at that size. */
export const BAR_KEY_PX = 40;
export const BAR_KEY_SIZE = "w-10 h-10";
export const BAR_KEY_VARIANT = "medium" as const;
/** Height change of the bar, so the picker below slides rather than jumps. */
export const BAR_RESIZE_MS = 180;

/** One slot: its control (usually a key) with a small label under it. */
export const BarSlot: FC<{ label: string; children: ReactNode; className?: string }> = ({ label, children, className }) => (
    <div className={cn("flex flex-col items-center gap-1", className)} data-bar-slot={label}>
        {children}
        <span className="text-[10px] leading-none font-medium text-muted-foreground whitespace-nowrap">{label}</span>
    </div>
);

/** A separator between slots, centered on the keys rather than on their labels. */
export const BarSep: FC<{ children: ReactNode }> = ({ children }) => (
    <div aria-hidden="true" className="h-10 flex items-center text-kb-ink [&>svg]:w-3 [&>svg]:h-3 shrink-0">{children}</div>
);

/** The row of slots. It wraps between slots when the content is longer than the panel is wide. */
export const BarRow: FC<{ children: ReactNode; label: string }> = ({ children, label }) => (
    <div role="group" aria-label={label} data-editor-bar-row="" className="flex flex-row flex-wrap items-start gap-x-1 gap-y-2 min-w-0">
        {children}
    </div>
);

/** Controls at the row's end: on/off, a time field, options, delete. */
export const BarEnd: FC<{ children: ReactNode }> = ({ children }) => (
    <div className="ml-auto pl-1 flex flex-row items-start gap-1.5 shrink-0" data-editor-bar-end="">
        {children}
    </div>
);

/** A control at the row's end that has no label, centered on the keys. */
export const BarControl: FC<{ children: ReactNode }> = ({ children }) => (
    <div className="h-10 flex items-center">{children}</div>
);

export const BarToggle: FC<{ label: string; value: boolean; onToggle: (value: boolean) => void }> = ({ label, value, onToggle }) => (
    <BarControl>
        <OnOffToggle label={label} value={value} onToggle={onToggle} size="sm" />
    </BarControl>
);

export const BarDelete: FC<{ label: string; enabled: boolean; onClick: () => void }> = ({ label, enabled, onClick }) => (
    <BarControl>
        <button
            type="button"
            aria-label={label}
            title={label}
            disabled={!enabled}
            onClick={onClick}
            className="rounded-full p-1.5 text-kb-gray-border dark:text-neutral-400 transition-colors enabled:hover:bg-red-500 enabled:hover:text-white enabled:cursor-pointer disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
            <Trash2 className="h-4 w-4" />
        </button>
    </BarControl>
);

/** Shows or hides an editor's less-used settings under the row. */
export const BarOptionsButton: FC<{ open: boolean; onToggle: () => void; controls: string }> = ({ open, onToggle, controls }) => (
    <BarControl>
        <button
            type="button"
            aria-expanded={open}
            aria-controls={controls}
            onClick={onToggle}
            data-editor-bar-options=""
            className="flex items-center gap-0.5 rounded-full px-2 py-1 text-[11px] font-semibold text-kb-ink hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2"
        >
            Options
            <ChevronDown aria-hidden="true" className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        </button>
    </BarControl>
);

/**
 * Animates its own height to its content's height, so whatever sits below
 * slides when the content grows or shrinks. Instant with reduced motion.
 */
export const AnimatedHeight: FC<{ children: ReactNode; className?: string }> = ({ children, className }) => {
    const innerRef = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState<number | null>(null);
    const [resizing, setResizing] = useState(false);
    const reducedMotion = usePrefersReducedMotion();
    useLayoutEffect(() => {
        const inner = innerRef.current;
        if (!inner) return;
        let last: number | null = null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const measure = () => {
            const next = Math.ceil(inner.offsetHeight);
            if (next === last) return;
            if (last !== null && !reducedMotion) {
                setResizing(true);
                clearTimeout(timer);
                timer = setTimeout(() => setResizing(false), BAR_RESIZE_MS + 40);
            }
            last = next;
            setHeight(next);
        };
        measure();
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
        observer?.observe(inner);
        return () => {
            observer?.disconnect();
            clearTimeout(timer);
        };
    }, [reducedMotion]);
    return (
        <div
            className={className}
            data-animated-height={resizing ? "resizing" : undefined}
            style={{
                height: height ?? undefined,
                // Clipped only while the height moves, so the content never spills over the picker.
                overflow: resizing ? "hidden" : undefined,
                transition: reducedMotion ? undefined : `height ${BAR_RESIZE_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
            }}
        >
            <div ref={innerRef}>{children}</div>
        </div>
    );
};
