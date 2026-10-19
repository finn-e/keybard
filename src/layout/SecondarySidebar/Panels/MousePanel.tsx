import React, { useMemo } from "react";

import SidebarItemRow from "@/layout/SecondarySidebar/components/SidebarItemRow";
import { Key } from "@/components/Key";
import { useKeyBinding } from "@/contexts/KeyBindingContext";
import { useLayer } from "@/contexts/LayerContext";
import { useLayoutSettings } from "@/contexts/LayoutSettingsContext";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { hoverBackgroundClasses, hoverBorderClasses, hoverHeaderClasses } from "@/utils/colors";
import { getKeyContents } from "@/utils/keys";
import { customKeycodeShortName } from "@/constants/custom-keycode-labels";
import { keyService } from "@/services/key.service";
import { KeyContent } from "@/types/keyboard.types";
import DescriptionBlock from "@/layout/SecondarySidebar/components/DescriptionBlock";
import MouseMovementSection from "./MouseMovementSection";

/**
 * Mouse key definition with keycode and display label
 */
interface MouseKeyDefinition {
    keycode: string;
    label: string;
}

/**
 * Standard QMK mouse keycodes (always available regardless of firmware).
 * Custom svalboard SV_* keycodes are appended dynamically from
 * keyboard.custom_keycodes (see mouseKeys in component).
 */
const STATIC_MOUSE_KEYS: readonly MouseKeyDefinition[] = [
    // Mouse Buttons
    { keycode: "KC_BTN1", label: "Mouse 1" },
    { keycode: "KC_BTN2", label: "Mouse 2" },
    { keycode: "KC_BTN3", label: "Mouse 3" },
    { keycode: "KC_BTN4", label: "Mouse 4" },
    { keycode: "KC_BTN5", label: "Mouse 5" },

    // Mouse Movement
    { keycode: "KC_MS_U", label: "Mouse Up" },
    { keycode: "KC_MS_D", label: "Mouse Down" },
    { keycode: "KC_MS_L", label: "Mouse Left" },
    { keycode: "KC_MS_R", label: "Mouse Right" },

    // Mouse Wheel
    { keycode: "KC_WH_U", label: "Mouse Wheel Up" },
    { keycode: "KC_WH_D", label: "Mouse Wheel Down" },
    { keycode: "KC_WH_L", label: "Mouse Wheel Left" },
    { keycode: "KC_WH_R", label: "Mouse Wheel Right" },

    // Mouse Acceleration
    { keycode: "KC_ACL0", label: "Mouse Accelerate 0" },
    { keycode: "KC_ACL1", label: "Mouse Accelerate 1" },
    { keycode: "KC_ACL2", label: "Mouse Accelerate 2" },
] as const;

/**
 * MousePanel displays all available mouse-related keycodes in a scrollable list.
 * Each key can be clicked to assign it to the currently selected keyboard position.
 * 
 * The panel uses the shared SidebarItemRow component for consistent styling
 * with other panels like Tap Dances and Combos.
 */
interface Props {
    isPicker?: boolean;
}

