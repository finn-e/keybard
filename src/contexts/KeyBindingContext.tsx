import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { MATRIX_COLS, SVALBOARD_LAYOUT } from "@/constants/svalboard-layout";
import { useChanges } from "@/contexts/ChangesContext";
import { useSettings } from "@/contexts/SettingsContext";
import { keyService } from "@/services/key.service";
import { isTapdanceKeycode } from "@/utils/keys";
import { isEditorInput } from "@/utils/editor-input";
import { keyboardService } from "@/services/keyboard.service";
import { prepareOverrideForEdit } from "@/utils/key-override";
import { KEYBOARD_EVENT_MAP } from "@/utils/keyboard-mapper";
import { getOrderedKeyPositions, SerialMode } from "@/utils/serial-assignment";
import { DEFAULT_TAPDANCE_TERM_MS } from "@/utils/tapdance-term";
import { useKeyboard } from "./KeyboardContext";

interface BindingTarget {
    type: "keyboard" | "combo" | "tapdance" | "macro" | "override" | "altrepeat" | "leaders";
    layer?: number;
    row?: number;
    col?: number;
    keyboardSubsection?: "full" | "inner"; // For compound keys (LT, mod-tap): "full" = whole key, "inner" = tap keycode only
    comboId?: number;
    comboSlot?: number; // 0-4 for combo keys
    tapdanceId?: number;
    tapdanceSlot?: "tap" | "hold" | "doubletap" | "taphold";
    macroId?: number;
    macroIndex?: number;
    // Add more as needed for other binding types
    isHover?: boolean;
    keycode?: string | number;
    label?: string;
    overrideId?: number;
    overrideSlot?: "trigger" | "replacement";
    altRepeatId?: number;
    altRepeatSlot?: "keycode" | "alt_keycode";
    leaderId?: number;
    leaderSlot?: "sequence" | "output";
    leaderSeqIndex?: number; // 0-4 for sequence keys
}


interface KeyBindingContextType {
    selectedTarget: BindingTarget | null;
    selectKeyboardKey: (layer: number, row: number, col: number) => void;
    selectKeyboardKeyWithSubsection: (layer: number, row: number, col: number, subsection: "full" | "inner") => void;
    selectComboKey: (comboId: number, slot: number) => void;
    selectTapdanceKey: (tapdanceId: number, slot: "tap" | "hold" | "doubletap" | "taphold") => void;
    selectMacroKey: (macroId: number, index: number) => void;
    selectOverrideKey: (overrideId: number, slot: "trigger" | "replacement") => void;
    selectAltRepeatKey: (altRepeatId: number, slot: "keycode" | "alt_keycode") => void;
    selectLeaderKey: (leaderId: number, slot: "sequence" | "output", seqIndex?: number) => void;
    assignKeycode: (keycode: number | string) => void;
    assignKeycodeTo: (target: BindingTarget, keycode: number | string, options?: { skipAdvance?: boolean }) => void;
    swapKeys: (target1: BindingTarget, target2: BindingTarget) => void;
    clearSelection: () => void;
    isBinding: boolean;
    hoveredKey: BindingTarget | null;
    setHoveredKey: (target: BindingTarget | null) => void;
}


const KeyBindingContext = createContext<KeyBindingContextType | undefined>(undefined);

