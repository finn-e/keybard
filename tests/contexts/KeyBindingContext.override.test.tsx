import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { KeyBindingProvider, useKeyBinding } from '../../src/contexts/KeyBindingContext';
import { KeyboardProvider, useKeyboard } from '../../src/contexts/KeyboardContext';
import { ChangesProvider } from '../../src/contexts/ChangesContext';
import { SettingsProvider } from '../../src/contexts/SettingsContext';
import type { KeyboardInfo } from '../../src/types/keyboard.types';

vi.mock('../../src/services/keyboard.service', () => ({
    keyboardService: { init: vi.fn(), load: vi.fn(), updateKey: vi.fn(), updateKeyoverride: vi.fn(), saveSvil: vi.fn() },
    KeyboardService: { isWebHIDSupported: vi.fn(() => true) },
}));
vi.mock('../../src/services/usb.service', () => ({ usbInstance: { open: vi.fn(), close: vi.fn(), getDeviceName: vi.fn() } }));

const board = (): KeyboardInfo => ({
    rows: 1, cols: 1, layers: 3, kbid: 'ko_test', keymap: [['KC_NO'], ['KC_NO'], ['KC_NO']], settings: {},
    key_overrides: [{ koid: 0, trigger: 'KC_NO', replacement: 'KC_NO', layers: 0, trigger_mods: 0, negative_mod_mask: 0, suppressed_mods: 0, options: 0 }],
} as any);

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SettingsProvider><ChangesProvider><KeyboardProvider><KeyBindingProvider>{children}</KeyBindingProvider></KeyboardProvider></ChangesProvider></SettingsProvider>
);

describe('assigning a key to a blank override', () => {
    it('makes it a new override: on, QMK default activations, every layer', () => {
        const { result } = renderHook(() => ({ kb: useKeyboard(), bind: useKeyBinding() }), { wrapper });
        act(() => { result.current.kb.setKeyboard(board()); });
        act(() => {
            result.current.bind.assignKeycodeTo({ type: 'override', overrideId: 0, overrideSlot: 'trigger' } as any, 'KC_BSPC', { skipAdvance: true });
        });
        const ko = result.current.kb.keyboard!.key_overrides![0];
        expect(ko.trigger).toBe('KC_BSPC');
        expect(ko.options).toBe(0x87);
        expect(ko.layers).toBe(0b111);
    });
});
