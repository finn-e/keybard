import { useEffect, useMemo, useState } from 'react';

import { PointingDevice } from '@/components/pointing-viz/PointingDevice';
import { pillColorsFromTokens } from '@/components/pointing-viz/PointingLayer';
import { BALL_GLOSS, BALL_SPARKLE, DEFAULT_BALL } from '@/components/pointing-viz/webgl/materials';
import { ReportFeed } from '@/hooks/usePointingDevices';
import { placeDevice, type KeyRect } from '@/utils/pointing-geometry';
import { boostLabel, pointingFactors, sniperLabel } from '@/utils/pointing-multiplier';
import { hostPointingConfig, hostPointingEvent, hostPointingLook, type HostPointingConfig, type HostPointingLook } from './host-pointing';

export type HandKind = 'trackball' | 'touchpad' | null;

interface Props {
    /** The overlay's keys, in key units (as OverlaySurface draws them). */
    keys: KeyRect[];
    /** Each hand's module, from the Host's profile. */
    pointing?: { left?: string | null; right?: string | null } | null;
    config: unknown;
    look?: unknown;
    keymap?: number[][];
    /** For the review demo: a feed and modes that don't come from the Host. */
    feed?: ReportFeed;
    modes?: { sniper: boolean; boost: boolean };
}

const kindOf = (v: unknown): HandKind => (v === 'trackball' || v === 'touchpad' ? v : null);

/** Where the OverlaySurface SVG puts key unit (0, 0) and how big a unit is, in window px. */
function surfaceFrame(keys: KeyRect[], w: number, h: number) {
    const minX = Math.min(...keys.map(k => k.x)), minY = Math.min(...keys.map(k => k.y));
    const width = Math.max(...keys.map(k => k.x + k.w)) - minX, height = Math.max(...keys.map(k => k.y + k.h)) - minY;
    const vbW = width * 40 + 8, vbH = height * 40 + 8;
    const s = Math.min(w / vbW, h / vbH);
    return { minX, minY, unitPx: 40 * s, x: (w - vbW * s) / 2 + 4 * s, y: (h - vbH * s) / 2 + 4 * s };
}

/**
 * The pointing devices in the Keybard Host overlay. With "Show pointing devices"
 * on, the same renderer as Keybard draws each hand's module where it sits; with
 * it off, only the sniper and boost pills show, centered where the device would
 * be. Motion arrives from the Host as keybard-host-pointing events.
 */
export function PointingOverlayLayer({ keys, pointing, config, look, keymap, feed: demoFeed, modes: demoModes }: Props) {
    const cfg: HostPointingConfig = hostPointingConfig(config);
    const balls: HostPointingLook = hostPointingLook(look);
    const [size, setSize] = useState(() => ({ w: typeof window !== 'undefined' ? window.innerWidth : 1000, h: typeof window !== 'undefined' ? window.innerHeight : 300 }));
    const ownFeed = useMemo(() => new ReportFeed(), []);
    const feed = demoFeed ?? ownFeed;
    const [modes, setModes] = useState({ sniper: false, boost: false });
    const [moving, setMoving] = useState<'left' | 'right'>('right');

    useEffect(() => {
        const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    useEffect(() => {
        if (demoFeed) return;
        const on = (event: Event) => {
            const r = hostPointingEvent((event as CustomEvent).detail);
            if (!r) return;
            ownFeed.push(r, r.elapsedMs);
            setModes(m => (m.sniper === r.sniper && m.boost === r.boost ? m : { sniper: r.sniper, boost: r.boost }));
        };
        window.addEventListener('keybard-host-pointing', on);
        return () => window.removeEventListener('keybard-host-pointing', on);
    }, [demoFeed, ownFeed]);

    const kinds = { left: kindOf(pointing?.left), right: kindOf(pointing?.right) };
    const frame = useMemo(() => (keys.length ? surfaceFrame(keys, size.w, size.h) : null), [keys, size.w, size.h]);
    const rel = useMemo(() => (frame ? keys.map(k => ({ x: k.x - frame.minX, y: k.y - frame.minY, w: k.w, h: k.h })) : []), [keys, frame]);
    const factors = useMemo(() => pointingFactors(keymap), [keymap]);
    const labels = { sniper: sniperLabel(factors.sniperDivisor), boost: boostLabel(factors.boostFactor) };
    const pillColors = useMemo(() => pillColorsFromTokens(true), []);
    const m = demoModes ?? modes;

    if (!frame || (!kinds.left && !kinds.right) || (!cfg.showPointing && !cfg.pointingPills)) return null;
    const ghost = !cfg.showPointing;
    const modesAt = kinds[moving] ? moving : kinds.right ? 'right' : 'left';
    return (
        <div className="pointer-events-none" data-host-pointing={ghost ? 'pills' : 'devices'} style={{ position: 'fixed', inset: 0 }}>
            {(['left', 'right'] as const).map(side => {
                const kind = kinds[side];
                if (!kind) return null;
                const ball = balls[side] ?? DEFAULT_BALL;
                const pl = placeDevice(rel, side, kind === 'trackball' ? 'ball' : 'pad', ball);
                if (!pl) return null;
                return (
                    <PointingDevice
                        key={side}
                        placement={pl}
                        unitPx={frame.unitPx}
                        originPx={{ x: frame.x, y: frame.y }}
                        ball={ball}
                        gloss={balls.gloss ?? BALL_GLOSS}
                        sparkle={balls.sparkle ?? BALL_SPARKLE}
                        theme="dark"
                        feed={feed}
                        sniper={cfg.pointingPills && m.sniper}
                        boost={cfg.pointingPills && m.boost}
                        showModes={modesAt === side}
                        labels={labels}
                        pillColors={pillColors}
                        ghost={ghost}
                        host
                        onMoved={s => setMoving(v => (v === s ? v : s))}
                    />
                );
            })}
        </div>
    );
}
