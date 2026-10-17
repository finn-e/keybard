import { useEffect } from "react";

import { useSettings } from "@/contexts/SettingsContext";
import { applyTheme, normalizeThemePref, resolveTheme, THEME_SETTING_NAME, watchSystemTheme } from "@/lib/theme";
import { themeFromSearch } from "@/lib/deepLinks";

/**
 * Keeps the `dark` class on <html> in step with the Appearance setting.
 * Does nothing until settings have loaded, so it never overrides the no-flash
 * head script with the pre-load default. While the preference is "system" it
 * follows prefers-color-scheme live. A ?theme=light|dark review link forces
 * that theme for this load and leaves the setting as it was.
 */
export default function ThemeSync() {
    const { getSetting, isLoaded } = useSettings();
    const pref = normalizeThemePref(getSetting(THEME_SETTING_NAME));

    useEffect(() => {
        if (!isLoaded) return;
        const forced = themeFromSearch(window.location.search);
        if (forced) { applyTheme(forced); return; }
        applyTheme(resolveTheme(pref));
        if (pref !== "system") return;
        return watchSystemTheme((prefersDark) => applyTheme(prefersDark ? "dark" : "light"));
    }, [pref, isLoaded]);

    return null;
}
