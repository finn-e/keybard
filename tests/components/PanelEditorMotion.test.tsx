import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import SecondarySidebar from '../../src/layout/SecondarySidebar/SecondarySidebar';
import { TooltipProvider } from '../../src/components/ui/tooltip';
import {
    pickerScrolledUnder, pinCueStyle, rowToEditorFrame, PANEL_EDITOR_FADE_MS, PANEL_EDITOR_MOTION_MS,
} from '../../src/lib/panelEditorMotion';

const state = vi.hoisted(() => ({
    activePanel: 'combos', state: 'expanded', itemToEdit: null as number | null, pickerMode: 'keyboard' as string,
    alternativeHeader: false,
    handleCloseDetails: vi.fn(), setItemToEdit: vi.fn(), handleCloseEditor: vi.fn(), setPickerMode: vi.fn(),
}));
const motionPref = vi.hoisted(() => ({ reduced: false }));
vi.mock('@/components/ui/sidebar', () => ({ useSidebar: () => ({ state: 'collapsed' }) }));
vi.mock('@/contexts/PanelsContext', () => ({ usePanels: () => state }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: null }) }));
vi.mock('@/hooks/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => motionPref.reduced }));
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
vi.mock('../../src/layout/SecondarySidebar/Panels/SpecialKeysPanel/SpecialKeysPanel', () => ({ default: () => <p>SpecialKeysPanel</p> }));

interface Played { el: HTMLElement; keyframes: Keyframe[]; options: KeyframeAnimationOptions }
let played: Played[] = [];
const ROW = { left: 16, top: 300, width: 448, height: 52 };
const EDITOR = { left: 16, top: 96, width: 400, height: 180 };
const rect = (r: typeof ROW) => ({ ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => r }) as DOMRect;

beforeAll(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
beforeEach(() => {
    played = [];
    motionPref.reduced = false;
    Object.assign(state, { activePanel: 'combos', itemToEdit: null, pickerMode: 'keyboard', alternativeHeader: false });
    HTMLElement.prototype.animate = vi.fn(function (this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
        played.push({ el: this, keyframes, options });
        return { cancel: vi.fn(), finished: Promise.resolve() } as unknown as Animation;
    }) as unknown as typeof HTMLElement.prototype.animate;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        if (this.getAttribute('data-binding-row') === '2') return rect(ROW);
        if (this.getAttribute('data-editor-placement') === 'panel' && this.tagName === 'DIV') return rect(EDITOR);
        return rect({ left: 0, top: 0, width: 0, height: 0 });
    });
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // @ts-expect-error jsdom has no animate; remove the stub again
    delete HTMLElement.prototype.animate;
    window.history.replaceState(null, '', '/');
});

