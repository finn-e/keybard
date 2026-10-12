import { afterEach, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PanelsProvider, usePanels } from '../../src/contexts/PanelsContext';

vi.mock('@/components/ui/sidebar', () => ({ useSidebar: () => ({ state: 'collapsed' }) }));

afterEach(() => { window.location.hash = ''; });
const wrapper = ({ children }: { children: ReactNode }) => <PanelsProvider>{children}</PanelsProvider>;

it.each(['#overlay', '#trainer'])('opens the Overlay page from %s', hash => {
    window.location.hash = hash;
    const { result } = renderHook(() => usePanels(), { wrapper });
    expect(result.current.activePanel).toBe('trainer');
});

it('opens no panel for other links', () => {
    window.location.hash = '#manual';
    const { result } = renderHook(() => usePanels(), { wrapper });
    expect(result.current.activePanel).toBeNull();
});
