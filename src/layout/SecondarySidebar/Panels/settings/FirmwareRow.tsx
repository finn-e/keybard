import React from "react";
import { Button } from "@/components/ui/button";
import { FirmwareLink } from "@/components/FirmwareUpdate";
import { describeFirmware, identifyFirmwareRelease, LATEST_FIRMWARE_RELEASE } from "@/constants/firmware";
import { useKeyboard } from "@/contexts/KeyboardContext";

/**
 * Settings > Firmware, status only: what the board runs. The install flow
 * replaces this file (one import in SettingsPanel) when it lands.
 */
const FirmwareRow: React.FC = () => {
    const { keyboard, isConnected } = useKeyboard();

    if (!keyboard || !isConnected) {
        return <p className="px-3 py-2.5 text-sm text-muted-foreground">Connect a keyboard to see its firmware.</p>;
    }

    const release = identifyFirmwareRelease(keyboard);
    const running = describeFirmware(keyboard);

    return (
        <div className="flex flex-col gap-2 px-3 py-2.5">
            <dl aria-label="Keyboard firmware" className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Half with USB</dt>
                <dd className="font-mono text-kb-ink break-all">{running ?? "Unknown"}</dd>
            </dl>
            {release?.outdated && (
                <p className="text-sm text-muted-foreground">
                    {LATEST_FIRMWARE_RELEASE} is available: get it from <FirmwareLink />.
                </p>
            )}
            {import.meta.env.DEV && (
                <div className="flex flex-row items-center gap-2">
                    <Button size="sm" variant="outline" disabled>
                        Open the firmware page
                    </Button>
                    <span className="text-xs text-muted-foreground">Coming soon</span>
                </div>
            )}
        </div>
    );
};

export default FirmwareRow;
