import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { BALLS, MAT_ORDER, type BallId } from "./webgl/materials";

interface Props {
    side: "left" | "right";
    current: BallId;
    x: number;
    y: number;
    onPick: (ball: BallId) => void;
    onClose: () => void;
}

/**
 * The ball menu, opened by right-clicking (or long-pressing) a trackball. It has
 * no keyboard shortcut; the Fragments panel's Ball choice is the keyboard path.
 * Inside the menu, arrows, Home and End move and Escape closes.
 */
export function BallMenu({ side, current, x, y, onPick, onClose }: Props) {
    const ref = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ left: x, top: y });
    const back = useRef<Element | null>(typeof document !== "undefined" ? document.activeElement : null);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const w = el.offsetWidth, h = el.offsetHeight;
        setPos({ left: Math.max(8, Math.min(x, window.innerWidth - w - 8)), top: Math.max(8, Math.min(y, window.innerHeight - h - 8)) });
        const items = [...el.querySelectorAll<HTMLButtonElement>("button")];
        (items.find((b) => b.getAttribute("aria-checked") === "true") ?? items[0])?.focus({ preventScroll: true });
    }, [x, y]);

    useEffect(() => {
        const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
        const scroll = () => onClose();
        document.addEventListener("pointerdown", down, true);
        window.addEventListener("scroll", scroll, { passive: true, capture: true });
        return () => { document.removeEventListener("pointerdown", down, true); window.removeEventListener("scroll", scroll, true); };
    }, [onClose]);

    const close = (restore: boolean) => {
        onClose();
        if (restore && back.current instanceof HTMLElement) back.current.focus({ preventScroll: true });
    };
    const onKeyDown = (e: React.KeyboardEvent) => {
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); close(true); }
        else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
        else if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
        else if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); }
    };

    return createPortal(
        <div
            ref={ref}
            role="menu"
            aria-label={`${side === "left" ? "Left" : "Right"} ball`}
            data-ball-menu={side}
            onKeyDown={onKeyDown}
            className="fixed z-[1000] min-w-[220px] rounded-lg border border-kb-gray-border bg-kb-surface text-kb-ink p-1 shadow-lg"
            style={{ left: pos.left, top: pos.top }}
        >
            <div className="px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground">{side === "left" ? "Left" : "Right"} ball</div>
            {MAT_ORDER.map((id) => (
                <button
                    key={id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={id === current}
                    data-ball-option={id}
                    onClick={() => { onPick(id); close(true); }}
                    className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left text-sm outline-none hover:bg-kb-gray-medium focus-visible:bg-kb-gray-medium",
                        id === current && "font-semibold",
                    )}
                >
                    <i aria-hidden="true" className="inline-block h-4 w-4 shrink-0 rounded-full border border-kb-gray-border" style={{ background: BALLS[id].swatch }} />
                    <span className="flex-1">{BALLS[id].name}</span>
                    <small className="text-xs text-muted-foreground">{BALLS[id].mm} mm</small>
                </button>
            ))}
        </div>,
        document.body,
    );
}
