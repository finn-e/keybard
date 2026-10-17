import { useMemo } from "react";

import { useSettings } from "@/contexts/SettingsContext";
import { COMBO_EDITOR_PLACEMENT_SETTING, resolveComboEditorPlacement } from "@/lib/comboEditorPlacement";

/** The one place the combo editor placement is decided (setting, with a URL review override). */
export function useComboEditorPlacement() {
    const { getSetting } = useSettings();
    const setting = getSetting(COMBO_EDITOR_PLACEMENT_SETTING);
    const search = typeof window === "undefined" ? "" : window.location.search;
    return useMemo(() => resolveComboEditorPlacement(search, setting), [search, setting]);
}
