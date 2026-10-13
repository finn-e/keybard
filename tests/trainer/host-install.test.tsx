import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { HostVersion, HOST_DOWNLOAD, HOST_RELEASE, HOST_RELEASE_TAG } from '@/features/trainer/HostInstall';
it('offers a versioned download', () => {
    expect(HOST_DOWNLOAD).toBe(`https://github.com/svalboard/keybard/releases/download/${HOST_RELEASE_TAG}/KeybardHost-Windows.zip`);
});

it('says which Keybard Host is connected and points older ones at the current release', () => {
    const { rerender } = render(<HostVersion build={{ version: HOST_RELEASE_TAG, keybardCommit: '5954334' }} />);
    expect(screen.getByText(new RegExp(`Connected to Keybard Host ${HOST_RELEASE_TAG} · Keybard 5954334`))).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'download it' })).toBeNull();
    rerender(<HostVersion build={{ version: 'unknown', keybardCommit: null }} />);
    expect(screen.getByText(/Connected to an older Keybard Host\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'download it' })).toHaveAttribute('href', HOST_RELEASE);
    rerender(<HostVersion build={{ version: 'dev', keybardCommit: 'abc1234' }} />);
    expect(screen.getByText(/Keybard Host dev · Keybard abc1234/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'download it' })).toBeNull();
});
