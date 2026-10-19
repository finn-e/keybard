import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QMKSettingsPanel from '../../src/layout/SecondarySidebar/Panels/TypingBehaviorPanel';
const { queue, setKeyboard } = vi.hoisted(() => ({ queue: vi.fn(), setKeyboard: vi.fn() }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: {settings: {7: 200, 8: 0, 21: 0}}, setKeyboard }) }));
vi.mock('@/contexts/ChangesContext', () => ({ useChanges: () => ({queue}) }));
vi.mock('@/services/qmk.service', () => ({qmkService: {}}));
vi.mock('@/services/keyboard.service', () => ({keyboardService: {}}));
describe('QMK settings access', () => {
 it('names real controls and exposes disclosure state without writing on navigation', async () => {
  const user = userEvent.setup();
  render(<QMKSettingsPanel />);
  expect(screen.getByRole('spinbutton', {name: 'Tapping Term'})).toHaveValue(200);
  expect(screen.getByRole('switch', {name: 'Permissive Hold'})).toHaveAttribute('aria-checked', 'false');
  const magic = screen.getByRole('button', {name: 'Magic'});
  expect(magic).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('switch', {name: 'Swap Caps Lock and Left Control'})).toBeNull();
  await user.click(magic);
  expect(magic).toHaveAttribute('aria-expanded', 'true');
  expect(document.getElementById(magic.getAttribute('aria-controls')!)).toBeVisible();
  expect(screen.getByRole('switch', {name: 'Swap Caps Lock and Left Control'})).toBeVisible();
  expect(queue).not.toHaveBeenCalled();
  expect(setKeyboard).not.toHaveBeenCalled();
 });
});
