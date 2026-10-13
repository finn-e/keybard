import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import CustomColorDialog, { PREVIEW_INTERVAL_MS } from '../../src/components/CustomColorDialog';

beforeAll(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));

const INITIAL = { hue: 85, sat: 255, val: 200 };

function setup() {
    const onApply = vi.fn();
    const onOpenChange = vi.fn();
    const onPreviewLed = vi.fn();
    render(
        <CustomColorDialog open onOpenChange={onOpenChange} onApply={onApply} onPreviewLed={onPreviewLed}
            initialLedHue={INITIAL.hue} initialLedSat={INITIAL.sat} initialLedVal={INITIAL.val} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'LED color' }));
    return { onApply, onOpenChange, onPreviewLed };
}

// Radix sliders step with the arrow keys.
const nudge = (name: string, key = 'ArrowLeft') => fireEvent.keyDown(screen.getByRole('slider', { name }), { key });

describe('Custom color live LED preview', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('shows LED changes on the board at most every 100 ms, ending on the latest value', () => {
        const { onPreviewLed, onApply } = setup();
        nudge('Brightness');
        act(() => { vi.advanceTimersByTime(0); });
        expect(onPreviewLed).toHaveBeenCalledTimes(1);
        expect(onPreviewLed).toHaveBeenLastCalledWith({ ...INITIAL, val: 199 });

        for (let i = 0; i < 5; i++) nudge('Brightness');
        act(() => { vi.advanceTimersByTime(PREVIEW_INTERVAL_MS - 1); });
        expect(onPreviewLed).toHaveBeenCalledTimes(1);
        act(() => { vi.advanceTimersByTime(1); });
        expect(onPreviewLed).toHaveBeenCalledTimes(2);
        expect(onPreviewLed).toHaveBeenLastCalledWith({ ...INITIAL, val: 194 });
        expect(onApply).not.toHaveBeenCalled();
    });

    it('does not preview the key color, which never reaches the board', () => {
        const { onPreviewLed } = setup();
        fireEvent.click(screen.getByRole('button', { name: 'Key color' }));
        nudge('Hue');
        act(() => { vi.advanceTimersByTime(PREVIEW_INTERVAL_MS); });
        expect(onPreviewLed).not.toHaveBeenCalled();
    });

    it('puts the LEDs back when closed without Apply', () => {
        const { onPreviewLed, onOpenChange } = setup();
        nudge('Saturation');
        act(() => { vi.advanceTimersByTime(PREVIEW_INTERVAL_MS); });
        nudge('Saturation');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        act(() => { vi.advanceTimersByTime(PREVIEW_INTERVAL_MS); });
        expect(onPreviewLed).toHaveBeenLastCalledWith(INITIAL);
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('does not revert after Apply', () => {
        const { onPreviewLed, onApply } = setup();
        nudge('Hue', 'ArrowRight');
        act(() => { vi.advanceTimersByTime(PREVIEW_INTERVAL_MS); });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        act(() => { vi.advanceTimersByTime(PREVIEW_INTERVAL_MS); });
        expect(onApply).toHaveBeenCalledWith(expect.anything(), { ...INITIAL, hue: 86 });
        expect(onPreviewLed).toHaveBeenCalledTimes(1);
    });

    it('shows the key color on the layout as it changes, and ends the preview on Cancel', () => {
        const onPreviewDisplay = vi.fn();
        const onApply = vi.fn();
        render(<CustomColorDialog open onOpenChange={vi.fn()} onApply={onApply} onPreviewDisplay={onPreviewDisplay}
            initialDisplayHue={10} initialDisplaySat={200} initialDisplayVal={150} />);
        fireEvent.click(screen.getByRole('button', { name: 'Key color' }));
        nudge('Hue', 'ArrowRight');
        expect(onPreviewDisplay).toHaveBeenLastCalledWith({ hue: 11, sat: 200, val: 150 });
        nudge('Brightness');
        expect(onPreviewDisplay).toHaveBeenLastCalledWith({ hue: 11, sat: 200, val: 149 });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onPreviewDisplay).toHaveBeenLastCalledWith(null);
        expect(onApply).not.toHaveBeenCalled();
    });

    it('ends the key color preview after Apply saves it', () => {
        const onPreviewDisplay = vi.fn();
        const onApply = vi.fn();
        render(<CustomColorDialog open onOpenChange={vi.fn()} onApply={onApply} onPreviewDisplay={onPreviewDisplay}
            initialDisplayHue={10} initialDisplaySat={200} initialDisplayVal={150} />);
        fireEvent.click(screen.getByRole('button', { name: 'Key color' }));
        nudge('Saturation');
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(onApply).toHaveBeenCalledWith({ hue: 10, sat: 199, val: 150 }, expect.anything());
        expect(onPreviewDisplay).toHaveBeenLastCalledWith(null);
    });

    it('applies a complete hex code while typing, and Escape restores the earlier color', () => {
        const { onPreviewLed } = setup();
        fireEvent.click(screen.getByRole('button', { name: /Edit hex color/ }));
        const input = screen.getByRole('textbox', { name: 'Hex color' });
        fireEvent.change(input, { target: { value: '#ff00' } });
        act(() => { vi.advanceTimersByTime(PREVIEW_INTERVAL_MS); });
        expect(onPreviewLed).not.toHaveBeenCalled();
        fireEvent.change(input, { target: { value: '#ff0000' } });
        act(() => { vi.advanceTimersByTime(PREVIEW_INTERVAL_MS); });
        expect(onPreviewLed).toHaveBeenLastCalledWith({ hue: 0, sat: 255, val: 255 });
        fireEvent.keyDown(input, { key: 'Escape' });
        act(() => { vi.advanceTimersByTime(PREVIEW_INTERVAL_MS); });
        expect(onPreviewLed).toHaveBeenLastCalledWith(INITIAL);
    });
});
