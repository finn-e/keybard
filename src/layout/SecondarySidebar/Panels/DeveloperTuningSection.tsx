import React from "react";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { selectPointingMenu } from "@/utils/pointing-menu";
import type { CustomUIMenuItem } from "@/types/keyboard.types";
import DynamicMenuPanel from "./DynamicMenuPanel";

/** The menu that carries the firmware's developer tuning values, or -1. */
export function developerTuningMenuIndex(menus: CustomUIMenuItem[] | undefined): number {
    const index = menus?.findIndex((menu) => menu.label?.toLowerCase().includes("pointing")) ?? -1;
    if (index < 0) return -1;
    const items = (menus?.[index]?.content ?? []) as CustomUIMenuItem[];
    return selectPointingMenu(items, "developer").length > 0 ? index : -1;
}

/**
 * Scan and idle tuning: the `developer` section of the keyboard definition's
 * menu (scan period, idle and deep-idle timing, clocks, idle RGB dimming,
 * pointer rest). It is developer-only and has no customer home in the editor.
 * Kept in its own component so it can move or be renamed without touching
 * the panel that hosts it (today, Scan Lab).
 */
const DeveloperTuningSection: React.FC<{ title?: string }> = ({ title = "Tuning" }) => {
    const { keyboard } = useKeyboard();
    const menuIndex = developerTuningMenuIndex(keyboard?.menus);
    if (menuIndex < 0) return null;
    return (
        <section aria-labelledby="developer-tuning-heading" className="flex flex-col gap-2">
            <h3 id="developer-tuning-heading" className="font-semibold text-lg text-kb-ink">{title}</h3>
            <p className="text-xs text-muted-foreground">
                Scan timing and power saving for the whole board. Changes follow your update mode.
            </p>
            <DynamicMenuPanel menuIndex={menuIndex} section="developer" embedded />
        </section>
    );
};

export default DeveloperTuningSection;
