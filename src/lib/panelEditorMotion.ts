/**
 * Motion for the binding editor "In the side panel" (the default placement).
 * The panel's frame and background never move; only its contents animate.
 * Entering, the clicked list row grows into the pinned editor while the rest
 * of the list fades out and the picker rises in beneath. Leaving reverses it.
 */

/** Enter and exit length. Standard ease-out. */
export const PANEL_EDITOR_MOTION_MS = 280;
export const PANEL_EDITOR_EASE_OUT = "cubic-bezier(0.2, 0, 0, 1)";
/** With reduced motion: a short crossfade only, nothing moves. */
export const PANEL_EDITOR_FADE_MS = 120;
/** How far the picker rises in from beneath the editor. */
export const PANEL_PICKER_RISE_PX = 16;

export type PanelEditorMotion = "enter" | "exit";

export interface MotionRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/**
 * The transform and clip that make an element laid out at `to` look like it
 * sits at `from`: shifted onto it, its width matched, and clipped to its
 * height (clipping keeps the text from squashing vertically). Origin top left.
 */
export function rowToEditorFrame(from: MotionRect, to: MotionRect): { transform: string; clipPath: string } {
    const dx = Math.round(from.left - to.left);
    const dy = Math.round(from.top - to.top);
    const sx = to.width > 0 && from.width > 0 ? from.width / to.width : 1;
    const hidden = Math.max(0, Math.round(to.height - from.height));
    return {
        transform: `translate(${dx}px, ${dy}px) scaleX(${Number(sx.toFixed(4))})`,
        clipPath: `inset(0px 0px ${hidden}px 0px round 8px)`,
    };
}

/** The editor at rest. */
export const EDITOR_REST_FRAME = { transform: "translate(0px, 0px) scaleX(1)", clipPath: "inset(0px 0px 0px 0px round 12px)" };

/** True when the rect has an area worth animating from or to. */
export const isUsableRect = (rect: MotionRect | null | undefined): rect is MotionRect =>
    !!rect && rect.width > 1 && rect.height > 1;

/** How the pinned editor shows it stays put while the picker scrolls (owner review: ?pinCue=). */
export const PIN_CUES = ["shadow", "divider", "notch"] as const;
export type PinCue = typeof PIN_CUES[number];
export const PIN_CUE_PARAM = "pinCue";
export const DEFAULT_PIN_CUE: PinCue = "shadow";

export function pinCueStyle(search: string): PinCue {
    let value: string | null = null;
    try {
        value = new URLSearchParams(search).get(PIN_CUE_PARAM);
    } catch {
        value = null;
    }
    return (PIN_CUES as readonly string[]).includes(value ?? "") ? value as PinCue : DEFAULT_PIN_CUE;
}

/**
 * True once picker content has scrolled beneath the pinned editor. A tall
 * editor pins with a negative top, so it first scrolls up by that much.
 */
export const pickerScrolledUnder = (scrollTop: number, pinTop: number): boolean =>
    scrollTop > Math.max(0, -pinTop) + 0.5;
