import * as React from "react";

import { useKeyBinding } from "@/contexts/KeyBindingContext";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { usePanels } from "@/contexts/PanelsContext";
import {
    bindingEditorTitle, isBindingEditorOpen, nudgeBindingEditor, SPOTLIGHT_NUDGE_EVENT, spotlightHint,
} from "@/lib/bindingSpotlight";
import { cn } from "@/lib/utils";
import { isEditorInput } from "@/utils/editor-input";

/** True while a binding editor is open and the spotlight is on. */
export function useBindingSpotlight(): boolean {
    const { activePanel, itemToEdit } = usePanels();
    return isBindingEditorOpen(activePanel, itemToEdit);
}

/**
 * A scrim over part of the page while a binding editor is open. Clicking it
 * never leaves the editor: it pulses the editor header and says how to finish.
 */
export function SpotlightScrim({ className }: { className?: string }) {
    return (
        <div
            aria-hidden="true"
            data-binding-scrim=""
            className={cn("bg-kb-scrim", className)}
            onPointerDown={(e) => e.preventDefault()}
            onClick={(e) => {
                e.stopPropagation();
                nudgeBindingEditor({ x: e.clientX, y: e.clientY });
            }}
        />
    );
}

const PULSE_CLASS = "binding-spotlight-pulse";
const HINT_MS = 1800;
/** Covered controls inside lifted areas (the canvas): dimmed, out of the Tab order, and a click nudges. */
const COVER = "[data-spotlight-cover]";
const FOCUSABLE = "button, a[href], input, select, textarea, [tabindex]";
const BLOCKED_EVENTS = ["click", "dblclick", "pointerdown", "mousedown", "dragstart", "contextmenu"] as const;

/**
 * The binding editor spotlight. While any binding editor is open it covers
 * the page with a scrim (the keyboard canvas, the editor, the picker panel and
 * the rail's picker categories are lifted above it by their own components),
 * keeps covered controls out of reach, answers clicks on the scrim, and closes
 * the editor on Esc when no slot is selected.
 */
export default function BindingSpotlight() {
    const { activePanel, itemToEdit, handleCloseEditor } = usePanels();
    const { keyboard } = useKeyboard();
    const { selectedTarget } = useKeyBinding();
    const active = isBindingEditorOpen(activePanel, itemToEdit);
    const title = bindingEditorTitle(activePanel, itemToEdit, keyboard?.cosmetic);
    const [hint, setHint] = React.useState<{ x: number; y: number; key: number } | null>(null);

    const selectedRef = React.useRef(selectedTarget);
    selectedRef.current = selectedTarget;
    const closeRef = React.useRef(handleCloseEditor);
    closeRef.current = handleCloseEditor;

    React.useEffect(() => {
        if (!active) { setHint(null); return; }
        const root = document.documentElement;
        root.setAttribute("data-binding-spotlight", "");
        return () => root.removeAttribute("data-binding-spotlight");
    }, [active]);

    // A click on anything covered: pulse the editor header and show the hint.
    React.useEffect(() => {
        if (!active) return;
        const onNudge = (event: Event) => {
            document.querySelectorAll<HTMLElement>("[data-binding-editor-header]").forEach(el => {
                el.classList.remove(PULSE_CLASS);
                void el.offsetWidth;
                el.classList.add(PULSE_CLASS);
            });
            let at = (event as CustomEvent<{ x: number; y: number } | null>).detail;
            if (!at) {
                const card = document.querySelector(".binding-workspace")?.getBoundingClientRect();
                at = card ? { x: card.left, y: card.top } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
            }
            setHint({ ...at, key: Date.now() });
        };
        const onEnd = (event: AnimationEvent) => {
            if (event.target instanceof HTMLElement) event.target.classList.remove(PULSE_CLASS);
        };
        window.addEventListener(SPOTLIGHT_NUDGE_EVENT, onNudge);
        document.addEventListener("animationend", onEnd);
        return () => {
            window.removeEventListener(SPOTLIGHT_NUDGE_EVENT, onNudge);
            document.removeEventListener("animationend", onEnd);
        };
    }, [active]);

    React.useEffect(() => {
        if (!hint) return;
        const timer = window.setTimeout(() => setHint(null), HINT_MS);
        return () => window.clearTimeout(timer);
    }, [hint]);

    // Covered controls inside the lifted canvas: out of the Tab order, and
    // pointer input on them nudges the editor instead of acting.
    React.useEffect(() => {
        if (!active) return;
        const touched = new Map<HTMLElement, { tabindex: string | null; disabled: string | null }>();
        const apply = () => {
            document.querySelectorAll<HTMLElement>(COVER).forEach(cover => {
                for (const el of [cover, ...cover.querySelectorAll<HTMLElement>(FOCUSABLE)]) {
                    if (touched.has(el)) continue;
                    touched.set(el, { tabindex: el.getAttribute("tabindex"), disabled: el.getAttribute("aria-disabled") });
                    el.setAttribute("tabindex", "-1");
                    el.setAttribute("aria-disabled", "true");
                }
            });
        };
        apply();
        const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(apply);
        observer?.observe(document.body, { childList: true, subtree: true });
        const block = (event: Event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target?.closest(COVER)) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.type === "click") {
                const m = event as MouseEvent;
                nudgeBindingEditor({ x: m.clientX, y: m.clientY });
            }
        };
        BLOCKED_EVENTS.forEach(type => document.addEventListener(type, block, true));
        return () => {
            observer?.disconnect();
            BLOCKED_EVENTS.forEach(type => document.removeEventListener(type, block, true));
            touched.forEach((was, el) => {
                if (was.tabindex === null) el.removeAttribute("tabindex"); else el.setAttribute("tabindex", was.tabindex);
                if (was.disabled === null) el.removeAttribute("aria-disabled"); else el.setAttribute("aria-disabled", was.disabled);
            });
        };
    }, [active]);

    // Esc closes the editor when no slot is selected. With a slot selected it
    // is left alone, so Typing Binds a Key works as before.
    React.useEffect(() => {
        if (!active) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented || event.repeat || isEditorInput(event.target)) return;
            if (selectedRef.current) return;
            if (document.querySelector("[role='dialog'], [role='alertdialog']")) return;
            event.preventDefault();
            closeRef.current();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [active]);

    if (!active) return null;
    const left = hint ? Math.max(8, Math.min(hint.x + 10, window.innerWidth - 320)) : 0;
    const top = hint ? Math.max(8, hint.y - 36) : 0;
    return (
        <>
            <SpotlightScrim className="fixed inset-0 z-[45]" />
            <div role="status" aria-live="polite" className="sr-only">{hint ? spotlightHint(title) : ""}</div>
            {hint && (
                <div
                    key={hint.key}
                    aria-hidden="true"
                    className="binding-spotlight-hint fixed z-[80] pointer-events-none rounded-full bg-kb-active text-kb-active-fg px-3 py-1.5 text-xs font-medium shadow-lg whitespace-nowrap"
                    style={{ left, top }}
                >
                    {spotlightHint(title)}
                </div>
            )}
        </>
    );
}
