import React from "react";

interface EditorControlsProps {
    children?: React.ReactNode;
}

export const EditorControls: React.FC<EditorControlsProps> = ({
    children
}) => {
    // Key size and panel position have one home: Settings > Appearance.
    // The key info toggle went with the bottom-left key info panel.
    return (
        <div className="flex flex-wrap justify-end items-center gap-2 max-w-full">
            {children}
        </div>
    );
};
