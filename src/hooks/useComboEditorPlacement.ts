import { useMemo } from "react";

import { resolveComboEditorPlacement } from "@/lib/comboEditorPlacement";

/**
 * The one place the binding editor placement is decided: the side panel, or a
 * ?comboEditor= review override for one page load. There is no setting; a value
 * saved by older versions is ignored.
 */
export function useComboEditorPlacement() {
    const search = typeof window === "undefined" ? "" : window.location.search;
    return useMemo(() => resolveComboEditorPlacement(search, undefined), [search]);
}
