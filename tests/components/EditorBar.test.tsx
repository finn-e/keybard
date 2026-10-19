import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BindingEditorContainer from '@/layout/SecondarySidebar/components/BindingEditor/BindingEditorContainer';
import { AnimatedHeight, BAR_RESIZE_MS } from '@/layout/SecondarySidebar/components/BindingEditor/EditorBar';
import { AltRepeatKeyOptions, ComboOptions, LeaderOptions } from '@/types/keyboard.types';

const state = vi.hoisted(() => ({
    board: {} as any, setKeyboard: vi.fn(), persist: vi.fn(async () => {}),
    binding: {
        selectedTarget: null as any, selectComboKey: vi.fn(), selectTapdanceKey: vi.fn(), selectMacroKey: vi.fn(),
        selectOverrideKey: vi.fn(), selectAltRepeatKey: vi.fn(), selectLeaderKey: vi.fn(), clearSelection: vi.fn(),
    },
    panels: { itemToEdit: 0 as number | null, bindingTypeToEdit: 'combos', initialEditorSlot: null, setPanelToGoBack: vi.fn(), setAlternativeHeader: vi.fn(), handleCloseEditor: vi.fn() },
    reduced: false,
}));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: state.board, setKeyboard: state.setKeyboard }) }));
vi.mock('@/contexts/KeyBindingContext', () => ({ useKeyBinding: () => state.binding }));
vi.mock('@/contexts/PanelsContext', () => ({ usePanels: () => state.panels }));
vi.mock('@/contexts/LayoutSettingsContext', () => ({ useLayoutSettings: () => ({ layoutMode: 'sidebar', keyVariant: 'default' }) }));
vi.mock('@/hooks/useBindingChanges', () => ({ useBindingChanges: () => state.persist }));
vi.mock('@/hooks/useBindingNames', () => ({ useBindingNames: () => ({ renameBinding: vi.fn(), nameError: null }) }));
vi.mock('@/hooks/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => state.reduced }));
vi.mock('@/components/Key', () => ({ Key: () => <div data-testid="header-icon" /> }));
vi.mock('@/layout/SecondarySidebar/components/BindingEditor/OverrideModifierSelector', () => ({ default: () => <p>Modifier selector</p> }));
vi.mock('@/layout/SecondarySidebar/components/BindingEditor/EditorKey', () => ({
    default: ({ keycode, onClick, size, unitSize }: { keycode: string; onClick: () => void; size?: string; unitSize?: number }) =>
        <button type="button" data-size={size} data-unit={unitSize} onClick={onClick}>{keycode}</button>,
}));

const board = () => ({
    layers: 4,
    combos: [{ keys: ['KC_J', 'KC_K', 'KC_NO', 'KC_NO'], output: 'KC_ESC', options: ComboOptions.ENABLED }],
    tapdances: [{ enabled: true, tap: 'KC_A', hold: 'KC_LCTL', doubletap: 'KC_NO', taphold: 'KC_NO', tapping_term: 200 }],
    macros: [
        { mid: 0, actions: [['tap', 'KC_A']] },
        { mid: 1, actions: [['tap', 'KC_H'], ['tap', 'KC_I'], ['text', 'hello'], ['delay', 100], ['down', 'KC_LSFT'], ['tap', 'KC_A'], ['up', 'KC_LSFT']] },
    ],
    key_overrides: [{ trigger: 'KC_BSPC', replacement: 'KC_DEL', layers: 0xFFFF, trigger_mods: 2, negative_mod_mask: 0, suppressed_mods: 0, options: 0x80 }],
    alt_repeat_keys: [{ keycode: 'KC_LEFT', alt_keycode: 'KC_RIGHT', allowed_mods: 0, options: AltRepeatKeyOptions.ENABLED }],
    leaders: [
        { sequence: ['KC_A', 'KC_B', 'KC_NO', 'KC_NO', 'KC_NO'], output: 'KC_ESC', options: LeaderOptions.ENABLED },
        { sequence: ['KC_A', 'KC_B', 'KC_C', 'KC_D', 'KC_E'], output: 'KC_ESC', options: LeaderOptions.ENABLED },
    ],
});

const KINDS = [
    { kind: 'combos', slots: ['Key 1', 'Key 2', 'Key 3', 'Key 4', 'Output'], toggle: 'Combo enabled' },
    // Tap dances are always on: no toggle.
    { kind: 'tapdances', slots: ['Tap', 'Hold', 'Tap-Hold', 'Double-Tap'], toggle: null },
    { kind: 'macros', slots: ['Tap', 'Add'], toggle: null },
    { kind: 'overrides', slots: ['Trigger', 'Replacement'], toggle: 'Override enabled' },
    { kind: 'altrepeat', slots: ['Trigger', 'Alternate'], toggle: 'Alt-repeat enabled' },
    { kind: 'leaders', slots: ['Key 1', 'Key 2', 'Key 3', 'Output'], toggle: 'Leader sequence enabled' },
] as const;

const bar = (c: HTMLElement) => c.querySelector('[data-editor-bar]') as HTMLElement;
const rows = (c: HTMLElement) => [...c.querySelectorAll('[data-editor-bar-row]')] as HTMLElement[];
const slotLabels = (row: HTMLElement) => [...row.querySelectorAll('[data-bar-slot]')].map(s => s.getAttribute('data-bar-slot'));

describe('side-panel editor bar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.board = board();
        state.panels.itemToEdit = 0;
        state.reduced = false;
    });
    afterEach(() => { state.panels.bindingTypeToEdit = 'combos'; });

    describe.each(KINDS)('$kind', ({ kind, slots, toggle }) => {
        beforeEach(() => { state.panels.bindingTypeToEdit = kind; });

        it('is one row of labeled slots with its controls at the end', () => {
            const { container } = render(<BindingEditorContainer inline bar />);
            expect(bar(container)).toHaveAttribute('data-editor-bar', kind);
            const [row, ...more] = rows(container);
            expect(more).toHaveLength(0);
            expect(slotLabels(row)).toEqual(expect.arrayContaining([...slots]));
            const end = row.querySelector('[data-editor-bar-end]') as HTMLElement;
            expect(end).not.toBeNull();
            // The controls are the row's last item, so they sit at its end (or wrap with it).
            expect(row.lastElementChild).toBe(end);
            if (toggle) expect(within(end).getByRole('group', { name: toggle })).toBeInTheDocument();
            expect(within(end).getByRole('button', { name: /^Clear / })).toBeInTheDocument();
        });

        it('has no close button, name or icon of its own', () => {
            render(<BindingEditorContainer inline bar />);
            expect(screen.queryByRole('button', { name: 'Close binding editor' })).toBeNull();
            expect(screen.queryByRole('heading')).toBeNull();
            expect(screen.queryByRole('button', { name: /^Rename / })).toBeNull();
            expect(screen.queryByTestId('header-icon')).toBeNull();
        });

        it('draws every key at the bar size', () => {
            render(<BindingEditorContainer inline bar />);
            const keys = screen.getAllByRole('button').filter(b => b.hasAttribute('data-size'));
            expect(keys.length).toBeGreaterThan(0);
            for (const k of keys) {
                expect(k).toHaveAttribute('data-size', 'w-10 h-10');
                expect(k).toHaveAttribute('data-unit', '40');
            }
        });
    });

    it('keeps a combo to one row that never wraps: four keys, the output and the controls', () => {
        state.panels.bindingTypeToEdit = 'combos';
        const { container } = render(<BindingEditorContainer inline bar />);
        const [row] = rows(container);
        expect(row).toHaveClass('flex-nowrap');
        expect(row).not.toHaveClass('flex-wrap');
        expect(slotLabels(row)).toEqual(['Key 1', 'Key 2', 'Key 3', 'Key 4', 'Output']);
        // Nothing but slots, separators and the controls: no title row above.
        expect(bar(container).querySelectorAll('h3')).toHaveLength(0);
    });

    it('puts the tap dance term field with the controls at the row end', () => {
        state.panels.bindingTypeToEdit = 'tapdances';
        const { container } = render(<BindingEditorContainer inline bar />);
        const end = container.querySelector('[data-editor-bar-end]') as HTMLElement;
        expect(within(end).getByRole('spinbutton', { name: 'Tapping term in milliseconds' })).toHaveValue(200);
        expect(within(end).queryByRole('group', { name: 'Tap dance enabled' })).toBeNull();
        expect(within(end).queryByRole('switch')).toBeNull();
    });

    it('lets a 5-key leader and a long macro wrap within the same row', () => {
        state.panels.bindingTypeToEdit = 'leaders';
        state.panels.itemToEdit = 1;
        const leader = render(<BindingEditorContainer inline bar />);
        const [leaderRow] = rows(leader.container);
        expect(slotLabels(leaderRow)).toEqual(['Key 1', 'Key 2', 'Key 3', 'Key 4', 'Key 5', 'Output']);
        expect(leaderRow).toHaveClass('flex-wrap');
        leader.unmount();

        state.panels.bindingTypeToEdit = 'macros';
        const macro = render(<BindingEditorContainer inline bar />);
        const [macroRow] = rows(macro.container);
        expect(slotLabels(macroRow)).toEqual(['Tap', 'Tap', 'Text', 'Delay (ms)', 'Down', 'Tap', 'Up', 'Add']);
        expect(macroRow).toHaveClass('flex-wrap');
        expect(within(macroRow).getByRole('textbox', { name: 'Macro text' })).toHaveValue('hello');
    });

    it('keeps an override or alt-repeat options closed until asked, then shows them under the row', () => {
        for (const kind of ['overrides', 'altrepeat']) {
            state.panels.bindingTypeToEdit = kind;
            const view = render(<BindingEditorContainer inline bar />);
            const options = view.container.querySelector('[data-editor-bar-options]') as HTMLElement;
            expect(options).toHaveAttribute('aria-expanded', 'false');
            expect(view.container.querySelector(`#${CSS.escape(options.getAttribute('aria-controls')!)}`)).toBeNull();
            fireEvent.click(options);
            expect(options).toHaveAttribute('aria-expanded', 'true');
            const panel = view.container.querySelector(`#${CSS.escape(options.getAttribute('aria-controls')!)}`) as HTMLElement;
            expect(panel).not.toBeNull();
            // Under the row, not in it.
            expect(rows(view.container)[0].contains(panel)).toBe(false);
            view.unmount();
        }
    });

    it('saves on/off from the bar', () => {
        state.panels.bindingTypeToEdit = 'combos';
        render(<BindingEditorContainer inline bar />);
        fireEvent.click(within(screen.getByRole('group', { name: 'Combo enabled' })).getByRole('button', { name: 'OFF' }));
        const updated = state.setKeyboard.mock.calls[0][0];
        expect(updated.combos[0].options & ComboOptions.ENABLED).toBe(0);
        expect(state.persist).toHaveBeenCalledWith(updated, 'combo', 0);
    });

    it('disables delete while there is nothing to clear', () => {
        state.panels.bindingTypeToEdit = 'combos';
        state.board.combos[0] = { keys: ['KC_NO', 'KC_NO', 'KC_NO', 'KC_NO'], output: 'KC_NO', options: ComboOptions.ENABLED };
        render(<BindingEditorContainer inline bar />);
        expect(screen.getByRole('button', { name: 'Clear Combo 0' })).toBeDisabled();
    });

    it('leaves the other placements with their close button', () => {
        state.panels.bindingTypeToEdit = 'combos';
        const close = vi.fn();
        render(<BindingEditorContainer inline compact onRequestClose={close} />);
        fireEvent.click(screen.getByRole('button', { name: 'Close binding editor' }));
        expect(close).toHaveBeenCalledOnce();
    });
});

