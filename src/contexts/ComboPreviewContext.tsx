// Key inspector and combo preview: hovering or focusing a layout key (or a row in the Combos
// list) shows the key inspector card for it. With combo indicators on, member keys also lift a
// larger fold showing only the previewed combos, and every other fold recedes.
//
// - First hover waits 250 ms, so sweeping the pointer across the layout does not flicker;
//   while a preview is up, moving to another key switches at once. Leaving waits 90 ms.
// - Keyboard focus previews at once.
// - Click (or Enter / Space) pins a preview; doing it again unpins. Clicking anywhere that is
//   not a key, a combo row, the inspector or a control clears the pin.
// - Esc clears hover and pin. The focused element does not preview again until it blurs.
// - An open combo editor counts as the previewed combo, under any hover or pin.
//
// Hover, focus, pin and Esc always run: the inspector shows for every layout key. The
// "combo-indicators" setting is the one owner of the folds and the preview highlighting
// ("off" means no folds and no lit combos), never of the inspector. The "colorblind-combo-colors" setting
// is the one owner of the palette; the provider mirrors it on the root element
// (data-combo-palette), where src/index.css swaps the fold tokens.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "@/contexts/SettingsContext";
import { usePanels } from "@/contexts/PanelsContext";
import { isEditorInput } from "@/utils/editor-input";
import { COMBO_COLORBLIND_SETTING, COMBO_INDICATOR_SETTING, comboIndicatorMode, type ComboIndicatorMode } from "@/lib/comboIndicators";
import type { ComboPalette } from "@/utils/combo-hues";
import type { InspectTarget } from "@/utils/key-inspect";

export { COMBO_INDICATOR_SETTING };
export const HOVER_DELAY_MS = 250;
export const LEAVE_DELAY_MS = 90;

export interface PreviewFocus {
    kind: "key" | "combo";
    /** Identity for pinning: a key's view/layer/position, or the combo number. */
    id: string;
    /** Combos previewed, ascending by combo number. */
    combos: number[];
    /** Key the preview came from (kind "key"): its keycode string, for the readout. */
    keycode?: string;
    /** Layout key (kind "key"): what the inspector describes. */
    key?: InspectTarget;
}

/** How the active preview arrived: screen readers hear focus and pin, never mouse hover. */
export type PreviewVia = "hover" | "focus" | "pin";

export interface ComboPreviewApi {
    /** Combo indicators on: folds and preview highlighting. The inspector runs either way. */
    enabled: boolean;
    /** Fold size mode ("off" when disabled). */
    mode: ComboIndicatorMode;
    palette: ComboPalette;
    /** Hover or pin (what the readout describes). */
    active: PreviewFocus | null;
    activeVia: PreviewVia | null;
    pin: PreviewFocus | null;
    /** Combos lit right now: hover, else pin, else the open combo editor. */
    focusSet: ReadonlySet<number> | null;
    enter: (f: PreviewFocus, immediate?: boolean) => void;
    leave: () => void;
    focusIn: (f: PreviewFocus, el: Element | null) => void;
    blurOut: () => void;
    togglePin: (f: PreviewFocus) => void;
    clearPin: () => void;
    isPinned: (id: string) => boolean;
}

const noop = () => { };
const INERT: ComboPreviewApi = {
    enabled: false, mode: "off", palette: "default", active: null, activeVia: null, pin: null, focusSet: null,
    enter: noop, leave: noop, focusIn: noop, blurOut: noop, togglePin: noop, clearPin: noop,
    isPinned: () => false,
};

const ComboPreviewContext = createContext<ComboPreviewApi>(INERT);

export const useComboPreview = () => useContext(ComboPreviewContext);

/** Elements that keep a pin when clicked (keys and rows mark themselves with this attribute). */
const KEEPS_PIN = "[data-combo-preview], [data-key-inspector], button, a, input, select, textarea, label, [role='dialog']";

