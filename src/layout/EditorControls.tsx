import React from "react";
import { cn } from "@/lib/utils";
import { PanelBottom, PanelRight } from "lucide-react";
import { useLayoutSettings } from "@/contexts/LayoutSettingsContext";
// import { useKeyboard } from "@/contexts/KeyboardContext";

interface EditorControlsProps {
    children?: React.ReactNode;
}

export const EditorControls: React.FC<EditorControlsProps> = ({
    children
}) => {
    const {
        keyVariant,
        setKeyVariant,
        isAutoKeySize,
        setIsAutoKeySize,
        isAutoLayoutMode,
        setIsAutoLayoutMode,
        layoutMode,
        setLayoutMode
    } = useLayoutSettings();
    // const { resetToOriginal } = useKeyboard();

    return (
        <div className="flex flex-wrap justify-end items-center gap-2 max-w-full">

            <div className="flex flex-row items-center gap-0.5 bg-gray-200/50 dark:bg-neutral-700/50 p-0.5 rounded-md border border-gray-300/50 dark:border-neutral-600/50 w-fit">
                {(['default', 'medium', 'small'] as const).map((variant) => (
                    <button
                        key={variant}
                        onClick={(e) => {
                            e.stopPropagation();
                            setKeyVariant(variant);
                        }}
                        className={cn(
                            "px-2 py-0.5 text-xs uppercase tracking-wide rounded-[4px] transition-all font-semibold border select-none",
                            keyVariant === variant && !isAutoKeySize
                                ? "bg-kb-active text-kb-active-fg shadow-sm border-kb-active"
                                : keyVariant === variant && isAutoKeySize
                                    ? "bg-gray-400 text-white border-gray-400 dark:bg-neutral-600 dark:border-neutral-600"
                                    : "text-gray-500 dark:text-neutral-400 border-transparent hover:text-gray-900 dark:hover:text-neutral-100 hover:bg-gray-300/50 dark:hover:bg-neutral-600/50"
                        )}
                        aria-pressed={keyVariant === variant && !isAutoKeySize}
                        title={`Set key size to ${variant}`}
                    >
                        {variant === 'default' ? 'Normal' : variant}
                    </button>
                ))}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsAutoKeySize(true);
                    }}
                    className={cn(
                        "px-2 py-0.5 text-xs uppercase tracking-wide rounded-[4px] transition-all font-semibold border select-none",
                        isAutoKeySize
                            ? "bg-kb-active text-kb-active-fg shadow-sm border-kb-active"
                            : "text-gray-500 dark:text-neutral-400 border-transparent hover:text-gray-900 dark:hover:text-neutral-100 hover:bg-gray-300/50 dark:hover:bg-neutral-600/50"
                    )}
                    aria-pressed={isAutoKeySize}
                    title="Auto size based on window"
                >
                    Auto
                </button>
            </div>

            <div className="flex flex-row items-center gap-0.5 bg-gray-200/50 dark:bg-neutral-700/50 p-0.5 rounded-md border border-gray-300/50 dark:border-neutral-600/50 w-fit">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsAutoLayoutMode(false);
                        setLayoutMode("sidebar");
                    }}
                    className={cn(
                        "p-1 rounded-[4px] transition-all border",
                        layoutMode === "sidebar" && !isAutoLayoutMode
                            ? "bg-kb-active text-kb-active-fg shadow-sm border-kb-active"
                            : "text-gray-500 dark:text-neutral-400 border-transparent hover:text-gray-900 dark:hover:text-neutral-100 hover:bg-gray-300/50 dark:hover:bg-neutral-600/50"
                    )}
                    aria-label="Sidebar layout"
                    aria-pressed={layoutMode === "sidebar" && !isAutoLayoutMode}
                    title="Sidebar layout"
                >
                    <PanelRight className="h-3.5 w-3.5" />
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsAutoLayoutMode(false);
                        setLayoutMode("bottombar");
                    }}
                    className={cn(
                        "p-1 rounded-[4px] transition-all border",
                        layoutMode === "bottombar" && !isAutoLayoutMode
                            ? "bg-kb-active text-kb-active-fg shadow-sm border-kb-active"
                            : "text-gray-500 dark:text-neutral-400 border-transparent hover:text-gray-900 dark:hover:text-neutral-100 hover:bg-gray-300/50 dark:hover:bg-neutral-600/50"
                    )}
                    aria-label="Bottom bar layout"
                    aria-pressed={layoutMode === "bottombar" && !isAutoLayoutMode}
                    title="Bottom bar layout"
                >
                    <PanelBottom className="h-3.5 w-3.5" />
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsAutoLayoutMode(true);
                    }}
                    className={cn(
                        "px-1.5 py-0.5 text-xs uppercase tracking-wide rounded-[4px] transition-all font-semibold border select-none",
                        isAutoLayoutMode
                            ? "bg-kb-active text-kb-active-fg shadow-sm border-kb-active"
                            : "text-gray-500 dark:text-neutral-400 border-transparent hover:text-gray-900 dark:hover:text-neutral-100 hover:bg-gray-300/50 dark:hover:bg-neutral-600/50"
                    )}
                    aria-pressed={isAutoLayoutMode}
                    title="Auto-switch layout based on window size"
                >
                    Auto
                </button>
            </div>

            {children}
        </div>
    );
};
