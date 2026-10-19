// Keybard Paranoid build (vite --mode paranoid): one HTML file opened from disk,
// no network access, no Keybard Overlay, no background reads from the keyboard.
export const PARANOID = import.meta.env.MODE === "paranoid";

/** In Paranoid, background polling of the board only runs while you are looking at Keybard. */
export function userIsLooking(): boolean {
    if (typeof document === "undefined") return true;
    return document.visibilityState === "visible" && document.hasFocus();
}
