import { useEffect } from 'react';
import { Download, PlugZap, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLayoutSettings } from '@/contexts/LayoutSettingsContext';
import { PARANOID } from '@/lib/paranoid';
import { useHost } from './host';
import { HOST_DOWNLOAD, HostVersion } from './HostInstall';

/** Links that open the overlay dialog: the Host's Open Keybard, and older Hosts' #trainer. */
export const overlayRequested = (hash = window.location.hash) => hash === '#overlay' || hash === '#trainer';

/**
 * The desktop overlay is Keybard Host, which reads the board and keeps its own settings.
 * Keybard only offers the download and connects to it, so the overlay refreshes after edits
 * and uses Keybard's keyboard language.
 */
export function OverlayDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    return <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[440px]">{open && <OverlayDialogBody />}</DialogContent>
    </Dialog>;
}

function OverlayDialogBody() {
    // Mounted only while open, so Keybard talks to the Host only then.
    const host = useHost();
    const { internationalLayout } = useLayoutSettings();
    useEffect(() => {
        if (!host.state || host.busy || host.state.config.layoutId === internationalLayout) return;
        void host.configure(latest => ({ ...latest, layoutId: internationalLayout }));
    }, [internationalLayout, host.state?.session, host.state?.config.layoutId, host.busy]);
    const board = host.state?.devices.find(d => d.id === host.state?.selectedDevice);
    const description = host.state
        ? board ? `Keybard Host is following ${board.name}.` : 'Keybard Host is running. Choose a board from its menu.'
        : PARANOID ? 'Start Keybard Host in paranoid mode (Start-Paranoid.cmd) and use the Keybard it opens.'
            : 'Keybard Host shows your layout above your other windows.';
    return <>
        <DialogHeader>
            <DialogTitle>Desktop overlay</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {host.error && !host.state && <p role="alert" className="text-sm text-destructive">{host.error}</p>}
        <HostVersion build={host.build} />
        <DialogFooter>
            {host.state ? board && <Button variant="outline" onClick={() => void host.command({ op: 'disconnect' })}><Unplug /> Disconnect</Button>
            : !PARANOID && <>
                {!host.local && <Button variant="outline" onClick={host.connect}><PlugZap /> Connect</Button>}
                <Button asChild><a href={HOST_DOWNLOAD}><Download /> Download for Windows</a></Button>
            </>}
        </DialogFooter>
    </>;
}