describe('bar height', () => {
    let resize: (() => void) | null = null;
    let height = 72;
    beforeEach(() => {
        vi.useFakeTimers();
        resize = null;
        height = 72;
        vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { resize = cb; } observe() {} unobserve() {} disconnect() {} });
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => height);
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    it('follows its content and animates the change, clipping only while it moves', () => {
        state.reduced = false;
        const { container } = render(<AnimatedHeight><p>row</p></AnimatedHeight>);
        const box = container.firstElementChild as HTMLElement;
        expect(box.style.height).toBe('72px');
        expect(box.style.transition).toContain(`height ${BAR_RESIZE_MS}ms`);
        expect(box.style.overflow).toBe('');
        height = 120;
        act(() => resize?.());
        expect(box.style.height).toBe('120px');
        expect(box.style.overflow).toBe('hidden');
        act(() => { vi.advanceTimersByTime(BAR_RESIZE_MS + 50); });
        expect(box.style.overflow).toBe('');
    });

    it('changes at once with reduced motion', () => {
        state.reduced = true;
        const { container } = render(<AnimatedHeight><p>row</p></AnimatedHeight>);
        const box = container.firstElementChild as HTMLElement;
        expect(box.style.transition).toBe('');
        height = 120;
        act(() => resize?.());
        expect(box.style.height).toBe('120px');
        expect(box.style.overflow).toBe('');
    });
});
