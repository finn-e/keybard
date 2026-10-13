import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULTS, STORAGE_KEY } from '@/features/trainer/core';
import { DEMO } from '@/features/trainer/useFeedbackDemo';

const hostState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/features/trainer/host', async (original) => ({
    ...(await original<typeof import('@/features/trainer/host')>()),
    useHost: () => ({ state: hostState.current, busy: false, error: '', local: true, build: null, configure: vi.fn(), command: vi.fn(), connect: vi.fn() }),
}));
vi.mock('@/features/trainer/HostInstall', () => ({ HostInstall: () => null, HostVersion: () => null }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: null, originalKeyboard: null, hasUnsavedChanges: false }) }));
vi.mock('@/contexts/LayoutSettingsContext', () => ({ useLayoutSettings: () => ({ internationalLayout: 'us' }) }));
import TrainerPage, { EFFECTS } from '@/features/trainer/TrainerPage';

const saved = () => JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');

beforeEach(() => { localStorage.clear(); hostState.current = null; });
afterEach(() => vi.useRealTimers());

describe('Overlay settings panel', () => {
    it('is one panel with no tabs, and every control has a name', () => {
        render(<TrainerPage />);
        expect(screen.queryByRole('tablist')).toBeNull();
        expect(screen.getByRole('group', { name: 'Overlay settings' })).toBeTruthy();
        for (const name of ['Key fill opacity', 'Outline opacity', 'Legend opacity', 'Key fill color', 'Outline color', 'Legend color',
            'Layer change color', 'Held key color', 'Contrasting legend halo', 'Reset style'])
            expect(screen.getByLabelText(name)).toBeTruthy();
        for (const name of ['Outline width', 'Hands']) expect(screen.getByRole('group', { name })).toBeTruthy();
        expect(screen.getByRole('radiogroup', { name: 'Layer-change highlight' })).toBeTruthy();
    });

    it('moves opacity in steps of 10', () => {
        render(<TrainerPage />);
        for (const name of ['Key fill opacity', 'Outline opacity', 'Legend opacity'])
            expect(screen.getByLabelText(name).getAttribute('step')).toBe('10');
    });

    it('sets the layer-change effect and its duration together', () => {
        render(<TrainerPage />);
        for (const [text, value] of EFFECTS) {
            fireEvent.click(screen.getByRole('radio', { name: text }));
            expect(screen.getByRole('radio', { name: text }).getAttribute('aria-checked')).toBe('true');
            expect(saved()).toMatchObject(value);
        }
    });

    it('resets only the style, leaving hands and size alone', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULTS, hands: 'Left', scale: 120, effect: 'Off', appearance: { ...DEFAULTS.appearance, fillAlpha: 50 } }));
        render(<TrainerPage />);
        fireEvent.click(screen.getByLabelText('Reset style'));
        expect(saved()).toMatchObject({ hands: 'Left', scale: 120, effect: DEFAULTS.effect, duration: DEFAULTS.duration, appearance: DEFAULTS.appearance });
    });

    it('drops the old Placement controls', () => {
        render(<TrainerPage />);
        for (const text of ['Place at bottom', 'Reload layout', 'Preview held keys', 'Reset appearance and view'])
            expect(screen.queryByText(text)).toBeNull();
        expect(screen.queryByLabelText(/Overlay size/)).toBeNull();
    });
});

describe('Self-running feedback preview', () => {
    it('flips layers with the highlight and shows a held chord, then repeats', () => {
        vi.useFakeTimers();
        const { container } = render(<TrainerPage />);
        const legends = () => [...container.querySelectorAll('.trainer-canvas [data-key-id]')].map(g => g.textContent).join('|');
        // The demo starts at once, on the alternate layer.
        const flipped = legends();
        act(() => { vi.advanceTimersByTime(DEMO.chordAt); });
        // A held key draws an extra rect filled with the pressed color.
        const pressed = DEFAULTS.appearance.pressed;
        expect(container.querySelectorAll(`.trainer-canvas rect[fill="${pressed}"]`).length).toBe(3);
        act(() => { vi.advanceTimersByTime(DEMO.backAt - DEMO.chordAt); });
        expect(legends()).not.toBe(flipped); // back on the preview layer
        act(() => { vi.advanceTimersByTime(DEMO.period - DEMO.backAt); });
        expect(legends()).toBe(flipped); // and again
    });

    it('stays still while the pointer is over the preview', () => {
        vi.useFakeTimers();
        const { container } = render(<TrainerPage />);
        const card = container.querySelector('.trainer-preview-card')!;
        act(() => { card.dispatchEvent(new Event('pointerenter')); });
        const legends = () => [...container.querySelectorAll('.trainer-canvas [data-key-id]')].map(g => g.textContent).join('|');
        const atRest = legends();
        act(() => { vi.advanceTimersByTime(DEMO.period * 2); });
        expect(legends()).toBe(atRest);
    });

    it('never runs while following the live board', () => {
        vi.useFakeTimers();
        hostState.current = { config: { ...DEFAULTS, highlightPressed: true, manualDefault: 1 }, revision: 1, board: null, valid: false, devices: [], selectedDevice: null, pressed: [], status: '' };
        const { container } = render(<TrainerPage />);
        act(() => { vi.advanceTimersByTime(DEMO.period); });
        expect(container.querySelectorAll('.trainer-canvas rect[fill="' + DEFAULTS.appearance.pressed + '"]').length).toBe(0);
    });
});
