import React from "react";
import DescriptionBlock from "@/layout/SecondarySidebar/components/DescriptionBlock";
import { QmkSettingsSections } from "./QMKSettingsPanel";

/** QMK settings groups shown in Typing behavior, in order. */
export const TYPING_BEHAVIOR_SECTIONS = ["Tap-Hold", "Auto Shift", "One Shot Keys", "Magic", "Grave Escape"];

/**
 * How keys behave when typed: tap-hold timing, Auto Shift, one-shot keys and
 * the QMK swaps. Combo, leader and mouse key timing live in their own panels.
 */
const TypingBehaviorPanel: React.FC = () => (
    <section className="flex flex-col">
        <DescriptionBlock>
            How keys respond when you tap, hold and shift them. Changes follow your update mode.
        </DescriptionBlock>
        <QmkSettingsSections
            sections={TYPING_BEHAVIOR_SECTIONS}
            openByDefault={["Tap-Hold"]}
            emptyMessage={
                <p className="text-sm text-muted-foreground">
                    Connect a keyboard to change how its keys behave. Some firmware doesn't report these settings.
                </p>
            }
        />
    </section>
);

export default TypingBehaviorPanel;
