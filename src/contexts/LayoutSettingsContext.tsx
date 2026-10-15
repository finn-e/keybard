import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode, useMemo } from "react";
import { MAX_FINGER_CLUSTER_SQUEEZE_U } from "@/constants/keyboard-visuals";
import { useOptionalSettings } from "@/contexts/SettingsContext";
import {
    DEFAULT_KEY_SIZE, DEFAULT_PANEL_POSITION, isKeySizePreference, isPanelPositionPreference,
    KEY_SIZE_SETTING, PANEL_POSITION_SETTING,
} from "@/lib/appearance-settings";

export type KeyVariant = "default" | "medium" | "small";
export type LayoutMode = "sidebar" | "bottombar";

// Measured dimensions from EditorLayout
interface MeasuredDimensions {
    containerWidth: number;
    containerHeight: number;
    keyboardWidths: { default: number; medium: number; small: number };
    keyboardHeights: { default: number; medium: number; small: number };
    // Raw widths without squeeze reduction - used for squeeze calculation
    rawKeyboardWidths?: { default: number; medium: number; small: number };
}

interface LayoutSettingsContextType {
    internationalLayout: string;
    setInternationalLayout: (layout: string) => void;
    keyVariant: KeyVariant;
    setKeyVariant: (variant: KeyVariant) => void;
    layoutMode: LayoutMode;
    setLayoutMode: (mode: LayoutMode) => void;
    isAutoLayoutMode: boolean;
    setIsAutoLayoutMode: (auto: boolean) => void;
    isAutoKeySize: boolean;
    setIsAutoKeySize: (auto: boolean) => void;
    // Allow EditorLayout to provide actual measured dimensions for more accurate auto-sizing
    setMeasuredDimensions: (dimensions: MeasuredDimensions) => void;
    // Dynamic finger cluster squeeze: amount to shift each side toward center (in key units)
    fingerClusterSqueeze: number;
    // 3D isometric view mode
    is3DMode: boolean;
    setIs3DMode: (mode: boolean) => void;
    isThumb3DOffsetActive: boolean;
    setIsThumb3DOffsetActive: (active: boolean) => void;
    backdropOpacity: number;
    setBackdropOpacity: (opacity: number) => void;
}

const LayoutSettingsContext = createContext<LayoutSettingsContextType | undefined>(undefined);

