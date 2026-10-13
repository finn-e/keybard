import { describe, expect, it } from 'vitest';
import { getLabelForKeycode } from '../../src/components/Keyboards/layouts';

describe('left and right modifier labels', () => {
    it.each([
        ['KC_LSHIFT', 'L shift'], ['KC_RSHIFT', 'R shift'],
        ['KC_LCTRL', 'L ctrl'], ['KC_RCTRL', 'R ctrl'],
        ['KC_LALT', 'L alt'], ['KC_RALT', 'R alt'],
        ['KC_LGUI', 'L gui'], ['KC_RGUI', 'R gui'],
    ])('%s shows as %s', (keycode, label) => {
        expect(getLabelForKeycode(keycode, 'us')).toBe(label);
    });
});