export const ComboPreviewProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { getSetting } = useSettings();
    const mode = comboIndicatorMode(getSetting(COMBO_INDICATOR_SETTING));
    const enabled = mode !== "off";
    const palette: ComboPalette = getSetting(COMBO_COLORBLIND_SETTING) === true ? "colorblind" : "default";
    const { activePanel, itemToEdit } = usePanels();

    const [hover, setHoverState] = useState<PreviewFocus | null>(null);
    const [hoverVia, setHoverVia] = useState<PreviewVia>("hover");
    const [pin, setPin] = useState<PreviewFocus | null>(null);
    const hoverRef = useRef<PreviewFocus | null>(null);
    const pinRef = useRef<PreviewFocus | null>(null);
    const hoverTimer = useRef<number>(0);
    const leaveTimer = useRef<number>(0);
    const suppressEl = useRef<Element | null>(null);

    const commitHover = useCallback((f: PreviewFocus | null) => { hoverRef.current = f; setHoverState(f); }, []);
    const commitPin = useCallback((f: PreviewFocus | null) => { pinRef.current = f; setPin(f); }, []);
    const clearTimers = () => { window.clearTimeout(hoverTimer.current); window.clearTimeout(leaveTimer.current); };

    const enter = useCallback((f: PreviewFocus, immediate = false) => {
        clearTimers();
        setHoverVia("hover");
        if (immediate || hoverRef.current) { commitHover(f); return; }
        hoverTimer.current = window.setTimeout(() => commitHover(f), HOVER_DELAY_MS);
    }, [commitHover]);

    const leave = useCallback(() => {
        clearTimers();
        leaveTimer.current = window.setTimeout(() => { if (hoverRef.current) commitHover(null); }, LEAVE_DELAY_MS);
    }, [commitHover]);

    const focusIn = useCallback((f: PreviewFocus, el: Element | null) => {
        if (el && suppressEl.current === el) return;
        enter(f, true);
        setHoverVia("focus");
    }, [enter]);

    const blurOut = useCallback(() => { suppressEl.current = null; leave(); }, [leave]);

    const togglePin = useCallback((f: PreviewFocus) => {
        const same = pinRef.current?.id === f.id;
        commitPin(same ? null : f);
        if (same) { clearTimers(); commitHover(null); }
    }, [commitHover, commitPin]);

    const clearPin = useCallback(() => { if (pinRef.current) commitPin(null); }, [commitPin]);

    // Esc clears the preview. Runs in the capture phase so that, when it clears a preview, it
    // keeps "typing binds a key" from also binding Esc to the selected key (clicking a key both
    // selects and pins it). It never consumes Esc while a dialog is open, in a text field, or
    // when there is nothing to clear, so a second Esc behaves as before.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || isEditorInput(e.target)) return;
            const had = !!pinRef.current || !!hoverRef.current;
            clearTimers();
            suppressEl.current = document.activeElement;
            if (!had) return;
            const consume = !document.querySelector("[role='dialog'], [role='alertdialog']");
            commitPin(null);
            commitHover(null);
            if (consume) e.preventDefault();
        };
        const onClick = (e: MouseEvent) => {
            if (!pinRef.current) return;
            const t = e.target as Element | null;
            if (t?.closest?.(KEEPS_PIN)) return;
            commitPin(null);
        };
        window.addEventListener("keydown", onKey, true);
        document.addEventListener("click", onClick);
        return () => {
            window.removeEventListener("keydown", onKey, true);
            document.removeEventListener("click", onClick);
        };
    }, [commitHover, commitPin]);

    useEffect(() => () => clearTimers(), []);

    // Palette tokens are swapped on the root, so the Combos list glyphs follow too.
    useEffect(() => {
        const root = document.documentElement;
        if (palette === "colorblind") root.dataset.comboPalette = "colorblind";
        else delete root.dataset.comboPalette;
        return () => { delete root.dataset.comboPalette; };
    }, [palette]);

    const editorCombo = activePanel === "combos" && typeof itemToEdit === "number" ? itemToEdit : null;
    const active = hover ?? pin;
    const activeVia: PreviewVia | null = hover ? hoverVia : pin ? "pin" : null;
    const focusSet = useMemo<ReadonlySet<number> | null>(() => {
        if (!enabled) return null;
        if (active) return active.combos.length ? new Set(active.combos) : null;
        return editorCombo != null ? new Set([editorCombo]) : null;
    }, [enabled, active, editorCombo]);

    const isPinned = useCallback((id: string) => pin?.id === id, [pin]);

    const api = useMemo<ComboPreviewApi>(
        () => ({ enabled, mode, palette, active, activeVia, pin, focusSet, enter, leave, focusIn, blurOut, togglePin, clearPin, isPinned }),
        [enabled, mode, palette, active, activeVia, pin, focusSet, enter, leave, focusIn, blurOut, togglePin, clearPin, isPinned]);

    return <ComboPreviewContext.Provider value={api}>{children}</ComboPreviewContext.Provider>;
};
