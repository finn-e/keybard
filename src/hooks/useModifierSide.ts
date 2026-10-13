import { useEffect, useState } from "react";

import { MATRIX_COLS } from "@/constants/svalboard-layout";
import { useKeyBinding } from "@/contexts/KeyBindingContext";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { KeyboardInfo } from "@/types/keyboard.types";
import { getKeycodeModifierSide, ModifierSide } from "@/utils/modifierUtils";

type SelectedTarget = ReturnType<typeof useKeyBinding>["selectedTarget"];

/** Numeric keycode of the keymap key being edited, or undefined when none is selected. */
export const getSelectedKeymapKeycode = (
    keyboard: KeyboardInfo | null | undefined,
    selectedTarget: SelectedTarget,
): number | undefined => {
    if (!keyboard?.keymap || !selectedTarget || selectedTarget.type !== "keyboard") return undefined;
    const { layer, row, col } = selectedTarget;
    if (layer === undefined || row === undefined || col === undefined) return undefined;
    const matrixCols = keyboard.cols || MATRIX_COLS;
    return keyboard.keymap[layer]?.[row * matrixCols + col];
};

/**
 * Left/Right state for the modifier pickers. It follows the key being edited:
 * selecting a key that already holds a right-hand modifier (KC_RSFT, RCTL(kc),
 * RSFT_T(kc), OSM(MOD_RALT)...) flips it to "right", a left-hand one flips it
 * back to "left". Keys with no modifier leave the user's choice alone.
 */
export const useModifierSide = (): [ModifierSide, (side: ModifierSide) => void] => {
    const { selectedTarget } = useKeyBinding();
    const { keyboard } = useKeyboard();
    const [side, setSide] = useState<ModifierSide>("left");

    const selectedKeycode = getSelectedKeymapKeycode(keyboard, selectedTarget);
    const selectedSide = getKeycodeModifierSide(selectedKeycode);

    useEffect(() => {
        if (selectedSide) setSide(selectedSide);
    }, [selectedSide, selectedTarget]);

    return [side, setSide];
};
