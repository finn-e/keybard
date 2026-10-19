import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";

import ChannelBanner from "./components/ChannelBanner";
import DeployBadge from "./components/DeployBadge";
import MainScreen from "./components/MainScreen";
import PrintableKeymapWrapper from "./components/PrintableKeymapWrapper";
import ThemeSync from "./components/ThemeSync";
import ExploreLayoutsPage from "./pages/ExploreLayoutsPage";
import { ProofSheetPage } from "./pages/ProofSheet";

import { BackupProvider } from "./contexts/BackupContext";
import { ChangesProvider } from "./contexts/ChangesContext";
import { DragProvider } from "./contexts/DragContext";
import { KeyBindingProvider } from "./contexts/KeyBindingContext";
import { LayoutLibraryProvider } from "./contexts/LayoutLibraryContext";
import { LayoutSettingsProvider } from "./contexts/LayoutSettingsContext";
import { SettingsProvider } from "./contexts/SettingsContext";
import { KeyboardProvider, useKeyboard } from "./contexts/KeyboardContext";
import { notifyHostLayoutChanged } from "./features/trainer/host";
import { useTapdanceRepair } from "./hooks/useTapdanceRepair";

// Simple page navigation context
type Page = "main" | "explore" | "proof-sheet";

interface NavigationContextType {
    currentPage: Page;
    navigateTo: (page: Page) => void;
    goBack: () => void;
}

const NavigationContext = createContext<NavigationContextType | null>(null);

export const useNavigation = () => {
    const context = useContext(NavigationContext);
    if (!context) {
        throw new Error("useNavigation must be used within NavigationProvider");
    }
    return context;
};

// Wrapper to connect KeyboardContext's markAsSaved to ChangesProvider
const ChangesProviderWithKeyboard = ({ children }: { children: ReactNode }) => {
    const { markAsSaved, getKeyboardSnapshot, isConnected, connectionSessionId, registerTargetChangeGuard, getKeyBlockWriter } = useKeyboard();
    // Once a batch of writes has reached the board, the Keybard Overlay app re-reads it.
    return <ChangesProvider captureSave={() => { const snapshot = getKeyboardSnapshot(); return () => { if (snapshot) markAsSaved(snapshot); notifyHostLayoutChanged(); }; }} canWrite={isConnected} sessionKey={connectionSessionId} registerTargetChangeGuard={registerTargetChangeGuard} keyBlockWriter={getKeyBlockWriter}>{children}</ChangesProvider>;
};

const NavigationProvider = ({ children }: { children: ReactNode }) => {
    const [currentPage, setCurrentPage] = useState<Page>("main");

    const navigateTo = useCallback((page: Page) => {
        setCurrentPage(page);
    }, []);

    const goBack = useCallback(() => {
        setCurrentPage("main");
    }, []);

    return (
        <NavigationContext.Provider value={{ currentPage, navigateTo, goBack }}>
            {children}
        </NavigationContext.Provider>
    );
};

function LoadingOverlay() {
    const { isImporting } = useKeyboard();
    if (!isImporting) return null;
    return createPortal(
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50">
            <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-10 w-10 animate-spin text-white" />
                <span className="text-white text-sm font-medium">Importing...</span>
            </div>
        </div>,
        document.body
    );
}

// Writes usable tap dance terms once per connect.
function TapdanceRepair() {
    useTapdanceRepair();
    return null;
}

function AppContent() {
    const { currentPage, goBack } = useNavigation();

    return (
        <>
            {currentPage === "main" ? (
                <>
                    <MainScreen />
                    <PrintableKeymapWrapper />
                </>
            ) : currentPage === "explore" ? (
                <LayoutSettingsProvider>
                    <DragProvider>
                        <ExploreLayoutsPage onBack={goBack} />
                    </DragProvider>
                </LayoutSettingsProvider>
            ) : currentPage === "proof-sheet" ? (
                <LayoutSettingsProvider>
                    <DragProvider>
                        <ProofSheetPage onBack={goBack} />
                    </DragProvider>
                </LayoutSettingsProvider>
            ) : null}
        </>
    );
}

function App() {
    return (
        <KeyboardProvider>
            <LoadingOverlay />
            <DeployBadge />
            <ChannelBanner />
            <SettingsProvider>
                <ThemeSync />
                <ChangesProviderWithKeyboard>
                    <TapdanceRepair />
                    <BackupProvider>
                        <KeyBindingProvider>
                            <LayoutLibraryProvider>
                                <NavigationProvider>
                                    <AppContent />
                                </NavigationProvider>
                            </LayoutLibraryProvider>
                        </KeyBindingProvider>
                    </BackupProvider>
                </ChangesProviderWithKeyboard>
            </SettingsProvider>
        </KeyboardProvider>
    );
}

export default App;
