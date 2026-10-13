import { describe, expect, it, vi } from 'vitest';
import { ChangeQueue, type KeyBlockWriter } from '../../src/services/changes.service';
import { KeyboardService } from '../../src/services/keyboard.service';
import { SvilUSB, VIA_BUFFER_HEADER_BYTES } from '../../src/services/usb.service';
import { WRAPPER_HEADER_BYTES } from '../../src/services/hid-report';

// Svalboard's matrix with 32 layers: 1,920 keymap positions.
const LAYERS = 32, ROWS = 10, COLS = 6;
const KEYS = LAYERS * ROWS * COLS;

/**
 * A board's dynamic keymap behind VIA, as the firmware handles it: set-buffer
 * writes `size` bytes at a byte offset (big-endian keycodes), set-keycode writes
 * one position. Every request must fit one wrapped report.
 */
function fakeBoard(reportLength: number) {
    const eeprom = new Uint8Array(KEYS * 2);
    const sent: Array<{ cmd: number; args: number[] }> = [];
    let failOn: number | null = null;
    const usb = {
        reportLength,
        send: vi.fn(async (cmd: number, args: number[]) => {
            if (WRAPPER_HEADER_BYTES + 1 + args.length > reportLength) throw new Error('request overflows the report');
            if (failOn !== null && sent.length === failOn) { failOn = null; throw new Error('USB failed'); }
            sent.push({ cmd, args });
            if (cmd === SvilUSB.CMD_VIA_KEYMAP_SET_BUFFER) {
                const offset = (args[0] << 8) | args[1], size = args[2];
                expect(args.length).toBe(3 + size);
                for (let i = 0; i < size; i++) if (offset + i < eeprom.length) eeprom[offset + i] = args[3 + i];
            } else if (cmd === SvilUSB.CMD_VIA_SET_KEYCODE) {
                const [layer, row, col, hi, lo] = args;
                const at = ((layer * ROWS + row) * COLS + col) * 2;
                eeprom[at] = hi; eeprom[at + 1] = lo;
            }
            return new Uint8Array(reportLength);
        }),
    };
    const service = new KeyboardService(usb as unknown as SvilUSB);
    const writer: KeyBlockWriter = {
        layers: LAYERS, rows: ROWS, cols: COLS,
        maxKeys: service.keymapBlockKeys(),
        write: (index, keycodes) => service.updateKeyBlock(index, keycodes),
    };
    const keycode = (index: number) => (eeprom[index * 2] << 8) | eeprom[index * 2 + 1];
    return { usb, service, writer, sent, keycode, failNext: (afterMessages: number) => { failOn = afterMessages; } };
}

const position = (index: number) => {
    const layer = Math.floor(index / (ROWS * COLS));
    const row = Math.floor((index % (ROWS * COLS)) / COLS);
    return { layer, row, col: index % COLS };
};

/** Queue key changes the way the import and the editor do. */
function stageKeys(queue: ChangeQueue, board: ReturnType<typeof fakeBoard>, indexes: number[], value: (index: number) => number) {
    const callbacks: Array<ReturnType<typeof vi.fn>> = [];
    for (const index of indexes) {
        const { layer, row, col } = position(index);
        const keycode = value(index);
        const cb = vi.fn(() => board.service.updateKey(layer, row, col, keycode));
        callbacks.push(cb);
        queue.add(`Update key L${layer} R${row} C${col}`, cb, { type: 'key', writeKey: `key:${layer}:${row}:${col}`, layer, row, col, keycode });
    }
    return callbacks;
}

const imported = (index: number) => 0x4000 + index;
const all = Array.from({ length: KEYS }, (_, i) => i);

