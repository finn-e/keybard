import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useCallback, useState } from 'react';

import {
    POINTING_DETECT_INTERVAL_MS as STEP,
    POINTING_DETECT_WINDOW_MS,
    PointingDetectPoller,
    withPointingDetection,
    type PointingDetectDeps,
} from '../../src/services/pointing-detect.service';
import { usePointingDetection } from '../../src/hooks/usePointingDetection';
import type { KeyboardInfo } from '../../src/types/keyboard.types';
import { parsePointingHardware, type PointingHardwareReport } from '../../src/utils/pointing-hardware';
import { createSvalboardPointingKbinfo, POINTING_FRAGMENT_IDS as ID, POINTING_INSTANCE_IDX as IDX } from '../fixtures/fragments.fixture';

// A mocked board: 0x18 answers what `board` says at the time of the read. The
// poller never reads 0x2C; `board.report` is what 0x2C would say if it did.
const board = vi.hoisted(() => ({
    hw: new Map<number, number>(),
    report: null as PointingHardwareReport | null,
}));
const deps: PointingDetectDeps = {
    readHardwareDetection: vi.fn(async () => new Map(board.hw)),
};
const reads = () => (deps.readHardwareDetection as ReturnType<typeof vi.fn>).mock.calls.length;

// Each half: [flags] [built_for] [detected] [id0] [id1]; flag bits: reported, left, started, auto.
const LEFT_AUTO = 0x0b, RIGHT_AUTO = 0x09;
const report2C = (left: number[], right: number[]) => parsePointingHardware(new Uint8Array([0x2c, 1, ...left, ...right]))!;
const NONE_BOTH = () => report2C([LEFT_AUTO, 0, 3, 0, 0], [RIGHT_AUTO, 0, 3, 0, 0]);
// The left half's auto build started with nothing and a PMW3389 answers now: the
// dialog's "not picked up" case, if a late 0x2C read ever reached it.
const LEFT_3389_NOT_STARTED = () => report2C([LEFT_AUTO, 0, 2, 0x47, 0xb8], [RIGHT_AUTO, 0, 3, 0, 0]);

const mocks = vi.hoisted(() => ({ ctx: { keyboard: null as any, isConnected: true, connectionSessionId: 1 } }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ ...mocks.ctx, setKeyboard: vi.fn(), getKeyboardSnapshot: () => mocks.ctx.keyboard }) }));
vi.mock('@/contexts/ChangesContext', () => ({ useChanges: () => ({ queue: vi.fn() }) }));
vi.mock('@/contexts/LayoutSettingsContext', () => ({ useLayoutSettings: () => ({ layoutMode: 'sidebar' }) }));
vi.mock('@/components/pointing-viz/PointingBallPicker', () => ({ PointingBallPicker: () => null }));
vi.mock('@/services/keyboard.service', async () => {
    const { FragmentService } = await import('../../src/services/fragment.service');
    const { FragmentComposerService } = await import('../../src/services/fragment-composer.service');
    const { KleService } = await import('../../src/services/kle.service');
    const fragments = new FragmentService(null as any);
    const composer = new FragmentComposerService(new KleService(), fragments);
    return { keyboardService: { getFragmentService: () => fragments, getFragmentComposer: () => composer } };
});

import FragmentsPanel from '../../src/layout/SecondarySidebar/Panels/FragmentsPanel';
import { TrackballMismatchDialog } from '../../src/components/TrackballMismatchDialog';
import { usePointingKinds } from '../../src/hooks/usePointingDevices';

const at = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
function connectedBoard(hw: [number, number][] = [[IDX.left, ID.pointing_none], [IDX.right, ID.pointing_none]]): KeyboardInfo {
    const kb = createSvalboardPointingKbinfo({ hwDetection: hw }) as KeyboardInfo;
    kb.feature_flags2 = 0x02;
    kb.pointing_hardware = NONE_BOTH();
    return kb;
}

