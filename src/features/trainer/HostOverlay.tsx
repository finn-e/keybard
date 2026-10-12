import { useEffect, useMemo, useRef, useState } from 'react';
import { OverlaySurface, type SurfaceKey } from './OverlaySurface';
import { useHost } from './host';
import { surfaceKeys } from './useSurfaceKeys';
import type { Appearance } from './core';
import { adaptAppearance, decodeBackdrop, sampleRect, wantsDarkLegend, type Backdrop } from './adaptiveContrast';
import './trainer.css';
export default function HostOverlay() {
    const { state } = useHost();
    const [changed, setChanged] = useState<Set<number>>(new Set());
    const previous = useRef<SurfaceKey[]>([]);
    const keys = useMemo(() => {
        if (!state?.valid || !state.board) return [];
        try { return surfaceKeys(state.board, state.active, state.default ?? state.config.manualDefault, state.config.hands, state.config.layoutId, state.modifiers); }
        catch { return []; }
    }, [state?.board, state?.valid, state?.active, state?.default, state?.config.manualDefault, state?.config.hands, state?.config.layoutId, state?.modifiers?.shift, state?.modifiers?.capsLock]);
    useEffect(() => {
        document.documentElement.style.background = 'transparent'; document.body.style.background = 'transparent';
        document.body.style.margin = '0'; document.body.style.overflow = 'hidden';
    }, []);
    // Adaptive contrast (prototype): the Host sends what's behind the overlay; restyle each key for it.
    const adaptive = state?.config.adaptiveContrast === true;
    const appearance = state?.config.appearance;
    const [keyAppearance, setKeyAppearance] = useState<Map<number, Appearance>>();
    const darkLegend = useRef(new Map<number, boolean>());
    useEffect(() => {
        if (!adaptive || !appearance) { setKeyAppearance(undefined); darkLegend.current.clear(); return; }
        const onBackdrop = (event: Event) => {
            const backdrop = (event as CustomEvent<Backdrop | null>).detail;
            if (!backdrop) { setKeyAppearance(undefined); return; }
            const lum = decodeBackdrop(backdrop);
            const next = new Map<number, Appearance>();
            for (const g of document.querySelectorAll<SVGGElement>('.trainer-native-surface [data-key-id]')) {
                const id = Number(g.dataset.keyId), rect = g.querySelector('rect')?.getBoundingClientRect();
                const sample = rect && sampleRect(lum, backdrop, innerWidth, innerHeight, rect);
                if (!sample) continue;
                const dark = wantsDarkLegend(sample.mean, darkLegend.current.get(id));
                darkLegend.current.set(id, dark);
                next.set(id, adaptAppearance(appearance, sample, dark));
            }
            setKeyAppearance(next);
        };
        window.addEventListener('keybard-host-backdrop', onBackdrop);
        return () => window.removeEventListener('keybard-host-backdrop', onBackdrop);
    }, [adaptive, appearance]);
    const bindingSignature = keys.map(k => `${k.id}:${k.code}:${k.layer}`).join(',');
    useEffect(() => {
        const before = new Map(previous.current.map(k => [k.id, `${k.code}:${k.layer}`]));
        setChanged(new Set(keys.filter(k => before.has(k.id) && before.get(k.id) !== `${k.code}:${k.layer}`).map(k => k.id)));
        previous.current = keys;
        const timer = setTimeout(() => setChanged(new Set()), state?.config.duration ?? 150);
        return () => clearTimeout(timer);
    }, [bindingSignature, state?.config.duration]);
    if (!state?.valid || !keys.length || !state.visible) return null;
    return <div className="trainer-native-surface"><OverlaySurface keys={keys} appearance={state.config.appearance}
        effect={state.config.effect} duration={state.config.duration} changed={changed}
        held={new Set(state.pressed)} hidden={new Set(state.practiceHidden)} target={state.practiceTarget ?? undefined}
        capitals={state.config.capitalAlphas === true} keyAppearance={keyAppearance} /></div>;
}
