import { useEffect } from 'react';
import { GraduationCap, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLayoutSettings } from '@/contexts/LayoutSettingsContext';
import './trainer.css';
import { useHost } from './host';
import { PARANOID } from '@/lib/paranoid';
import { HostInstall, HostVersion } from './HostInstall';

/**
 * The desktop overlay lives in Keybard Host: it reads the board itself, and its overlay menu and
 * tray hold every setting. This page installs the Host and connects Keybard to it, so the overlay
 * re-reads the layout after edits and uses Keybard's keyboard language.
 */
export default function TrainerPage(_props: { active?: boolean }) {
    const host = useHost();
    const { internationalLayout } = useLayoutSettings();
    useEffect(() => {
        if (!host.state || host.busy || host.state.config.layoutId === internationalLayout) return;
        void host.configure(latest => ({ ...latest, layoutId: internationalLayout }));
    }, [internationalLayout, host.state?.session, host.state?.config.layoutId, host.busy]);
    const board = host.state?.devices.find(d => d.id === host.state?.selectedDevice);
    return <div className="trainer-page">
        <header className="trainer-header"><GraduationCap size={19} className="text-kb-green" /><h1>Overlay</h1></header>
        <main className="trainer-main">
            {!host.state && (PARANOID
                ? <p className="trainer-note">For the desktop overlay, start Keybard Host in paranoid mode (Start-Paranoid.cmd) and use the Keybard it opens. This file never contacts anything else.</p>
                : <HostInstall onConnect={host.local ? undefined : host.connect} />)}
            {host.error && <p role="alert" className="trainer-error">{host.error}</p>}
            {host.state && <section className="trainer-install" aria-label="Keybard Host">
                <div className="trainer-install-heading"><div>
                    <h2>{board ? `The overlay follows ${board.name}` : 'Keybard Host is running'}</h2>
                    <p>{board ? (host.state.valid ? 'It updates when you change the layout here.' : host.state.status) : 'Choose a Svalboard from the overlay’s ⋯ menu or the tray icon.'}</p>
                </div>
                    {board && <Button variant="outline" onClick={() => void host.command({ op: 'disconnect' })}><Unplug size={14} /> Disconnect</Button>}
                </div>
                <p>The overlay’s settings are in its <strong>⋯</strong> menu, above its corner, and in the Keybard Host tray icon: the board it follows, style, layer-change highlight, held keys, hands, capital letters and adaptive contrast.</p>
                <HostVersion build={host.build} />
            </section>}
        </main>
    </div>;
}
