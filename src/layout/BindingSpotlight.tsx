import * as React from "react";

import { useKeyBinding } from "@/contexts/KeyBindingContext";
import { usePanels } from "@/contexts/PanelsContext";
import {
    backPulseStyle, bindingEditorKind, isBindingEditorOpen, nudgeBindingEditor, SPOTLIGHT_NUDGE_EVENT, spotlightHint,
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
 * never leaves the editor: it pulses the back arrow and points to it.
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

const PULSE_CLASS = "binding-back-pulse";
const HINT_MS = 2600;
/** The editor's way out (the picker header's back arrow); the visible one gets the pulse. */
const BACK = "[data-binding-editor-back]";

function visibleBackArrow(): HTMLElement | null {
    for (const el of document.querySelectorAll<HTMLElement>(BACK)) {
        if (el.closest("[hidden], [inert], [aria-hidden='true']")) continue;
        return el;
    }
    return null;
}
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
    const { selectedTarget } = useKeyBinding();
    const active = isBindingEditorOpen(activePanel, itemToEdit);
    const kind = bindingEditorKind(activePanel, itemToEdit);
    /** Where the callout sits: under the back arrow (arrow), or near the click when there is none. */
    const [hint, setHint] = React.useState<{ x: number; y: number; arrow: boolean; key: number } | null>(null);

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

    // A click on anything covered: pulse the back arrow and show the callout under it.
    React.useEffect(() => {
        if (!active) return;
        const onNudge = (event: Event) => {
            const back = visibleBackArrow();
            if (back) {
                back.dataset.backPulse = backPulseStyle(window.location.search);
                back.classList.remove(PULSE_CLASS);
                void back.offsetWidth;
                back.classList.add(PULSE_CLASS);
                const r = back.getBoundingClientRect();
                setHint({ x: r.left, y: r.bottom + 10, arrow: true, key: Date.now() });
                return;
            }
            let at = (event as CustomEvent<{ x: number; y: number } | null>).detail;
            if (!at) {
                const card = document.querySelector(".binding-workspace")?.getBoundingClientRect();
                at = card ? { x: card.left, y: card.top } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
            }
            setHint({ x: at.x + 10, y: at.y - 36, arrow: false, key: Date.now() });
        };
        // The pulse ends with its last animation; a reduced-motion static highlight ends with the callout.
        const onEnd = (event: AnimationEvent) => {
            if (event.target instanceof HTMLElement && event.animationName.startsWith("bindingBack")) event.target.classList.remove(PULSE_CLASS);
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
        const timer = window.setTimeout(() => {
            setHint(null);
            document.querySelectorAll(`.${PULSE_CLASS}`).forEach(el => el.classList.remove(PULSE_CLASS));
        }, HINT_MS);
        return () => window.clearTimeout(timer);
    }, [hint]);

    React.useEffect(() => {
        if (active) return;
        document.querySelectorAll(`.${PULSE_CLASS}`).forEach(el => el.classList.remove(PULSE_CLASS));
    }, [active]);

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
    const text = spotlightHint(kind);
    const left = hint ? Math.max(8, Math.min(hint.x, window.innerWidth - 320)) : 0;
    const top = hint ? Math.max(8, Math.min(hint.y, window.innerHeight - 48)) : 0;
    return (
        <>
            <SpotlightScrim className="fixed inset-0 z-[45]" />
            <div role="status" aria-live="polite" className="sr-only">{hint ? text : ""}</div>
            {hint && (
                <div
                    key={hint.key}
                    aria-hidden="true"
                    data-binding-back-callout={hint.arrow ? "arrow" : "point"}
                    className={cn("binding-back-callout fixed z-[80] pointer-events-none rounded-lg px-3 py-2 text-[13px] font-medium shadow-lg whitespace-nowrap", hint.arrow && "binding-back-callout-arrow")}
                    style={{ left, top }}
                >
                    {text}
                </div>
            )}
        </>
    );
}
