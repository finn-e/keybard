import { useEffect, useRef, useState, type RefObject } from 'react';

/** Demo cycle timings (ms): flip to the alternate layer, show a held chord, flip back, rest. */
export const DEMO = { chordAt: 700, backAt: 1600, period: 2600 };

interface Options {
    /** Off while following the live board: real presses and layer changes drive the preview. */
    enabled: boolean;
    /** The layer the preview flips to and back from, or null when no layer differs enough. */
    alternate: number | null;
    /** Keys to show as a held chord. */
    chord: () => number[];
    setHeld: (keys: Set<number>) => void;
    /** Pauses while the pointer or focus is inside it, so a setting can be inspected at rest. */
    card: RefObject<HTMLElement | null>;
    /** Any change replays the demo from the start, so an edit shows at once. */
    replay: unknown;
}

/**
 * Shows layer-change and held-key feedback in the preview on its own, in a loop.
 * Only local preview state changes: nothing here reaches the Host.
 */
export function useFeedbackDemo({ enabled, alternate, chord, setHeld, card, replay }: Options) {
    const [demoLayer, setDemoLayer] = useState<number | null>(null);
    const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
    const [inside, setInside] = useState(false);
    const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const chordRef = useRef(chord); chordRef.current = chord;
    const heldRef = useRef(setHeld); heldRef.current = setHeld;

    useEffect(() => {
        const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
        document.addEventListener('visibilitychange', onVisibility);
        const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
        const onMotion = () => setReduced(!!query?.matches);
        query?.addEventListener?.('change', onMotion);
        return () => { document.removeEventListener('visibilitychange', onVisibility); query?.removeEventListener?.('change', onMotion); };
    }, []);

    useEffect(() => {
        const el = card.current;
        if (!el) return;
        let pointer = false, focus = false;
        const sync = () => setInside(pointer || focus);
        const enter = () => { pointer = true; sync(); }, leave = () => { pointer = false; sync(); };
        const focusIn = () => { focus = true; sync(); }, focusOut = (e: FocusEvent) => { if (!el.contains(e.relatedTarget as Node | null)) { focus = false; sync(); } };
        el.addEventListener('pointerenter', enter); el.addEventListener('pointerleave', leave);
        el.addEventListener('focusin', focusIn); el.addEventListener('focusout', focusOut);
        return () => { el.removeEventListener('pointerenter', enter); el.removeEventListener('pointerleave', leave); el.removeEventListener('focusin', focusIn); el.removeEventListener('focusout', focusOut); };
    }, [card]);

    const running = enabled && visible && !inside;
    useEffect(() => {
        if (!running) { setDemoLayer(null); return; }
        const timers: number[] = [];
        const cycle = () => {
            if (alternate !== null) setDemoLayer(alternate);
            // After the flip: a layer change clears held keys in the preview.
            timers.push(window.setTimeout(() => heldRef.current(new Set(chordRef.current())), DEMO.chordAt));
            timers.push(window.setTimeout(() => setDemoLayer(null), DEMO.backAt));
        };
        cycle();
        // Reduced motion: one cycle on start and after each change, no loop.
        const loop = reduced ? 0 : window.setInterval(cycle, DEMO.period);
        return () => { timers.forEach(clearTimeout); clearInterval(loop); setDemoLayer(null); };
    }, [running, alternate, reduced, replay]);

    return demoLayer;
}
