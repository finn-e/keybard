// The editor's firmware updates. In development, `?fwfake=1` backs them with the mock board
// (the harness's), so Settings > Firmware can be tried and reviewed without a keyboard.
// The mock is a dynamic import inside a DEV-only branch: production and Paranoid builds drop it.

import { lazy, Suspense, type ReactNode } from "react";

import { FirmwareUpdateProvider } from "./FirmwareUpdateProvider";

const DevFakeFirmware = import.meta.env.DEV ? lazy(() => import("./harness/DevFakeFirmware")) : null;

function wantsFake(): boolean {
    if (!import.meta.env.DEV || typeof location === "undefined") return false;
    return new URLSearchParams(location.search).has("fwfake");
}

export function AppFirmwareUpdates({ children }: { children: ReactNode }) {
    if (DevFakeFirmware && wantsFake()) {
        return (
            <Suspense fallback={children}>
                <DevFakeFirmware>{children}</DevFakeFirmware>
            </Suspense>
        );
    }
    return <FirmwareUpdateProvider>{children}</FirmwareUpdateProvider>;
}
