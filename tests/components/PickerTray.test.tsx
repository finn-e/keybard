import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import SecondarySidebar from '../../src/layout/SecondarySidebar/SecondarySidebar';
import PickerTray from '../../src/layout/PickerTray';
import { TooltipProvider } from '../../src/components/ui/tooltip';
import { TRAY_HANDLE_PX } from '../../src/lib/pickerShape';
const state = vi.hoisted(() => ({
    activePanel: 'combos', state: 'expanded', itemToEdit: null as number | null, pickerMode: 'keyboard' as string,
    alternativeHeader: false,
    handleCloseDetails: vi.fn(), setItemToEdit: vi.fn(), handleCloseEditor: vi.fn(), setPickerMode: vi.fn(),
}));
vi.mock('@/components/ui/sidebar', () => ({ useSidebar: () => ({ state: 'collapsed' }) }));
vi.mock('@/contexts/PanelsContext', () => ({ usePanels: () => state }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: null }) }));
vi.mock('@/hooks/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => true }));
vi.mock('../../src/layout/SecondarySidebar/components/BindingEditor/BindingEditorContainer', () => ({
    default: () => <p data-testid="editor">Editor</p>,
}));
const rows = () => <div>{[0, 1, 2, 3].map(i => <div key={i} data-binding-row={i}>Row {i}</div>)}</div>;
vi.mock('../../src/layout/SecondarySidebar/Panels/AltRepeatPanel', () => ({ default: () => rows() }));
vi.mock('../../src/layout/SecondarySidebar/Panels/BasicKeyboards', () => ({ default: () => <button type="button">KC_A</button> }));
vi.mock('../../src/layout/SecondarySidebar/Panels/CombosPanel', () => ({ default: () => rows() }));
vi.mock('../../src/layout/SecondarySidebar/Panels/DynamicMenuPanel', () => ({ default: () => <p>DynamicMenuPanel</p> }));
vi.mock('../../src/layout/SecondarySidebar/Panels/FragmentsPanel', () => ({ default: () => <p>FragmentsPanel</p> }));
vi.mock('../../src/layout/SecondarySidebar/Panels/LayoutsPanel', () => ({ default: () => <p>LayoutsPanel</p> }));
vi.mock('../../src/layout/SecondarySidebar/Panels/LeadersPanel', () => ({ default: () => rows() }));
vi.mock('../../src/layout/SecondarySidebar/Panels/LayersPanel', () => ({ default: () => <p>LayersPanel</p> }));
vi.mock('../../src/layout/SecondarySidebar/Panels/MacrosPanel', () => ({ default: () => rows() }));
vi.mock('../../src/layout/SecondarySidebar/Panels/OverridesPanel', () => ({ default: () => rows() }));
vi.mock('../../src/layout/SecondarySidebar/Panels/PointingPanel', () => ({ default: () => <p>PointingPanel</p> }));
vi.mock('../../src/layout/SecondarySidebar/Panels/OneShotComposerPanel', () => ({ default: () => <p>OneShotComposerPanel</p> }));
vi.mock('../../src/layout/SecondarySidebar/Panels/QmkKeysPanel', () => ({ default: () => <p>QmkKeysPanel</p> }));
vi.mock('../../src/layout/SecondarySidebar/Panels/MousePanel', () => ({ default: () => <p>MousePanel</p> }));
vi.mock('../../src/layout/SecondarySidebar/Panels/QMKSettingsPanel', () => ({ default: () => <p>QMKSettingsPanel</p> }));
vi.mock('../../src/layout/SecondarySidebar/Panels/ScanLabPanel', () => ({ default: () => <p>ScanLabPanel</p> }));
vi.mock('../../src/layout/SecondarySidebar/Panels/TapdancePanel', () => ({ default: () => rows() }));
vi.mock('../../src/layout/SecondarySidebar/Panels/QuickStartPanel', () => ({ default: () => <p>QuickStartPanel</p> }));

beforeAll(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
beforeEach(() => {
    Object.assign(state, { activePanel: 'combos', itemToEdit: null, pickerMode: 'keyboard', alternativeHeader: false });
});
afterEach(() => cleanup());

describe('L-shaped picker: the side panel', () => {
    it('draws no frame of its own in the side layout, so the L surface shows', () => {
        const { container } = render(<TooltipProvider><SecondarySidebar comboPlacement="panel" pickerShape="L" /></TooltipProvider>);
        expect(container.querySelector('aside.detail-panel')?.getAttribute('data-picker-shape')).toBe('L');
    });

    it('is unchanged in the bottom bar', () => {
        const { container } = render(<TooltipProvider><SecondarySidebar bottom comboPlacement="panel" pickerShape="L" /></TooltipProvider>);
        expect(container.querySelector('aside.detail-panel')?.hasAttribute('data-picker-shape')).toBe(false);
    });
});

describe('L-shaped picker: the tray', () => {
    const panel = () => {
        const el = document.createElement('aside');
        el.className = 'detail-panel';
        el.setAttribute('data-placement', 'side');
        el.getBoundingClientRect = () => ({ left: 48, right: 560, top: 8, bottom: 892, width: 512, height: 884, x: 48, y: 8, toJSON: () => ({}) }) as DOMRect;
        document.body.appendChild(el);
        Object.defineProperty(document.documentElement, 'clientWidth', { value: 1440, configurable: true });
        return el;
    };
    const tray = (props: Partial<React.ComponentProps<typeof PickerTray>> = {}) => (
        <PickerTray shape="L" state="open" height={250} panelOpen onToggle={vi.fn()} headerRef={vi.fn()} bodyRef={vi.fn()} onContentHeight={vi.fn()} {...props} />
    );

    it('joins the panel at its right edge', () => {
        const el = panel();
        const { container } = render(tray());
        const section = () => container.querySelector('[data-picker-tray]') as HTMLElement;
        expect(section().style.left).toBe('560px');
        expect(section().style.height).toBe('250px');
        expect(container.querySelector('[data-picker-surface] path')?.getAttribute('d')).toMatch(/0 0 0 /);
        el.remove();
    });

    it('resizes live when its height changes (a key size clicked), instantly with reduced motion', () => {
        const el = panel();
        const { container, rerender } = render(tray({ height: 250 }));
        const section = () => container.querySelector('[data-picker-tray]') as HTMLElement;
        expect(section().style.height).toBe('250px');
        rerender(tray({ height: 360 }));
        expect(section().style.height).toBe('360px');
        rerender(tray({ height: 200 }));
        expect(section().style.height).toBe('200px');
        el.remove();
    });

    it('shows only its labeled handle when collapsed, and toggles from it', () => {
        const el = panel();
        const onToggle = vi.fn();
        const { container, getByRole } = render(tray({ state: 'handle', onToggle }));
        expect((container.querySelector('[data-picker-tray]') as HTMLElement).style.height).toBe(`${TRAY_HANDLE_PX}px`);
        const toggle = getByRole('button', { name: 'Standard Keys' });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(toggle);
        expect(onToggle).toHaveBeenCalledTimes(1);
        el.remove();
    });

    it('is collapsed and out of reach when hidden', () => {
        const el = panel();
        const { container } = render(tray({ state: 'hidden' }));
        const section = container.querySelector('[data-picker-tray]') as HTMLElement;
        expect(section.style.height).toBe('0px');
        expect(section.hasAttribute('inert')).toBe(true);
        el.remove();
    });
});
