import React from "react";
import { cn } from "@/lib/utils";
import { InfoIcon } from "@/components/icons/InfoIcon";

interface EditorControlsProps {
    showInfoPanel: boolean;
    setShowInfoPanel: (show: boolean) => void;
    showInfoToggle?: boolean;
    children?: React.ReactNode;
}

export const EditorControls: React.FC<EditorControlsProps> = ({
    showInfoPanel,
    setShowInfoPanel,
    showInfoToggle = true,
    children
}) => {
    // Key size and panel position have one home: Settings > Appearance.
    return (
        <div className="flex flex-wrap justify-end items-center gap-2 max-w-full">
            {showInfoToggle && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setShowInfoPanel(!showInfoPanel);
                    }}
                    className={cn(
                        "p-1 rounded-[4px] transition-all border",
                        showInfoPanel
                            ? "bg-kb-active text-kb-active-fg shadow-sm border-kb-active"
                            : "text-gray-500 dark:text-neutral-400 border-transparent hover:text-gray-900 dark:hover:text-neutral-100 hover:bg-gray-300/50 dark:hover:bg-neutral-600/50"
                    )}
                    aria-label={showInfoPanel ? "Hide Key Info" : "Show Key Info"}
                    aria-expanded={showInfoPanel}
                    title={showInfoPanel ? "Hide Key Info" : "Show Key Info"}
                >
                    <InfoIcon className="h-3.5 w-3.5" />
                </button>
            )}
            {children}
        </div>
    );
};
