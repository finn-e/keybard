import { migrateSettings, SETTINGS_SCHEMA_VERSION, SETTINGS_VERSION_KEY } from "@/services/settings-migration";
import { DEFAULT_KEY_SIZE, DEFAULT_PANEL_POSITION, KEY_SIZE_SETTING, PANEL_POSITION_SETTING } from "@/lib/appearance-settings";
import { SettingDefinition, SettingsCategory, SettingsContextType, SettingsState } from "@/types/settings.types";
import { SettingsIcon, LayoutGrid, FileJson, History } from "lucide-react";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

import { SettingsService } from "@/services/settings.service";
import { DEFAULT_THEME_PREF, THEME_SETTING_NAME } from "@/lib/theme";
import { DEFAULT_SHOW_ALT_REPEAT, SHOW_ALT_REPEAT_SETTING } from "@/lib/altRepeatVisibility";
import { COMBO_COLORBLIND_SETTING, COMBO_INDICATOR_SETTING, DEFAULT_COMBO_INDICATORS_ON } from "@/lib/comboIndicators";

// Settings definitions - single source of truth
export const SETTINGS: SettingDefinition[] = [
    {
        name: THEME_SETTING_NAME,
        label: "Appearance",
        type: "select",
        items: [
            { label: "System", value: "system" },
            { label: "Light", value: "light" },
            { label: "Dark", value: "dark" },
        ],
        defaultValue: DEFAULT_THEME_PREF,
    },
    {
        name: "live-updating",
        label: "Live Updating",
        description: "Automatically apply changes to the keyboard as you make them.",
        defaultValue: true,
        type: "boolean",
    },
    {
        name: "typing-binds-key",
        label: "Typing Binds a Key",
        description: "Select a key, then type to assign it. You can include held modifiers.",
        defaultValue: true,
        type: "boolean",
    },
    {
        name: COMBO_INDICATOR_SETTING,
        label: "Combo Indicators",
        description: "Fold the corner of keys in a combo. The folds grow while you move over the keyboard.",
        type: "boolean",
        defaultValue: DEFAULT_COMBO_INDICATORS_ON,
    },
    {
        name: COMBO_COLORBLIND_SETTING,
        label: "Colorblind-Friendly Combo Colors",
        description: "Combo colors that stay apart with color blindness, each with its own texture.",
        defaultValue: false,
        type: "boolean",
    },
    {
        name: SHOW_ALT_REPEAT_SETTING,
        label: "Show Alt-Repeat",
        description: "Add Alt-Repeat to the rail.",
        defaultValue: DEFAULT_SHOW_ALT_REPEAT,
        type: "boolean",
    },
    {
        name: "serial-assignment",
        label: "Serial Assignment",
        type: "select",
        items: [
            { label: "None", value: "none" },
            { label: "Down columns then rows", value: "col-row" },
            { label: "Across rows then columns", value: "row-col" },
            { label: "Svalboard by key direction", value: "svalboard" },
        ],
        defaultValue: "none",
    },
    {
        name: "international-keyboards",
        label: "International Keyboards",
        type: "select",
        items: [
            { label: "English (US)", value: "us" },
            { label: "English (UK)", value: "uk" },
            { label: "Brazilian", value: "br" },
            { label: "Canadian (CSA)", value: "ca-csa" },
            { label: "Colemak", value: "colemak" },
            { label: "Croatian (QWERTZ)", value: "croatian-qwertz" },
            { label: "Danish", value: "danish" },
            { label: "EuroKey", value: "eurokey" },
            { label: "French (AZERTY)", value: "french-azerty" },
            { label: "French (Mac)", value: "french-mac" },
            { label: "German (QWERTZ)", value: "german-qwertz" },
            { label: "Hebrew (Standard)", value: "hebrew-standard" },
            { label: "Hungarian (QWERTZ)", value: "hungarian-qwertz" },
            { label: "Italian", value: "italian" },
            { label: "Japanese", value: "japanese" },
            { label: "Latin American", value: "latin-american" },
            { label: "Norwegian", value: "norwegian" },
            { label: "Russian", value: "russian" },
            { label: "Slovak", value: "slovak" },
            { label: "Spanish", value: "spanish" },
            { label: "Swedish", value: "swedish" },
            { label: "Swedish (SWERTY)", value: "swedish-swerty" },
            { label: "Swiss (QWERTZ)", value: "swiss-qwertz" },
            { label: "Turkish", value: "turkish" },
        ],
        defaultValue: "us",
    },
    {
        name: "import",
        label: "Import...",
        type: "action",
        action: "import-settings",
    },
    {
        name: "export",
        label: "Export...",
        type: "action",
        action: "export-settings",
    },
    {
        name: "scan-lab",
        label: "Scan Lab...",
        description: "Measure key scanning and test sensor timing.",
        type: "action",
        action: "open-scan-lab",
    },
    {
        name: "key-proof-sheet",
        label: "Key Proof Sheet...",
        description: "Visual inspection of key renderings at all sizes",
        type: "action",
        action: "open-proof-sheet",
    },
    {
        name: KEY_SIZE_SETTING,
        label: "Key size",
        type: "select",
        items: [
            { label: "Auto", value: "auto" },
            { label: "Normal", value: "default" },
            { label: "Medium", value: "medium" },
            { label: "Small", value: "small" },
        ],
        defaultValue: DEFAULT_KEY_SIZE,
    },
    {
        name: PANEL_POSITION_SETTING,
        label: "Panel position",
        type: "select",
        items: [
            { label: "Auto", value: "auto" },
            { label: "Beside the keyboard", value: "sidebar" },
            { label: "Below the keyboard", value: "bottombar" },
        ],
        defaultValue: DEFAULT_PANEL_POSITION,
    },
];

