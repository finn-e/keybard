import { LAYOUTS } from '@/components/Keyboards/layouts';
import type { KeyboardInfo } from '@/types/keyboard.types';
import { SVALBOARD_LAYOUT } from '@/constants/svalboard-layout';

export interface Appearance {
    fill: string; fillAlpha: number; outline: string; outlineAlpha: number;
    legend: string; legendAlpha: number; width: number; halo: boolean;
    changed: string; pressed: string;
}
export const PRESETS: Record<string, Appearance> = {
    Dark: { fill: '#14202b', fillAlpha: 80, outline: '#51606a', outlineAlpha: 100,
        legend: '#f0f5f7', legendAlpha: 100, width: 1, halo: false, changed: '#8ce4d3', pressed: '#ffd27a' },
};
PRESETS.Subtle = { ...PRESETS.Dark, fillAlpha: 20, outlineAlpha: 40, legendAlpha: 80, halo: true };
PRESETS['Outline only'] = { ...PRESETS.Dark, fillAlpha: 0, outline: '#dce5ec', outlineAlpha: 90, halo: true };
PRESETS.Light = { ...PRESETS.Dark, fill: '#f3f5f7', fillAlpha: 90, outline: '#56616b', legend: '#15202b' };
PRESETS['High contrast'] = { ...PRESETS.Dark, fill: '#000000', fillAlpha: 90, outline: '#ffffff', width: 2, halo: true };
export interface Preferences { layoutId: string; appearance: Appearance; effect: 'Off' | 'Quick flash' | 'Short fade'; duration: number; scale: number; hands: 'Both' | 'Left' | 'Right' }
export const DEFAULTS: Preferences = { layoutId: 'us', appearance: { ...PRESETS['Outline only'] }, effect: 'Short fade', duration: 150, scale: 100, hands: 'Both' };
export const STORAGE_KEY = 'keybard.trainer.v1';
export function preferences(value: unknown): Preferences {
    const result = { ...DEFAULTS, appearance: { ...DEFAULTS.appearance } };
    if (!value || typeof value !== 'object') return result;
    const data = value as Record<string, unknown>;
    const colors = data.appearance as Record<string, unknown> | undefined;
    if (colors && typeof colors === 'object') {
        for (const name of ['fill', 'outline', 'legend', 'changed', 'pressed'] as const)
            if (typeof colors[name] === 'string' && /^#[\da-f]{6}$/i.test(colors[name] as string)) result.appearance[name] = colors[name] as string;
        for (const name of ['fillAlpha', 'outlineAlpha', 'legendAlpha', 'width'] as const)
            if (typeof colors[name] === 'number' && Number.isFinite(colors[name])) result.appearance[name] = Math.max(0, Math.min(name === 'width' ? 4 : 100, colors[name] as number));
        if (typeof colors.halo === 'boolean') result.appearance.halo = colors.halo;
    }
    if (typeof data.layoutId === 'string' && Object.prototype.hasOwnProperty.call(LAYOUTS, data.layoutId)) result.layoutId = data.layoutId;
    if (['Off', 'Quick flash', 'Short fade'].includes(data.effect as string)) result.effect = data.effect as Preferences['effect'];
    if (['Both', 'Left', 'Right'].includes(data.hands as string)) result.hands = data.hands as Preferences['hands'];
    for (const key of ['duration', 'scale'] as const) if (typeof data[key] === 'number' && Number.isFinite(data[key]))
        result[key] = Math.max(key === 'duration' ? 50 : 50, Math.min(key === 'duration' ? 750 : 150, data[key] as number));
    return result;
}
/** The preferences that differ between two snapshots (a whole appearance counts as one field). */
export function changedPreferences(before: Preferences, after: Preferences): Partial<Preferences> {
    const changed: Partial<Preferences> = {};
    for (const key of Object.keys(after) as Array<keyof Preferences>)
        if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) (changed as Record<string, unknown>)[key] = after[key];
    return changed;
}
export function resolveBinding(keymap: number[][], index: number, active: number, defaults: number) {
    const mask = (active | defaults) >>> 0;
    for (let layer = 31; layer >= 0; layer--) {
        if (((mask >>> layer) & 1) === 0) continue;
        if (!keymap[layer]) throw new Error(`Layer ${layer} is not in this snapshot.`);
        const code = keymap[layer][index];
        if (code !== undefined && code !== 1) return { code, layer };
    }
    return { code: keymap[0]?.[index] ?? 0, layer: 0 };
}
export function geometry(board: KeyboardInfo) {
    const layout = board.keylayout && Object.keys(board.keylayout).length ? board.keylayout : SVALBOARD_LAYOUT;
    return Object.entries(layout).flatMap(([id, raw]) => {
        const index = Number(id), row = raw.row ?? Math.floor(index / board.cols), col = raw.col ?? index % board.cols;
        const x = Number(raw.x), y = Number(raw.y), w = Number(raw.w ?? 1), h = Number(raw.h ?? 1);
        if (![row, col, x, y, w, h].every(Number.isFinite) || !Number.isInteger(row) || !Number.isInteger(col)
            || row < 0 || row >= board.rows || col < 0 || col >= board.cols || w <= 0 || h <= 0) return [];
        return [{ id: row * board.cols + col, row, col, x, y, w, h, hand: row < 5 ? 'Left' : 'Right' }];
    });
}
export function haloColor(color: string) {
    const channels = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > 127 ? '#000000' : '#ffffff';
}
