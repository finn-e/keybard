import React from "react";
import DescriptionBlock from "@/layout/SecondarySidebar/components/DescriptionBlock";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { identifyFirmwareRelease, firmwareReleaseLabel, LATEST_FIRMWARE_RELEASE } from "@/constants/firmware";
import { FirmwareLink } from "@/components/FirmwareUpdate";
import { keybardVersion } from "@/utils/build-info";

/** What the connected board says about its firmware. */
const FirmwareDetails: React.FC = () => {
    const { keyboard, isConnected } = useKeyboard();
    if (!keyboard || !isConnected) {
        return <p className="text-sm text-muted-foreground">Connect a keyboard to see its firmware.</p>;
    }
    const release = identifyFirmwareRelease(keyboard);
    return (
        <dl aria-label="Keyboard firmware" className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <dt>Release</dt>
            <dd className="font-mono text-kb-ink">{release ? firmwareReleaseLabel(release) : "Unknown"}</dd>
            {keyboard.sval_firmware && (
                <>
                    <dt>Build</dt>
                    <dd className="font-mono text-kb-ink break-all">{keyboard.sval_firmware}</dd>
                </>
            )}
            <dt>Sval protocol</dt>
            <dd className="font-mono text-kb-ink">{keyboard.svil_proto ?? "?"}</dd>
            {keyboard.keycode_version && (
                <>
                    <dt>QMK keycodes</dt>
                    <dd className="font-mono text-kb-ink">{keyboard.keycode_version}</dd>
                </>
            )}
            {release?.outdated && (
                <dd className="col-span-2 pt-1">
                    {LATEST_FIRMWARE_RELEASE} is available: get it from <FirmwareLink />.
                </dd>
            )}
        </dl>
    );
};

const AboutPanel: React.FC = () => {
    return (
        <div className="space-y-3 pt-0 pb-8 relative flex flex-col">
            <div className="flex flex-col">
                <DescriptionBlock wrapText={false}>
                    <p className="mb-4 text-sm text-slate-500 dark:text-neutral-400 leading-relaxed">
                        <b>Keybard</b> <span className="font-mono">{keybardVersion()}</span>
                        <br/><br/>
                        Developed for the <b>Svalboard</b> community.
                    </p>
                    <h3 className="mb-2 text-sm font-semibold text-kb-ink">Keyboard firmware</h3>
                    <FirmwareDetails />
                    <p className="mt-3 text-xs text-muted-foreground">
                        Newest Svalboard firmware this Keybard knows: <span className="font-mono">{LATEST_FIRMWARE_RELEASE}</span>.
                        The firmware doesn't report its release over USB; Keybard identifies it from the features it reports.
                    </p>
                </DescriptionBlock>
            </div>
        </div>
    );
};

export default AboutPanel;
