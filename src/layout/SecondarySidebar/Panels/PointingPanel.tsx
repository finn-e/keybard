import DynamicMenuPanel from "./DynamicMenuPanel";
import MouseKeysSection from "./MouseKeysSection";
import { useLayoutSettings } from "@/contexts/LayoutSettingsContext";
import { useKeyboard } from "@/contexts/KeyboardContext";
import DescriptionBlock from "@/layout/SecondarySidebar/components/DescriptionBlock";

/**
 * Unified Pointing Devices panel
 * - When disconnected: shows placeholder text
 * - When connected: shows the Mouse Keys section (mouse buttons, sniper, boost)
 *   at top, then dynamic VIA3 menu content
 * - As a picker (isPicker): renders the SAME content as the main panel so any
 *   assignable pointing-device key is available. The picker bypasses the
 *   "not connected" gate because the keys work whether the board was connected
 *   live or loaded from a file.
 *
 * All assignable keys render through MouseKeysSection so they share one size
 * (user key-size setting in the sidebar, compact/medium in the bottom bar).
 * Do not add ad-hoc <Key> rows here; add them to MouseKeysSection instead.
 */
interface Props {
    isPicker?: boolean;
}

const PointingPanel = ({ isPicker }: Props) => {
    const { keyboard, isConnected, connect } = useKeyboard();
    const { layoutMode } = useLayoutSettings();
    const isHorizontal = layoutMode === "bottombar";

    // Find the pointing device menu from keyboard definition
    // Support both "Pointing Device" (singular) and "Pointing Devices" (plural)
    const pointingMenuIndex = keyboard?.menus?.findIndex(
        (menu) => menu.label?.toLowerCase().includes('pointing')
    ) ?? -1;

    // Not connected (skipped in picker mode — the keys don't need a live connection)
    if (!isConnected && !isPicker) {
        return (
            <section className="h-full flex flex-col pt-2">
                <DescriptionBlock>
                    <button
                        onClick={() => connect()}
                        className="underline underline-offset-2 hover:text-foreground transition-all text-inherit"
                    >
                        Connect
                    </button>
                    {" keyboard to view pointing devices settings."}
                </DescriptionBlock>
            </section>
        );
    }

    // Horizontal layout for bottom panel
    if (isHorizontal) {
        return (
            <div className="flex flex-row gap-3 items-start flex-wrap content-start">
                <MouseKeysSection compact variant="medium" />
                {pointingMenuIndex !== -1 && (
                    <DynamicMenuPanel menuIndex={pointingMenuIndex} horizontal embedded section="pointing" />
                )}
            </div>
        );
    }

    // Vertical layout for sidebar
    return (
        <section className="flex flex-col">
            <div>
                <DescriptionBlock>
                    Emulate a mouse using the Mouse Button keys, adjust the Track Ball speed with the Sniper and Boost keys, and adjust the settings for your pointing devices.
                </DescriptionBlock>
                {/* Mouse Keys section at top: mouse buttons, sniper, boost */}
                <div className="pb-4">
                    <MouseKeysSection />
                </div>

                {/* Dynamic menu content below */}
                {pointingMenuIndex !== -1 ? (
                    <DynamicMenuPanel menuIndex={pointingMenuIndex} embedded section="pointing" />
                ) : (
                    <p className="text-muted-foreground text-center">
                        This keyboard does not have additional pointing device settings
                    </p>
                )}
            </div>
        </section>
    );
};

export default PointingPanel;
