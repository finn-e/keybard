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

// A mocked board: 0x18 and 0x2C answer what `board` says at the time of the read.
const board = vi.hoisted(() => ({
    hw: new Map<number, number>(),
    report: null as PointingHardwareReport | null,
    has2C: true,
}));
const deps: PointingDetectDeps = {
    readHardwareDetection: vi.fn(async () => new Map(board.hw)),
    readPointingHardware: vi.fn(async () => board.report),
    hasPointingHardware: () => board.has2C,
};
const reads = () => (deps.readHardwareDetection as ReturnType<typeof vi.fn>).mock.calls.length;

// Each half: [flags] [built_for] [detected] [id0] [id1]; flag bits: reported, left, started, auto.
const LEFT_AUTO = 0x0b, RIGHT_AUTO = 0x09;
const report2C = (left: number[], right: number[]) => parsePointingHardware(new Uint8Array([0x2c, 1, ...left, ...right]))!;
const NONE_BOTH = () => report2C([LEFT_AUTO, 0, 3, 0, 0], [RIGHT_AUTO, 0, 3, 0, 0]);
const LEFT_3389 = () => report2C([LEFT_AUTO | 0x04, 2, 2, 0x47, 0xb8], [RIGHT_AUTO, 0, 3, 0, 0]);

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
        vi.mocked(deps.readPointingHardware).mockClear();
        board.hw = new Map([[IDX.left, ID.pointing_none], [IDX.right, ID.pointing_none]]);
        board.report = NONE_BOTH();
        board.has2C = true;
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
        board.report = LEFT_3389();
        await at(2000);
        expect(reads()).toBe(6);
        expect(row(container, 'left').textContent).toContain('Auto-detected');
        expect(row(container, 'left').querySelector('[role="status"]')!.textContent).toBe('PMW3389 trackball');
        expect(getByTestId('drawn').textContent).toBe('trackball/-');
        // Written into the board state once, the same in the draft and the loaded copy: no unsaved edit.
        expect(state!.keyboard.fragmentState!.hwDetection.get(IDX.left)).toBe(ID.pointing_trackball_pmw3389);
        expect(state!.keyboard.pointing_hardware!.halves.find((h) => h.side === 'left')!.detected).toBe('pmw3389');
        expect(serialize(state!.keyboard)).toBe(serialize(state!.original));
        // No dialog: an auto build that picked the module up is fine.
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
        expect(deps.readPointingHardware).not.toHaveBeenCalled();
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

    it('older firmware with no pointing slots and no 0x2C: never polls', async () => {
        const kb = createSvalboardPointingKbinfo({ withPointing: false }) as KeyboardInfo;
        board.has2C = false;
        const poller = new PointingDetectPoller(deps);
        poller.start(kb, vi.fn());
        expect(poller.isPolling).toBe(false);
        await at(60 * 1000);
        expect(reads()).toBe(0);
    });

    it('a board without pointing slots waits on its 0x2C halves', async () => {
        const kb = createSvalboardPointingKbinfo({ withPointing: false }) as KeyboardInfo;
        kb.feature_flags2 = 0x02;
        kb.pointing_hardware = NONE_BOTH();
        const onUpdate = vi.fn();
        const poller = new PointingDetectPoller(deps);
        poller.start(kb, onUpdate);
        expect(poller.isPolling).toBe(true);
        board.report = report2C([LEFT_AUTO | 0x04, 2, 2, 0x47, 0xb8], [RIGHT_AUTO | 0x04, 5, 5, 0, 40]);
        await at(STEP);
        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(onUpdate.mock.calls[0][0].pointingHardware.halves.map((h: { detected: string }) => h.detected)).toEqual(['pmw3389', 'azoteq']);
        expect(poller.isPolling).toBe(false);
        expect(reads()).toBe(0);
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