const MousePanel: React.FC<Props> = ({ isPicker }) => {
    const { keyboard } = useKeyboard();
    const { assignKeycode } = useKeyBinding();
    const { selectedLayer } = useLayer();
    const { layoutMode } = useLayoutSettings();

    const isHorizontal = layoutMode === "bottombar";

    // Standard QMK mouse keys + every SV_* custom keycode advertised by the
    // firmware (svalboard convention: any name starting with "SV_"). New
    // firmware keycodes appear automatically — no UI changes required.
    const mouseKeys = useMemo<readonly MouseKeyDefinition[]>(() => {
        const customSv = (keyboard?.custom_keycodes ?? [])
            .filter((ck) => ck.name.startsWith("SV_"))
            .map((ck) => ({
                keycode: ck.name,
                label: customKeycodeShortName(ck).replace(/\n/g, " "),
            }));
        return [...STATIC_MOUSE_KEYS, ...customSv];
    }, [keyboard?.custom_keycodes]);

    // Memoize hover colors based on selected layer
    const hoverStyles = useMemo(() => {
        if (!keyboard) return null;

        const layerColorName = keyboard.cosmetic?.layer_colors?.[selectedLayer] || "primary";

        return {
            layerColorName,
            hoverBorderColor: hoverBorderClasses[layerColorName] || hoverBorderClasses.primary,
            hoverBackgroundColor: hoverBackgroundClasses[layerColorName] || hoverBackgroundClasses.primary,
            hoverHeaderClass: hoverHeaderClasses[layerColorName] || hoverHeaderClasses.primary,
        };
    }, [keyboard, selectedLayer]);

    if (!keyboard || !hoverStyles) {
        return null;
    }

    // Group mouse keys by category
    const mouseButtons = mouseKeys.filter(k => k.keycode.startsWith("KC_BTN"));
    const mouseMovement = mouseKeys.filter(k => k.keycode.startsWith("KC_MS_"));
    const mouseWheel = mouseKeys.filter(k => k.keycode.startsWith("KC_WH_"));
    const mouseAccel = mouseKeys.filter(k => k.keycode.startsWith("KC_ACL"));
    const svalKeys = mouseKeys.filter(k => k.keycode.startsWith("SV_"));

    // Horizontal layout for bottom panel
    if (isHorizontal) {
        const renderKeyGroup = (keys: readonly MouseKeyDefinition[], label: string) => (
            <div className="flex flex-col gap-1">
                <span className="text-[9px] font-bold text-slate-500 dark:text-neutral-400 uppercase">{label}</span>
                <div className="flex flex-row gap-1 flex-wrap">
                    {keys.map((mouseKey) => {
                        const keyContents = getKeyContents(keyboard, mouseKey.keycode) as KeyContent;
                        const displayLabel = keyService.define(mouseKey.keycode)?.str || mouseKey.label;
                        return (
                            <Key
                                key={mouseKey.keycode}
                                x={0} y={0} w={1} h={1} row={-1} col={-1}
                                keycode={mouseKey.keycode}
                                label={displayLabel}
                                keyContents={keyContents}
                                layerColor="sidebar"
                                headerClassName={`bg-kb-sidebar-dark ${hoverStyles.hoverHeaderClass}`}
                                isRelative
                                variant="medium"
                                hoverBorderColor={hoverStyles.hoverBorderColor}
                                hoverBackgroundColor={hoverStyles.hoverBackgroundColor}
                                hoverLayerColor={hoverStyles.layerColorName}
                                onClick={() => assignKeycode(mouseKey.keycode)}
                                disableTooltip={true}
                            />
                        );
                    })}
                </div>
            </div>
        );

        return (
            <div className="flex flex-row gap-3 h-full items-start flex-wrap content-start">
                {renderKeyGroup(mouseButtons, "Buttons")}
                {renderKeyGroup(mouseMovement, "Move")}
                {renderKeyGroup(mouseWheel, "Wheel")}
                {renderKeyGroup(mouseAccel, "Accel")}
                {svalKeys.length > 0 && renderKeyGroup(svalKeys, "Svalboard")}
                {!isPicker && <MouseMovementSection />}
            </div>
        );
    }

    return (
        <section className="flex flex-col space-y-3 pt-0">
            {isPicker && (
                <div className="pb-2">
                    <span className="font-semibold text-xl text-kb-ink">Mouse Keys</span>
                </div>
            )}
            <div className="flex flex-col">
                <DescriptionBlock>
                    Emulate a mouse using your keyboard. You can move the pointer at different speeds, press 5 buttons and scroll in 8 directions.
                </DescriptionBlock>
                <div className="pr-[26px]">
                    {mouseKeys.map((mouseKey, index) => {
                        const keyContents = getKeyContents(keyboard, mouseKey.keycode) as KeyContent;
                        const displayLabel = keyService.define(mouseKey.keycode)?.str || mouseKey.label;

                        return (
                            <SidebarItemRow
                                key={mouseKey.keycode}
                                index={index}
                                keyboard={keyboard}
                                keycode={mouseKey.keycode}
                                label={displayLabel}
                                keyContents={keyContents}
                                onAssignKeycode={assignKeycode}
                                hoverBorderColor={hoverStyles.hoverBorderColor}
                            hoverBackgroundColor={hoverStyles.hoverBackgroundColor}
                            hoverLayerColor={hoverStyles.layerColorName}
                            hoverHeaderClass={hoverStyles.hoverHeaderClass}
                            showIndex={false}
                            dottedLineAfterLabel
                            className="py-2"
                        />
                    );
                })}
                </div>
                {!isPicker && <MouseMovementSection />}
            </div>
        </section>
    );
};

MousePanel.displayName = "MousePanel";

export default MousePanel;