/** Stand-in for KeyboardProvider: keeps the draft and the loaded copy, runs the one poller. */
let state: { keyboard: KeyboardInfo; original: KeyboardInfo } | null = null;
function Kinds() {
    const kinds = usePointingKinds();
    return <div data-testid="drawn">{`${kinds.left ?? '-'}/${kinds.right ?? '-'}`}</div>;
}
function Harness({ initial }: { initial: KeyboardInfo }) {
    const [kbs, setKbs] = useState(() => ({ keyboard: initial, original: structuredClone(initial) }));
    state = kbs;
    mocks.ctx.keyboard = kbs.keyboard;
    usePointingDetection({
        connected: true,
        boardLoad: 1,
        getKeyboard: () => state!.keyboard,
        apply: useCallback((patch) => setKbs((s) => ({ keyboard: patch(s.keyboard), original: patch(s.original) })), []),
        deps,
    });
    return <><FragmentsPanel /><TrackballMismatchDialog /><Kinds /></>;
}
const row = (c: HTMLElement, side: string) => c.querySelector(`[data-pointing-instance="${side}_pointing"]`)!;
const serialize = (v: unknown) => JSON.stringify(v, (_k, x) => x instanceof Map ? [...x.entries()] : x);

describe('late pointing detection', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.mocked(deps.readHardwareDetection).mockClear();
        board.hw = new Map([[IDX.left, ID.pointing_none], [IDX.right, ID.pointing_none]]);
        board.report = NONE_BOTH();
        state = null;
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('none, then a PMW3389 after 12 s: the row, the drawn device and the board state update, and polling stops', async () => {
        const { container, getByTestId } = render(<Harness initial={connectedBoard()} />);
        expect(row(container, 'left').querySelector('[role="status"]')!.textContent).toBe('No pointing module');
        expect(getByTestId('drawn').textContent).toBe('-/-');

        await at(10 * 1000);
        expect(reads()).toBe(5);
        expect(row(container, 'left').querySelector('[role="status"]')!.textContent).toBe('No pointing module');

        board.hw = new Map([[IDX.left, ID.pointing_trackball_pmw3389], [IDX.right, ID.pointing_none]]);
        board.report = LEFT_3389_NOT_STARTED();
        await at(2000);
        expect(reads()).toBe(6);
        expect(row(container, 'left').textContent).toContain('Auto-detected');
        expect(row(container, 'left').querySelector('[role="status"]')!.textContent).toBe('PMW3389 trackball');
        expect(getByTestId('drawn').textContent).toBe('trackball/-');
        // Written into the board state once, the same in the draft and the loaded copy: no unsaved edit.
        expect(state!.keyboard.fragmentState!.hwDetection.get(IDX.left)).toBe(ID.pointing_trackball_pmw3389);
        // pointing_hardware stays as read at connect: the dialog never hears of a late find.
        expect(state!.keyboard.pointing_hardware).toEqual(NONE_BOTH());
        expect(serialize(state!.keyboard)).toBe(serialize(state!.original));
        expect(document.querySelector('[role="dialog"]')).toBeNull();

        // The right hand still has none: it keeps polling for that hand, and a
        // module the board finds at its last probe (30 s) is still picked up.
        await at(30 * 1000 - 12 * 1000 - 1);
        expect(row(container, 'right').querySelector('[role="status"]')!.textContent).toBe('No pointing module');
        board.hw = new Map([[IDX.left, ID.pointing_trackball_pmw3389], [IDX.right, ID.pointing_touchpad_azoteq]]);
        await at(STEP + 1);
        expect(row(container, 'right').querySelector('[role="status"]')!.textContent).toBe('Azoteq touchpad');
        expect(getByTestId('drawn').textContent).toBe('trackball/touchpad');
        const done = reads();
        await at(60 * 1000);
        expect(reads()).toBe(done);
    });

    it('stays none: polls every 2 s up to 35 s after connect, then stops for good', async () => {
        render(<Harness initial={connectedBoard()} />);
        await at(STEP - 1);
        expect(reads()).toBe(0);
        await at(1);
        expect(reads()).toBe(1);
        await at(32 * 1000); // 34 s: the last read inside the window
        expect(reads()).toBe(17);
        await at(POINTING_DETECT_WINDOW_MS);
        expect(reads()).toBe(17);
        await at(10 * 60 * 1000);
        expect(reads()).toBe(17);
        // Nothing changed, so nothing was written.
        expect(serialize(state!.keyboard)).toBe(serialize(state!.original));
    });

    it('a module on each hand at connect: no polling', async () => {
        const kb = connectedBoard([[IDX.left, ID.pointing_trackball_pmw3360], [IDX.right, ID.pointing_touchpad_azoteq]]);
        const poller = new PointingDetectPoller(deps);
        poller.start(kb, vi.fn());
        expect(poller.isPolling).toBe(false);
        render(<Harness initial={kb} />);
        await at(60 * 1000);
        expect(reads()).toBe(0);
    });

    it('"Detecting" at connect turns into the module; a hand that showed none never goes back to "Detecting"', async () => {
        board.hw = new Map();
        const { container } = render(<Harness initial={connectedBoard([])} />);
        expect(row(container, 'left').querySelector('[role="status"]')!.textContent).toBe('Detecting');
        await at(STEP);
        expect(row(container, 'left').querySelector('[role="status"]')!.textContent).toBe('Detecting');
        board.hw = new Map([[IDX.left, ID.pointing_trackpoint], [IDX.right, ID.pointing_none]]);
        await at(STEP);
        expect(row(container, 'left').querySelector('[role="status"]')!.textContent).toBe('TrackPoint');
        expect(row(container, 'right').querySelector('[role="status"]')!.textContent).toBe('No pointing module');
        board.hw = new Map([[IDX.left, ID.pointing_trackpoint]]);
        await at(STEP);
        expect(row(container, 'right').querySelector('[role="status"]')!.textContent).toBe('No pointing module');
    });

    it('older firmware with no pointing slots: never polls', async () => {
        const kb = createSvalboardPointingKbinfo({ withPointing: false }) as KeyboardInfo;
        kb.feature_flags2 = 0x02;
        kb.pointing_hardware = NONE_BOTH();
        const poller = new PointingDetectPoller(deps);
        poller.start(kb, vi.fn());
        expect(poller.isPolling).toBe(false);
        await at(60 * 1000);
        expect(reads()).toBe(0);
    });

    it('a late find opens no dialog, even when 0x2C would have looked like a problem then', async () => {
        render(<Harness initial={connectedBoard()} />);
        board.hw = new Map([[IDX.left, ID.pointing_trackball_pmw3389], [IDX.right, ID.pointing_trackpoint]]);
        board.report = LEFT_3389_NOT_STARTED();
        await at(STEP);
        expect(state!.keyboard.fragmentState!.hwDetection.get(IDX.left)).toBe(ID.pointing_trackball_pmw3389);
        await at(POINTING_DETECT_WINDOW_MS);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(document.body.textContent).not.toMatch(/picked up|firmware/i);
        expect(state!.keyboard.pointing_hardware).toEqual(NONE_BOTH());
    });

    it('"Auto-detected" only on a real module: not on "Detecting", not on no module', async () => {
        board.hw = new Map();
        const { container } = render(<Harness initial={connectedBoard([])} />);
        const label = (side: string) => row(container, side).textContent!.includes('Auto-detected');
        expect(label('left')).toBe(false);
        expect(label('right')).toBe(false);
        board.hw = new Map([[IDX.left, ID.pointing_none], [IDX.right, ID.pointing_none]]);
        await at(STEP);
        expect(row(container, 'left').querySelector('[role="status"]')!.textContent).toBe('No pointing module');
        expect(label('left')).toBe(false);
        expect(label('right')).toBe(false);
        board.hw = new Map([[IDX.left, ID.pointing_touchpad_azoteq], [IDX.right, ID.pointing_none]]);
        await at(STEP);
        expect(label('left')).toBe(true);
        expect(label('right')).toBe(false);
        // The finger and thumb rows here have no detection, so none says "Detected" either.
        const others = [...container.querySelectorAll('.panel-layer-item')].filter((el) => !el.hasAttribute('data-pointing-instance'));
        expect(others.length).toBeGreaterThan(0);
        for (const el of others) expect(el.textContent).not.toMatch(/Detected/i);
    });

    it('a failed read changes nothing', async () => {
        vi.mocked(deps.readHardwareDetection).mockRejectedValueOnce(new Error('gone'));
        const onUpdate = vi.fn();
        const poller = new PointingDetectPoller(deps);
        poller.start(connectedBoard(), onUpdate);
        await at(STEP);
        expect(onUpdate).not.toHaveBeenCalled();
        expect(poller.isPolling).toBe(true);
        poller.stop();
        expect(poller.isPolling).toBe(false);
    });

    it('withPointingDetection keeps everything else, including a plain-object detection map from a file', () => {
        const kb = connectedBoard();
        (kb.fragmentState as any).hwDetection = { 0: 1, [IDX.left]: ID.pointing_none };
        const next = withPointingDetection(kb, { hwDetection: new Map([[IDX.left, ID.pointing_trackpoint]]) });
        expect(next.fragmentState!.hwDetection).toEqual(new Map([[0, 1], [IDX.left, ID.pointing_trackpoint]]));
        expect(next.keylayout).toBe(kb.keylayout);
        expect(next.pointing_hardware).toBe(kb.pointing_hardware);
    });
});
