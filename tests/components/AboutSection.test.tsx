import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AboutSection from '../../src/layout/SecondarySidebar/Panels/settings/AboutSection';

vi.mock('@/lib/paranoid', () => ({ PARANOID: false, userIsLooking: () => true }));

afterEach(() => vi.unstubAllEnvs());

describe('About', () => {
    it('shows the Keybard build, never a made-up version, and no firmware text', () => {
        render(<AboutSection />);
        const facts = screen.getByLabelText('Keybard');
        expect(facts).not.toHaveTextContent('1.0.0');
        expect(facts.textContent).toMatch(/^Keybard(build [0-9a-f]+|development build|[vx]\d)/);
        expect(document.body.textContent).not.toMatch(/firmware/i);
    });

    it('links to the manual, release notes and community', () => {
        render(<AboutSection />);
        expect(screen.getByRole('link', { name: 'Manual' })).toHaveAttribute('href', expect.stringMatching(/manual\/$/));
        expect(screen.getByRole('link', { name: 'Release notes' })).toHaveAttribute('href', 'https://github.com/svalboard/keybard/releases');
        expect(screen.getByRole('link', { name: 'Svalboard community' })).toHaveAttribute('href', 'https://svalboard.com/discord');
    });

    it('links to the bleeding edge from stable', () => {
        render(<AboutSection />);
        expect(screen.getByRole('link', { name: 'next.keybard.svalboard.com' })).toHaveAttribute('href', 'https://next.keybard.svalboard.com/');
        expect(screen.getByText('Bleeding edge')).toBeInTheDocument();
    });

    it('links back to stable from the bleeding edge', () => {
        vi.stubEnv('VITE_CHANNEL', 'next');
        render(<AboutSection />);
        expect(screen.getByRole('link', { name: 'keybard.svalboard.com' })).toHaveAttribute('href', 'https://keybard.svalboard.com/');
        expect(screen.getByText('Stable')).toBeInTheDocument();
    });
});
