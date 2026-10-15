import * as React from "react";

import { useKeyBinding } from "@/contexts/KeyBindingContext";
import { usePanels } from "@/contexts/PanelsContext";
import { useSettings } from "@/contexts/SettingsContext";
import {
    bindingEditorKind, isBindingEditorOpen, nudgeBindingEditor, SPOTLIGHT_NUDGE_EVENT, spotlightHint, spotStrength,
} from "@/lib/bindingSpotlight";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { cn } from "@/lib/utils";
import { isEditorInput } from "@/utils/editor-input";

/** True while a binding editor is open and the spotlight is on. */
export function useBindingSpotlight(): boolean {
    const { activePanel, itemToEdit } = usePanels();
    return isBindingEditorOpen(activePanel, itemToEdit);
}

/**
 * The spotlight scrim: the one place its color is drawn. Clicking it never
 * leaves the editor: it pulses the back arrow and points to it.
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
/** How long the callout (and a blocked click's reduced-motion highlight) stays. */
const HINT_MS = 2600;
/** How long the opening cue's reduced-motion highlight stays. */
const PRECUE_STATIC_MS = 900;
/** Reopening an editor this soon after one closed is going straight from one item to the next. */
const STRAIGHT_ON_MS = 400;
/** The opening cue waits for the enter motion, but never longer than this. */
const PRECUE_MAX_WAIT_MS = 1500;
/** The editor's way out (the picker header's back arrow); the visible one gets the pulse. */
const BACK = "[data-binding-editor-back]";

function visibleBackArrow(): HTMLElement | null {
    const candidates = [...document.querySelectorAll<HTMLElement>(BACK)]
        .filter(el => !el.closest("[hidden], [inert], [aria-hidden='true']"));
    // A copy inside a display: none container has no boxes; prefer the one on screen.
    return candidates.find(el => el.getClientRects().length > 0) ?? candidates[0] ?? null;
}

/**
 * Rings the back arrow. "blocked" (a click on something covered) rings twice;
 * "precue" (the editor just opened) rings once. With reduced motion both are
 * a brief static highlight, removed by the caller's timer.
 */
function ringBackArrow(back: HTMLElement, cue: "blocked" | "precue") {
    back.dataset.backCue = cue;
    back.classList.remove(PULSE_CLASS);
    void back.offsetWidth;
    back.classList.add(PULSE_CLASS);
}
const clearRings = () => document.querySelectorAll(`.${PULSE_CLASS}`).forEach(el => el.classList.remove(PULSE_CLASS));

/** Covered controls inside lifted areas (the canvas): darkened, out of the Tab order, and a click nudges. */
const COVER = "[data-spotlight-cover]";
/** The lifted canvas: a click on its empty space (not a key or a control) is a blocked click. */
const CANVAS = "[data-spotlight-canvas]";
const CANVAS_TARGETS = "[data-keycode], button, a[href], input, select, textarea, [role='button'], [role='tab'], [role='menuitem']";
const FOCUSABLE = "button, a[href], input, select, textarea, [tabindex]";
const BLOCKED_EVENTS = ["click", "dblclick", "pointerdown", "mousedown", "dragstart", "contextmenu"] as const;

/**
 * The binding editor spotlight. While any binding editor is open it covers
 * the page with the scrim (the keyboard canvas, the editor, the picker panel
 * and the rail's picker categories are lifted above it by their own
 * components), keeps covered controls out of reach, answers clicks on the
 * scrim and on empty canvas, rings the back arrow once when an editor opens,
 * and closes the editor on Esc when no slot is selected.
 */
