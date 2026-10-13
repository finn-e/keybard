import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { setLayerColorPreview, usePreviewedLayerColors } from '../../src/hooks/useLayerColorPreview';

const SAVED = { '0': 'green', '2': '#123456' };

describe('layer color preview', () => {
    afterEach(() => act(() => setLayerColorPreview(null)));

    it('shows the saved colors when nothing is being picked', () => {
        const { result } = renderHook(() => usePreviewedLayerColors(SAVED));
        expect(result.current).toBe(SAVED);
    });

    it('overlays the color being picked on its layer only, and drops it when the preview ends', () => {
        const { result } = renderHook(() => usePreviewedLayerColors(SAVED));
        act(() => setLayerColorPreview({ layer: 2, color: '#ff0000' }));
        expect(result.current).toEqual({ '0': 'green', '2': '#ff0000' });
        expect(SAVED['2']).toBe('#123456');
        act(() => setLayerColorPreview(null));
        expect(result.current).toBe(SAVED);
    });
});
