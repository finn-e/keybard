// Where the editor (Keyboard.tsx) puts each key, before its container-fit
// squeeze and global offset. The trainer previews use the same math, and Keybard
// Host's overlay geometry (companion/overlay-host/keybard_host/device/geometry.py)
// is locked to it by tests/trainer/host-overlay-layout.test.ts.

import { SVALBOARD_LAYOUT } from "@/constants/svalboard-layout";
import { THUMB_OFFSET_U } from "@/constants/keyboard-visuals";
import type { KeyboardInfo } from "@/types/keyboard.types";

export interface EditorKeyLayout { x: number; y: number; w: number; h: number; row?: number; col?: number }

/**
 * The layout the editor draws: the board's composed keylayout when it has one,
 * else the built-in Svalboard schematic. `fragment` says which.
 */
export function editorKeyLayout(keyboard: Pick<KeyboardInfo, "keylayout">): { layout: Record<number, EditorKeyLayout>; fragment: boolean } {
    if (keyboard.keylayout && Object.keys(keyboard.keylayout).length > 0) {
        return { layout: keyboard.keylayout as Record<number, EditorKeyLayout>, fragment: true };
    }
    return { layout: SVALBOARD_LAYOUT, fragment: false };
}

/** The editor's drawn Y for a layout Y: the schematic drops its bottom thumb row a little. */
export function editorYPos(y: number, fragment: boolean): number {
    return !fragment && y >= 6 ? y + THUMB_OFFSET_U : y;
}

/** Each key as the editor draws it with no squeeze, keyed by matrix position. */
export function editorKeyRects(keyboard: Pick<KeyboardInfo, "keylayout">): Record<number, EditorKeyLayout> {
    const { layout, fragment } = editorKeyLayout(keyboard);
    return Object.fromEntries(Object.entries(layout).map(([pos, k]) => [pos, { ...k, y: editorYPos(k.y, fragment) }]));
}
