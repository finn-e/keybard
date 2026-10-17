import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { HostVersion, HOST_DOWNLOAD, HOST_RELEASE, HOST_RELEASE_TAG, hostZipName } from '@/features/trainer/HostInstall';
it('offers a versioned download', () => {
    expect(HOST_DOWNLOAD).toBe(`https://github.com/svalboard/keybard/releases/download/${HOST_RELEASE_TAG}/${hostZipName(HOST_RELEASE_TAG)}`);
});

it('uses the ZIP name each release has: the old name before the rename, the new one after', () => {
    expect(hostZipName('vLaunch2.3')).toBe('KeybardHost-Windows.zip');
    expect(hostZipName('keybard-host-v0.1.0-preview.6')).toBe('KeybardHost-Windows.zip');
    expect(hostZipName('x3')).toBe('KeybardOverlay-Windows.zip');
    expect(hostZipName('v3.1')).toBe('KeybardOverlay-Windows.zip');
});

it('says which Keybard Overlay is connected and points older ones at the current release', () => {
    const { rerender } = render(<HostVersion build={{ version: HOST_RELEASE_TAG, keybardCommit: '5954334' }} />);
    expect(screen.getByText(new RegExp(`Connected to Keybard Overlay ${HOST_RELEASE_TAG} · Keybard 5954334`))).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'download it' })).toBeNull();
    rerender(<HostVersion build={{ version: 'unknown', keybardCommit: null }} />);
    expect(screen.getByText(/Connected to an older Keybard Overlay\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'download it' })).toHaveAttribute('href', HOST_RELEASE);
    rerender(<HostVersion build={{ version: 'dev', keybardCommit: 'abc1234' }} />);
    expect(screen.getByText(/Keybard Overlay dev · Keybard abc1234/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'download it' })).toBeNull();
});
