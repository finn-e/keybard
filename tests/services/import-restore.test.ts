/**
 * Restoring a .svil onto a board that was reset to defaults: everything the file
 * holds must reach the board, and only what differs is written.
 */
import { describe, it, expect, vi } from 'vitest';
import { prepareImport } from '../../src/services/import-preflight';
import { ImportService } from '../../src/services/import.service';
import { fileService } from '../../src/services/file.service';
import type { KeyboardInfo } from '../../src/types/keyboard.types';
import { createKbinfoWithFragments, createFragmentState, FRAGMENT_IDS, FRAGMENT_NAMES } from '../fixtures/fragments.fixture';

const LAYERS = 4;
const menus = [{
    label: 'Layer colors',
    content: Array.from({ length: LAYERS }, (_, layer) => ({ label: String(layer), type: 'color', content: [`id_layer${layer}_color`, 0, 32 + layer] })),
}] as any;

/** A board as Keybard loads it on connect. Both positions detect the 5-key cluster. */
function connected(settings: { selections: [number, number][]; oneShot: { timeout: number; tap_toggle: number }; colors: Array<[number, number]> }): KeyboardInfo {
    const kb = createKbinfoWithFragments({
        layers: LAYERS,
        fragmentState: createFragmentState({
            hwDetection: [[0, FRAGMENT_IDS.FINGER_5KEY], [1, FRAGMENT_IDS.FINGER_5KEY]],
            eepromSelections: settings.selections,
        }),
    });
    kb.kbid = 'a1b2c3d4e5f60718';
    kb.macros = [{ mid: 0, actions: [['tap', 'KC_A'], ['text', 'hi']] }];
    kb.macro_count = 1;
    kb.macros_size = 256;
    kb.svil_proto = 3;
    kb.menus = menus;
    kb.one_shot = settings.oneShot;
    kb.settings = { 5: settings.oneShot.tap_toggle, 6: settings.oneShot.timeout };
    kb.layer_colors = settings.colors.map(([hue, sat]) => ({ hue, sat, val: 255 }));
    kb.custom_values = settings.colors.map(([hue, sat], layer) => ({ key: `id_layer${layer}_color`, channel: 0, valueId: 32 + layer, data: [hue, sat] }));
    return kb;
}

const configured = () => connected({
    selections: [[0, 1]], // left_finger: the 6-key option, chosen by the user
    oneShot: { timeout: 3000, tap_toggle: 3 },
    colors: [[0, 255], [85, 255], [170, 128], [0, 0]],
});
const reset = () => connected({ selections: [], oneShot: { timeout: 5000, tap_toggle: 5 }, colors: [[0, 0], [0, 0], [0, 0], [0, 0]] });

const reload = (kb: KeyboardInfo) => fileService.svilToKBINFO(JSON.parse(fileService.kbinfoToSvil(kb)));

function services() {
    return {
        keyboardService: {
            saveSvil: vi.fn().mockResolvedValue(undefined),
            updateKey: vi.fn().mockResolvedValue(undefined),
            updateQMKSetting: vi.fn().mockResolvedValue(undefined),
            updateFragmentSelection: vi.fn().mockResolvedValue(true),
        },
    };
}

async function sync(next: KeyboardInfo, current: KeyboardInfo, svc = services()) {
    const keys: string[] = [];
    const writes: Array<() => Promise<void>> = [];
    await new ImportService().syncWithKeyboard(next, current, async (_desc, cb, metadata) => { keys.push(metadata?.writeKey ?? ''); writes.push(cb); }, svc);
    return { keys, writes, svc };
}

describe('restoring a .svil after a settings reset', () => {
    it('restores one-shot settings, layer colors and hardware positions', async () => {
        const board = reset();
        const review = prepareImport(reload(configured()), board);
        expect(review.errors).toEqual([]);
        expect(review.warnings.join(' ')).not.toMatch(/kept from the keyboard|not supported/);

        expect(review.keyboard.one_shot).toEqual({ timeout: 3000, tap_toggle: 3 });
        expect(review.keyboard.layer_colors?.map(c => [c.hue, c.sat])).toEqual([[0, 255], [85, 255], [170, 128], [0, 0]]);
        expect(review.keyboard.fragmentState?.eepromSelections.get(0)).toBe(1);
        expect(review.keyboard.fragmentState?.eepromSelections.has(1)).toBe(false);

        const { keys, writes, svc } = await sync(review.keyboard, board);
        // Layer 3 already matches the defaults; right_finger is fixed by its detected hardware.
        expect(keys).toEqual(['fragment:0', 'setting:5', 'setting:6', 'custom:id_layer0_color', 'custom:id_layer1_color', 'custom:id_layer2_color', 'custom-save:0', 'save-svil']);
        await writes[0]();
        expect(svc.keyboardService.updateFragmentSelection).toHaveBeenCalledExactlyOnceWith(review.keyboard, 0, 1);
    });

    it('writes nothing when the board already matches the file', async () => {
        const board = configured();
        const review = prepareImport(reload(board), board);
        expect(review.errors).toEqual([]);
        const { keys } = await sync(review.keyboard, board);
        expect(keys).toEqual([]);
    });

    it('clears a saved selection that the detected hardware already provides', async () => {
        const board = connected({ selections: [[0, 1]], oneShot: { timeout: 0, tap_toggle: 0 }, colors: [] });
        const file = reload(board);
        file.fragmentState!.userSelections.set('left_finger', FRAGMENT_NAMES.FINGER_5KEY);
        const review = prepareImport(file, board);
        expect(review.keyboard.fragmentState?.eepromSelections.has(0)).toBe(false);
        const { keys, writes, svc } = await sync(review.keyboard, board);
        expect(keys).toEqual(['fragment:0', 'save-svil']);
        await writes[0]();
        expect(svc.keyboardService.updateFragmentSelection).toHaveBeenCalledExactlyOnceWith(review.keyboard, 0, 0xff);
    });

    it('keeps a hardware-fixed position and says so', () => {
        const board = reset();
        const file = reload(board);
        file.fragmentState!.userSelections.set('right_finger', FRAGMENT_NAMES.FINGER_6KEY);
        const review = prepareImport(file, board);
        expect(review.warnings.join(' ')).toMatch(/right_finger is fixed by the detected hardware/);
        expect(review.keyboard.fragmentState?.eepromSelections.has(1)).toBe(false);
    });

    it('takes one-shot settings from QMK settings 5 and 6 over an older one-shot block', () => {
        const file = reload(configured());
        file.one_shot = { timeout: 0, tap_toggle: 0 }; // the separate block older firmware read
        const review = prepareImport(file, reset());
        expect(review.keyboard.settings).toMatchObject({ 5: 3, 6: 3000 });
        expect(review.keyboard.one_shot).toEqual({ timeout: 3000, tap_toggle: 3 });
    });
});
