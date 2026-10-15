import { describe, expect, it } from 'vitest';
import { keybardVersion } from '../../src/utils/build-info';

describe('Keybard version', () => {
    it('is the release tag for release and prerelease builds', () => {
        expect(keybardVersion('v3', '1a2b3c4')).toBe('v3');
        expect(keybardVersion('x3.1', '1a2b3c4')).toBe('x3.1');
    });

    it('is the commit for any other build', () => {
        expect(keybardVersion('', '1a2b3c4')).toBe('build 1a2b3c4');
        expect(keybardVersion('', '')).toBe('development build');
    });
});
