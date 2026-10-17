import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import SecondarySidebar from '../../src/layout/SecondarySidebar/SecondarySidebar';
const state = vi.hoisted(() => ({ activePanel: 'settings', state: 'expanded', itemToEdit: null as number | null }));
vi.mock('@/components/ui/sidebar', () => ({ useSidebar: () => ({state: 'collapsed'}) }));
vi.mock('@/contexts/PanelsContext', () => ({ usePanels: () => ({ ...state, handleCloseDetails: vi.fn(), setItemToEdit: vi.fn() }) }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({keyboard: null}) }));
vi.mock('../../src/layout/SecondarySidebar/components/BindingEditor/BindingEditorContainer', () => ({default: () => {
 const [draft, setDraft] = useState('');
 return <input aria-label="Binding draft" value={draft} onChange={event => setDraft(event.target.value)} />;
}}));
vi.mock('../../src/layout/SecondarySidebar/components/EditorSidePanel', () => ({default: () => null}));
vi.mock('../../src/layout/SecondarySidebar/Panels/SettingsPanel', () => ({default: () => {
 const [draft, setDraft] = useState('');
 return <input aria-label="Board name draft" value={draft} onChange={event => setDraft(event.target.value)} />;
}}));
vi.mock('../../src/layout/SecondarySidebar/Panels/AltRepeatPanel', () => ({default: () => <p>AltRepeatPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/BasicKeyboards', () => ({default: () => <p>BasicKeyboards</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/CombosPanel', () => ({default: () => <p>CombosPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/DynamicMenuPanel', () => ({default: () => <p>DynamicMenuPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/LayoutsPanel', () => ({default: () => <p>LayoutsPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/LeadersPanel', () => ({default: () => <p>LeadersPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/LayersPanel', () => ({default: () => <p>LayersPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/MacrosPanel', () => ({default: () => <p>MacrosPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/OverridesPanel', () => ({default: () => <p>OverridesPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/PointingPanel', () => ({default: () => <p>PointingPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/OneShotComposerPanel', () => ({default: () => <p>OneShotComposerPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/QmkKeysPanel', () => ({default: () => <p>QmkKeysPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/MousePanel', () => ({default: () => <p>MousePanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/TypingBehaviorPanel', () => ({default: () => <p>TypingBehaviorPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/ClustersPanel', () => ({default: () => <p>ClustersPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/ScanLabPanel', () => ({default: () => <p>ScanLabPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/TapdancePanel', () => ({default: () => <p>TapdancePanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/AboutPanel', () => ({default: () => <p>AboutPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/QuickStartPanel', () => ({default: () => <p>QuickStartPanel</p>}));
vi.mock('../../src/layout/SecondarySidebar/Panels/SpecialKeysPanel/SpecialKeysPanel', () => ({default: () => <p>SpecialKeysPanel/SpecialKeysPanel</p>}));
describe('shared panel placement', () => {
 it('keeps the binding editor draft mounted across placement changes', () => {
  state.activePanel = 'macros';
  state.itemToEdit = 0;
  const view = render(<SecondarySidebar />);
  fireEvent.change(screen.getByLabelText('Binding draft'), {target: {value: 'Unfinished name'}});
  view.rerender(<SecondarySidebar bottom />);
  expect(screen.getByLabelText('Binding draft')).toHaveValue('Unfinished name');
  view.rerender(<SecondarySidebar />);
  expect(screen.getByLabelText('Binding draft')).toHaveValue('Unfinished name');
  state.itemToEdit = null;
 });
 it('moves a combo editor between placements without remounting it', () => {
  state.activePanel = 'combos';
  state.itemToEdit = 0;
  const view = render(<SecondarySidebar comboPlacement="dock" />);
  const workspace = () => screen.getByLabelText('Binding editor');
  expect(workspace()).toHaveAttribute('data-combo-placement', 'dock');
  expect(screen.getByLabelText('Editing Combo 0')).toHaveAttribute('data-combo-placement', 'dock');
  fireEvent.change(screen.getByLabelText('Binding draft'), {target: {value: 'Half-made combo'}});
  for (const [placement, bottom] of [['anchored', false], ['float', true], ['dock', true], [undefined, false]] as const) {
   view.rerender(<SecondarySidebar comboPlacement={placement} bottom={bottom} />);
   expect(screen.getByLabelText('Binding draft')).toHaveValue('Half-made combo');
   if (placement) expect(workspace()).toHaveAttribute('data-combo-placement', placement);
   else expect(workspace()).not.toHaveAttribute('data-combo-placement');
  }
  state.itemToEdit = null;
 });
 it('keeps an unmeasured combo editor focusable so it can take the opening focus', () => {
  state.activePanel = 'combos';
  state.itemToEdit = 0;
  render(<SecondarySidebar comboPlacement="dock" />);
  const workspace = screen.getByLabelText('Binding editor');
  expect(workspace.style.visibility).not.toBe('hidden');
  expect(document.activeElement).toBe(workspace);
  state.itemToEdit = null;
 });
 it('leaves other binding editors where they were', () => {
  state.activePanel = 'macros';
  state.itemToEdit = 0;
  render(<SecondarySidebar comboPlacement="float" />);
  expect(screen.getByLabelText('Binding editor')).not.toHaveAttribute('data-combo-placement');
  state.itemToEdit = null;
 });
 it('retains local draft when switching between sidebar and bottom', () => {
  state.activePanel = 'settings';
  const view = render(<SecondarySidebar />);
  fireEvent.change(screen.getByLabelText('Board name draft'), {target: {value: 'My board'}});
  view.rerender(<SecondarySidebar bottom />);
  expect(screen.getByLabelText('Board name draft')).toHaveValue('My board');
  view.rerender(<SecondarySidebar />);
  expect(screen.getByLabelText('Board name draft')).toHaveValue('My board');
 });
 it.each(['quickstart', 'about', 'scanlab'])('provides real %s content in either placement', panel => {
  state.activePanel = panel;
  const view = render(<SecondarySidebar />);
  const expected = {quickstart: 'QuickStartPanel', about: 'AboutPanel', scanlab: 'ScanLabPanel'}[panel];
  expect(screen.getByText(expected!)).toBeVisible();
  view.rerender(<SecondarySidebar bottom />);
  expect(screen.getByText(expected!)).toBeVisible();
 });
 it.each(['clusters', 'typing'])('has no panel of its own for %s: it is a section of Settings', panel => {
  state.activePanel = panel;
  render(<SecondarySidebar />);
  expect(screen.queryByText('ClustersPanel')).toBeNull();
  expect(screen.queryByText('TypingBehaviorPanel')).toBeNull();
 });
});
