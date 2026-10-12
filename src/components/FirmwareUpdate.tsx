import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";

import { SVALBOARD_FIRMWARE_URL, type FirmwareUpdateNotice } from "@/constants/firmware";
import { PARANOID } from "@/lib/paranoid";
import type { UnsupportedFirmwareInfo } from "@/utils/unsupported-firmware";
import { cn } from "@/lib/utils";

/** The firmware download. Keybard Paranoid can't open links, so it shows the address instead. */
export function FirmwareLink() {
    if (PARANOID) return <code className="select-all break-all font-mono text-xs">{SVALBOARD_FIRMWARE_URL}</code>;
    return (
        <a href={SVALBOARD_FIRMWARE_URL} target="_blank" rel="noreferrer" className="font-medium text-kb-primary underline">
            the latest Svalboard firmware release
        </a>
    );
}

const FlashSteps = ({ fromVial }: { fromVial: boolean }) => (
    <ol className="list-decimal space-y-1 pl-5">
        {fromVial && (
            <li>
                Keep your layout: in Vial, choose <strong>File &gt; Save current layout</strong> to save a .vil file.
            </li>
        )}
        <li>
            Download the <span className="font-mono">.uf2</span> files from <FirmwareLink />: pick the image that matches each half's sensor type and side (left or right).
        </li>
        <li>
            Flash both halves: double-tap a half's reset button so it shows up as a drive named <span className="font-mono">RPI-RP2</span>, then copy its <span className="font-mono">.uf2</span> onto that drive. Repeat for the other half.
        </li>
        <li>
            Connect again.{fromVial && <> Then click <strong>Import Layout</strong> above the keyboard and choose your saved .vil file.</>}
        </li>
    </ol>
);

/** Why the keyboard couldn't connect, and how to get it onto firmware Keybard can use. */
export function UnsupportedFirmwareCard({ info, className, onDismiss }: { info: UnsupportedFirmwareInfo; className?: string; onDismiss?: () => void }) {
    let title: string;
    let body: React.ReactNode;
    switch (info.kind) {
        case "svalboard-vial":
            title = "Update your Svalboard's firmware";
            body = (
                <>
                    <p>
                        This Svalboard is running the old Vial firmware{info.reportedVersion && <> (<span className="font-mono">{info.reportedVersion}</span>)</>}. Keybard needs Svalboard QMK firmware.
                    </p>
                    <FlashSteps fromVial />
                </>
            );
            break;
        case "outdated-sval":
            title = "Update your Svalboard's firmware";
            body = (
                <>
                    <p>This Svalboard runs a pre-release Svalboard QMK build (Sval protocol {info.svilProto ?? "?"}) that this Keybard can't edit safely.</p>
                    <FlashSteps fromVial={false} />
                </>
            );
            break;
        case "other-qmk":
            title = "Not a Svalboard firmware";
            body = <p>This keyboard doesn't run Svalboard firmware. Keybard only configures keyboards running Svalboard QMK; use VIA or Vial for this one.</p>;
            break;
        case "no-response":
            title = "The keyboard didn't respond";
            body = (
                <ol className="list-decimal space-y-1 pl-5">
                    <li>Close other apps that may be using the keyboard: Vial, VIA, or another Keybard tab or window.</li>
                    <li>Unplug the keyboard, plug it back in, and wait a few seconds.</li>
                    <li>Connect again.</li>
                </ol>
            );
            break;
        default:
            title = "Keyboard firmware not recognized";
            body = (
                <>
                    <p>The keyboard didn't answer like Svalboard QMK firmware. If it is a Svalboard, it is probably still running the old Vial firmware:</p>
                    <FlashSteps fromVial />
                </>
            );
    }
    return (
        <div role="alert" aria-label={title} className={cn("rounded-md border border-kb-gray-border bg-kb-surface p-4 text-left text-sm text-kb-ink", className)}>
            <p className="mb-2 flex items-center gap-2 font-semibold text-kb-red">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="flex-1">{title}</span>
                {onDismiss && (
                    <button type="button" onClick={onDismiss} aria-label="Dismiss" title="Dismiss" className="rounded p-0.5 text-kb-ink hover:bg-kb-gray-medium cursor-pointer">
                        <X className="h-4 w-4" />
                    </button>
                )}
            </p>
            <div className="space-y-2">{body}</div>
        </div>
    );
}

const NOTICE_TEXT: Record<FirmwareUpdateNotice, string> = {
    rc0: "Newer Svalboard firmware is available. It lets the Trainer follow your layers, and applies more of the QMK settings you save here.",
    rc: "Newer Svalboard firmware is available. It applies more of the QMK settings you save here, such as tap-hold timing.",
    launch: "Newer Svalboard firmware (vLaunch2) is available. It keeps your settings more reliably, and lets you choose the default layer here.",
};

const dismissKey = (notice: FirmwareUpdateNotice) => `keybard:firmware-notice-dismissed:${notice}`;

function isDismissed(notice: FirmwareUpdateNotice): boolean {
    try { return localStorage.getItem(dismissKey(notice)) === "1"; } catch { return false; }
}

/** Non-blocking "newer firmware available" note for a board on a release candidate. */
export function FirmwareUpdateNote({ notice }: { notice: FirmwareUpdateNotice }) {
    const [dismissed, setDismissed] = useState(() => isDismissed(notice));
    if (dismissed) return null;
    const dismiss = () => {
        try { localStorage.setItem(dismissKey(notice), "1"); } catch { /* still hide it for this session */ }
        setDismissed(true);
    };
    return (
        <div role="note" aria-label="Firmware update available" className="flex items-start gap-2 whitespace-normal rounded-md border border-kb-gray-border bg-kb-surface p-3 text-sm text-kb-ink shadow-sm">
            <p className="flex-1">{NOTICE_TEXT[notice]} Get it from <FirmwareLink />.</p>
            <button type="button" onClick={dismiss} aria-label="Dismiss firmware notice" title="Dismiss" className="rounded p-0.5 text-kb-ink hover:bg-kb-gray-medium cursor-pointer">
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
