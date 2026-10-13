import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BasicKeyboards from '../../src/layout/SecondarySidebar/Panels/BasicKeyboards';
import MouseKeysSection from '../../src/layout/SecondarySidebar/Panels/MouseKeysSection';

// Issue #45: one Left/Right toggle switches every modifier key the Standard Keys
// and Pointing panels build (chords, mod-taps, one-shots) between hands, in
// sidebar, bottom-bar and picker modes, and follows the key being edited.

const layoutSettings = {
    keyVariant: 'default' as 'small' | 'medium' | 'default',
    layoutMode: 'sidebar' as 'sidebar' | 'bottombar',
    internationalLayout: 'us',
    setInternationalLayout: vi.fn(),
};
const assignKeycode = vi.fn();
const binding: { selectedTarget: any } = { selectedTarget: null };
// 6 matrix columns; layer 0 row 0: [KC_A, RCTL(KC_A), LSFT(KC_A), KC_RSFT]
const keyboard = { cols: 6, keymap: [[0x04, 0x1104, 0x0204, 0xE5, 0, 0]] };

vi.mock('@/contexts/LayoutSettingsContext', () => ({ useLayoutSettings: () => layoutSettings }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard }) }));
vi.mock('@/contexts/LayerContext', () => ({ useLayer: () => ({ selectedLayer: 0 }) }));
vi.mock('@/contexts/KeyBindingContext', () => ({
    useKeyBinding: () => ({ assignKeycode, isBinding: true, selectedTarget: binding.selectedTarget }),
}));
vi.mock('@/utils/keys', () => ({ getKeyContents: () => undefined }));
vi.mock('@/components/Key', () => ({
    Key: ({ keycode, onClick }: { keycode: string; onClick?: () => void }) => (
        <button type="button" data-testid="key" data-keycode={keycode} onClick={onClick} />
    ),
}));

// jsdom has no ResizeObserver; QwertyKeyboard uses it to fit its width.
globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

const keycodes = () => screen.getAllByTestId('key').map((el) => el.getAttribute('data-keycode'));
const sideButton = (label: 'L' | 'R') =>
    screen.getByRole('button', { name: label });
const selectKey = (col: number) => {
    binding.selectedTarget = { type: 'keyboard', layer: 0, row: 0, col };
};

describe('BasicKeyboards: Left/Right modifier toggle', () => {
    beforeEach(() => {
        layoutSettings.layoutMode = 'sidebar';
        binding.selectedTarget = null;
        assignKeycode.mockClear();
    });

    describe.each([
        ['sidebar', 'sidebar', false],
        ['picker', 'sidebar', true],
        ['bottom bar', 'bottombar', false],
    ] as const)('%s mode', (_name, mode, isPicker) => {
        beforeEach(() => {
            layoutSettings.layoutMode = mode;
        });

        it('defaults to left and builds left-hand keys', () => {
            render(<BasicKeyboards isPicker={isPicker} />);
            expect(screen.getAllByTestId('modifier-side-toggle')).toHaveLength(1);
            expect(sideButton('L')).toHaveAttribute('aria-pressed', 'true');
            fireEvent.click(screen.getByRole('button', { name: /^shift$/i }));
            expect(keycodes()).toEqual(expect.arrayContaining(['LSFT(KC_A)', 'LSFT(KC_NO)', 'LSFT_T(KC_NO)', 'OSM(MOD_LSFT)']));
        });

        it('switches chords, mod-taps, one-shots and the QWERTY keys to the right hand', () => {
            render(<BasicKeyboards isPicker={isPicker} />);
            fireEvent.click(screen.getByRole('button', { name: /^ctrl$/i }));
            fireEvent.click(screen.getByRole('button', { name: /^shift$/i }));
            fireEvent.click(sideButton('R'));
            expect(sideButton('R')).toHaveAttribute('aria-pressed', 'true');
            const codes = keycodes();
            expect(codes).toEqual(expect.arrayContaining(['RSC(KC_A)', 'RSC(KC_NO)', 'RSC_T(KC_NO)', 'OSM(MOD_RCTL|MOD_RSFT)']));
            expect(codes.some((c) => c?.startsWith('C_S(') || c?.startsWith('LSFT('))).toBe(false);

            // Clicking a QWERTY key assigns the right-hand chord
            fireEvent.click(screen.getAllByTestId('key').find((el) => el.getAttribute('data-keycode') === 'RSC(KC_A)')!);
            expect(assignKeycode).toHaveBeenCalledWith('RSC(KC_A)');
        });

        it('never wraps the plain right-hand modifier keys', () => {
            render(<BasicKeyboards isPicker={isPicker} />);
            fireEvent.click(screen.getByRole('button', { name: /^ctrl$/i }));
            const codes = keycodes();
            expect(codes).toEqual(expect.arrayContaining(['KC_RSHIFT', 'KC_RCTRL', 'KC_RALT', 'KC_RGUI']));
            fireEvent.click(screen.getAllByTestId('key').find((el) => el.getAttribute('data-keycode') === 'KC_RSHIFT')!);
            expect(assignKeycode).toHaveBeenCalledWith('KC_RSHIFT');
        });

        it('reflects a right-hand modifier on the key being edited', () => {
            selectKey(1); // RCTL(KC_A)
            const { rerender } = render(<BasicKeyboards isPicker={isPicker} />);
            expect(sideButton('R')).toHaveAttribute('aria-pressed', 'true');
            fireEvent.click(screen.getByRole('button', { name: /^alt$/i }));
            expect(keycodes()).toContain('RALT_T(KC_A)');

            selectKey(0); // KC_A has no modifier: the choice stays
            rerender(<BasicKeyboards isPicker={isPicker} />);
            expect(sideButton('R')).toHaveAttribute('aria-pressed', 'true');

            selectKey(2); // LSFT(KC_A)
            rerender(<BasicKeyboards isPicker={isPicker} />);
            expect(sideButton('L')).toHaveAttribute('aria-pressed', 'true');

            selectKey(3); // KC_RSFT
            rerender(<BasicKeyboards isPicker={isPicker} />);
            expect(sideButton('R')).toHaveAttribute('aria-pressed', 'true');
        });
    });
});

describe('MouseKeysSection: Left/Right modifier toggle', () => {
    beforeEach(() => {
        binding.selectedTarget = null;
    });

    it.each([false, true])('applies right-hand modifiers to mouse buttons (compact=%s)', (compact) => {
        render(<MouseKeysSection compact={compact} />);
        fireEvent.click(screen.getByRole('button', { name: /^gui$/i }));
        expect(keycodes()).toContain('LGUI(KC_BTN1)');
        fireEvent.click(sideButton('R'));
        expect(keycodes()).toContain('RGUI(KC_BTN1)');
    });
});
