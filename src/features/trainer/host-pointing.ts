// Keybard Host and the pointing devices: the overlay's pointing settings (read
// with defaults, since Hosts before this release don't have them) and the
// board's look (which ball on each hand, gloss, sparkle) sent to the Host so its
// overlay draws the same balls. Nothing here reaches the board.

import { isBallId, type BallId } from '@/components/pointing-viz/webgl/materials';
import { PARANOID } from '@/lib/paranoid';
import { appStorage } from '@/utils/app-storage';
import type { PadContact } from '@/utils/pointing-contacts';
import type { PointingMotionReport } from '@/utils/pointing-motion';
import { HOST_ORIGIN } from './host';

/** The Host's pointing settings: devices off, the pills on. */
export interface HostPointingConfig { showPointing: boolean; pointingPills: boolean }
export const HOST_POINTING_DEFAULTS: HostPointingConfig = { showPointing: false, pointingPills: true };

/** The pointing settings from a Host config; missing or invalid fields take the defaults. */
export function hostPointingConfig(config: unknown): HostPointingConfig {
    const c = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
    const pick = (k: keyof HostPointingConfig) => (typeof c[k] === 'boolean' ? c[k] as boolean : HOST_POINTING_DEFAULTS[k]);
    return { showPointing: pick('showPointing'), pointingPills: pick('pointingPills') };
}

/** Whether this Host knows the pointing settings (it sends them in its config). */
export function hostHasPointing(config: unknown): boolean {
    return !!config && typeof config === 'object' && typeof (config as Record<string, unknown>).showPointing === 'boolean';
}

/** The look the Host keeps per board, as its snapshot carries it. */
export interface HostPointingLook { left?: BallId; right?: BallId; gloss?: number; sparkle?: number }
export function hostPointingLook(value: unknown): HostPointingLook {
    const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const out: HostPointingLook = {};
    if (isBallId(v.left)) out.left = v.left;
    if (isBallId(v.right)) out.right = v.right;
    for (const k of ['gloss', 'sparkle'] as const) if (typeof v[k] === 'number' && Number.isFinite(v[k])) out[k] = Math.min(1, Math.max(0, v[k] as number));
    return out;
}

/** The Host's board uid (decimal) for Keybard's kbid (hex from the board, or decimal from a file). */
export function hostUid(kbid: string | undefined | null): string | null {
    if (!kbid) return null;
    try {
        if (/^[0-9a-f]{16}$/i.test(kbid)) return BigInt('0x' + kbid).toString();
        if (/^\d{1,20}$/.test(kbid)) return BigInt(kbid).toString();
    } catch { /* not a uid */ }
    return null;
}

/** A hand's contacts from the Host (at most 5; each id 0..15, x and y -1..1). */
function hostContacts(list: unknown[]): PadContact[] {
    const out: PadContact[] = [];
    for (const item of list.slice(0, 5)) {
        if (!item || typeof item !== 'object') continue;
        const c = item as Record<string, unknown>;
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
        const id = num(c.id), x = num(c.x), y = num(c.y);
        if (id === null || x === null || y === null) continue;
        out.push({ id: Math.trunc(id) & 15, x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), confident: c.confident !== false });
    }
    return out;
}

/** The motion event the Host sends its overlay (keybard-host-pointing), validated. */
export function hostPointingEvent(detail: unknown): PointingMotionReport | null {
    if (!detail || typeof detail !== 'object') return null;
    const d = detail as Record<string, unknown>;
    const half = (h: unknown) => {
        const o = (h && typeof h === 'object' ? h : {}) as Record<string, unknown>;
        const n = (k: string) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? o[k] as number : 0);
        return {
            valid: o.valid === true, scrolling: o.scrolling === true, saturated: false, autoMouse: false,
            touchValid: o.touchValid === true, fingers: n('fingers'), dx: n('dx'), dy: n('dy'), h: 0, v: 0, buttons: 0,
            touchX: n('touchX'), touchY: n('touchY'),
            ...(n('cpi') > 0 ? { cpi: n('cpi') } : {}),
            ...(Array.isArray(o.contacts) ? { contacts: hostContacts(o.contacts) } : {}),
        };
    };
    return {
        sniper: d.sniper === true, boost: d.boost === true, autoMouseLayer: false, axisLockEnabled: false, naturalScroll: false, scrollKey: false,
        elapsedMs: typeof d.elapsedMs === 'number' ? d.elapsedMs : 16, axisLock: 'free', left: half(d.left), right: half(d.right),
    };
}

const REMOTE_KEY = 'keybard-host-remote';
const servedByHost = () => typeof document !== 'undefined' && document.documentElement.dataset.keybardHost === 'true';
function rememberedRemote() { try { return appStorage.getItem(REMOTE_KEY) === '1'; } catch { return false; } }

let token = '';
let unsupported = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Tells Keybard Host which balls this board shows, and the gloss and sparkle, so
 * the overlay matches. Only where the Host is already in use (as for layout
 * refreshes); never probes loopback otherwise. Older Hosts refuse the op once
 * and are not asked again this session.
 */
export function notifyHostPointingLook(kbid: string | undefined | null, balls: Partial<Record<'left' | 'right', BallId>>, gloss: number, sparkle: number): void {
    const uid = hostUid(kbid);
    if (!uid || unsupported) return;
    const local = servedByHost() || (typeof window !== 'undefined' && !!window.__keybardNativeState);
    if (!local && (PARANOID || !rememberedRemote())) return;
    const body = { op: 'pointingLook', uid, ...(balls.left ? { left: balls.left } : {}), ...(balls.right ? { right: balls.right } : {}), gloss, sparkle };
    clearTimeout(timer);
    timer = setTimeout(() => { void send(local ? '' : HOST_ORIGIN, body); }, 300);
}

async function send(base: string, body: Record<string, unknown>, retried = false): Promise<void> {
    try {
        if (!token) {
            const r = await fetch(`${base}/api/host/bootstrap`, { cache: 'no-store', signal: AbortSignal.timeout(1500) });
            if (!r.ok) return;
            const data = await r.json();
            if (data.apiVersion !== 1) return;
            token = data.token;
        }
        const r = await fetch(`${base}/api/host/command`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Keybard-Token': token },
            body: JSON.stringify(body), signal: AbortSignal.timeout(1500),
        });
        if (r.status === 403 && !retried) { token = ''; return send(base, body, true); }
        if (r.status === 400) unsupported = true;
    } catch { /* Host not running */ }
}

/** Tests only. */
export function _resetHostPointingForTests() { token = ''; unsupported = false; clearTimeout(timer); }
