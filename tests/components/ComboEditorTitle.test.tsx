import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComboEditorTitle } from '../../src/layout/SecondarySidebar/components/ComboEditorTitle';

const { renameBinding, kb, error } = vi.hoisted(() => ({
    renameBinding: vi.fn(),
    kb: { keyboard: null as any },
    error: { value: null as string | null },
}));
vi.mock('@/hooks/useBindingNames', () => ({ useBindingNames: () => ({ renameBinding, nameError: error.value }) }));
vi.mock('@/contexts/KeyboardContext', () => ({ useKeyboard: () => ({ keyboard: kb.keyboard }) }));
beforeEach(() => {
    vi.clearAllMocks();
    error.value = null;
    kb.keyboard = { cosmetic: { combos: { '0': 'Quick escape' } } };
    renameBinding.mockImplementation(async (_kind: string, index: number, value: string) => {
        const names = { ...kb.keyboard.cosmetic.combos };
        if (value.trim()) names[String(index)] = value.trim(); else delete names[String(index)];
        kb.keyboard = { cosmetic: { combos: names } };
        return true;
    });
});

describe('combo editor title', () => {
    it('titles a named combo with its name, its number as the small label', () => {
        render(<ComboEditorTitle index={0} />);
        expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Quick escape');
        expect(screen.getByText('Combo 0')).toBeVisible();
        expect(screen.queryByText('Name this combo')).toBeNull();
    });

    it('offers "Name this combo" for an unnamed combo, and names it in place', async () => {
        const user = userEvent.setup();
        const view = render(<ComboEditorTitle index={1} />);
        expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Combo 1');
        await user.click(screen.getByRole('button', { name: 'Name this combo' }));
        const input = screen.getByRole('textbox', { name: 'Name of Combo 1' });
        expect(input).toHaveFocus();
        expect(input).toHaveValue('');
        await user.type(input, 'Save file{Enter}');
        expect(renameBinding).toHaveBeenCalledExactlyOnceWith('combo', 1, 'Save file');
        view.rerender(<ComboEditorTitle index={1} />);
        await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Save file'));
        expect(screen.getByText('Combo 1')).toBeVisible();
    });

    it('renames on a click of the name; Escape cancels; an empty name removes it', async () => {
        const user = userEvent.setup();
        const view = render(<ComboEditorTitle index={0} />);
        await user.click(screen.getByRole('button', { name: 'Quick escape, rename Combo 0' }));
        expect(screen.getByRole('textbox')).toHaveValue('Quick escape');
        await user.type(screen.getByRole('textbox'), ' now{Escape}');
        expect(renameBinding).not.toHaveBeenCalled();
        expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Quick escape');
        await user.click(screen.getByRole('button', { name: 'Quick escape, rename Combo 0' }));
        await user.clear(screen.getByRole('textbox'));
        await user.keyboard('{Enter}');
        expect(renameBinding).toHaveBeenCalledExactlyOnceWith('combo', 0, '');
        view.rerender(<ComboEditorTitle index={0} />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Name this combo' })).toBeVisible());
    });

    it('keeps the field open with the error when the name is refused', async () => {
        renameBinding.mockResolvedValue(false);
        error.value = 'Name is too long';
        const user = userEvent.setup();
        render(<ComboEditorTitle index={1} />);
        await user.click(screen.getByRole('button', { name: 'Name this combo' }));
        await user.type(screen.getByRole('textbox'), 'a very long combo name{Enter}');
        expect(screen.getByRole('textbox')).toHaveValue('a very long combo name');
        expect(screen.getByRole('alert')).toHaveTextContent('Name is too long');
    });

    it('is plain text while the editor leaves (read-only)', () => {
        render(<ComboEditorTitle index={0} readOnly />);
        expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Quick escape');
        expect(screen.queryByRole('button')).toBeNull();
    });
});