export const KeyBindingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { keyboard, setKeyboard, updateKey, getKeyboardSnapshot } = useKeyboard();
    const { queue, registerUndo } = useChanges();
    const { getSetting } = useSettings();
    const [selectedTarget, setSelectedTarget] = useState<BindingTarget | null>(null);
    const [hoveredKey, setHoveredKey] = useState<BindingTarget | null>(null);
    const [isBinding, setIsBinding] = useState(false);

    // Use a ref to always have access to the current selectedTarget value
    const selectedTargetRef = useRef<BindingTarget | null>(null);
    const modifierStateRef = useRef<Set<string>>(new Set());

    // Keep the ref in sync with the state
    selectedTargetRef.current = selectedTarget;



    const selectKeyboardKey = useCallback(
        (layer: number, row: number, col: number) => {
            setSelectedTarget({
                type: "keyboard",
                layer,
                row,
                col,
            });
            setIsBinding(true);
        },
        [keyboard]
    );

    const selectKeyboardKeyWithSubsection = useCallback(
        (layer: number, row: number, col: number, subsection: "full" | "inner") => {
            setSelectedTarget({
                type: "keyboard",
                layer,
                row,
                col,
                keyboardSubsection: subsection,
            });
            setIsBinding(true);
        },
        [keyboard]
    );

    const selectComboKey = useCallback((comboId: number, slot: number) => {
        setSelectedTarget({
            type: "combo",
            comboId,
            comboSlot: slot,
        });
        setIsBinding(true);
    }, []);

    const selectTapdanceKey = useCallback((tapdanceId: number, slot: "tap" | "hold" | "doubletap" | "taphold") => {
        setSelectedTarget({
            type: "tapdance",
            tapdanceId,
            tapdanceSlot: slot,
        });
        setIsBinding(true);
    }, []);

    const selectMacroKey = useCallback((macroId: number, index: number) => {
        setSelectedTarget({
            type: "macro",
            macroId,
            macroIndex: index,
        });
        setIsBinding(true);
    }, []);

    const selectOverrideKey = useCallback((overrideId: number, slot: "trigger" | "replacement") => {
        setSelectedTarget({
            type: "override",
            overrideId,
            overrideSlot: slot,
        });
        setIsBinding(true);
    }, []);

    const selectAltRepeatKey = useCallback((altRepeatId: number, slot: "keycode" | "alt_keycode") => {
        setSelectedTarget({
            type: "altrepeat",
            altRepeatId,
            altRepeatSlot: slot,
        });
        setIsBinding(true);
    }, []);

    const selectLeaderKey = useCallback((leaderId: number, slot: "sequence" | "output", seqIndex?: number) => {
        setSelectedTarget({
            type: "leaders",
            leaderId,
            leaderSlot: slot,
            leaderSeqIndex: seqIndex,
        });
        setIsBinding(true);
    }, []);

    const clearSelection = useCallback(() => {
        setSelectedTarget(null);
        setIsBinding(false);
    }, []);

    const selectNextKey = useCallback(() => {
        const currentTarget = selectedTargetRef.current;
        if (!currentTarget || currentTarget.type !== 'keyboard' || !keyboard) return;

        const { row, col, layer } = currentTarget;
        if (row === undefined || col === undefined || layer === undefined) return;

        // Get keyboard layout (same logic as Keyboard.tsx lines 30-37)
        const keylayout = (keyboard.keylayout && Object.keys(keyboard.keylayout).length > 0)
            ? keyboard.keylayout as Record<number, { x: number; y: number; w: number; h: number; row?: number; col?: number }>
            : SVALBOARD_LAYOUT;

        const matrixCols = keyboard.cols || MATRIX_COLS;
        const mode = getSetting('serial-assignment', 'none') as SerialMode;

        // If mode is 'none', don't advance - just clear the selection
        if (mode === 'none') {
            clearSelection();
            return;
        }

        const ordered = getOrderedKeyPositions(keylayout, mode, matrixCols);

        if (ordered.length === 0) {
            clearSelection();
            return;
        }

        // Find current position in ordered list
        const currentIdx = ordered.findIndex(pos => pos.row === row && pos.col === col);

        // Select next (wrap to 0 if at end or not found)
        const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % ordered.length;
        selectKeyboardKey(layer, ordered[nextIdx].row, ordered[nextIdx].col);
    }, [keyboard, getSetting, clearSelection, selectKeyboardKey]);

    const assignKeycodeTo = useCallback(
        (target: BindingTarget, keycode: number | string, options?: { skipAdvance?: boolean }) => {
            if (!target || !keyboard) return;
            const updatedKeyboard = structuredClone(keyboard) as typeof keyboard & Record<string, any>;
            console.log("assignKeycodeTo called with", keycode, "for target", target);
            // Convert keycode string to number using keyService
            const keycodeValue = typeof keycode === "string" ? keyService.parse(keycode) : keycode;
            console.log("assignKeycode to keyboard", target, keycode, "->", keycodeValue);

            switch (target.type) {
                case "keyboard": {
                    const { layer, row, col, keyboardSubsection } = target;
                    if (layer === undefined || row === undefined || col === undefined) break;

                    const matrixPos = row * MATRIX_COLS + col;
                    if (!updatedKeyboard.keymap) updatedKeyboard.keymap = [];
                    if (!updatedKeyboard.keymap[layer]) updatedKeyboard.keymap[layer] = [];

                    // Store previous value for potential rollback
                    const previousValue = updatedKeyboard.keymap[layer][matrixPos];

                    let finalKeycodeValue = keycodeValue;

                    // If subsection is "inner", compose new keycode preserving the hold/mask portion
                    // Exception: KC_NO (0) and KC_TRNS (1) clear the entire key
                    if (keyboardSubsection === "inner" && previousValue !== undefined && keycodeValue > 1) {
                        const prevKeycode = typeof previousValue === "number" ? previousValue : keyService.parse(previousValue);
                        const prevKeyStr = keyService.stringify(prevKeycode);

                        // Check if it's a layerhold (LT#) or modtap (_T) key
                        const isLayerhold = /^LT\d+\(/.test(prevKeyStr);
                        const isModtap = /_T\(/.test(prevKeyStr);

                        if (isLayerhold || isModtap) {
                            // Extract the mask (hold portion) and compose with new inner key
                            const mask = prevKeycode & 0xFF00;
                            const newInner = keycodeValue & 0x00FF;
                            finalKeycodeValue = mask | newInner;
                            console.log(`Inner key composition: ${prevKeyStr} → mask 0x${mask.toString(16)} | inner 0x${newInner.toString(16)} = 0x${finalKeycodeValue.toString(16)}`);
                        }
                    }

                    updatedKeyboard.keymap[layer][matrixPos] = finalKeycodeValue;

                    // Queue the change with callback
                    const changeDesc = `key_${layer}_${row}_${col}`;
                    registerUndo?.(`key on layer ${layer}`, async () => {
                        const current = getKeyboardSnapshot?.() ?? keyboard;
                        if (!current?.keymap) return;
                        const restored = structuredClone(current);
                        restored.keymap![layer][matrixPos] = previousValue;
                        setKeyboard(restored);
                        await queue(changeDesc, () => updateKey(layer, row, col, previousValue), {
                            type: "key", writeKey: `key:${layer}:${row}:${col}`, layer, row, col, keycode: previousValue,
                        });
                    });
                    queue(
                        changeDesc,
                        async () => {
                            console.log(`Committing key change: Layer ${layer}, Key [${row},${col}] → ${finalKeycodeValue}`);
                            await updateKey(layer, row, col, finalKeycodeValue);
                        },
                        {
                            type: "key",
                            writeKey: `key:${layer}:${row}:${col}`,
                            layer,
                            row,
                            col,
                            keycode: finalKeycodeValue,
                            previousValue,
                        }
                    );

                    break;
                }

                case "combo": {
                    const { comboId, comboSlot } = target;
                    if (comboId === undefined || comboSlot === undefined) break;

                    // CRITICAL: Ensure combos array exists and is properly copied
                    if (!(updatedKeyboard as any).combos) {
                        (updatedKeyboard as any).combos = [];
                    }

                    // Create a defensive copy of the entire combos array to preserve all combos
                    const originalCombos = (keyboard as any)?.combos || [];
                    const combos = Array.isArray(originalCombos) ? originalCombos.map((entry: any) => structuredClone(entry)) : [];
                    (updatedKeyboard as any).combos = combos;

                    // Get the ORIGINAL combo from the source keyboard to preserve existing values
                    const originalCombo = originalCombos[comboId];
                    const combo = combos[comboId];
                    if (!combo) break;

                    const keycodeName = typeof keycode === "string" ? keycode : `KC_${keycode}`;

                    let previousValue: string;

                    if (comboSlot === 4) {
                        // Output - but we must also preserve the input keys!
                        // CRITICAL: Preserve the keys array from the original combo
                        const originalKeys = Array.isArray(originalCombo?.keys) ? originalCombo.keys : [];
                        combo.keys = [...originalKeys];
                        while (combo.keys.length < 4) combo.keys.push("KC_NO");

                        previousValue = combo.output;
                        combo.output = keycodeName;

                        console.log("combo update debug (output): preserved keys", combo.keys);
                    } else {
                        // Input keys - preserve all existing values from the ORIGINAL keyboard state
                        // CRITICAL: Check if keys is actually an array, not the prototype's keys() function
                        const originalKeys = Array.isArray(originalCombo?.keys) ? originalCombo.keys : [];

                        console.log("combo update debug: originalKeys", originalKeys, "comboId", comboId, "slot", comboSlot);

                        // Build a fresh 4-element array from the original state
                        const newKeys: string[] = [];
                        for (let i = 0; i < 4; i++) {
                            const val = originalKeys[i];
                            newKeys.push(typeof val === "string" && val ? val : "KC_NO");
                        }

                        // Now update just the target slot
                        previousValue = newKeys[comboSlot];
                        newKeys[comboSlot] = keycodeName;
                        combo.keys = newKeys;

                        console.log("combo update debug: newKeys after", combo.keys);
                    }

                    // Capture comboId for closure
                    const cmbId = comboId;

                    // Queue the change with callback
                    const changeDesc = `combo_${comboId}_${comboSlot}`;
                    queue(
                        changeDesc,
                        async () => {
                            console.log(`Committing combo change: Combo ${cmbId}, Slot ${comboSlot} → ${keycodeName}`);
                            await keyboardService.updateCombo(updatedKeyboard, cmbId);
                            await keyboardService.saveSvil();
                        },
                        {
                            type: "combo",
                            writeKey: `combo:${comboId}`,
                            comboId,
                            comboSlot,
                            keycode: keycodeValue,
                            previousValue,
                        }
                    );

                    break;
                }

                case "tapdance": {
                    const { tapdanceId, tapdanceSlot } = target;
                    if (tapdanceId === undefined || tapdanceSlot === undefined) break;

                    // A tap dance must never contain another tap dance. Nesting causes an
                    // infinite-recursion render crash (getKeyContents <-> describeTapdance),
                    // so refuse the assignment outright.
                    if (isTapdanceKeycode(keycode)) {
                        console.warn(
                            `Blocked: cannot place a tap dance inside tap dance ${tapdanceId} (${tapdanceSlot}). Tap dances cannot contain other tap dances.`
                        );
                        break;
                    }

                    // tapdance is actually an array with objects having tap/hold/doubletap/taphold properties
                    const tapdances = (updatedKeyboard as any).tapdances;
                    if (!tapdances) break;
                    if (!tapdances[tapdanceId]) {
                        tapdances[tapdanceId] = {
                            tap: "KC_NO",
                            hold: "KC_NO",
                            doubletap: "KC_NO",
                            taphold: "KC_NO",
                            tapping_term: DEFAULT_TAPDANCE_TERM_MS,
                            idx: tapdanceId,
                        };
                    }

                    // Store previous value
                    const previousValue = tapdances[tapdanceId][tapdanceSlot];

                    const keycodeName = typeof keycode === "string" ? keycode : `KC_${keycode}`;
                    tapdances[tapdanceId][tapdanceSlot] = keycodeName;

                    // Capture tapdanceId for closure
                    const tdId = tapdanceId;

                    // Queue the change with callback
                    const changeDesc = `tapdance_${tapdanceId}_${tapdanceSlot}`;
                    queue(
                        changeDesc,
                        async () => {
                            console.log(`Committing tapdance change: Tapdance ${tdId}, ${tapdanceSlot} → ${keycodeName}`);
                            await keyboardService.updateTapdance(updatedKeyboard, tdId);
                            await keyboardService.saveSvil();
                        },
                        {
                            type: "tapdance",
                            writeKey: `tapdance:${tapdanceId}`,
                            tapdanceId,
                            tapdanceSlot,
                            keycode: keycodeValue,
                            previousValue,
                        }
                    );

                    break;
                }

                case "macro": {
                    const { macroId, macroIndex } = target;
                    if (macroId === undefined || macroIndex === undefined) break;

                    const macros = updatedKeyboard.macros;
                    if (!macros || !macros[macroId]) break;

                    const action = macros[macroId].actions[macroIndex];
                    if (!action || !["tap", "down", "up"].includes(action[0])) break;

                    const keycodeName = typeof keycode === "string" ? keycode : `KC_${keycode}`;
                    macros[macroId].actions[macroIndex][1] = keycodeName;

                    // Queue the change with callback
                    const mId = macroId;
                    queue(
                        `macro_${mId}`,
                        async () => {
                            console.log(`Committing macro change: Macro ${macroId}, Index ${macroIndex} → ${keycodeName}`);
                            await keyboardService.updateMacros(updatedKeyboard);
                            await keyboardService.saveSvil();
                        },
                        {
                            writeKey: "macros", type: "macro" as any,
                            macroId,
                            macroIndex,
                            keycode: keycodeValue,
                        } as any
                    );

                    break;
                }

                case "override": {
                    const { overrideId, overrideSlot } = target;
                    if (overrideId === undefined || overrideSlot === undefined) break;

                    const overrides = updatedKeyboard.key_overrides;
                    if (!overrides || !overrides[overrideId]) break;

                    const previousValue = overrides[overrideId][overrideSlot];
                    prepareOverrideForEdit(overrides[overrideId], updatedKeyboard.layers);
                    const keycodeName = typeof keycode === "string" ? keycode : `KC_${keycode}`;
                    overrides[overrideId][overrideSlot] = keycodeName;

                    // Capture overrideId for closure
                    const koId = overrideId;

                    // Queue the change with callback
                    const changeDesc = `override_${overrideId}_${overrideSlot}`;
                    queue(
                        changeDesc,
                        async () => {
                            console.log(`Committing override change: Override ${koId}, ${overrideSlot} → ${keycodeName}`);
                            await keyboardService.updateKeyoverride(updatedKeyboard, koId);
                            await keyboardService.saveSvil();
                        },
                        {
                            type: "override",
                            writeKey: `override:${koId}`,
                            overrideId,
                            overrideSlot,
                            keycode: keycodeValue,
                            previousValue,
                        } as any
                    );

                    break;
                }

                case "altrepeat": {
                    const { altRepeatId, altRepeatSlot } = target;
                    if (altRepeatId === undefined || altRepeatSlot === undefined) break;

                    const altRepeatKeys = updatedKeyboard.alt_repeat_keys;
                    if (!altRepeatKeys || !altRepeatKeys[altRepeatId]) break;

                    const previousValue = altRepeatKeys[altRepeatId][altRepeatSlot];
                    const keycodeName = typeof keycode === "string" ? keycode : `KC_${keycode}`;
                    altRepeatKeys[altRepeatId][altRepeatSlot] = keycodeName;

                    // Capture values for closure
                    const arkId = altRepeatId;

                    // Queue the change with callback
                    const changeDesc = `altrepeat_${altRepeatId}_${altRepeatSlot}`;
                    queue(
                        changeDesc,
                        async () => {
                            console.log(`Committing alt-repeat change: AltRepeat ${arkId}, ${altRepeatSlot} → ${keycodeName}`);
                            await keyboardService.updateAltRepeatKey(updatedKeyboard, arkId);
                            await keyboardService.saveSvil(); // Persist to EEPROM
                        },
                        {
                            type: "altrepeat" as any,
                            writeKey: `altrepeat:${arkId}`,
                            altRepeatId,
                            altRepeatSlot,
                            keycode: keycodeValue,
                            previousValue,
                        } as any
                    );

                    break;
                }

                case "leaders": {
                    const { leaderId, leaderSlot, leaderSeqIndex } = target;
                    if (leaderId === undefined || leaderSlot === undefined) break;

                    const leaders = updatedKeyboard.leaders;
                    if (!leaders || !leaders[leaderId]) break;

                    const keycodeName = typeof keycode === "string" ? keycode : keyService.stringify(keycode);

                    if (leaderSlot === "sequence" && leaderSeqIndex !== undefined) {
                        // Ensure sequence array exists and has 5 slots
                        if (!leaders[leaderId].sequence) {
                            leaders[leaderId].sequence = ["KC_NO", "KC_NO", "KC_NO", "KC_NO", "KC_NO"];
                        }
                        while (leaders[leaderId].sequence.length < 5) {
                            leaders[leaderId].sequence.push("KC_NO");
                        }
                        leaders[leaderId].sequence[leaderSeqIndex] = keycodeName;
                    } else if (leaderSlot === "output") {
                        leaders[leaderId].output = keycodeName;
                    }

                    // Capture values for closure
                    const ldrId = leaderId;

                    // Queue the change with callback
                    const changeDesc = `leader_${leaderId}_${leaderSlot}${leaderSeqIndex !== undefined ? `_${leaderSeqIndex}` : ""}`;
                    queue(
                        changeDesc,
                        async () => {
                            console.log(`Committing leader change: Leader ${ldrId}, ${leaderSlot} → ${keycodeName}`);
                            await keyboardService.updateLeader(updatedKeyboard, ldrId);
                            await keyboardService.saveSvil();
                        },
                        {
                            type: "leaders" as any,
                            writeKey: `leader:${ldrId}`,
                            leaderId,
                            leaderSlot,
                            leaderSeqIndex,
                            keycode: keycodeValue,
                        } as any
                    );

                    break;
                }
            }
            setKeyboard(updatedKeyboard);

            // Auto-advance to next slot after assignment (unless skipAdvance is set)
            if (!options?.skipAdvance && target === selectedTargetRef.current) {
                if (target.type === 'keyboard') {
                    selectNextKey();
                } else if (target.type === 'combo' && target.comboSlot !== undefined && target.comboSlot < 4) {
                    // Combo: advance through input slots 0→1→2→3→4 (output)
                    selectComboKey(target.comboId!, target.comboSlot + 1);
                } else if (target.type === 'tapdance' && target.tapdanceSlot) {
                    // Tap dance: advance tap→hold→doubletap→taphold
                    const tdOrder: Array<"tap" | "hold" | "doubletap" | "taphold"> = ["tap", "hold", "taphold", "doubletap"];
                    const currentIdx = tdOrder.indexOf(target.tapdanceSlot);
                    if (currentIdx >= 0 && currentIdx < tdOrder.length - 1) {
                        selectTapdanceKey(target.tapdanceId!, tdOrder[currentIdx + 1]);
                    } else {
                        clearSelection();
                    }
                } else if (target.type === 'override' && target.overrideSlot === 'trigger') {
                    // Override: advance trigger→replacement
                    selectOverrideKey(target.overrideId!, 'replacement');
                } else if (target.type === 'altrepeat' && target.altRepeatSlot === 'keycode') {
                    // Alt-repeat: advance keycode→alt_keycode
                    selectAltRepeatKey(target.altRepeatId!, 'alt_keycode');
                } else if (target.type === 'leaders' && target.leaderSlot === 'sequence' && target.leaderSeqIndex !== undefined) {
                    // Leader: advance within sequence, then to output
                    if (target.leaderSeqIndex < 4) {
                        selectLeaderKey(target.leaderId!, 'sequence', target.leaderSeqIndex + 1);
                    } else {
                        selectLeaderKey(target.leaderId!, 'output');
                    }
                } else {
                    clearSelection();
                }
            }
        },
        [keyboard, setKeyboard, clearSelection, selectNextKey, selectComboKey, selectTapdanceKey, selectOverrideKey, selectAltRepeatKey, selectLeaderKey, queue, updateKey, registerUndo, getKeyboardSnapshot]
    );

    const swapKeys = useCallback(
        (target1: BindingTarget, target2: BindingTarget) => {
            if (!keyboard) return;

            // Only support keyboard swaps for now, but structure allows extension
            if (target1.type !== "keyboard" || target2.type !== "keyboard") return;

            const { layer: layer1, row: row1, col: col1 } = target1;
            const { layer: layer2, row: row2, col: col2 } = target2;

            if (
                layer1 === undefined || row1 === undefined || col1 === undefined ||
                layer2 === undefined || row2 === undefined || col2 === undefined
            ) return;

            // Clone state ONCE
            const updatedKeyboard = structuredClone(keyboard) as typeof keyboard & Record<string, any>;
            if (!updatedKeyboard.keymap) updatedKeyboard.keymap = [];

            // Ensure layers exist
            if (!updatedKeyboard.keymap[layer1]) updatedKeyboard.keymap[layer1] = [];
            if (!updatedKeyboard.keymap[layer2]) updatedKeyboard.keymap[layer2] = [];

            const matrixPos1 = row1 * MATRIX_COLS + col1;
            const matrixPos2 = row2 * MATRIX_COLS + col2;

            // Get values from CLONED state (or original, same thing at start)
            const val1 = updatedKeyboard.keymap[layer1][matrixPos1] || 0;
            const val2 = updatedKeyboard.keymap[layer2][matrixPos2] || 0;

            console.log(`Swapping keys: [${layer1},${row1},${col1}](${val1}) <-> [${layer2},${row2},${col2}](${val2})`);

            // Swap values
            updatedKeyboard.keymap[layer1][matrixPos1] = val2;
            updatedKeyboard.keymap[layer2][matrixPos2] = val1;

            // Queue changes
            // Change 1: Target 1 gets Val 2
            queue(
                `key_${layer1}_${row1}_${col1}`,
                async () => {
                    console.log(`Committing swap change 1: Layer ${layer1}, Key [${row1},${col1}] → ${val2}`);
                    await updateKey(layer1, row1, col1, val2);
                },
                {
                    type: "key",
                    writeKey: `key:${layer1}:${row1}:${col1}`,
                    layer: layer1,
                    row: row1,
                    col: col1,
                    keycode: val2,
                    previousValue: val1,
                }
            );

            // Change 2: Target 2 gets Val 1
            queue(
                `key_${layer2}_${row2}_${col2}`,
                async () => {
                    console.log(`Committing swap change 2: Layer ${layer2}, Key [${row2},${col2}] → ${val1}`);
                    await updateKey(layer2, row2, col2, val1);
                },
                {
                    type: "key",
                    writeKey: `key:${layer2}:${row2}:${col2}`,
                    layer: layer2,
                    row: row2,
                    col: col2,
                    keycode: val1,
                    previousValue: val2,
                }
            );

            setKeyboard(updatedKeyboard);
            clearSelection();
        },
        [keyboard, setKeyboard, queue, clearSelection, updateKey]
    );

    const assignKeycode = useCallback(
        (keycode: number | string) => {
            if (selectedTargetRef.current) {
                assignKeycodeTo(selectedTargetRef.current, keycode);
            }
        },
        [assignKeycodeTo]
    );

    useEffect(() => {
        const isModifierCode = (code: string) =>
            code === "ShiftLeft" || code === "ShiftRight" ||
            code === "ControlLeft" || code === "ControlRight" ||
            code === "AltLeft" || code === "AltRight" ||
            code === "MetaLeft" || code === "MetaRight";

        const handleModifierDown = (event: KeyboardEvent) => {
            if (!isModifierCode(event.code)) return;
            modifierStateRef.current.add(event.code);
        };

        const handleModifierUp = (event: KeyboardEvent) => {
            if (!isModifierCode(event.code)) return;
            modifierStateRef.current.delete(event.code);
        };

        window.addEventListener("keydown", handleModifierDown);
        window.addEventListener("keyup", handleModifierUp);
        return () => {
            window.removeEventListener("keydown", handleModifierDown);
            window.removeEventListener("keyup", handleModifierUp);
        };
    }, []);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const typingBindsKey = getSetting("typing-binds-key");

            if (!typingBindsKey || !selectedTargetRef.current || event.defaultPrevented || event.repeat) return;
            if (isEditorInput(event.target)) return;

            const qmkKeycode = KEYBOARD_EVENT_MAP[event.code];

            const isModifierOnly =
                event.code === "ShiftLeft" || event.code === "ShiftRight" ||
                event.code === "ControlLeft" || event.code === "ControlRight" ||
                event.code === "AltLeft" || event.code === "AltRight" ||
                event.code === "MetaLeft" || event.code === "MetaRight";

            if (isModifierOnly) return;

            if (qmkKeycode) {
                event.preventDefault();
                event.stopPropagation();
                const modifiers = {
                    ctrl: event.ctrlKey,
                    shift: event.shiftKey,
                    alt: event.altKey,
                    gui: event.metaKey,
                };
                const comboKey = [
                    modifiers.ctrl ? "C" : "",
                    modifiers.shift ? "S" : "",
                    modifiers.alt ? "A" : "",
                    modifiers.gui ? "G" : "",
                ].join("");

                const modWrapperMap: Record<string, string> = {
                    C: "LCTL",
                    S: "LSFT",
                    A: "LALT",
                    G: "LGUI",
                    CS: "C_S",
                    CA: "LCA",
                    CG: "LCG",
                    SA: "LSA",
                    SG: "LSG",
                    AG: "LAG",
                    CSA: "MEH",
                    CSG: "LSCG",
                    CAG: "LCAG",
                    SAG: "LSAG",
                    CSAG: "HYPR",
                };

                const rightWrapperMap: Record<string, string> = {
                    C: "RCTL",
                    S: "RSFT",
                    A: "RALT",
                    G: "RGUI",
                    CS: "RSC",
                    CA: "RCA",
                    CG: "RCG",
                    SA: "RSA",
                    SG: "RSG",
                    AG: "RAG",
                    CSA: "RSCA",
                    CSG: "RSCG",
                    CAG: "RCAG",
                    SAG: "RSAG",
                    CSAG: "RSCAG",
                };

                const mods = modifierStateRef.current;
                const anyLeft = mods.has("ControlLeft") || mods.has("ShiftLeft") || mods.has("AltLeft") || mods.has("MetaLeft");
                const anyRight = mods.has("ControlRight") || mods.has("ShiftRight") || mods.has("AltRight") || mods.has("MetaRight");
                const useRight = anyRight && !anyLeft;

                const wrapper = (useRight ? rightWrapperMap[comboKey] : undefined) || modWrapperMap[comboKey];
                assignKeycode(wrapper ? `${wrapper}(${qmkKeycode})` : qmkKeycode);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [assignKeycode, getSetting]);

    const value: KeyBindingContextType = {
        selectedTarget,
        selectKeyboardKey,
        selectKeyboardKeyWithSubsection,
        selectComboKey,
        selectTapdanceKey,
        selectMacroKey,
        selectOverrideKey,
        selectAltRepeatKey,
        selectLeaderKey,
        assignKeycode,
        assignKeycodeTo,
        swapKeys,
        clearSelection,
        isBinding,
        hoveredKey,
        setHoveredKey,
    };


    return <KeyBindingContext.Provider value={value}>{children}</KeyBindingContext.Provider>;
};

export const useKeyBinding = (): KeyBindingContextType => {
    const context = useContext(KeyBindingContext);
    if (!context) {
        throw new Error("useKeyBinding must be used within a KeyBindingProvider");
    }
    return context;
};
