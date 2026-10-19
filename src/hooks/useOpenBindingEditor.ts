import { useCallback } from "react";
import { usePanels } from "@/contexts/PanelsContext";

/**
 * Opens the binding editor for one entry, as a click on its row in the panel's list does:
 * the panel opens on that entry, and the editor's back button returns to the list. Used by the
 * ?edit deep link and by a click on a combo's folded corner on the layout.
 */
export function useOpenBindingEditor() {
    const { setActivePanel, setPanelToGoBack, setBindingTypeToEdit, setItemToEdit, setAlternativeHeader, setInitialEditorSlot } = usePanels();
    return useCallback((panel: string, index: number) => {
        setActivePanel(panel);
        setPanelToGoBack(panel);
        setBindingTypeToEdit(panel);
        setInitialEditorSlot(null);
        setItemToEdit(index);
        setAlternativeHeader(true);
    }, [setActivePanel, setPanelToGoBack, setBindingTypeToEdit, setItemToEdit, setAlternativeHeader, setInitialEditorSlot]);
}
