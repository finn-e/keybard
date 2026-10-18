import { useEffect, useMemo, useState } from 'react';

import demoLayoutUrl from '@/default-layouts/sval-default.svil?url';
import { pointingDemo } from '@/features/pointing-demo';
import { ReportFeed, startDemoFeed } from '@/hooks/usePointingDevices';
import { getBalls } from '@/services/pointing-look.service';
import { fileService } from '@/services/file.service';
import type { KeyboardInfo } from '@/types/keyboard.types';
import { PRESETS } from './core';
import { OverlaySurface } from './OverlaySurface';
import { PointingOverlayLayer } from './PointingOverlayLayer';
import { surfaceKeys } from './useSurfaceKeys';
import './trainer.css';

/**
 * ?hostOverlay=1&hostDemo=pointing: the Keybard Host overlay as it draws the
 * pointing devices, without a Host or a board, for review. The QWERTY Example
 * with a left touchpad and a right trackball, scripted motion, and the Host's
 * pointing settings from the URL: &showDevices=1|0, &pills=0, &sniper=1, &boost=1,
 * &velocity=1 (Velocity Scroll held, with &velViz=).
 */
export default function HostPointingDemo() {
    const demo = pointingDemo();
    const [board, setBoard] = useState<KeyboardInfo | null>(null);
    const feed = useMemo(() => new ReportFeed(), []);
    useEffect(() => {
        let alive = true;
        void fetch(demoLayoutUrl).then(r => r.text()).then(t => { if (alive) setBoard(fileService.parseContent(t)); }).catch(() => {});
        return () => { alive = false; };
    }, []);
    useEffect(() => (demo?.motion || demo?.velocity ? startDemoFeed(demo, feed) : undefined), [demo, feed]);
    const params = new URLSearchParams(window.location.search);
    const flag = (k: string, dflt: boolean) => (params.has(k) ? !/^(0|false|off|no)$/i.test(params.get(k) ?? '') : dflt);
    const config = { showPointing: flag('showDevices', true), pointingPills: flag('pills', true) };
    const keys = useMemo(() => {
        if (!board) return [];
        try { return surfaceKeys(board, 1, 1, 'Both'); } catch { return []; }
    }, [board]);
    const balls = getBalls(board?.kbid);
    const asKind = (k?: string) => (k === 'trackball' || k === 'touchpad' ? k : null);
    return (
        <div className="trainer-native-surface" data-host-demo="pointing" style={{ background: 'linear-gradient(135deg, #3a4654 0%, #20262d 60%, #15191d 100%)' }}>
            {keys.length > 0 && <OverlaySurface keys={keys} appearance={PRESETS['Outline only']} effect="Off" duration={150}
                changed={new Set()} held={new Set()} hidden={new Set()} />}
            {keys.length > 0 && <PointingOverlayLayer keys={keys} keymap={board?.keymap}
                pointing={{ left: asKind(demo?.left), right: asKind(demo?.right) }}
                config={config} look={balls} feed={feed} modes={{ sniper: !!demo?.sniper, boost: !!demo?.boost }} />}
        </div>
    );
}
