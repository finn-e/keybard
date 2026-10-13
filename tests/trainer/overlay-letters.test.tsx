import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { surfaceKeys } from '@/features/trainer/useSurfaceKeys';
import { keyService } from '@/services/key.service';
import { OverlaySurface } from '@/features/trainer/OverlaySurface';
import { DEFAULTS } from '@/features/trainer/core';

function center(key: string, capitals?: boolean) {
    const code = keyService.parse(key)!;
    const keys = surfaceKeys({ rows: 10, cols: 6, keymap: [[code]],
        keylayout: { 0: { row: 0, col: 0, x: 0, y: 0, w: 1, h: 1 } } }, 0, 1, 'Both', 'us', { shift: false, capsLock: false });
    const { container } = render(<OverlaySurface keys={keys} appearance={DEFAULTS.appearance} changed={new Set()} held={new Set()}
        hidden={new Set()} effect="Off" duration={150} capitals={capitals} />);
    return container.querySelector('.trainer-key-center') as HTMLElement;
}

describe('overlay letters and digits', () => {
    it.each(['KC_A', 'KC_1'])('draws %s half again as large as other legends', key => {
        expect(center(key).style.fontSize).toBe('18px');
    });

    it('keeps other legends at their size', () => {
        expect(center('KC_SCOLON').style.fontSize).toBe('12px');
        expect(center('KC_ESC').style.fontSize).not.toBe('18px');
    });

    it('leaves a layer key number at its usual size', () => {
        expect(center('MO(3)').style.fontSize).toBe('12px');
    });

    it('shows letters in lower case unless Capital letters is on', () => {
        expect(center('KC_A').textContent).toBe('a');
        expect(center('KC_A', true).textContent).toBe('A');
    });

    it('Capital letters changes only single letters', () => {
        expect(center('KC_1', true).textContent).toBe('1');
        expect(center('KC_ESC', true).textContent).toBe('Escape');
    });
});
