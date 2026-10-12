import { useEffect, useMemo, useRef, useState } from 'react';
import { OverlaySurface, type SurfaceKey } from './OverlaySurface';
import { useHost } from './host';
import { surfaceKeys } from './useSurfaceKeys';
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
        capitals={state.config.capitalAlphas === true} /></div>;
}