describe('ChangeQueue key blocks', () => {
    it.each([
        [32, 11, 175],
        [64, 27, 72],
    ])('writes a full-keymap import at %i bytes as set-buffer messages of %i keys (%i messages)', async (reportLength, perMessage, messages) => {
        const board = fakeBoard(reportLength);
        expect(board.writer.maxKeys).toBe(perMessage);
        expect(perMessage * 2).toBe(reportLength - VIA_BUFFER_HEADER_BYTES);
        const notify = vi.fn();
        const queue = new ChangeQueue(notify, () => true, undefined, () => board.writer);
        const callbacks = stageKeys(queue, board, all, imported);
        notify.mockClear();

        expect(await queue.commit()).toBe(true);
        expect(queue.pending).toEqual({});
        expect(callbacks.every(cb => cb.mock.calls.length === 0)).toBe(true);
        expect(board.sent).toHaveLength(messages);
        let offset = 0;
        for (const { cmd, args } of board.sent) {
            expect(cmd).toBe(SvilUSB.CMD_VIA_KEYMAP_SET_BUFFER);
            expect((args[0] << 8) | args[1]).toBe(offset);
            const size = args[2];
            expect(size).toBe(Math.min(perMessage * 2, KEYS * 2 - offset));
            for (let i = 0; i < size; i += 2) {
                expect((args[3 + i] << 8) | args[4 + i]).toBe(imported((offset + i) / 2));
            }
            offset += size;
        }
        expect(offset).toBe(KEYS * 2);
        expect(all.every(i => board.keycode(i) === imported(i))).toBe(true);
        // One render to start, one per block, one at the end.
        expect(notify.mock.calls.length).toBe(messages + 2);
    });

    it('writes only the runs that changed, never the keys between them', async () => {
        const board = fakeBoard(32);
        const queue = new ChangeQueue(() => {}, () => true, undefined, () => board.writer);
        // Out of order on purpose: blocks follow keymap order, not queue order.
        const changed = [1919, 45, 2, 0, 1, 10, ...Array.from({ length: 15 }, (_, i) => 30 + i)];
        stageKeys(queue, board, changed, imported);

        expect(await queue.commit()).toBe(true);
        const runs = board.sent.map(({ args }) => [((args[0] << 8) | args[1]) / 2, args[2] / 2]);
        expect(runs).toEqual([[0, 3], [10, 1], [30, 11], [41, 5], [1919, 1]]);
        expect(changed.every(i => board.keycode(i) === imported(i))).toBe(true);
        expect([3, 9, 11, 29, 46, 1918].every(i => board.keycode(i) === 0)).toBe(true);
    });

    it('leaves exactly the failed block and later keys pending, and a retry completes', async () => {
        const board = fakeBoard(32);
        const acknowledge = vi.fn();
        const queue = new ChangeQueue(() => {}, () => true, () => acknowledge, () => board.writer);
        stageKeys(queue, board, all.slice(0, 50), imported);
        board.failNext(2);

        expect(await queue.commit()).toBe(false);
        expect(queue.error).toBe('USB failed');
        expect(acknowledge).not.toHaveBeenCalled();
        const pending = Object.values(queue.pending).map(change => (change.layer! * ROWS + change.row!) * COLS + change.col!);
        expect(pending.sort((a, b) => a - b)).toEqual(all.slice(22, 50));
        expect(all.slice(0, 22).every(i => board.keycode(i) === imported(i))).toBe(true);
        expect(board.keycode(22)).toBe(0);

        expect(await queue.commit()).toBe(true);
        expect(queue.error).toBeNull();
        expect(queue.pending).toEqual({});
        expect(acknowledge).toHaveBeenCalledOnce();
        expect(all.slice(0, 50).every(i => board.keycode(i) === imported(i))).toBe(true);
    });

    it('keeps a newer edit to a key whose block was in flight', async () => {
        const board = fakeBoard(32);
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const writer: KeyBlockWriter = { ...board.writer, write: async (index, keycodes) => { await gate; await board.writer.write(index, keycodes); } };
        const queue = new ChangeQueue(() => {}, () => true, undefined, () => writer);
        stageKeys(queue, board, [0, 1, 2], imported);
        const saving = queue.commit();
        await Promise.resolve(); await Promise.resolve();
        stageKeys(queue, board, [1], () => 0x1234);
        release();

        expect(await saving).toBe(true);
        expect(board.sent.map(({ args }) => [((args[0] << 8) | args[1]) / 2, args[2] / 2])).toEqual([[0, 3], [1, 1]]);
        expect(board.keycode(1)).toBe(0x1234);
    });

    it('still applies other changes through their callbacks, in queue order around key blocks', async () => {
        const board = fakeBoard(64);
        const order: string[] = [];
        const writer: KeyBlockWriter = { ...board.writer, write: async (index, keycodes) => { order.push(`keys ${index}+${keycodes.length}`); await board.writer.write(index, keycodes); } };
        const tracked = new ChangeQueue(() => {}, () => true, undefined, () => writer);
        stageKeys(tracked, board, [0, 1, 2], imported);
        tracked.add('Update All Macros', async () => { order.push('macros'); }, { type: 'macro', writeKey: 'macros' });
        stageKeys(tracked, board, [3, 4], imported);
        // Import tags labels, settings and the final save as "key" changes; they aren't keycode writes.
        tracked.add('Rename layer 0', async () => { order.push('label'); }, { type: 'key', writeKey: 'label:layer:0' });
        tracked.add('Save imported configuration', async () => { order.push('save'); }, { type: 'key', writeKey: 'save-svil' });

        expect(await tracked.commit()).toBe(true);
        expect(order).toEqual(['keys 0+3', 'macros', 'keys 3+2', 'label', 'save']);
        expect(tracked.pending).toEqual({});
    });

    it('writes keys one at a time when there is no block writer', async () => {
        const board = fakeBoard(32);
        const queue = new ChangeQueue(() => {}, () => true, undefined, () => null);
        const callbacks = stageKeys(queue, board, [0, 1, 2], imported);
        expect(await queue.commit()).toBe(true);
        expect(callbacks.every(cb => cb.mock.calls.length === 1)).toBe(true);
        expect(board.sent.every(({ cmd }) => cmd === SvilUSB.CMD_VIA_SET_KEYCODE)).toBe(true);
    });

    it('refuses a block that does not fit one message', async () => {
        const board = fakeBoard(32);
        await expect(board.service.updateKeyBlock(0, new Array(12).fill(0))).rejects.toThrow();
        await expect(board.service.updateKeyBlock(0, [])).rejects.toThrow();
        expect(board.sent).toHaveLength(0);
    });
});
