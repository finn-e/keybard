// The firmware files this deploy carries, fetched from the same origin and checked by
// the sheet against their pins. Keybard Paranoid fetches nothing: Choose a file only.

import { carriedFileUrl, type FirmwareReleasePin } from "@/constants/firmware-releases";
import { PARANOID } from "@/lib/paranoid";
import { loadSvup, type SvupFile } from "@/services/updater/svup";
import type { Hand } from "@/services/updater/protocol";

export async function loadCarriedRelease(release: FirmwareReleasePin, fetcher: typeof fetch = fetch): Promise<Record<Hand, SvupFile>> {
    if (PARANOID) throw new Error("Keybard Paranoid installs only a file you choose.");
    const get = async (name: string) => {
        const res = await fetcher(carriedFileUrl(release, name), { cache: "no-store" });
        if (!res.ok) throw new Error(`Couldn't load ${name} (${res.status}).`);
        return loadSvup(new Uint8Array(await res.arrayBuffer()));
    };
    const [left, right] = await Promise.all([get(release.files.left.svup), get(release.files.right.svup)]);
    return { 0: left, 1: right } as Record<Hand, SvupFile>;
}
