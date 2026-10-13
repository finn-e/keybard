import { useRef, useState } from 'react';
import { useKeyboard } from '@/contexts/KeyboardContext';
import { useChanges } from '@/contexts/ChangesContext';
import { useLayoutLibrary } from '@/contexts/LayoutLibraryContext';
import { svalService } from '@/services/sval.service';
import { usbInstance } from '@/services/usb.service';
import { parseLayerClipboard, readLayerClipboard, type LayerClipboardData } from '@/utils/layer-clipboard';

export function useLayerClipboardActions() {
    const { keyboard, setKeyboard, updateKey, isConnected } = useKeyboard();
    const { queue } = useChanges();
    const { copyLayer } = useLayoutLibrary();
    const [clipboardError, setClipboardError] = useState<string | null>(null);
    const current = useRef(keyboard);
    current.current = keyboard;

    const copy = (layer: number) => {
        if (!keyboard?.keymap?.[layer]) return;
        setClipboardError(null);
        const now = new Date().toISOString();
        copyLayer({ id: `current-${layer}`, name: svalService.getLayerName(keyboard, layer),
            description: '', author: 'Local User', tags: [], keyboardType: 'svalboard',
            keyCount: keyboard.keymap[layer].length, keymap: [...keyboard.keymap[layer]],
            layerColor: keyboard.cosmetic?.layer_colors?.[layer],
            ledColor: keyboard.layer_colors?.[layer], createdAt: now, updatedAt: now });
    };

    const apply = (source: LayerClipboardData, layer: number) => {
        if (!keyboard?.keymap?.[layer]) return;
        const data = parseLayerClipboard(source);
        const previous = keyboard.keymap[layer];
        if (data.keymap.length !== previous.length) throw new Error(`This layer has ${data.keymap.length} keys; the destination needs ${previous.length}.`);
        const next = structuredClone(keyboard);
        next.keymap![layer] = [...data.keymap];
        if (data.layerColor !== undefined) {
            next.cosmetic ??= {};
            next.cosmetic.layer_colors ??= {};
            next.cosmetic.layer_colors[layer] = data.layerColor;
        }
        if (data.ledColor) {
            next.layer_colors ??= [];
            next.layer_colors[layer] = { ...data.ledColor };
        }
        setKeyboard(next);
        data.keymap.forEach((keycode, index) => {
            if (keycode === previous[index]) return;
            const row = Math.floor(index / keyboard.cols), col = index % keyboard.cols;
            void queue(`key_${layer}_${row}_${col}`, async () => { await updateKey(layer, row, col, keycode); },
                { type: 'key', writeKey: `key:${layer}:${row}:${col}`, layer, row, col, keycode, previousValue: previous[index] });
        });
        if (data.ledColor && isConnected) {
            const color = data.ledColor;
            void queue(`Layer ${layer} LED color`, async () => { await usbInstance.setLayerColor(layer, color.hue, color.sat); },
                { type: 'setting', writeKey: `layer-color:${layer}` });
        }
    };

    const paste = async (layer: number) => {
        setClipboardError(null);
        try {
            const source = await readLayerClipboard();
            if (current.current !== keyboard) throw new Error('The layout changed while reading the clipboard. Please paste again.');
            apply(source, layer);
        } catch (error) { setClipboardError(error instanceof Error ? error.message : 'Could not paste the layer.'); }
    };
    return { copy, paste, apply, clipboardError, clearClipboardError: () => setClipboardError(null) };
}
