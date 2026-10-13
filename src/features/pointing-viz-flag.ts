import { appStorage } from "@/utils/app-storage";

// The pointing-module animations in the layout (each hand's pointing slot and the
// live POINTING_MOTION poll behind it) are off until they ship. Fragment support
// stays on regardless: a board whose definition has pointing slots must still lay
// out its keys correctly.
//
// On when any of:
// - the build sets VITE_POINTING_VIZ=1 (the dev server does, in .env.development);
// - this browser opted in: ?pointingViz=1 once (remembered), ?pointingViz=0 to opt out;
// - the page is a demo (?pointingDemo=...).
const STORAGE_KEY = "pointingViz";

export function readPointingVizFlag(search: string, envValue: string | undefined, storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null): boolean {
    const params = new URLSearchParams(search);
    const asked = params.get("pointingViz");
    try {
        if (asked === "1") storage?.setItem(STORAGE_KEY, "1");
        else if (asked === "0") storage?.removeItem(STORAGE_KEY);
    } catch {
        // Storage blocked: the URL still decides for this page.
    }
    if (asked === "0") return false;
    if (asked === "1" || params.has("pointingDemo") || envValue === "1") return true;
    try {
        return storage?.getItem(STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

let cached: boolean | undefined;

/** Whether this page shows the pointing slots. Read once per page load. */
export function pointingVizEnabled(): boolean {
    if (cached === undefined) {
        cached = typeof window !== "undefined" && readPointingVizFlag(window.location.search, import.meta.env.VITE_POINTING_VIZ, appStorage);
    }
    return cached;
}

/** For tests. */
export function _setPointingVizEnabledForTest(value: boolean | undefined) {
    cached = value;
}
