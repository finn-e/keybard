import { describe, expect, it, vi } from 'vitest';
import { blankKeyOnDrop } from '../../src/layout/blank-key-drop';

describe('dropping a key into blank space', () => {
    it('makes a layout key blank', () => {
        const assign = vi.fn();
        blankKeyOnDrop(assign)({ keycode: 'KC_A', label: 'A', type: 'keyboard', row: 2, col: 3, layer: 1 } as any);
        expect(assign).toHaveBeenCalledExactlyOnceWith({ type: 'keyboard', row: 2, col: 3, layer: 1 }, 'KC_NO', { skipAdvance: true });
    });

    it('ignores keys dragged from a panel', () => {
        const assign = vi.fn();
        blankKeyOnDrop(assign)({ keycode: 'KC_A', label: 'A', type: 'keyboard' } as any);
        expect(assign).not.toHaveBeenCalled();
    });
});
