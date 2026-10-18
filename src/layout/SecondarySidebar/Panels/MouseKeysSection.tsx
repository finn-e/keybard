import { Key } from "@/components/Key";
import { useKeyBinding } from "@/contexts/KeyBindingContext";
import { useLayer } from "@/contexts/LayerContext";
import { useLayoutSettings } from "@/contexts/LayoutSettingsContext";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { hoverBackgroundClasses, hoverBorderClasses, hoverHeaderClasses } from "@/utils/colors";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Modifier, modifierOptions, applyModifiers } from "@/utils/modifierUtils";
import { getKeyContents } from "@/utils/keys";
import { KeyContent } from "@/types/keyboard.types";
import ModifierSideToggle from "@/components/ModifierSideToggle";
import { useModifierSide } from "@/hooks/useModifierSide";

interface Props {
    compact?: boolean;
    variant?: "small" | "medium" | "default";
}

const MouseKeysSection = ({ compact, variant: variantOverride }: Props) => {
    const { assignKeycode } = useKeyBinding();
    const { keyboard } = useKeyboard();
    const { selectedLayer } = useLayer();
    const { keyVariant } = useLayoutSettings();
    const [activeModifiers, setActiveModifiers] = useState<Modifier[]>([]);
    const [modifierSide, setModifierSide] = useModifierSide();

    const layerColorName = keyboard?.cosmetic?.layer_colors?.[selectedLayer] || "primary";
    const hoverBorderColor = hoverBorderClasses[layerColorName] || hoverBorderClasses["primary"];
    const hoverBackgroundColor = hoverBackgroundClasses[layerColorName] || hoverBackgroundClasses["primary"];

    const hoverHeaderClass = hoverHeaderClasses[layerColorName] || hoverHeaderClasses["primary"];
    const effectiveVariant = variantOverride || (compact ? "small" : keyVariant);
    const keySizeClass = effectiveVariant === 'small' ? 'h-[30px] w-[30px]' : effectiveVariant === 'medium' ? 'h-[45px] w-[45px]' : 'h-[60px] w-[60px]';

    const handleModifierToggle = (mod: Modifier) => {
        if (activeModifiers.includes(mod)) {
            setActiveModifiers(activeModifiers.filter((m) => m !== mod));
        } else {
            setActiveModifiers([...activeModifiers, mod]);
        }
    };

    const handleClearModifiers = () => {
        setActiveModifiers([]);
    };

    // Row 1: Mouse 1-5 buttons
    const mouseButtons = [
        { keycode: "KC_BTN1", label: "Mouse 1" },
        { keycode: "KC_BTN2", label: "Mouse 2" },
        { keycode: "KC_BTN3", label: "Mouse 3" },
        { keycode: "KC_BTN4", label: "Mouse 4" },
        { keycode: "KC_BTN5", label: "Mouse 5" },
    ];

    // Row 2: 6 sniper keys. Toggle labels are "NxTG" (4 chars after the family
    // word is stripped) so they stay at the variant's native text size instead of
    // falling into Key.tsx's long-label shrink/wrap rule, which cropped "TOGGLE"
    // at the small and medium key sizes. Matches the firmware shortName "Sniper\n2xTG".
    const sniperKeys = [
        { keycode: "SV_SNIPER_2", label: "Sniper 2x" },
        { keycode: "SV_SNIPER_3", label: "Sniper 3x" },
        { keycode: "SV_SNIPER_5", label: "Sniper 5x" },
        { keycode: "SV_SNIPER_2_TG", label: "Sniper 2xTG" },
        { keycode: "SV_SNIPER_3_TG", label: "Sniper 3xTG" },
        { keycode: "SV_SNIPER_5_TG", label: "Sniper 5xTG" },
    ];

    // Row 3: 6 boost keys (multiplier mirror of sniper)
    const boostKeys = [
        { keycode: "SV_BOOST_2", label: "Boost 2x" },
        { keycode: "SV_BOOST_3", label: "Boost 3x" },
        { keycode: "SV_BOOST_5", label: "Boost 5x" },
        { keycode: "SV_BOOST_2_TG", label: "Boost 2xTG" },
        { keycode: "SV_BOOST_3_TG", label: "Boost 3xTG" },
        { keycode: "SV_BOOST_5_TG", label: "Boost 5xTG" },
    ];

    // Row 4: hold to scroll with the pointer (firmware SV_SCROLL_HOLD), and
    // hold to scroll at a speed set by how far the pointer moves
    // (SV_VELOCITY_SCROLL). The labels match the layout's
    // (CUSTOM_KEYCODE_LABELS). Velocity Scroll is offered unless the connected
    // firmware has no such key (it came after Drag Scroll).
    const firmwareKeycodes = keyboard?.custom_keycodes;
    const hasVelocityScroll = !firmwareKeycodes || firmwareKeycodes.some((ck) => ck.name === "SV_VELOCITY_SCROLL");
    const scrollKeys = [
        { keycode: "SV_SCROLL_HOLD", label: "Drag Scroll" },
        ...(hasVelocityScroll ? [{ keycode: "SV_VELOCITY_SCROLL", label: "Velocity Scroll" }] : []),
    ];

    // Every key row in this section MUST go through renderKey so it picks up the
    // same effectiveVariant / keySizeClass. Do not render <Key> directly in the
    // panels that embed this section (see CLAUDE.md: key sizing consistency).
    const renderKey = (k: { keycode: string; label: string }, withModifiers: boolean = false) => {
        const finalKeycode = withModifiers ? applyModifiers(k.keycode, activeModifiers, false, modifierSide) : k.keycode;
        const keyContents = keyboard ? getKeyContents(keyboard, finalKeycode) : undefined;

        // Force label usage "Mouse 1" so getHeaderIcons sees "Mouse" and adds the icon
        // Key.tsx getCenterContent will strip "Mouse" and show "1"
        // Key.tsx shouldOverrideForInternational won't fire for "Mouse 1" (length > 1) so Shift badge stays
        return (
            <Key
                key={k.keycode}
                x={0}
                y={0}
                w={1}
                h={1}
                row={0}
                col={0}
                keycode={finalKeycode}
                label={k.label}
                forceLabel={true}
                keyContents={keyContents as KeyContent | undefined}
                layerColor="sidebar"
                headerClassName={`bg-kb-sidebar-dark ${hoverHeaderClass}`}
                isRelative
                variant={effectiveVariant}
                className={keySizeClass}
                hoverBorderColor={hoverBorderColor}
                hoverBackgroundColor={hoverBackgroundColor}
                hoverLayerColor={layerColorName}
                onClick={() => assignKeycode(finalKeycode)}
                disableTooltip={true}
            />
        );
    };

    return (
        <div className={compact ? "flex min-w-0 flex-wrap items-start gap-4" : "flex min-w-0 flex-col gap-4"}>
            <div className="flex flex-col gap-1">
                <span className={compact ? "text-[9px] font-bold text-slate-500 dark:text-neutral-400 uppercase" : "font-semibold text-lg text-kb-ink"}>
                    Mouse Buttons
                </span>
                {/* Row 1: Mouse buttons */}
                <div className="flex flex-wrap gap-1">
                    {mouseButtons.map((k) => renderKey(k, true))}
                </div>
            </div>

            {/* Modifiers section */}
            <div className="flex flex-col gap-2">
                <div className={compact ? "flex items-center gap-2" : "flex items-center gap-3"}>
                    <span className={compact ? "text-[9px] font-bold text-slate-500 dark:text-neutral-400 uppercase" : "font-semibold text-lg text-kb-ink"}>
                        Modifiers
                    </span>
                    <ModifierSideToggle side={modifierSide} onChange={setModifierSide} compact={compact} />
                </div>
                {compact ? (
                    // Compact modifier choices wrap with the available panel width.
                    <div className="flex flex-wrap gap-1">
                        <Button
                            type="button"
                            variant={activeModifiers.length === 0 ? "default" : "secondary"}
                            size="sm"
                            className={cn(
                                "rounded-md px-2 py-0.5 h-6 transition-all text-[10px] font-medium border-none",
                                activeModifiers.length === 0 ? "bg-kb-active text-kb-active-fg shadow-sm" : "bg-kb-gray-medium text-slate-700 dark:text-neutral-200 hover:bg-kb-surface dark:hover:bg-neutral-700"
                            )}
                            onClick={handleClearModifiers}
                            title="Clear modifiers"
                        >
                            None
                        </Button>
                        {modifierOptions.map((modifier) => {
                            const isActive = activeModifiers.includes(modifier);
                            return (
                                <Button
                                    key={modifier}
                                    type="button"
                                    variant={isActive ? "default" : "secondary"}
                                    size="sm"
                                    className={cn(
                                        "rounded-md px-2 py-0.5 h-6 transition-all text-[11px] font-medium border-none",
                                        isActive ? "bg-kb-active text-kb-active-fg shadow-sm" : "bg-kb-gray-medium text-slate-700 dark:text-neutral-200 hover:bg-kb-surface dark:hover:bg-neutral-700"
                                    )}
                                    onClick={() => handleModifierToggle(modifier)}
                                    title={modifier}
                                >
                                    {modifier.toUpperCase()}
                                </Button>
                            );
                        })}
                    </div>
                ) : (
                    // Standard Vertical Layout - Matches BasicKeyboards.tsx exactly
                    <div className="flex flex-wrap items-center gap-1">
                        <Button
                            type="button"
                            variant={activeModifiers.length === 0 ? "default" : "secondary"}
                            size="sm"
                            className={cn(
                                "rounded-md h-8 transition-all text-sm font-bold border-none w-[84px]",
                                activeModifiers.length === 0 ? "bg-kb-active text-kb-active-fg shadow-sm" : "bg-kb-gray-medium text-slate-700 dark:text-neutral-200 hover:bg-kb-surface dark:hover:bg-neutral-700"
                            )}
                            onClick={handleClearModifiers}
                            title="Clear modifiers"
                        >
                            None
                        </Button>
                        {modifierOptions.map((modifier) => {
                            const isActive = activeModifiers.includes(modifier);
                            return (
                                <Button
                                    key={modifier}
                                    type="button"
                                    variant={isActive ? "default" : "secondary"}
                                    size="sm"
                                    className={cn(
                                        "rounded-md h-8 transition-all text-sm font-bold border-none w-[84px]",
                                        isActive ? "bg-kb-active text-kb-active-fg shadow-sm" : "bg-kb-gray-medium text-slate-700 dark:text-neutral-200 hover:bg-kb-surface dark:hover:bg-neutral-700"
                                    )}
                                    onClick={() => handleModifierToggle(modifier)}
                                >
                                    {modifier.toUpperCase()}
                                </Button>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="flex flex-col gap-1">
                <span className={compact ? "text-[9px] font-bold text-slate-500 dark:text-neutral-400 uppercase" : "font-semibold text-lg text-kb-ink"}>
                    Sniper Keys
                </span>
                {/* Row 2: Sniper keys */}
                <div className="flex flex-wrap gap-1">
                    {sniperKeys.map((k) => renderKey(k, false))}
                </div>
            </div>

            <div className="flex flex-col gap-1">
                <span className={compact ? "text-[9px] font-bold text-slate-500 dark:text-neutral-400 uppercase" : "font-semibold text-lg text-kb-ink"}>
                    Boost
                </span>
                {/* Row 3: Boost keys */}
                <div className="flex flex-wrap gap-1">
                    {boostKeys.map((k) => renderKey(k, false))}
                </div>
            </div>

            <div className="flex flex-col gap-1">
                <span className={compact ? "text-[9px] font-bold text-slate-500 dark:text-neutral-400 uppercase" : "font-semibold text-lg text-kb-ink"}>
                    Scroll
                </span>
                {/* Row 4: Drag Scroll, Velocity Scroll */}
                <div className="flex flex-wrap gap-1">
                    {scrollKeys.map((k) => renderKey(k, false))}
                </div>
            </div>

        </div>
    );
};

export default MouseKeysSection;
