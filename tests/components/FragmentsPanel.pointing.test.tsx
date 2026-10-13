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
    it('lists the ten key positions and not the pointing slots', () => {
        mocks.keyboard = createSvalboardPointingKbinfo({ hwDetection: [[IDX.left, ID.pointing_trackpoint]] });
        render(<FragmentsPanel />);
        expect(screen.getAllByRole('combobox')).toHaveLength(10);
        expect(screen.queryByText(/pointing/i)).toBeNull();
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