const ui = (props: Record<string, unknown> = {}) => <TooltipProvider><SecondarySidebar comboPlacement="panel" {...props} /></TooltipProvider>;
const aside = (c: HTMLElement) => c.querySelector('aside.detail-panel') as HTMLElement;
const ghost = (c: HTMLElement) => c.querySelector('[data-editor-ghost]') as HTMLElement | null;
const editor = (c: HTMLElement) => c.querySelector('.binding-workspace') as HTMLElement | null;
const SLIDE = /(^|\s)(-?translate-x-\[|slide-in|slide-out|binding-editor--enter|binding-editor--exit)/;

function slideClasses(root: HTMLElement): string[] {
    return [root, ...root.querySelectorAll<HTMLElement>('*')]
        .map(el => el.getAttribute('class') ?? '')
        .filter(c => SLIDE.test(c));
}
const transforms = () => played.flatMap(p => p.keyframes.map(k => String(k.transform ?? '')));

async function open(view: ReturnType<typeof render>, index = 2) {
    state.itemToEdit = index;
    state.alternativeHeader = true;
    view.rerender(ui());
    expect(aside(view.container)).toHaveAttribute('data-editor-motion', 'enter');
    await waitFor(() => expect(aside(view.container)).not.toHaveAttribute('data-editor-motion'));
}
async function close(view: ReturnType<typeof render>) {
    state.itemToEdit = null;
    state.alternativeHeader = false;
    view.rerender(ui());
    expect(aside(view.container)).toHaveAttribute('data-editor-motion', 'exit');
    await waitFor(() => expect(aside(view.container)).not.toHaveAttribute('data-editor-motion'));
}

describe('side-panel editor motion', () => {
    it.each(['combos', 'tapdances', 'macros', 'overrides', 'altrepeat', 'leaders'])('%s: enter, exit and rail switches use no slide classes', async panel => {
        state.activePanel = panel;
        const view = render(ui());
        expect(slideClasses(aside(view.container))).toEqual([]);
        state.itemToEdit = 2;
        state.alternativeHeader = true;
        view.rerender(ui());
        expect(slideClasses(aside(view.container))).toEqual([]);
        await waitFor(() => expect(aside(view.container)).not.toHaveAttribute('data-editor-motion'));
        state.pickerMode = 'special';
        view.rerender(ui());
        expect(slideClasses(aside(view.container))).toEqual([]);
        expect(view.container.querySelector('[data-picker-body="special"]')).toHaveClass('panel-picker-swap');
        state.itemToEdit = null;
        state.alternativeHeader = false;
        view.rerender(ui());
        expect(slideClasses(aside(view.container))).toEqual([]);
        await waitFor(() => expect(aside(view.container)).not.toHaveAttribute('data-editor-motion'));
        // Nothing ever moves sideways: only the FLIP between row and editor shifts x, by their offset.
        expect(transforms().some(t => t.includes('translateX'))).toBe(false);
    });

    it('grows the clicked row into the pinned editor and fades the list out', async () => {
        const view = render(ui());
        state.itemToEdit = 2;
        state.alternativeHeader = true;
        view.rerender(ui());
        const g = ghost(view.container);
        expect(g).not.toBeNull();
        expect(g).toHaveAttribute('aria-hidden', 'true');
        expect(g!.classList.contains('binding-workspace')).toBe(false);
        const flip = played.find(p => p.el === g)!;
        expect(flip.keyframes[0].transform).toBe(rowToEditorFrame(ROW, EDITOR).transform);
        expect(flip.keyframes[1].transform).toBe('translate(0px, 0px) scaleX(1)');
        expect(flip.options.duration).toBe(PANEL_EDITOR_MOTION_MS);
        expect(flip.options.easing).toMatch(/cubic-bezier/);
        const list = view.container.querySelector('[data-panel-scroll-owner]') as HTMLElement;
        expect(played.find(p => p.el === list)!.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
        const picker = view.container.querySelector('[data-picker-body]') as HTMLElement;
        expect(String(played.find(p => p.el === picker)!.keyframes[0].transform)).toMatch(/translateY\(\d+px\)/);
        expect((view.container.querySelector('[data-binding-row="2"]') as HTMLElement).style.opacity).toBe('0');
        await waitFor(() => expect(aside(view.container)).not.toHaveAttribute('data-editor-motion'));
        expect(ghost(view.container)).toBeNull();
        expect((view.container.querySelector('[data-binding-row="2"]') as HTMLElement).style.opacity).toBe('');
    });

    it('shrinks the editor back into its row and keeps the picker shown while it fades', async () => {
        const view = render(ui());
        await open(view);
        played = [];
        state.itemToEdit = null;
        state.alternativeHeader = false;
        view.rerender(ui());
        expect(editor(view.container)).toBeNull();
        const g = ghost(view.container);
        expect(g).not.toBeNull();
        const flip = played.find(p => p.el === g)!;
        expect(flip.keyframes[0].transform).toBe('translate(0px, 0px) scaleX(1)');
        expect(flip.keyframes[1].transform).toBe(rowToEditorFrame(ROW, EDITOR).transform);
        const overlay = view.container.querySelector('[data-picker-overlay]') as HTMLElement;
        expect(overlay).not.toHaveClass('invisible');
        expect(played.find(p => p.el === overlay)!.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
        await waitFor(() => expect(aside(view.container)).not.toHaveAttribute('data-editor-motion'));
        expect(overlay).toHaveClass('invisible');
        // Opacity too: keycaps with transition-all would show through "invisible" alone.
        expect(overlay).toHaveClass('opacity-0');
        expect(ghost(view.container)).toBeNull();
    });

    it('copies the editor again one frame on, keeping its place in the motion', async () => {
        const frames: FrameRequestCallback[] = [];
        const raf = window.requestAnimationFrame;
        const caf = window.cancelAnimationFrame;
        window.requestAnimationFrame = (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; };
        window.cancelAnimationFrame = () => {};
        const view = render(ui());
        state.itemToEdit = 2;
        state.alternativeHeader = true;
        view.rerender(ui());
        const first = ghost(view.container)!;
        expect(first).not.toBeNull();
        const firstAnim = played.find(p => p.el === first)!;
        expect(frames.length).toBeGreaterThan(0);
        act(() => frames.forEach(cb => cb(0)));
        const second = ghost(view.container)!;
        expect(second).not.toBe(first);
        expect(first.isConnected).toBe(false);
        expect(played.find(p => p.el === second)!.keyframes).toEqual(firstAnim.keyframes);
        await waitFor(() => expect(aside(view.container)).not.toHaveAttribute('data-editor-motion'));
        window.requestAnimationFrame = raf;
        window.cancelAnimationFrame = caf;
    });

    it('with reduced motion only crossfades: no ghost, no transforms', async () => {
        motionPref.reduced = true;
        const view = render(ui());
        state.itemToEdit = 2;
        state.alternativeHeader = true;
        view.rerender(ui());
        expect(ghost(view.container)).toBeNull();
        await waitFor(() => expect(aside(view.container)).not.toHaveAttribute('data-editor-motion'));
        await close(view);
        expect(ghost(view.container)).toBeNull();
        expect(played.length).toBeGreaterThan(0);
        expect(played.every(p => p.keyframes.every(k => k.transform === undefined && k.clipPath === undefined))).toBe(true);
        expect(played.every(p => p.options.duration === PANEL_EDITOR_FADE_MS || (p.options.duration as number) < PANEL_EDITOR_FADE_MS)).toBe(true);
    });

    it('leaves the other placements to their own motion', () => {
        const view = render(ui({ comboPlacement: 'half' }));
        state.itemToEdit = 2;
        view.rerender(ui({ comboPlacement: 'half' }));
        expect(aside(view.container)).not.toHaveAttribute('data-editor-motion');
        expect(played).toEqual([]);
    });
});

describe('pinned cue', () => {
    it('reads ?pinCue= and falls back to shadow', () => {
        expect(pinCueStyle('')).toBe('shadow');
        expect(pinCueStyle('?pinCue=divider')).toBe('divider');
        expect(pinCueStyle('?comboEditor=panel&pinCue=notch')).toBe('notch');
        expect(pinCueStyle('?pinCue=glow')).toBe('shadow');
    });

    it.each(['shadow', 'divider', 'notch'] as const)('marks the pinned editor with ?pinCue=%s', cue => {
        window.history.replaceState(null, '', `/?comboEditor=panel&pinCue=${cue}`);
        state.itemToEdit = 2;
        const { container } = render(ui());
        expect(editor(container)).toHaveAttribute('data-pin-cue', cue);
        expect(!!container.querySelector('.pin-cue-glyph')).toBe(cue === 'notch');
    });

    it('defaults to shadow, shown only once the picker scrolls beneath the editor', () => {
        state.itemToEdit = 2;
        const { container } = render(ui());
        const ed = editor(container)!;
        expect(ed).toHaveAttribute('data-pin-cue', 'shadow');
        expect(ed).not.toHaveAttribute('data-pinned-under');
        const sc = container.querySelector('[data-panel-editor-scroll]') as HTMLElement;
        sc.scrollTop = 40;
        fireEvent.scroll(sc);
        expect(ed).toHaveAttribute('data-pinned-under', 'true');
        sc.scrollTop = 0;
        fireEvent.scroll(sc);
        expect(ed).not.toHaveAttribute('data-pinned-under');
    });

    it('counts a tall editor scrolling up to its pin before the picker is under it', () => {
        expect(pickerScrolledUnder(0, 0)).toBe(false);
        expect(pickerScrolledUnder(1, 0)).toBe(true);
        expect(pickerScrolledUnder(100, -120)).toBe(false);
        expect(pickerScrolledUnder(121, -120)).toBe(true);
    });
});
