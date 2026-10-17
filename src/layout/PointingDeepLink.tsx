import { useEffect, useRef } from "react";

import { useKeyboard } from "@/contexts/KeyboardContext";
import { usePanels } from "@/contexts/PanelsContext";
import { pointingDemo } from "@/features/pointing-demo";

/**
 * ?panel=settings (with ?category=general|fragments) opens Settings once a
 * layout is loaded, so a pointing review link lands on the Ball gloss and
 * Sparkle density sliders or the Fragments ball choice. Once per page load.
 */
export default function PointingDeepLink() {
    const { keyboard } = useKeyboard();
    const { setActivePanel, openDetails, setPanelToGoBack, setItemToEdit } = usePanels();
    const done = useRef(false);
    useEffect(() => {
        const panel = pointingDemo()?.panel;
        if (!keyboard || !panel || done.current) return;
        done.current = true;
        setActivePanel("settings");
        setPanelToGoBack(null);
        setItemToEdit(null);
        openDetails();
    }, [keyboard, setActivePanel, openDetails, setPanelToGoBack, setItemToEdit]);
    return null;
}
