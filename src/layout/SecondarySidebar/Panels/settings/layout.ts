import { THEME_SETTING_NAME } from "@/lib/theme";
import { DEVELOPER_OPENED_SETTING, KEY_SIZE_SETTING, PANEL_POSITION_SETTING } from "@/lib/appearance-settings";
import { SHOW_ALT_REPEAT_SETTING } from "@/lib/altRepeatVisibility";
import { COMBO_COLORBLIND_SETTING, COMBO_INDICATOR_SETTING } from "@/lib/comboIndicators";

/**
 * The Settings page, declared. Settings holds the setup a board needs once
 * (its hardware, firmware, backups and typing behavior), and preferences for
 * the Keybard app. What people use while editing a layout (layers, combos,
 * pointing modes and the rest) lives on the rail, never here
 * (docs/design/firmware-settings/settings-structure.md).
 *
 * A row is either a setting from SETTINGS (by name, with an optional label or
 * description for this page) or a block this page renders itself. To add a
 * preference, add its definition to SETTINGS and its name to a section in
 * every layout below.
 */
export type SettingsBlock = "hardware" | "firmware" | "board" | "backups" | "typing" | "about";

export type SettingsRow =
    | { setting: string; label?: string; description?: string }
    | { block: SettingsBlock };

export interface SettingsSection {
    id: string;
    title: string;
    rows: SettingsRow[];
    /** Has an open/close header. Closed unless `defaultOpen`. */
    collapsible?: boolean;
    /** A collapsible section that starts open. */
    defaultOpen?: boolean;
    /** Once opened, stays open in this browser (the setting that remembers it). */
    rememberOpen?: string;
    /** What the section holds, in a few words, shown under a collapsed heading. */
    summary?: string;
}

export interface SettingsGroup {
    id: string;
    title: string;
    sections: SettingsSection[];
    /** Drawn small at the end of the page, after a divider. */
    footer?: boolean;
    /** The title is for screen readers only (a page of one group). */
    hideTitle?: boolean;
}

export type SettingsLayoutId = "a" | "b" | "c";

export interface SettingsLayout {
    id: SettingsLayoutId;
    /** How sections are drawn: cards in groups, task groups with strong dividers, or one list of collapsible cards. */
    style: "cards" | "tasks" | "list";
    groups: SettingsGroup[];
    /** The chips under the search field. A group anchor jumps to the group's heading. */
    anchors: Array<{ id: string; label: string; group?: boolean }>;
}

/** QMK settings groups shown in Typing behavior, in order. */
export const TYPING_BEHAVIOR_SECTIONS = ["Tap-Hold", "Auto Shift", "One Shot Keys", "Magic", "Grave Escape"];

// --- Sections, shared by the layouts ---

const hardware: SettingsSection = { id: "hardware", title: "Hardware", rows: [{ block: "hardware" }], summary: "Clusters, pointing devices and ball color" };
const importRow: SettingsRow = { setting: "import", label: "Import layout", description: "Open a .svil or .vil file. You review the changes before anything is written." };
const exportRow: SettingsRow = { setting: "export", label: "Export layout", description: "Save the layout as .svil or .vil, or print it." };
const firmwareAndBoard: SettingsSection = { id: "firmware", title: "Firmware and board", rows: [{ block: "firmware" }, { block: "board" }] };
const backups: SettingsSection = { id: "backups", title: "Backups and files", rows: [{ block: "backups" }, importRow, exportRow] };
const typing: SettingsSection = {
    id: "typing",
    title: "Typing behavior",
    collapsible: true,
    rows: [{ block: "typing" }],
    summary: "Tap-hold, Auto Shift, one-shot keys and key swaps",
};
const appearanceRows: SettingsRow[] = [
    { setting: THEME_SETTING_NAME, label: "Theme", description: "System follows your computer's light or dark mode." },
    { setting: KEY_SIZE_SETTING },
    { setting: PANEL_POSITION_SETTING },
];
const editingRows: SettingsRow[] = [
    { setting: "typing-binds-key", label: "Typing binds a key" },
    { setting: "serial-assignment", label: "Advance after assigning", description: "After you assign a key, select the next one in this order." },
    { setting: "international-keyboards", label: "Key legends", description: "The keyboard layout your computer uses, so keys show what they type." },
    { setting: SHOW_ALT_REPEAT_SETTING },
    { setting: COMBO_INDICATOR_SETTING, label: "Combo indicators" },
    { setting: COMBO_COLORBLIND_SETTING, label: "Colorblind-friendly combo colors" },
];
const developerRows: SettingsRow[] = [
    { setting: "scan-lab", label: "Scan Lab", description: "Measure key scanning and sensor timing." },
    { setting: "key-proof-sheet", label: "Key proof sheet", description: "Every key rendering at every size, for visual checks." },
];
const about: SettingsSection = { id: "about", title: "About", rows: [{ block: "about" }] };
const developer: SettingsSection = { id: "developer", title: "Developer", collapsible: true, rememberOpen: DEVELOPER_OPENED_SETTING, rows: developerRows };

/**
 * The three organizations under review, chosen for one page load with
 * ?settingsLayout=a|b|c (never saved). A is the default: it is the closest to
 * the page before Hardware and Typing behavior moved in.
 */
