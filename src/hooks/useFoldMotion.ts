// Fold motion ("small" combo indicators): while the pointer moves over the keyboard, every fold
// grows to its large size, as a hint that keys can be hovered to explore their combos. After
// the pointer rests for the idle delay, or leaves the keyboard, the folds ease back.
//
// One pointermove listener per keyboard and one data attribute on its layout element
// (data-combo-motion="active"); the CSS in src/index.css does the rest. No React state, so
// moving the pointer never re-renders the keyboard. Keyboard focus moving onto a combo key
// counts as activity too.
import { useEffect, type RefObject } from "react";
import { foldIdleMs } from "@/lib/comboIndicators";

export const FOLD_MOTION_ATTR = "data-combo-motion";
/** Activity is noted at most this often (ms) while the pointer keeps moving. */
const THROTTLE_MS = 80;

export function useFoldMotion(ref: RefObject<HTMLElement | null>, on: boolean): void {
    useEffect(() => {
        const el = ref.current;
        if (!el || !on) return;
        const idle = foldIdleMs(typeof window !== "undefined" ? window.location.search : "");
        let timer = 0;
        let last = -Infinity;
        let active = false;
        let rect: DOMRect | null = null;
        let rectAt = 0;

        const rest = () => {
            window.clearTimeout(timer);
            if (!active) return;
            active = false;
            el.removeAttribute(FOLD_MOTION_ATTR);
        };
        const wake = (now: number) => {
            if (active && now - last < THROTTLE_MS) return;
            last = now;
            if (!active) { active = true; el.setAttribute(FOLD_MOTION_ATTR, "active"); }
            window.clearTimeout(timer);
            timer = window.setTimeout(rest, idle);
        };
        const inside = (e: PointerEvent) => {
            const t = e.target as Node | null;
            if (t && el.contains(t)) return true;
            // Gaps between keys are not hit targets (the layout has pointer-events: none), so
            // test the layout's box, read at most twice a second.
            const now = performance.now();
            if (!rect || now - rectAt > 500) { rect = el.getBoundingClientRect(); rectAt = now; }
            const r = rect;
            return r.width > 0 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        };
        const onMove = (e: PointerEvent) => {
            if (e.pointerType === "touch") return;
            if (inside(e)) wake(e.timeStamp || performance.now());
            else rest();
        };
        const onFocus = (e: FocusEvent) => {
            const t = e.target as Element | null;
            if (t?.closest?.("[data-combo-preview]")) { last = -Infinity; wake(performance.now()); }
        };
        const onLeaveWindow = () => rest();

        window.addEventListener("pointermove", onMove, { passive: true });
        el.addEventListener("focusin", onFocus);
        document.documentElement.addEventListener("pointerleave", onLeaveWindow);
        window.addEventListener("blur", onLeaveWindow);
        return () => {
            window.removeEventListener("pointermove", onMove);
            el.removeEventListener("focusin", onFocus);
            document.documentElement.removeEventListener("pointerleave", onLeaveWindow);
            window.removeEventListener("blur", onLeaveWindow);
            window.clearTimeout(timer);
            el.removeAttribute(FOLD_MOTION_ATTR);
        };
    }, [ref, on]);
}
