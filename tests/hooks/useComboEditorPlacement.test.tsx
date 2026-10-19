import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import { SettingsProvider, useSettings, SETTINGS, SETTINGS_CATEGORIES } from '@/contexts/SettingsContext';
import { useComboEditorPlacement } from '@/hooks/useComboEditorPlacement';
import { COMBO_EDITOR_PLACEMENT_SETTING, resolveComboEditorPlacement } from '@/lib/comboEditorPlacement';

const wrapper = ({ children }: { children: ReactNode }) => <SettingsProvider>{children}</SettingsProvider>;
const setSearch = (search: string) => window.history.replaceState(null, '', `/${search}`);

describe('binding editor placement', () => {
 afterEach(() => setSearch(''));

 it('is the side panel, with no setting for it', () => {
  expect(SETTINGS.find(s => s.name === COMBO_EDITOR_PLACEMENT_SETTING)).toBeUndefined();
  for (const c of SETTINGS_CATEGORIES) expect(c.settings).not.toContain(COMBO_EDITOR_PLACEMENT_SETTING);
  expect(resolveComboEditorPlacement('', undefined)).toEqual({ placement: 'panel', fromUrl: false });
 });

 it('ignores a placement saved by an older version', () => {
  const { result } = renderHook(() => ({ p: useComboEditorPlacement(), s: useSettings() }), { wrapper });
  act(() => result.current.s.updateSetting(COMBO_EDITOR_PLACEMENT_SETTING, 'anchored'));
  expect(result.current.p.placement).toBe('panel');
 });

 it('keeps the ?comboEditor= review override for one page load', () => {
  expect(resolveComboEditorPlacement('?comboEditor=half', undefined)).toEqual({ placement: 'half', fromUrl: true });
  expect(resolveComboEditorPlacement('?comboEditor=sideways', undefined)).toEqual({ placement: 'panel', fromUrl: false });
  setSearch('?comboEditor=float');
  const { result } = renderHook(() => useComboEditorPlacement(), { wrapper });
  expect(result.current).toEqual({ placement: 'float', fromUrl: true });
 });
});