export const SETTINGS_LAYOUTS: Record<SettingsLayoutId, SettingsLayout> = {
    // A. Two groups of cards.
    a: {
        id: "a",
        style: "cards",
        groups: [
            { id: "this-keyboard", title: "This keyboard", sections: [hardware, firmwareAndBoard, backups, typing] },
            {
                id: "keybard",
                title: "Keybard",
                sections: [{ id: "appearance", title: "Appearance and editing", rows: [...appearanceRows, ...editingRows] }, about, developer],
            },
        ],
        anchors: [
            { id: "hardware", label: "Hardware" },
            { id: "firmware", label: "Firmware" },
            { id: "backups", label: "Backups" },
            { id: "appearance", label: "Appearance" },
        ],
    },
    // B. In the order a board is set up, then used; About at the end.
    b: {
        id: "b",
        style: "tasks",
        groups: [
            { id: "set-up", title: "Set up", sections: [hardware, firmwareAndBoard] },
            {
                id: "everyday",
                title: "Everyday",
                sections: [
                    { id: "appearance", title: "Appearance", rows: appearanceRows },
                    { id: "editing", title: "Editing", rows: editingRows },
                    backups,
                ],
            },
            { id: "advanced", title: "Advanced", sections: [typing, developer] },
            { id: "keybard", title: "Keybard", footer: true, sections: [about] },
        ],
        anchors: [
            { id: "set-up", label: "Set up", group: true },
            { id: "everyday", label: "Everyday", group: true },
            { id: "advanced", label: "Advanced", group: true },
        ],
    },
    // C. One short list of collapsible cards; Hardware starts open.
    c: {
        id: "c",
        style: "list",
        groups: [
            {
                id: "settings",
                title: "Settings",
                hideTitle: true,
                sections: [
                    { ...hardware, collapsible: true, defaultOpen: true },
                    {
                        id: "firmware",
                        title: "Firmware and backups",
                        collapsible: true,
                        rows: [{ block: "firmware" }, { block: "board" }, { block: "backups" }, importRow, exportRow],
                        summary: "Updates, board name, backups, import and export",
                    },
                    {
                        id: "appearance",
                        title: "Appearance and editing",
                        collapsible: true,
                        rows: [...appearanceRows, ...editingRows],
                        summary: "Theme, key size, legends and combo indicators",
                    },
                    typing,
                    {
                        id: "about",
                        title: "About",
                        collapsible: true,
                        rows: [{ block: "about" }, ...developerRows],
                        summary: "Version, manual, community and developer tools",
                    },
                ],
            },
        ],
        anchors: [],
    },
};

export const DEFAULT_SETTINGS_LAYOUT: SettingsLayoutId = "a";

/** The layout a page's ?settingsLayout= asks for, or the default. */
export function settingsLayoutFromSearch(search: string): SettingsLayoutId {
    let value: string | undefined;
    try { value = new URLSearchParams(search).get("settingsLayout")?.trim().toLowerCase(); } catch { value = undefined; }
    return value === "a" || value === "b" || value === "c" ? value : DEFAULT_SETTINGS_LAYOUT;
}

let cachedLayout: SettingsLayoutId | undefined;
/** This page load's layout (read once, never saved). */
export function settingsLayoutId(): SettingsLayoutId {
    if (cachedLayout === undefined) cachedLayout = typeof window === "undefined" ? DEFAULT_SETTINGS_LAYOUT : settingsLayoutFromSearch(window.location.search);
    return cachedLayout;
}
export function _setSettingsLayoutForTests(id: SettingsLayoutId | undefined) { cachedLayout = id; }

/** The default layout's groups. */
export const SETTINGS_PAGE: SettingsGroup[] = SETTINGS_LAYOUTS[DEFAULT_SETTINGS_LAYOUT].groups;

/**
 * Settings that have a definition in SETTINGS but are deliberately not on this
 * page, with their one home. A definition that is in neither list fails a test.
 */
export const SETTINGS_SHOWN_ELSEWHERE: Record<string, string> = {
    "live-updating": "the toolbar (Live Updating / Manual Updates)",
};

/** The default layout's anchor chips. */
export const SETTINGS_ANCHORS = SETTINGS_LAYOUTS[DEFAULT_SETTINGS_LAYOUT].anchors;

/** Every setting name the page renders, in page order. */
export function settingsOnPage(page: SettingsGroup[] = SETTINGS_PAGE): string[] {
    return page.flatMap((g) => g.sections.flatMap((s) => s.rows.flatMap((r) => ("setting" in r ? [r.setting] : []))));
}

/** Every block the page renders, in page order. */
export function blocksOnPage(page: SettingsGroup[] = SETTINGS_PAGE): SettingsBlock[] {
    return page.flatMap((g) => g.sections.flatMap((s) => s.rows.flatMap((r) => ("block" in r ? [r.block] : []))));
}

/** The section that holds a block in a layout (where an old link to its panel lands). */
export function sectionOfBlock(page: SettingsGroup[], block: SettingsBlock): string | undefined {
    for (const g of page) for (const s of g.sections) if (s.rows.some((r) => "block" in r && r.block === block)) return s.id;
    return undefined;
}