export const LayoutSettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [internationalLayout, setInternationalLayout] = useState<string>("us");
    const [keyVariant, setKeyVariantState] = useState<KeyVariant>("default");
    const [layoutMode, setLayoutModeState] = useState<LayoutMode>("sidebar");
    const [isAutoLayoutMode, setIsAutoLayoutModeState] = useState<boolean>(true);
    const [manualLayoutMode, setManualLayoutMode] = useState<LayoutMode>("sidebar");
    const [isAutoKeySize, setIsAutoKeySizeState] = useState<boolean>(true);
    const [manualKeyVariant, setManualKeyVariant] = useState<KeyVariant>("default");
    const [measuredDimensions, setMeasuredDimensionsState] = useState<MeasuredDimensions | null>(null);
    const [is3DMode, setIs3DMode] = useState<boolean>(false);
    const [isThumb3DOffsetActive, setIsThumb3DOffsetActive] = useState<boolean>(false);
    const [backdropOpacity, setBackdropOpacity] = useState<number>(0.25);

    // Key size and panel position are stored preferences (Settings > Appearance).
    // Outside a SettingsProvider (isolated renders) they are kept in memory only.
    const settings = useOptionalSettings();
    const updateSetting = settings?.updateSetting;
    const storedKeySize = settings?.isLoaded ? settings.getSetting(KEY_SIZE_SETTING, DEFAULT_KEY_SIZE) : null;
    const storedPanelPosition = settings?.isLoaded ? settings.getSetting(PANEL_POSITION_SETTING, DEFAULT_PANEL_POSITION) : null;

    useEffect(() => {
        if (!isKeySizePreference(storedKeySize)) return;
        if (storedKeySize === "auto") {
            setIsAutoKeySizeState(true);
        } else {
            setManualKeyVariant(storedKeySize);
            setIsAutoKeySizeState(false);
        }
    }, [storedKeySize]);

    useEffect(() => {
        if (!isPanelPositionPreference(storedPanelPosition)) return;
        if (storedPanelPosition === "auto") {
            setIsAutoLayoutModeState(true);
        } else {
            setManualLayoutMode(storedPanelPosition);
            setIsAutoLayoutModeState(false);
        }
    }, [storedPanelPosition]);

    // Use refs to track current values without triggering re-renders during calculation
    const measuredDimensionsRef = useRef<MeasuredDimensions | null>(null);

    const setMeasuredDimensions = useCallback((dimensions: MeasuredDimensions) => {
        measuredDimensionsRef.current = dimensions;
        setMeasuredDimensionsState(dimensions);
    }, []);

    // Calculate finger cluster squeeze: how much to shift each side toward center
    // This allows medium keys to fit in narrower containers by reducing the gap between halves
    const fingerClusterSqueeze = useMemo(() => {
        if (!measuredDimensions) return 0;

        const { containerWidth, keyboardWidths, rawKeyboardWidths } = measuredDimensions;

        // Use raw widths for overflow calculation (squeeze-aware widths are for auto-sizing)
        const widthsForCalculation = rawKeyboardWidths ?? keyboardWidths;

        // Get current keyboard width based on variant (using raw/uncompressed width)
        const currentWidth = keyVariant === 'small'
            ? widthsForCalculation.small
            : keyVariant === 'medium'
                ? widthsForCalculation.medium
                : widthsForCalculation.default;

        // Calculate overflow
        const overflow = currentWidth - containerWidth;
        if (overflow <= 0) return 0;

        // Convert overflow to key units and divide by 2 (squeeze both sides)
        const unitSize = keyVariant === 'small' ? 30 : keyVariant === 'medium' ? 45 : 60;
        const squeezePerSide = overflow / unitSize / 2;

        // Cap at max squeeze (50% of the ~2.3u gap between halves)
        return Math.min(squeezePerSide, MAX_FINGER_CLUSTER_SQUEEZE_U);
    }, [measuredDimensions, keyVariant]);

    // Handle auto-switching based on available space
    const updateAutoLayout = useCallback(() => {
        if (!isAutoLayoutMode && !isAutoKeySize) return;

        const measured = measuredDimensionsRef.current;

        // If we have measured dimensions, use the actual container dimensions directly
        if (measured && isAutoKeySize) {
            // Direct comparison: does the keyboard fit at each size (both width AND height)?
            const containerWidth = measured.containerWidth;
            const containerHeight = measured.containerHeight;
            const widths = measured.keyboardWidths;
            const heights = measured.keyboardHeights;

            // Check if size fits both width and height
            const fitsAt = (size: KeyVariant) =>
                containerWidth >= widths[size] && containerHeight >= heights[size];

            let bestSize: KeyVariant = "small";
            if (fitsAt("default")) {
                bestSize = "default";
            } else if (fitsAt("medium")) {
                bestSize = "medium";
            }
            setKeyVariantState(bestSize);
        }

        // Auto placement follows the viewport, not whether opening a panel makes
        // the board fit. A constrained board pans without moving the user's tools.
        if (isAutoLayoutMode) {
            setLayoutModeState(window.innerWidth >= 900 ? "sidebar" : "bottombar");
        }

    }, [isAutoLayoutMode, isAutoKeySize]);

    // Listen for window resize
    useEffect(() => {
        const handleResize = () => {
            updateAutoLayout();
        };

        // Set initial value
        updateAutoLayout();

        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [updateAutoLayout]);

    // Recalculate readable key size when the canvas changes. Placement still
    // depends only on viewport width, so opening a panel cannot move the tools.
    useEffect(() => {
        updateAutoLayout();
    }, [measuredDimensions, updateAutoLayout]);

    // When auto mode is disabled, use the manual setting
    useEffect(() => {
        if (!isAutoLayoutMode) {
            setLayoutModeState(manualLayoutMode);
        }
    }, [isAutoLayoutMode, manualLayoutMode]);

    // When auto key size is disabled, use the manual setting
    useEffect(() => {
        if (!isAutoKeySize) {
            setKeyVariantState(manualKeyVariant);
        }
    }, [isAutoKeySize, manualKeyVariant]);

    // Wrapper to handle manual mode changes
    const setLayoutMode = useCallback((mode: LayoutMode) => {
        setManualLayoutMode(mode);
        setIsAutoLayoutModeState(false); // Disable auto when user manually selects
        setLayoutModeState(mode);
        updateSetting?.(PANEL_POSITION_SETTING, mode);
    }, [updateSetting]);

    const setIsAutoLayoutMode = useCallback((auto: boolean) => {
        setIsAutoLayoutModeState(auto);
        updateSetting?.(PANEL_POSITION_SETTING, auto ? "auto" : manualLayoutMode);
    }, [updateSetting, manualLayoutMode]);

    // Wrapper to handle manual key variant changes
    const setKeyVariant = useCallback((variant: KeyVariant) => {
        setManualKeyVariant(variant);
        setIsAutoKeySizeState(false); // Disable auto when user manually selects
        setKeyVariantState(variant);
        updateSetting?.(KEY_SIZE_SETTING, variant);
    }, [updateSetting]);

    const setIsAutoKeySize = useCallback((auto: boolean) => {
        setIsAutoKeySizeState(auto);
        updateSetting?.(KEY_SIZE_SETTING, auto ? "auto" : manualKeyVariant);
    }, [updateSetting, manualKeyVariant]);

    return (
        <LayoutSettingsContext.Provider value={{
            internationalLayout,
            setInternationalLayout,
            keyVariant,
            setKeyVariant,
            layoutMode,
            setLayoutMode,
            isAutoLayoutMode,
            setIsAutoLayoutMode,
            isAutoKeySize,
            setIsAutoKeySize,
            setMeasuredDimensions,
            fingerClusterSqueeze,
            is3DMode,
            setIs3DMode,
            isThumb3DOffsetActive,
            setIsThumb3DOffsetActive,
            backdropOpacity,
            setBackdropOpacity,
        }}>
            {children}
        </LayoutSettingsContext.Provider>
    );
};

export const useLayoutSettings = () => {
    const context = useContext(LayoutSettingsContext);
    if (!context) {
        throw new Error("useLayoutSettings must be used within a LayoutSettingsProvider");
    }
    return context;
};
