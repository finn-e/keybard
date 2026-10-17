import { THEME_SETTING_NAME } from "@/lib/theme";
import { KEY_SIZE_SETTING, PANEL_POSITION_SETTING } from "@/lib/appearance-settings";
import { SHOW_ALT_REPEAT_SETTING } from "@/lib/altRepeatVisibility";
import { COMBO_COLORBLIND_SETTING, COMBO_INDICATOR_SETTING } from "@/lib/comboIndicators";

/**
 * The Settings page, declared. Settings holds two kinds of thing: preferences
 * for the Keybard app, and management of the board and its firmware. Anything
 * that configures the board's layout or devices lives in the editor panel for
 * that feature, never here (docs/design/firmware-settings/settings-structure.md).
 *
 * A row is either a setting from SETTINGS (by name, with an optional label or
 * description for this page) or a block this page renders itself. To add a
 * preference, add its definition to SETTINGS and its name to a section here.
 */
export type SettingsBlock = "firmware" | "board" | "backups" | "about";

export type SettingsRow =
    | { setting: string; label?: string; description?: string }
    | { block: SettingsBlock };

export interface SettingsSection {
    id: string;
    title: string;
    rows: SettingsRow[];
    /** Starts collapsed, and stays expanded once opened in this browser. */
    collapsible?: boolean;
}

export interface SettingsGroup {
    id: string;
    title: string;
    sections: SettingsSection[];
}

export const SETTINGS_PAGE: SettingsGroup[] = [
    {
        id: "this-keyboard",
        title: "This keyboard",
        sections: [
            { id: "firmware", title: "Firmware", rows: [{ block: "firmware" }] },
            { id: "board", title: "Board", rows: [{ block: "board" }] },
            {
                id: "backups",
                title: "Backups and files",
                rows: [
                    { block: "backups" },
                    { setting: "import", label: "Import layout", description: "Open a .svil or .vil file. You review the changes before anything is written." },
                    { setting: "export", label: "Export layout", description: "Save the layout as .svil or .vil, or print it." },
                ],
            },
        ],
    },
    {
        id: "this-browser",
        title: "This browser",
        sections: [
            {
                id: "appearance",
                title: "Appearance",
                rows: [
                    { setting: THEME_SETTING_NAME, label: "Theme", description: "System follows your computer's light or dark mode." },
                    { setting: KEY_SIZE_SETTING },
                    { setting: PANEL_POSITION_SETTING },
                ],
            },
            {
                id: "editing",
                title: "Editing",
                rows: [
                    { setting: "typing-binds-key", label: "Typing binds a key" },
                    { setting: "serial-assignment", label: "Advance after assigning", description: "After you assign a key, select the next one in this order." },
                    { setting: "international-keyboards", label: "Key legends", description: "The keyboard layout your computer uses, so keys show what they type." },
                    { setting: SHOW_ALT_REPEAT_SETTING },
                    { setting: COMBO_INDICATOR_SETTING, label: "Combo indicators" },
                    { setting: COMBO_COLORBLIND_SETTING, label: "Colorblind-friendly combo colors" },
                ],
            },
        ],
    },
    {
        id: "keybard",
        title: "Keybard",
        sections: [
            { id: "about", title: "About", rows: [{ block: "about" }] },
            {
                id: "developer",
                title: "Developer",
                collapsible: true,
                rows: [
                    { setting: "scan-lab", label: "Scan Lab", description: "Measure key scanning and sensor timing." },
                    { setting: "key-proof-sheet", label: "Key proof sheet", description: "Every key rendering at every size, for visual checks." },
                ],
            },
        ],
    },
];

/**
 * Settings that have a definition in SETTINGS but are deliberately not on this
 * page, with their one home. A definition that is in neither list fails a test.
 */
export const SETTINGS_SHOWN_ELSEWHERE: Record<string, string> = {
    "live-updating": "the toolbar (Live Updating / Manual Updates)",
};

/** Sections the anchor chips jump to. */
export const SETTINGS_ANCHORS: Array<{ id: string; label: string }> = [
    { id: "firmware", label: "Firmware" },
    { id: "board", label: "Board" },
    { id: "backups", label: "Backups" },
    { id: "appearance", label: "Appearance" },
    { id: "editing", label: "Editing" },
    { id: "about", label: "About" },
];

/** Every setting name the page renders, in page order. */
export function settingsOnPage(page: SettingsGroup[] = SETTINGS_PAGE): string[] {
    return page.flatMap((g) => g.sections.flatMap((s) => s.rows.flatMap((r) => ("setting" in r ? [r.setting] : []))));
}
