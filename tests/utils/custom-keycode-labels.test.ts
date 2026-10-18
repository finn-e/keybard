import { describe, it, expect } from 'vitest';
import { customKeycodeShortName } from '../../src/constants/custom-keycode-labels';
import { keyService } from '../../src/services/key.service';
import { KEYMAP } from '../../src/constants/keygen';
import type { KeyboardInfo } from '../../src/types/keyboard.types';

describe('custom keycode labels', () => {
    it('shows SV_SCROLL_HOLD as "Drag Scroll", whatever the firmware calls it', () => {
        expect(customKeycodeShortName({ name: 'SV_SCROLL_HOLD', shortName: 'Scroll\\nToggle\\nHold' })).toBe('Drag\nScroll');
    });

    it("keeps the firmware's shortName for other keys, with real line breaks", () => {
        expect(customKeycodeShortName({ name: 'SV_SNIPER_2', shortName: 'Sniper\\n2x' })).toBe('Sniper\n2x');
        expect(customKeycodeShortName({ name: 'SV_SNIPER_3', shortName: 'Sniper\n3x' })).toBe('Sniper\n3x');
    });

    it('labels an assigned SV_SCROLL_HOLD "Drag Scroll" on the layout', () => {
        const kbinfo = {
            custom_keycodes: [
                { name: 'SV_SNIPER_2', title: 'Slow the cursor 2x more.', shortName: 'Sniper\n2x' },
                { name: 'SV_SCROLL_HOLD', title: 'Hold to toggle the scrolling mode of both pointers.', shortName: 'Scroll\nToggle\nHold' },
            ],
        } as unknown as KeyboardInfo;
        keyService.generateAllKeycodes(kbinfo);
        expect(KEYMAP['SV_SCROLL_HOLD'].str).toBe('Drag\nScroll');
        expect(KEYMAP['SV_SNIPER_2'].str).toBe('Sniper\n2x');
    });
});