/**
 * The tabbed Settings layout from before Settings became one page. Nothing
 * renders it any more: the page reads settings/layout.ts. It stays only so
 * branches that add names here still merge; add new names to layout.ts.
 * @deprecated
 */
export const SETTINGS_CATEGORIES: SettingsCategory[] = [
    {
        name: "general",
        label: "General",
        icon: SettingsIcon,
        settings: [THEME_SETTING_NAME, "typing-binds-key", COMBO_INDICATOR_SETTING, COMBO_COLORBLIND_SETTING, SHOW_ALT_REPEAT_SETTING, "serial-assignment", "international-keyboards", "qmk-settings", "print"],
    },
    {
        name: "fragments",
        label: "Hardware",
        icon: LayoutGrid,
        settings: [],
    },
    {
        name: "backups",
        label: "Backups",
        icon: History,
        settings: [],
    },
    {
        name: "developer",
        label: "Developer",
        icon: FileJson,
        settings: ["scan-lab", "key-proof-sheet"],
    },
];

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [settings, setSettings] = useState<SettingsState>({});
    const [loaded, setLoaded] = useState(false);
    const settingsService = new SettingsService();

    // Load settings from localStorage on mount
    useEffect(() => {
        const loadedSettings = migrateSettings(settingsService.load());
        setSettings(loadedSettings);
        setLoaded(true);
        refreshHardwareSettings();
    }, []);

    // Save settings to localStorage whenever they change
    useEffect(() => {
        if (!loaded) return;
        settingsService.save(settings);
    }, [settings, loaded]);

    const updateSetting = useCallback((name: string, value: string | number | boolean) => {
        setSettings((prev) => ({
            ...prev,
            [name]: value,
        }));

        // Check if it's a hardware setting
        const definition = SETTINGS.find(s => s.name === name);
        if (definition?.scope === 'hardware') {
            settingsService.setHardwareSetting(name, value);
        }
    }, []);

    const getSetting = useCallback(
        (name: string, defaultValue?: string | number | boolean) => {
            if (settings[name] !== undefined) {
                return settings[name];
            }

            // Try to get default from SETTINGS definition
            const settingDef = SETTINGS.find((s) => s.name === name);
            if (settingDef) {
                return settingDef.defaultValue ?? false;
            }

            return defaultValue ?? false;
        },
        [settings]
    );

    const getSettingDefinition = useCallback((name: string) => {
        return SETTINGS.find((s) => s.name === name);
    }, []);

    const resetSettings = useCallback(() => {
        settingsService.clear();
        setSettings({ [SETTINGS_VERSION_KEY]: SETTINGS_SCHEMA_VERSION });
    }, []);

    const resetSetting = useCallback((name: string) => {
        setSettings((prev) => {
            const newSettings = { ...prev };
            delete newSettings[name];
            return newSettings;
        });
    }, []);

    const refreshHardwareSettings = useCallback(async () => {
        const hardwareSettings = SETTINGS.filter(s => s.scope === 'hardware');
        const newSettings: SettingsState = {};

        for (const setting of hardwareSettings) {
            const val = await settingsService.getHardwareSetting(setting.name);
            if (val !== undefined) {
                newSettings[setting.name] = val;
            }
        }

        if (Object.keys(newSettings).length > 0) {
            setSettings(prev => ({
                ...prev,
                ...newSettings
            }));
        }
    }, []);

    const value: SettingsContextType = {
        settings,
        settingsDefinitions: SETTINGS,
        settingsCategories: SETTINGS_CATEGORIES,
        updateSetting,
        getSetting,
        getSettingDefinition,
        resetSettings,
        resetSetting,
        refreshHardwareSettings,
        isLoaded: loaded,
    };

    return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

/** The settings, or null outside a SettingsProvider (isolated renders and tests). */
export const useOptionalSettings = (): SettingsContextType | null => useContext(SettingsContext) ?? null;

export const useSettings = (): SettingsContextType => {
    const context = useContext(SettingsContext);
    if (!context) {
        throw new Error("useSettings must be used within a SettingsProvider");
    }
    return context;
};
