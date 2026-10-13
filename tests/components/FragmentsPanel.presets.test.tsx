import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FragmentsPanel from '../../src/layout/SecondarySidebar/Panels/FragmentsPanel';

const FINGER = [
    { fragment: 'finger_5', matrix_map: [0, 1, 2, 3, 4] },
    { fragment: 'finger_6', matrix_map: [0, 1, 2, 3, 4, 5], default: true },
];
const THUMB = [{ fragment: 'thumb', matrix_map: [0, 1, 2, 3, 4, 5] }];
const POSITIONS = ['left_thumb', 'left_index', 'left_middle', 'left_ring', 'left_pinky', 'right_index', 'right_pinky'];
const INSTANCES = POSITIONS.map((id, idx) => ({
    idx, instance: { id, fragment_options: id.endsWith('thumb') ? THUMB : FINGER },
}));

const mocks = vi.hoisted(() => ({
    queue: vi.fn(), setKeyboard: vi.fn(), update: vi.fn(), save: vi.fn(),
    current: {} as Record<string, string>,
    keyboard: { rows: 1, cols: 1, fragmentState: { hwDetection: new Map(), eepromSelections: new Map(), userSelections: new Map() } },
}));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: mocks.keyboard, setKeyboard: mocks.setKeyboard, isConnected: true, getKeyboardSnapshot: () => mocks.keyboard }) }));
vi.mock('@/contexts/ChangesContext', () => ({ useChanges: () => ({ queue: mocks.queue }) }));
vi.mock('@/contexts/LayoutSettingsContext', () => ({ useLayoutSettings: () => ({ layoutMode: 'sidebar' }) }));
vi.mock('@/components/ui/select', () => ({
    Select: ({ children }: any) => <div>{children}</div>, SelectContent: () => null, SelectItem: () => null,
    SelectTrigger: ({ children, ...props }: any) => <button role="combobox" {...props}>{children}</button>, SelectValue: () => null,
}));
vi.mock('@/services/keyboard.service', () => ({ keyboardService: {
    getFragmentService: () => ({
        hasFragments: () => true, getSelectableInstances: () => INSTANCES,
        getOptionIndex: (instance: any, name: string) => instance.fragment_options.findIndex((o: any) => o.fragment === name),
        resolveFragment: (_kb: unknown, _idx: number, instance: any) => mocks.current[instance.id] ?? 'none',
        getFragmentOptions: (instance: any) => instance.fragment_options.map((o: any) => o.fragment),
        getInstanceDisplayName: (id: string) => id, getFragmentDisplayName: (_kb: unknown, name: string) => name,
    }),
    getFragmentComposer: () => ({ composeLayout: () => ({}) }),
    updateFragmentSelection: mocks.update, saveSvil: mocks.save,
} }));

/** Clicks a preset and returns the cluster it chose for each position it changed. */
async function apply(name: string): Promise<Record<string, string>> {
    render(<FragmentsPanel />);
    fireEvent.click(screen.getByRole('button', { name }));
    await waitFor(() => expect(mocks.queue).toHaveBeenCalled());
    for (const [, callback] of mocks.queue.mock.calls) await callback();
    return Object.fromEntries(mocks.update.mock.calls.map(([, idx, option]) => {
        const { instance } = INSTANCES[idx];
        return [instance.id, instance.fragment_options[option].fragment];
    }));
}

describe('hardware presets', () => {
    beforeEach(() => { vi.clearAllMocks(); mocks.update.mockResolvedValue(true); mocks.current = {}; });

    it('Default picks 5-key fingers', async () => {
        expect(await apply('Restore default hardware selections')).toEqual({
            left_thumb: 'thumb', left_index: 'finger_5', left_middle: 'finger_5', left_ring: 'finger_5',
            left_pinky: 'finger_5', right_index: 'finger_5', right_pinky: 'finger_5',
        });
    });

    it('6-key picks 6-key fingers everywhere', async () => {
        expect(await apply('Use 6-key finger clusters')).toEqual({
            left_thumb: 'thumb', left_index: 'finger_6', left_middle: 'finger_6', left_ring: 'finger_6',
            left_pinky: 'finger_6', right_index: 'finger_6', right_pinky: 'finger_6',
        });
    });

    it('Fang picks 6-key index and pinky, 5-key middle and ring', async () => {
        expect(await apply('Use 6-key index and pinky clusters, 5-key middle and ring')).toEqual({
            left_thumb: 'thumb', left_index: 'finger_6', left_middle: 'finger_5', left_ring: 'finger_5',
            left_pinky: 'finger_6', right_index: 'finger_6', right_pinky: 'finger_6',
        });
    });

    it('leaves positions that already match alone', async () => {
        mocks.current = { left_thumb: 'thumb', left_index: 'finger_6', left_middle: 'finger_5' };
        const changed = await apply('Use 6-key index and pinky clusters, 5-key middle and ring');
        expect(changed).not.toHaveProperty('left_index');
        expect(changed).not.toHaveProperty('left_middle');
        expect(changed).toHaveProperty('left_ring', 'finger_5');
    });

    it('shows the three preset buttons by name', () => {
        render(<FragmentsPanel />);
        for (const label of ['Default', '6-key', 'Fang']) expect(screen.getByText(label)).toBeInTheDocument();
    });
});
