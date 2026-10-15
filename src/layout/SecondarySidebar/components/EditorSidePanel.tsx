import LayersDefaultIcon from "@/components/icons/LayersDefault";
import MacrosIcon from "@/components/icons/MacrosIcon";
import MouseIcon from "@/components/icons/Mouse";
import PointingDeviceBall01Icon from "@/components/icons/PointingDeviceBall01Icon";
import TapdanceIcon from "@/components/icons/Tapdance";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { cn } from "@/lib/utils";
import { PICKER_CATEGORIES, type PickerMode } from "@/lib/bindingSpotlight";
import { FC } from "react";

import { Keyboard, Piano } from "lucide-react";

export type { PickerMode };

const ICONS: Partial<Record<PickerMode, React.ReactNode>> = {
    keyboard: <Keyboard className="w-4 h-4" />,
    pointing: <PointingDeviceBall01Icon className="w-4 h-4" />,
    special: <Piano className="w-4 h-4" />,
    layers: <LayersDefaultIcon className="w-4 h-4" />,
    mouse: <MouseIcon className="w-4 h-4" />,
    tapdances: <TapdanceIcon className="w-4 h-4" />,
    macros: <MacrosIcon className="w-4 h-4" />,
};

// The same categories, names and order as the rail.
const iconsToShow: { icon: React.ReactNode; panel: PickerMode; title: string }[] =
    PICKER_CATEGORIES.map(c => ({ icon: ICONS[c.id], panel: c.id, title: c.title }));

interface Props {
    className?: string;
    activeTab?: PickerMode;
    onTabChange?: (tab: PickerMode) => void;
    /** The categories the open editor can use (see usablePickerCategories); all by default. */
    categories?: readonly PickerMode[];
    horizontal?: boolean;
}

const EditorSidePanel: FC<Props> = ({ className, activeTab, onTabChange, categories, horizontal = false }) => {
    const visibleIcons = categories ? iconsToShow.filter((i) => categories.includes(i.panel)) : iconsToShow;

    if (horizontal) {
        return (
            <div className={cn("w-full items-center justify-center flex", className)}>
                <div className="flex items-center flex-row justify-center gap-1">
                    {visibleIcons.map((i) => (
                        <Tooltip key={i.panel}>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    aria-label={i.title}
                                    aria-pressed={activeTab === i.panel}
                                    className={cn(
                                        "cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 transition-colors px-3 py-2 rounded-md flex items-center gap-2",
                                        activeTab === i.panel
                                            ? "bg-kb-active text-kb-active-fg"
                                            : "text-gray-500 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-neutral-100 hover:bg-gray-100 dark:hover:bg-neutral-700"
                                    )}
                                    onClick={() => {
                                        if (onTabChange) {
                                            onTabChange(i.panel);
                                        }
                                    }}
                                >
                                    {i.icon}
                                    <span className="text-xs font-medium">{i.title}</span>
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                                {i.title}
                            </TooltipContent>
                        </Tooltip>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className={cn("items-start justify-start flex", className)}>
            <div
                className="bg-kb-surface rounded-r-[18px] text-gray-400 dark:text-neutral-400 flex items-center flex-col justify-start py-3 px-2 gap-1 shadow-[4px_0_16px_rgba(0,0,0,0.1)] border-l-0"
                style={{ clipPath: "inset(-50px -50px -50px 0px)" }}
            >
                {visibleIcons.map((i) => (
                    <Tooltip key={i.panel}>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                aria-label={i.title}
                                aria-pressed={activeTab === i.panel}
                                key={i.panel}
                                className={cn(
                                    "cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 transition-colors px-2 py-3 h-10 w-10 items-center justify-center flex",
                                    activeTab === i.panel ? "text-slate-900 dark:text-neutral-100" : "text-gray-400 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-neutral-100"
                                )}
                                onClick={() => {
                                    if (onTabChange) {
                                        onTabChange(i.panel);
                                    }
                                }}
                            >
                                {i.icon}
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                            {i.title}
                        </TooltipContent>
                    </Tooltip>
                ))}
            </div>
        </div>
    );
};

export default EditorSidePanel;
