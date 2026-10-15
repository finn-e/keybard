import { useEffect } from "react";

import { useKeyboard } from "@/contexts/KeyboardContext";
import { usePanels } from "@/contexts/PanelsContext";
import { claimEditStart, EDIT_PANELS, editFromSearch, editTargetExists } from "@/lib/deepLinks";

/**
 * ?edit=combo:N | tapdance:N | macro:N: opens that editor once a layout is
 * loaded, as a click on its row would. Once per page load; an entry the
 * layout does not have is ignored.
 */
export default function DeepLinkEditor() {
    const { keyboard } = useKeyboard();
    const { setActivePanel, setItemToEdit, setBindingTypeToEdit, setAlternativeHeader, setPanelToGoBack } = usePanels();

    useEffect(() => {
        if (!keyboard) return;
        const target = editFromSearch(window.location.search);
        if (!target) return;
        const counts = {
            combos: keyboard.combos?.length ?? keyboard.combo_count ?? 0,
            tapdances: keyboard.tapdances?.length ?? keyboard.tapdance_count ?? 0,
            macros: keyboard.macros?.length ?? keyboard.macro_count ?? 0,
        };
        if (!editTargetExists(target, counts) || !claimEditStart()) return;
        const panel = EDIT_PANELS[target.kind];
        setActivePanel(panel);
        setPanelToGoBack(panel);
        setBindingTypeToEdit(panel);
        setItemToEdit(target.index);
        setAlternativeHeader(true);
    }, [keyboard, setActivePanel, setItemToEdit, setBindingTypeToEdit, setAlternativeHeader, setPanelToGoBack]);

    return null;
}
