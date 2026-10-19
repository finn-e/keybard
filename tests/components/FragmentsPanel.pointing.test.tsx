import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { createSvalboardPointingKbinfo, POINTING_FRAGMENT_IDS as ID, POINTING_INSTANCE_IDX as IDX } from '../fixtures/fragments.fixture';

// Real FragmentService + composer over the Svalboard definition with the two
// pointing slots: the slots must not show up as hardware positions to choose.
const mocks = vi.hoisted(() => ({ keyboard: null as any, setKeyboard: vi.fn(), queue: vi.fn(), update: vi.fn(async () => true), save: vi.fn() }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: mocks.keyboard, setKeyboard: mocks.setKeyboard, isConnected: true, getKeyboardSnapshot: () => mocks.keyboard }) }));
vi.mock('@/contexts/ChangesContext', () => ({ useChanges: () => ({ queue: mocks.queue }) }));
vi.mock('@/contexts/LayoutSettingsContext', () => ({ useLayoutSettings: () => ({ layoutMode: 'sidebar' }) }));
vi.mock('@/services/keyboard.service', async () => {
    const { FragmentService } = await import('../../src/services/fragment.service');
    const { FragmentComposerService } = await import('../../src/services/fragment-composer.service');
    const { KleService } = await import('../../src/services/kle.service');
    const fragments = new FragmentService(null as any);
    const composer = new FragmentComposerService(new KleService(), fragments);
    return { keyboardService: { getFragmentService: () => fragments, getFragmentComposer: () => composer, updateFragmentSelection: mocks.update, saveSvil: mocks.save } };
});

import FragmentsPanel from '../../src/layout/SecondarySidebar/Panels/FragmentsPanel';

describe('FragmentsPanel with pointing slots', () => {
    it('lists the ten key positions to choose and each pointing slot locked to its detected module', () => {
        mocks.keyboard = createSvalboardPointingKbinfo({ hwDetection: [[IDX.left, ID.pointing_trackpoint]] });
        const { container } = render(<FragmentsPanel />);
        expect(screen.getAllByRole('combobox')).toHaveLength(10);
        const left = container.querySelector('[data-pointing-instance="left_pointing"]')!;
        const right = container.querySelector('[data-pointing-instance="right_pointing"]')!;
        expect(left).toBeTruthy();
        expect(right).toBeTruthy();
        expect(left.textContent).toContain('Auto-detected');
        expect(left.querySelector('[role="status"]')!.textContent).toBe(
            mocks.keyboard.fragments.pointing_trackpoint.description ?? 'pointing_trackpoint');
        // Not reported yet: listed, not locked, no module named.
        expect(right.textContent).not.toContain('Auto-detected');
        expect(right.querySelector('[role="status"]')!.textContent).toBe('Detecting');
        expect(left.querySelector('button, [role="combobox"], select')).toBeNull();
    });

    it('lists no pointing rows for older firmware without pointing slots', async () => {
        const { createKbinfoWithFragments } = await import('../fixtures/fragments.fixture');
        mocks.keyboard = createKbinfoWithFragments();
        const { container } = render(<FragmentsPanel />);
        expect(container.querySelector('[data-pointing-instance]')).toBeNull();
    });

    it('a finger row says "Auto-detected: …" only for a real detection', async () => {
        const { createKbinfoWithFragments, FRAGMENT_IDS } = await import('../fixtures/fragments.fixture');
        mocks.keyboard = createKbinfoWithFragments({ fragmentState: { hwDetection: [[1, FRAGMENT_IDS.FINGER_6KEY]] as any } });
        const { unmount } = render(<FragmentsPanel />);
        expect(screen.getAllByText(/^Auto-detected: /)).toHaveLength(1);
        unmount();
        mocks.keyboard = createKbinfoWithFragments({ fragmentState: { hwDetection: [[1, 0xff]] as any } });
        render(<FragmentsPanel />);
        expect(screen.queryByText(/Auto-detected/)).toBeNull();
    });

    it('"Restore default" never writes a selection for a pointing slot', async () => {
        mocks.keyboard = createSvalboardPointingKbinfo({ sixKey: true });
        render(<FragmentsPanel />);
        fireEvent.click(screen.getByRole('button', { name: 'Restore default hardware selections' }));
        await waitFor(() => expect(mocks.queue).toHaveBeenCalled());
        const labels = mocks.queue.mock.calls.map((c) => c[0] as string);
        expect(labels.some((l) => l.includes('pointing'))).toBe(false);
        for (const call of mocks.queue.mock.calls) await call[1]();
        expect(mocks.update.mock.calls.map((c) => c[1])).not.toContain(IDX.left);
        expect(mocks.update.mock.calls.map((c) => c[1])).not.toContain(IDX.right);
    });
});
