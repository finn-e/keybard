import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QMKSettingsPanel from '../../src/layout/SecondarySidebar/Panels/TypingBehaviorPanel';
const { queue, setKeyboard } = vi.hoisted(() => ({ queue: vi.fn(), setKeyboard: vi.fn() }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: {settings: {7: 200, 8: 0, 21: 0}}, setKeyboard }) }));
vi.mock('@/contexts/ChangesContext', () => ({ useChanges: () => ({queue}) }));
vi.mock('@/services/qmk.service', () => ({qmkService: {}}));
vi.mock('@/services/keyboard.service', () => ({keyboardService: {}}));

const savedValues = () => setKeyboard.mock.calls.map(([kb]) => kb.settings[7]);

describe('QMK settings integer fields', () => {
 beforeEach(() => { queue.mockReset(); setKeyboard.mockReset(); });

 it('keeps focus while typing and saves the whole value once on Enter', async () => {
  const user = userEvent.setup();
  render(<QMKSettingsPanel />);
  const field = screen.getByRole('spinbutton', {name: 'Tapping Term'});
  await user.clear(field);
  await user.type(field, '210');
  expect(field).toHaveFocus();
  expect(field).toHaveValue(210);
  expect(setKeyboard).not.toHaveBeenCalled();
  await user.keyboard('{Enter}');
  expect(savedValues()).toEqual([210]);
  expect(queue).toHaveBeenCalledTimes(1);
 });

 it('saves on blur, clamps to the range, and discards on Escape', async () => {
  const user = userEvent.setup();
  render(<QMKSettingsPanel />);
  const field = screen.getByRole('spinbutton', {name: 'Tapping Term'});
  await user.clear(field);
  await user.type(field, '99999');
  await user.tab();
  expect(savedValues()).toEqual([10000]);

  setKeyboard.mockReset();
  await user.clear(field);
  await user.type(field, '5{Escape}');
  expect(field).toHaveValue(200);
  await user.tab();
  expect(setKeyboard).not.toHaveBeenCalled();
 });
});
