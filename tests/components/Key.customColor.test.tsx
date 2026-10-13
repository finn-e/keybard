import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Key } from '../../src/components/Key';
import { getColorByName, textClassForHex } from '../../src/utils/colors';

vi.mock('@/contexts/LayoutSettingsContext', () => ({
    useLayoutSettings: () => ({ internationalLayout: 'us', keyVariant: 'default', layoutMode: 'sidebar' }),
}));
vi.mock('@/hooks/useKeyDrag', () => ({
    useKeyDrag: ({ unitSize }: { unitSize?: number }) => ({
        isDragSource: false, isDragHover: false, currentUnitSize: unitSize ?? 60,
        handleMouseEnter: () => {}, handleMouseLeave: () => {}, handleMouseDown: () => {}, handleMouseUp: () => {},
    }),
}));

function keyBox(layerColor: string, selected = false) {
    const { container } = render(
        <Key x={0} y={0} w={1} h={1} row={0} col={0} keycode="KC_A" label="A" layerColor={layerColor}
             selected={selected} disableTooltip />
    );
    return container.querySelector('.uppercase') as HTMLElement;
}

describe('custom hex layer colors', () => {
    it('fill the key with the hex color and readable text', () => {
        const box = keyBox('#450770');
        expect(box.style.backgroundColor).toBe('rgb(69, 7, 112)');
        expect(box.className).toContain('text-white');
        expect(box.className).not.toContain('bg-kb-primary');
    });

    it('use dark text on light colors', () => {
        expect(keyBox('#f0e68c').className).toContain('text-black');
    });

    it('leave the selected key red', () => {
        expect(keyBox('#450770', true).style.backgroundColor).toBe('');
    });

    it('keep preset names on their classes', () => {
        const box = keyBox('blue');
        expect(box.style.backgroundColor).toBe('');
        expect(box.className).toContain('bg-kb-blue');
    });

    it('resolve through getColorByName for backdrops and headers', () => {
        expect(getColorByName('#450770')?.hex).toBe('#450770');
        expect(getColorByName('green')?.hex).toBe('#099e7c');
        expect(textClassForHex('#ffffff')).toBe('text-black');
        expect(textClassForHex('#000000')).toBe('text-white');
    });
});
