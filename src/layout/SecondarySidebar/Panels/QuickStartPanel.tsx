import React from "react";
import DescriptionBlock from "@/layout/SecondarySidebar/components/DescriptionBlock";

const QuickStartPanel: React.FC = () => {
    return (
        <div className="space-y-3 pt-0 pb-8 relative flex flex-col">
            <div className="flex flex-col">
                <DescriptionBlock wrapText={false}>
                    <p className="mb-4 text-sm text-slate-500 dark:text-neutral-400 leading-relaxed">
                        <b>Keybard</b> is a keyboard layout editor that allows you to create and edit keyboard layouts for your <b>Svalboard</b> keyboard.
                    </p>
                    <ol className="list-decimal list-outside ml-0 pl-8 space-y-3 text-sm text-slate-500 dark:text-neutral-400 leading-relaxed marker:font-bold">
                        <li>
                            Start by connecting your <b>Svalboard</b> to see its current layout. Then you have two options:
                            <ol className="list-decimal list-outside ml-0 pl-8 mt-2 space-y-2 marker:font-normal">
                                <li><b>Live updating</b> that instantly updates your <b>Svalboard</b>.</li>
                                <li><b>Manual Changes</b> where you can make changes then press the <b>Update</b> button when you are happy your new layout, or <b>Revert</b> any edits and start again.</li>
                            </ol>
                        </li>
                        <li>Drag and drop new black keys from any of the panels on the left onto your layer's layout.</li>
                        <li>You can also swap keys on your layout by dragging and dropping them onto each other (including between layers).</li>
                        <li><b>[SHORTCUT]</b> Drag a key off your layout into blank space to create a blank key.</li>
                        <li>You can see multiple layers at once by clicking on the <b>Show Multiple Layers</b> button.</li>
                        <li>You can switch between layers by clicking on the layer tabs at the top of the layout. There are a maximum of 16 layers available for use [0-15]. You can just show the layers you are using by clicking on the <b>Hide Transparent Layers</b> button.</li>
                        <li>The <b>3D View</b> button lets you see your layout from a different perspective and the relationships between layers in multiple layers mode.</li>
                        <li>The <b>Hide All Transparent Keys</b> button lets you see the key that will be activated if you click that key while on that layer.</li>
                        <li><b>Hide Thumb Keys</b> to focus on the finger clusters.</li>
                        <li>Click on a layer name to give it new name and color to help you distinguish between layers. </li>
                        <li>Each layer has a contextual menu which allows you to copy, pasted, make blank or transparent, or save to the <b>Layouts</b> panel.</li>
                        <li>You can set an entire layer by dragging and dropping one from the <b>Layouts</b> panel and tempoarilly save your own layers there too.</li>
                        <li>You can <b>Export</b> and <b>Import</b> your layouts using the .svil file format.</li>
                        <li>Use the <b>Matrix Tester</b> to check if your Svalboard keys are all working correctly.</li>
                        <li>Click the <b>Info</b> button in the bottom left corner to see the QMK code for the currently selected key.</li>
                    </ol>
                </DescriptionBlock>
            </div>
        </div>
    );
};

export default QuickStartPanel;
