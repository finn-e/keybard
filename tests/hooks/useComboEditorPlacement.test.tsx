import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import { SettingsProvider, useSettings, SETTINGS, SETTINGS_CATEGORIES } from '@/contexts/SettingsContext';
import { useComboEditorPlacement } from '@/hooks/useComboEditorPlacement';
import { COMBO_EDITOR_PLACEMENT_SETTING, resolveComboEditorPlacement } from '@/lib/comboEditorPlacement';

const wrapper = ({ children }: { children: ReactNode }) => <SettingsProvider>{children}</SettingsProvider>;
const setSearch = (search: string) => window.history.replaceState(null, '', `/${search}`);

describe('combo editor placement', () => {
 afterEach(() => setSearch(''));

 it('defaults to the editor in the side panel, with the others still selectable', () => {
  expect(resolveComboEditorPlacement('', undefined)).toEqual({ placement: 'panel', fromUrl: false });
  const setting = SETTINGS.find(s => s.name === COMBO_EDITOR_PLACEMENT_SETTING);
  expect(setting?.defaultValue).toBe('panel');
  expect(setting?.items?.map(i => i.value)).toEqual(['panel', 'half', 'dock', 'anchored', 'float']);
  expect(resolveComboEditorPlacement('?comboEditor=half', 'dock')).toEqual({ placement: 'half', fromUrl: true });
  expect(SETTINGS_CATEGORIES.find(c => c.name === 'general')?.settings).toContain(COMBO_EDITOR_PLACEMENT_SETTING);
 });

 it('keeps ?comboEditor=<value> as a one-load opt-out from the side panel, for comparison', () => {
  const setting = SETTINGS.find(s => s.name === COMBO_EDITOR_PLACEMENT_SETTING);
  expect(setting?.items?.find(i => i.value === 'panel')?.label).toBe('In the side panel');
  expect(resolveComboEditorPlacement('?comboEditor=half', undefined)).toEqual({ placement: 'half', fromUrl: true });
  expect(resolveComboEditorPlacement('?comboEditor=dock', 'panel')).toEqual({ placement: 'dock', fromUrl: true });
  expect(resolveComboEditorPlacement('?comboEditor=panel', 'half')).toEqual({ placement: 'panel', fromUrl: true });
  expect(resolveComboEditorPlacement('', 'half')).toEqual({ placement: 'half', fromUrl: false });
 });

 it('lets a valid URL value win over the setting without saving it', () => {
  expect(resolveComboEditorPlacement('?comboEditor=float', 'anchored')).toEqual({ placement: 'float', fromUrl: true });
 });

 it('ignores an invalid URL value and an unknown setting', () => {
  expect(resolveComboEditorPlacement('?comboEditor=sideways', 'anchored')).toEqual({ placement: 'anchored', fromUrl: false });
  expect(resolveComboEditorPlacement('?comboEditor=sideways', 'beside')).toEqual({ placement: 'panel', fromUrl: false });
 });

 it('follows the setting, and the URL override never writes to it', () => {
  const { result } = renderHook(() => ({ p: useComboEditorPlacement(), s: useSettings() }), { wrapper });
  expect(result.current.p.placement).toBe('panel');
  act(() => result.current.s.updateSetting(COMBO_EDITOR_PLACEMENT_SETTING, 'anchored'));
  expect(result.current.p.placement).toBe('anchored');
  setSearch('?comboEditor=float');
  const second = renderHook(() => ({ p: useComboEditorPlacement(), s: useSettings() }), { wrapper });
  expect(second.result.current.p).toEqual({ placement: 'float', fromUrl: true });
  expect(second.result.current.s.settings[COMBO_EDITOR_PLACEMENT_SETTING]).not.toBe('float');
 });
});