export default function BindingSpotlight() {
    const { activePanel, itemToEdit, handleCloseEditor } = usePanels();
    const { selectedTarget, clearSelection } = useKeyBinding();
    const { getSetting } = useSettings();
    const typingBindsKey = getSetting("typing-binds-key") === true;
    const active = isBindingEditorOpen(activePanel, itemToEdit);
    const kind = bindingEditorKind(activePanel, itemToEdit);
    const reducedMotion = usePrefersReducedMotion();
    /** Where the callout sits: under the back arrow (arrow), or near the click when there is none. */
    const [hint, setHint] = React.useState<{ x: number; y: number; arrow: boolean; key: number } | null>(null);

    const selectedRef = React.useRef(selectedTarget);
    selectedRef.current = selectedTarget;
    const typingRef = React.useRef(typingBindsKey);
    typingRef.current = typingBindsKey;
    const closeRef = React.useRef(handleCloseEditor);
    closeRef.current = handleCloseEditor;
    const clearSelectionRef = React.useRef(clearSelection);
    clearSelectionRef.current = clearSelection;
    const reducedRef = React.useRef(reducedMotion);
    reducedRef.current = reducedMotion;
    /** When the last editor closed, so going straight on to another skips the opening cue. */
    const closedAt = React.useRef(-Infinity);
    /** Set by a blocked click, so a late opening cue never follows it. */
    const nudgedRef = React.useRef(false);

    React.useEffect(() => {
        if (!active) { setHint(null); return; }
        const root = document.documentElement;
        root.setAttribute("data-binding-spotlight", "");
        const strength = spotStrength(window.location.search);
        if (strength !== "medium") root.setAttribute("data-spot", strength);
        return () => {
            root.removeAttribute("data-binding-spotlight");
            root.removeAttribute("data-spot");
        };
    }, [active]);

    // Closing an editor drops its slot selection, so Esc closes the next one.
    React.useEffect(() => {
        if (!active) return;
        nudgedRef.current = false;
        return () => {
            closedAt.current = performance.now();
            const selected = selectedRef.current;
            if (selected && selected.type !== "keyboard") clearSelectionRef.current?.();
        };
    }, [active]);

    // Opening an editor: once its enter motion has landed, ring the back
    // arrow once, with no callout. Skipped when going straight from one item
    // to another.
    React.useEffect(() => {
        if (!active || performance.now() - closedAt.current < STRAIGHT_ON_MS) return;
        if (typeof requestAnimationFrame === "undefined") return;
        const start = performance.now();
        let frame = 0;
        let staticTimer = 0;
        let last: DOMRect | null = null;
        let still = 0;
        const step = () => {
            if (nudgedRef.current) return;
            const back = visibleBackArrow();
            const moving = !!document.querySelector("[data-editor-motion]");
            const rect = back?.getBoundingClientRect() ?? null;
            const steady = !!rect && !!last && rect.left === last.left && rect.top === last.top && rect.width > 0;
            still = steady && !moving ? still + 1 : 0;
            last = rect;
            const waited = performance.now() - start;
            if (back && (still >= 3 || waited > PRECUE_MAX_WAIT_MS)) {
                ringBackArrow(back, "precue");
                if (reducedRef.current) staticTimer = window.setTimeout(() => back.classList.remove(PULSE_CLASS), PRECUE_STATIC_MS);
                return;
            }
            if (waited <= PRECUE_MAX_WAIT_MS * 2) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => {
            cancelAnimationFrame(frame);
            window.clearTimeout(staticTimer);
        };
    }, [active]);

    // A click on anything covered: ring the back arrow twice and show the callout under it.
    React.useEffect(() => {
        if (!active) return;
        const onNudge = (event: Event) => {
            nudgedRef.current = true;
            const back = visibleBackArrow();
            if (back) {
                ringBackArrow(back, "blocked");
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
        // A ring ends with its last animation; a reduced-motion highlight ends with its timer.
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
            clearRings();
        }, HINT_MS);
        return () => window.clearTimeout(timer);
    }, [hint]);

    React.useEffect(() => {
        if (active) return;
        clearRings();
    }, [active]);

    // Covered controls inside the lifted canvas: out of the Tab order, and
    // pointer input on them nudges the editor instead of acting. A click on
    // the canvas's empty space is blocked the same way.
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
            if (!target) return;
            const covered = !!target.closest(COVER);
            const canvas = target.closest(CANVAS);
            const emptyCanvas = !covered && !!canvas && !(target.closest(CANVAS_TARGETS) && canvas.contains(target.closest(CANVAS_TARGETS)));
            if (covered) {
                event.preventDefault();
                event.stopPropagation();
            } else if (emptyCanvas && event.type === "click") {
                // Not a key or a control: blocked like any click under the scrim.
                event.stopPropagation();
            } else return;
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

    // A slot the person picked (rather than the one an editor selects on
    // opening) keeps Esc for Typing Binds a Key.
    const pickedRef = React.useRef(false);
    React.useEffect(() => {
        pickedRef.current = false;
        if (!active) return;
        const onDown = (event: PointerEvent) => {
            if (event.target instanceof Element && event.target.closest("[data-editor-slot]")) pickedRef.current = true;
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => document.removeEventListener("pointerdown", onDown, true);
    }, [active, itemToEdit]);

    // Esc closes the editor. With Typing Binds a Key on and a slot the person
    // picked, it is left alone so Esc can be typed into that slot. Combos and
    // tap dances select a slot on opening; that one never holds Esc, so Esc
    // closes every editor the same way. Runs in the capture phase, after the
    // combo preview's own Esc (which clears a pinned preview first).
    React.useEffect(() => {
        if (!active) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented || event.repeat || isEditorInput(event.target)) return;
            if (selectedRef.current && typingRef.current && pickedRef.current) return;
            if (document.querySelector("[role='dialog'], [role='alertdialog']")) return;
            event.preventDefault();
            event.stopPropagation();
            closeRef.current();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
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
