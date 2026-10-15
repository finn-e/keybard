import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useBindingSpotlight } from "@/layout/BindingSpotlight";
import { cn } from "@/lib/utils";
import {
    lSurfacePath, SPOTLIGHT_SURFACE_RADIUS_PX, TRAY_EDGE_PX, TRAY_HANDLE_PX, TRAY_MOTION_MS, trayVisibleHeight,
    type PickerShape, type SurfaceGeometry, type TrayState,
} from "@/lib/pickerShape";

/** The CSS variable the panel (Lfull) reads to sit on top of the tray. */
export const TRAY_HEIGHT_VAR = "--picker-tray-h";
const EASE_OUT = (t: number) => 1 - Math.pow(1 - t, 3);

/** The tray's shown height, eased toward the target; instant with reduced motion. */
function useTrayHeight(target: number, reducedMotion: boolean): number {
    const [height, setHeight] = React.useState(target);
    const current = React.useRef(target);
    React.useEffect(() => {
        const from = current.current;
        if (reducedMotion || from === target || typeof requestAnimationFrame === "undefined") {
            current.current = target;
            setHeight(target);
            return;
        }
        let frame = 0;
        const start = performance.now();
        const step = (now: number) => {
            const t = Math.min(1, (now - start) / TRAY_MOTION_MS);
            const value = from + (target - from) * EASE_OUT(t);
            current.current = value;
            setHeight(value);
            if (t < 1) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
    }, [target, reducedMotion]);
    return height;
}

interface PanelBox { left: number; right: number; top: number; vw: number; vh: number }

/** The side panel's left, right and top, kept current as it and the window change. */
function usePanelBox(active: boolean): PanelBox | null {
    const [box, setBox] = React.useState<PanelBox | null>(null);
    React.useLayoutEffect(() => {
        if (!active) { setBox(null); return; }
        const panel = document.querySelector<HTMLElement>("aside.detail-panel[data-placement='side']");
        if (!panel) return;
        const measure = () => {
            const r = panel.getBoundingClientRect();
            const next = { left: r.left, right: r.right, top: r.top, vw: document.documentElement.clientWidth, vh: window.innerHeight };
            setBox(prev => prev && prev.left === next.left && prev.right === next.right && prev.top === next.top
                && prev.vw === next.vw && prev.vh === next.vh ? prev : next);
        };
        measure();
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
        observer?.observe(panel);
        window.addEventListener("resize", measure);
        // The panel's left edge follows the primary sidebar, which animates.
        const late = setTimeout(measure, 400);
        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", measure);
            clearTimeout(late);
        };
    }, [active]);
    return box;
}

interface PickerTrayProps {
    shape: PickerShape;
    state: TrayState;
    /** The tray's height when open. */
    height: number;
    /** The side panel is open, so the L surface is drawn. */
    panelOpen: boolean;
    onToggle: () => void;
    headerRef: (el: HTMLElement | null) => void;
    bodyRef: (el: HTMLElement | null) => void;
    /** The keyboard's height as laid out, so the tray takes no more than it needs. */
    onContentHeight: (px: number) => void;
}

/**
 * The Standard Keys tray of the L-shaped picker and the one surface it shares
 * with the side panel. The surface is a single outline drawn behind both, so
 * the two read as one L: same fill, one border, rounded outer corners and a
 * concave fillet where the tray meets the panel.
 */
export default function PickerTray({ shape, state, height, panelOpen, onToggle, headerRef, bodyRef, onContentHeight }: PickerTrayProps) {
    const reducedMotion = usePrefersReducedMotion();
    const shown = useTrayHeight(trayVisibleHeight(state, height), reducedMotion);
    const box = usePanelBox(panelOpen);
    // While an editor is open the L is a lit surface like the plain panel: flat, same corners.
    const spotlight = useBindingSpotlight();

    React.useLayoutEffect(() => {
        document.documentElement.style.setProperty(TRAY_HEIGHT_VAR, `${Math.round(shown)}px`);
    }, [shown]);
    React.useEffect(() => () => {
        document.documentElement.style.removeProperty(TRAY_HEIGHT_VAR);
    }, []);

    // The body's height with the keyboard in it. An empty body (another
    // category) keeps the last height, so the tray reopens at its size.
    const [bodyEl, setBodyEl] = React.useState<HTMLElement | null>(null);
    const reportHeight = React.useRef(onContentHeight);
    reportHeight.current = onContentHeight;
    React.useLayoutEffect(() => {
        if (!bodyEl || typeof ResizeObserver === "undefined") return;
        const measure = () => {
            if (bodyEl.querySelector("[data-fitted-keyboard]")) reportHeight.current(Math.ceil(bodyEl.offsetHeight));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(bodyEl);
        return () => observer.disconnect();
    }, [bodyEl]);
    const setBody = React.useCallback((el: HTMLElement | null) => {
        setBodyEl(el);
        bodyRef(el);
    }, [bodyRef]);

    if (!panelOpen || !box) return null;
    const bottom = box.vh - TRAY_EDGE_PX;
    const right = box.vw - TRAY_EDGE_PX;
    const geometry: SurfaceGeometry = {
        // Half a pixel in, so the 1px border lands on whole pixels.
        left: box.left + 0.5, inner: box.right - 0.5, right: right - 0.5,
        top: box.top + 0.5, trayTop: bottom - shown + 0.5, bottom: bottom - 0.5,
    };
    const trayLeft = shape === "Lfull" ? box.left : box.right;
    const collapsed = state === "handle";
    const visible = shown > 0.5;

    return (
        <>
            <svg
                aria-hidden="true"
                className="picker-surface fixed inset-0 z-[59] pointer-events-none"
                width={box.vw}
                height={box.vh}
                data-picker-surface={shape}
                data-spotlight-surface={spotlight ? "" : undefined}
            >
                <path d={lSurfacePath(geometry, spotlight ? SPOTLIGHT_SURFACE_RADIUS_PX : undefined)} />
            </svg>
            <section
                aria-label="Standard Keys"
                aria-hidden={!visible || state === "hidden"}
                inert={!visible || state === "hidden"}
                data-picker-tray={state}
                className={cn("fixed z-[60] flex flex-col overflow-hidden", !visible && "invisible")}
                style={{ left: trayLeft, right: TRAY_EDGE_PX, bottom: TRAY_EDGE_PX, height: shown }}
            >
                <div className="flex shrink-0 items-center gap-3 px-4" style={{ height: TRAY_HANDLE_PX }}>
                    <button
                        type="button"
                        onClick={onToggle}
                        aria-expanded={!collapsed}
                        className="flex items-center gap-1.5 rounded-md px-1 -mx-1 text-sm font-semibold text-kb-ink hover:bg-muted/60 cursor-pointer"
                        data-picker-tray-toggle=""
                    >
                        {collapsed ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                        Standard Keys
                    </button>
                    <span ref={headerRef} className={cn("flex items-center", collapsed && "hidden")} />
                </div>
                {shape === "Lfull" && <div aria-hidden="true" className="absolute top-0 h-px bg-border" style={{ left: 16, width: Math.max(0, box.right - box.left - 32) }} />}
                <div ref={setBody} className="shrink-0 px-4 pb-3 pt-1" data-picker-tray-body="" />
            </section>
        </>
    );
}
