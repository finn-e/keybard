import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PointingPanel from '../../src/layout/SecondarySidebar/Panels/PointingPanel';

// Guard for the key-sizing consistency rule: the Pointing panel must not render
// <Key> itself. Every assignable key comes from MouseKeysSection, which owns the
// single size computation for the panel.
const layoutSettings = { keyVariant: 'default', layoutMode: 'sidebar' as 'sidebar' | 'bottombar' };
const keyRenders = vi.fn();
const mouseKeysSectionRenders = vi.fn();

vi.mock('@/contexts/LayoutSettingsContext', () => ({ useLayoutSettings: () => layoutSettings }));
vi.mock('@/contexts/KeyboardContext', () => ({
    useKeyboard: () => ({ keyboard: { menus: [{ label: 'Pointing Device', content: [] }] }, isConnected: true, connect: vi.fn() }),
}));
vi.mock('@/components/Key', () => ({
    Key: (props: { keycode: string }) => { keyRenders(props); return <div data-testid="stray-key" />; },
}));
vi.mock('../../src/layout/SecondarySidebar/Panels/MouseKeysSection', () => ({
    default: (props: Record<string, unknown>) => { mouseKeysSectionRenders(props); return <div data-testid="mouse-keys-section" />; },
}));
vi.mock('../../src/layout/SecondarySidebar/Panels/DynamicMenuPanel', () => ({
    default: () => <div data-testid="dynamic-menu" />,
}));
vi.mock('@/layout/SecondarySidebar/components/DescriptionBlock', () => ({
    default: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

describe('PointingPanel: all keys come from the shared MouseKeysSection', () => {
    it('sidebar mode renders no ad-hoc <Key> and embeds the section with default sizing', () => {
        layoutSettings.layoutMode = 'sidebar';
        render(<PointingPanel />);
        expect(screen.getByTestId('mouse-keys-section')).toBeInTheDocument();
        expect(screen.queryByTestId('stray-key')).not.toBeInTheDocument();
        expect(keyRenders).not.toHaveBeenCalled();
        expect(mouseKeysSectionRenders).toHaveBeenLastCalledWith({});
    });

    it('bottom-bar mode renders no ad-hoc <Key> and passes the compact/medium override', () => {
        layoutSettings.layoutMode = 'bottombar';
        render(<PointingPanel />);
        expect(screen.queryByTestId('stray-key')).not.toBeInTheDocument();
        expect(mouseKeysSectionRenders).toHaveBeenLastCalledWith({ compact: true, variant: 'medium' });
    });

    it('picker mode renders the same section, not its own keys', () => {
        layoutSettings.layoutMode = 'sidebar';
        render(<PointingPanel isPicker />);
        expect(screen.getByTestId('mouse-keys-section')).toBeInTheDocument();
        expect(screen.queryByTestId('stray-key')).not.toBeInTheDocument();
    });

    it.each(['sidebar', 'bottombar'] as const)('%s mode no longer shows the pointing hardware summary (it lives in the layout slots)', (mode) => {
        layoutSettings.layoutMode = mode;
        render(<PointingPanel />);
        expect(screen.queryByTestId('pointing-hardware-summary')).not.toBeInTheDocument();
        expect(screen.queryByText(/trackball|TrackPoint|Checking/i)).not.toBeInTheDocument();
    });
});
