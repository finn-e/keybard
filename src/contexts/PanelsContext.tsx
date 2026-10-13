import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { useSidebar } from "@/components/ui/sidebar";

interface PanelsContextType {
    activePanel: string | undefined | null;
    panelToGoBack: string | undefined | null;
    setPanelToGoBack: React.Dispatch<React.SetStateAction<string | null>>;
    setActivePanel: React.Dispatch<React.SetStateAction<string | null>>;
    handleCloseDetails: () => void;
    openDetails: () => void;
    alternativeHeader: boolean;
    setAlternativeHeader: React.Dispatch<React.SetStateAction<boolean>>;
    handleCloseEditor: () => void;
    itemToEdit: number | null;
    setItemToEdit: React.Dispatch<React.SetStateAction<number | null>>;
    bindingTypeToEdit: string | null;
    setBindingTypeToEdit: React.Dispatch<React.SetStateAction<string | null>>;
    initialEditorSlot: any | null;
    setInitialEditorSlot: React.Dispatch<React.SetStateAction<any | null>>;

    name: string;
    state: "expanded" | "collapsed";
    open: boolean;
    setOpen: (value: boolean | ((value: boolean) => boolean)) => void;
    openMobile: boolean;
    setOpenMobile: (value: boolean | ((value: boolean) => boolean)) => void;
    isMobile: boolean;
    toggleSidebar: () => void;
}

const PanelsContext = createContext<PanelsContextType | undefined>(undefined);

export const PanelsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [activePanel, setActivePanel] = useState<string | null>(null);
    const [alternativeHeader, setAlternativeHeader] = useState<boolean>(false);
    const [panelToGoBack, setPanelToGoBack] = useState<string | null>(null);
    const [itemToEdit, setItemToEdit] = useState<number | null>(null);
    const [bindingTypeToEdit, setBindingTypeToEdit] = useState<string | null>(null);
    const [initialEditorSlot, setInitialEditorSlot] = useState<any | null>(null);

    const sidebar = useSidebar("details-panel", { defaultOpen: false });
    const { open: detailsOpen, setOpen } = sidebar;

    // The shared detail shell uses the same open state in either placement.
    const openDetails = useCallback(() => setOpen(true), [setOpen]);
    const closeDetails = useCallback(() => setOpen(false), [setOpen]);

    useEffect(() => {
        if (activePanel && activePanel !== "matrixtester" && activePanel !== "trainer" && !detailsOpen) {
            openDetails();
        }

        if ((!activePanel || activePanel === "trainer") && detailsOpen) {
            closeDetails();
        }
    }, [activePanel, detailsOpen, openDetails, closeDetails]);

    const handleCloseDetails = useCallback(() => {
        closeDetails();
        setActivePanel(null);
    }, [closeDetails]);

    const handleCloseEditor = useCallback(() => {
        setItemToEdit(null);
        setActivePanel(panelToGoBack);
        setAlternativeHeader(false);
        setPanelToGoBack(null);
        setInitialEditorSlot(null);
    }, [panelToGoBack]);

    return (
        <PanelsContext.Provider
            value={{
                activePanel,
                setActivePanel,
                handleCloseDetails,
                openDetails,
                alternativeHeader,
                setAlternativeHeader,
                panelToGoBack,
                setPanelToGoBack,
                handleCloseEditor,
                itemToEdit,
                setItemToEdit,
                bindingTypeToEdit,
                setBindingTypeToEdit,
                initialEditorSlot,
                setInitialEditorSlot,
                ...sidebar,
            }}
        >
            {children}
        </PanelsContext.Provider>
    );
};

export const usePanels = (): PanelsContextType => {
    const context = useContext(PanelsContext);
    if (!context) {
        throw new Error("useKeyboard must be used within a KeyboardProvider");
    }
    return context;
};
