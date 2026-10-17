import { useEffect, useRef } from "react";

import { useKeyboard } from "@/contexts/KeyboardContext";
import { usePanels } from "@/contexts/PanelsContext";
import { pointingDemo } from "@/features/pointing-demo";

/**
 * ?panel=settings opens Settings once a layout is loaded (with ?demo, the
 * QWERTY Example), so a review link lands on the Settings page;
 * ?panel=fragments opens Clusters, where the fragment and ball choices now
 * live. Once per page load.
 */
export default function PointingDeepLink() {
    const { keyboard } = useKeyboard();
    const { setActivePanel, openDetails, setPanelToGoBack, setItemToEdit } = usePanels();
    const done = useRef(false);
    useEffect(() => {
        const panel = pointingDemo()?.panel;
        if (!keyboard || !panel || done.current) return;
        done.current = true;
        setActivePanel(panel === "fragments" ? "clusters" : "settings");
        setPanelToGoBack(null);
        setItemToEdit(null);
        openDetails();
    }, [keyboard, setActivePanel, openDetails, setPanelToGoBack, setItemToEdit]);
    return null;
}
