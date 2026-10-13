/**
 * Fragment Service Tests
 *
 * Tests for fragment resolution logic, USB communication, and state management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FragmentService } from '../../src/services/fragment.service';
import type { KeyboardInfo, FragmentInstance, FragmentState } from '../../src/types/keyboard.types';
import {
    createTestFragments,
    createFragmentState,
    createSelectableInstance,
    createFixedInstance,
    createLockedInstance,
    FRAGMENT_NAMES,
    FRAGMENT_IDS,
    USB_RESPONSES,
    RESOLUTION_SCENARIOS,
} from '../fixtures/fragments.fixture';
import { createTestKeyboardInfo } from '../fixtures/keyboard-info.fixture';

// Mock USB service
const mockUsb = {
    sendSvil: vi.fn(),
};

describe('FragmentService', () => {
    let service: FragmentService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new FragmentService(mockUsb as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('resolveFragment', () => {
        it('returns fixed fragment for fixed instance', () => {
            const kbinfo = createKbinfoWithFragments();
            const instance = createFixedInstance();

            const result = service.resolveFragment(kbinfo, 0, instance);

            expect(result).toBe(FRAGMENT_NAMES.NUMPAD);
        });

        it('returns hardware detection when allow_override=false', () => {
            const kbinfo = createKbinfoWithFragments({
                hwDetection: [[0, FRAGMENT_IDS.FINGER_6KEY]],
                userSelections: [['right_finger', FRAGMENT_NAMES.FINGER_5KEY]],
            });
            const instance = createLockedInstance();

            const result = service.resolveFragment(kbinfo, 0, instance);

            expect(result).toBe(FRAGMENT_NAMES.FINGER_6KEY);
        });

        it('returns user selection when allow_override=true', () => {
            const kbinfo = createKbinfoWithFragments({
                hwDetection: [[0, FRAGMENT_IDS.FINGER_5KEY]],
                userSelections: [['left_finger', FRAGMENT_NAMES.FINGER_6KEY]],
            });
            const instance = createSelectableInstance();

            const result = service.resolveFragment(kbinfo, 0, instance);

            expect(result).toBe(FRAGMENT_NAMES.FINGER_6KEY);
        });

        it('returns EEPROM selection when no user selection', () => {
            const kbinfo = createKbinfoWithFragments({
                hwDetection: [[0, FRAGMENT_IDS.FINGER_5KEY]],
                eepromSelections: [[0, 1]], // Option index 1 = 6-key
            });
            const instance = createSelectableInstance();

            const result = service.resolveFragment(kbinfo, 0, instance);

            expect(result).toBe(FRAGMENT_NAMES.FINGER_6KEY);
        });

        it('returns hardware detection when no user or EEPROM selection (allow_override=true)', () => {
            const kbinfo = createKbinfoWithFragments({
                hwDetection: [[0, FRAGMENT_IDS.FINGER_6KEY]],
            });
            const instance = createSelectableInstance();

            const result = service.resolveFragment(kbinfo, 0, instance);

            expect(result).toBe(FRAGMENT_NAMES.FINGER_6KEY);
        });

        it('returns default option when no selections at all', () => {
            const kbinfo = createKbinfoWithFragments();
            const instance = createSelectableInstance();

            const result = service.resolveFragment(kbinfo, 0, instance);

            // First option marked as default
            expect(result).toBe(FRAGMENT_NAMES.FINGER_5KEY);
        });

        it('falls back to hardware detection when user selection is invalid', () => {
            const kbinfo = createKbinfoWithFragments({
                hwDetection: [[0, FRAGMENT_IDS.FINGER_5KEY]],
                userSelections: [['left_finger', 'nonexistent_fragment']],
            });
            const instance = createSelectableInstance();

            const result = service.resolveFragment(kbinfo, 0, instance);

            // Falls back to hardware detection
            expect(result).toBe(FRAGMENT_NAMES.FINGER_5KEY);
        });

        it('returns empty string for instance with no options', () => {
            const kbinfo = createKbinfoWithFragments();
            const instance: FragmentInstance = {
                id: 'empty_instance',
                fragment_options: [],
            };

            const result = service.resolveFragment(kbinfo, 0, instance);

            expect(result).toBe('');
        });
    });

    describe('get()', () => {
        it('queries hardware detection via USB 0x18', async () => {
            const kbinfo = createKbinfoWithFragments();
            mockUsb.sendSvil
                .mockResolvedValueOnce(USB_RESPONSES.hardwareDetection({ 0: FRAGMENT_IDS.FINGER_5KEY }))
                .mockResolvedValueOnce(USB_RESPONSES.eepromSelections({}));

            await service.get(kbinfo);

            expect(mockUsb.sendSvil).toHaveBeenCalledWith(
                0x18, // CMD_SVIL_FRAGMENT_GET_HARDWARE
                [],
                { uint8: true }
            );
        });

        it('queries EEPROM selections via USB 0x19', async () => {
            const kbinfo = createKbinfoWithFragments();
            mockUsb.sendSvil
                .mockResolvedValueOnce(USB_RESPONSES.hardwareDetection({}))
                .mockResolvedValueOnce(USB_RESPONSES.eepromSelections({ 0: 1 }));

            await service.get(kbinfo);

            expect(mockUsb.sendSvil).toHaveBeenCalledWith(
                0x19, // CMD_SVIL_FRAGMENT_GET_SELECTIONS
                [],
                { uint8: true }
            );
        });

        it('populates fragmentState from USB responses', async () => {
            const kbinfo = createKbinfoWithFragments();
            // Clear existing state
            kbinfo.fragmentState = undefined;

            mockUsb.sendSvil
                .mockResolvedValueOnce(USB_RESPONSES.hardwareDetection({ 0: FRAGMENT_IDS.FINGER_5KEY, 1: FRAGMENT_IDS.FINGER_6KEY }))
                .mockResolvedValueOnce(USB_RESPONSES.eepromSelections({ 0: 0, 1: 1 }));

            await service.get(kbinfo);

            expect(kbinfo.fragmentState).toBeDefined();
            expect(kbinfo.fragmentState!.hwDetection.get(0)).toBe(FRAGMENT_IDS.FINGER_5KEY);
            expect(kbinfo.fragmentState!.hwDetection.get(1)).toBe(FRAGMENT_IDS.FINGER_6KEY);
            expect(kbinfo.fragmentState!.eepromSelections.get(0)).toBe(0);
            expect(kbinfo.fragmentState!.eepromSelections.get(1)).toBe(1);
        });

        it('marks the selections read only when 0x19 answers', async () => {
            const kbinfo = createKbinfoWithFragments();
            kbinfo.fragmentState = undefined;
            mockUsb.sendSvil
                .mockResolvedValueOnce(USB_RESPONSES.hardwareDetection({}))
                .mockRejectedValueOnce(new Error('USB error'));
            await service.get(kbinfo);
            expect(kbinfo.fragmentState!.selectionsRead).toBeFalsy();

            mockUsb.sendSvil
                .mockResolvedValueOnce(USB_RESPONSES.hardwareDetection({}))
                .mockResolvedValueOnce(USB_RESPONSES.eepromSelections({ 0: 1 }));
            await service.get(kbinfo);
            expect(kbinfo.fragmentState!.selectionsRead).toBe(true);
        });

        it('handles keyboard with no fragments', async () => {
            const kbinfo = createTestKeyboardInfo({
                rows: 4,
                cols: 4,
                layers: 1,
            });
            // No fragments defined

            await service.get(kbinfo);

            // Should not call USB
            expect(mockUsb.sendSvil).not.toHaveBeenCalled();
            // But should initialize fragment state
            expect(kbinfo.fragmentState).toBeDefined();
        });

        it('handles USB errors gracefully', async () => {
            const kbinfo = createKbinfoWithFragments();
            mockUsb.sendSvil.mockRejectedValue(new Error('USB error'));

            // Should not throw
            await expect(service.get(kbinfo)).resolves.not.toThrow();
        });

        it('ignores 0xFF values (no detection)', async () => {
            const kbinfo = createKbinfoWithFragments();
            kbinfo.fragmentState = undefined;

            // Response with some 0xFF values
            const response = new Uint8Array(23);
            response[0] = 0x18;
            response[1] = 3;
            response[2] = FRAGMENT_IDS.FINGER_5KEY;
            response[3] = 0xFF; // No detection
            response[4] = FRAGMENT_IDS.FINGER_6KEY;

            mockUsb.sendSvil
                .mockResolvedValueOnce(response)
                .mockResolvedValueOnce(USB_RESPONSES.eepromSelections({}));

            await service.get(kbinfo);

            expect(kbinfo.fragmentState!.hwDetection.has(0)).toBe(true);
            expect(kbinfo.fragmentState!.hwDetection.has(1)).toBe(false); // 0xFF skipped
            expect(kbinfo.fragmentState!.hwDetection.has(2)).toBe(true);
        });
    });

    describe('setSelection()', () => {
        it('sends selection via USB 0x1A', async () => {
            const kbinfo = createKbinfoWithFragments({
                eepromSelections: [[0, 0]],
            });
            kbinfo.fragmentState!.selectionsRead = true;

            mockUsb.sendSvil.mockResolvedValueOnce(USB_RESPONSES.setSelectionSuccess());

            await service.setSelection(kbinfo, 0, 1);

            expect(mockUsb.sendSvil).toHaveBeenCalledWith(
                0x1A, // CMD_SVIL_FRAGMENT_SET_SELECTIONS
                expect.any(Array),
                { uint8: true }
            );
        });

        it('returns true on success', async () => {
            const kbinfo = createKbinfoWithFragments();
            kbinfo.fragmentState!.selectionsRead = true;
            mockUsb.sendSvil.mockResolvedValueOnce(USB_RESPONSES.setSelectionSuccess());

            const result = await service.setSelection(kbinfo, 0, 1);

            expect(result).toBe(true);
        });

        it('returns false on failure response', async () => {
            const kbinfo = createKbinfoWithFragments();
            kbinfo.fragmentState!.selectionsRead = true;
            mockUsb.sendSvil.mockResolvedValueOnce(USB_RESPONSES.setSelectionFailure());

            const result = await service.setSelection(kbinfo, 0, 1);

            expect(result).toBe(false);
        });

        it('updates local cache on success', async () => {
            const kbinfo = createKbinfoWithFragments();
            kbinfo.fragmentState!.selectionsRead = true;
            mockUsb.sendSvil.mockResolvedValueOnce(USB_RESPONSES.setSelectionSuccess());

            await service.setSelection(kbinfo, 0, 1);

            expect(kbinfo.fragmentState!.eepromSelections.get(0)).toBe(1);
        });

        it('clears selection with 0xFF', async () => {
            const kbinfo = createKbinfoWithFragments({
                eepromSelections: [[0, 1]],
            });
            kbinfo.fragmentState!.selectionsRead = true;
            mockUsb.sendSvil.mockResolvedValueOnce(USB_RESPONSES.setSelectionSuccess());

            await service.setSelection(kbinfo, 0, 0xFF);

            expect(kbinfo.fragmentState!.eepromSelections.has(0)).toBe(false);
        });

        it("refuses to write before the board's selections were read", async () => {
            const kbinfo = createKbinfoWithFragments({ eepromSelections: [[0, 1]] });

            const result = await service.setSelection(kbinfo, 0, 1);

            expect(result).toBe(false);
            expect(mockUsb.sendSvil).not.toHaveBeenCalled();
        });

        it('returns false when no fragment state', async () => {
            const kbinfo = createTestKeyboardInfo({ rows: 4, cols: 4 });
            kbinfo.fragmentState = undefined;

            const result = await service.setSelection(kbinfo, 0, 1);

            expect(result).toBe(false);
            expect(mockUsb.sendSvil).not.toHaveBeenCalled();
        });

        it('returns false when no instances', async () => {
            const kbinfo = createTestKeyboardInfo({ rows: 4, cols: 4 });
            kbinfo.fragmentState = createFragmentState();
            // No composition/instances

            const result = await service.setSelection(kbinfo, 0, 1);

            expect(result).toBe(false);
        });

        it('handles USB error', async () => {
            const kbinfo = createKbinfoWithFragments();
            kbinfo.fragmentState!.selectionsRead = true;
            mockUsb.sendSvil.mockRejectedValueOnce(new Error('USB error'));

            const result = await service.setSelection(kbinfo, 0, 1);

            expect(result).toBe(false);
        });
    });

    describe('hasFragments()', () => {
        it('returns true when fragments and composition defined', () => {
            const kbinfo = createKbinfoWithFragments();

            expect(service.hasFragments(kbinfo)).toBe(true);
        });

        it('returns false when no fragments', () => {
            const kbinfo = createTestKeyboardInfo({ rows: 4, cols: 4 });

            expect(service.hasFragments(kbinfo)).toBe(false);
        });

        it('returns false when no composition', () => {
            const kbinfo = createTestKeyboardInfo({ rows: 4, cols: 4 });
            kbinfo.fragments = createTestFragments();
            // No composition

            expect(service.hasFragments(kbinfo)).toBe(false);
        });

        it('returns false when empty instances array', () => {
            const kbinfo = createTestKeyboardInfo({ rows: 4, cols: 4 });
            kbinfo.fragments = createTestFragments();
            kbinfo.composition = { instances: [] };

            expect(service.hasFragments(kbinfo)).toBe(false);
        });
    });

    describe('getInstanceCount()', () => {
        it('returns instance count', () => {
            const kbinfo = createKbinfoWithFragments();

            expect(service.getInstanceCount(kbinfo)).toBe(2);
        });

        it('returns 0 when no composition', () => {
            const kbinfo = createTestKeyboardInfo({ rows: 4, cols: 4 });

            expect(service.getInstanceCount(kbinfo)).toBe(0);
        });
    });

    describe('getSelectableInstances()', () => {
        it('returns only instances with fragment_options', () => {
            const kbinfo = createTestKeyboardInfo({ rows: 4, cols: 4 });
            kbinfo.fragments = createTestFragments();
            kbinfo.composition = {
                instances: [
                    createSelectableInstance({ id: 'selectable' }),
                    createFixedInstance({ id: 'fixed' }),
                ],
            };

            const result = service.getSelectableInstances(kbinfo);

            expect(result.length).toBe(1);
            expect(result[0].instance.id).toBe('selectable');
        });

        it('returns empty array when no composition', () => {
            const kbinfo = createTestKeyboardInfo({ rows: 4, cols: 4 });

            expect(service.getSelectableInstances(kbinfo)).toEqual([]);
        });
    });

    describe('getFragmentNameById()', () => {
        it('returns fragment name for valid ID', () => {
            const kbinfo = createKbinfoWithFragments();

            expect(service.getFragmentNameById(kbinfo, FRAGMENT_IDS.FINGER_5KEY)).toBe(FRAGMENT_NAMES.FINGER_5KEY);
            expect(service.getFragmentNameById(kbinfo, FRAGMENT_IDS.FINGER_6KEY)).toBe(FRAGMENT_NAMES.FINGER_6KEY);
        });

        it('returns undefined for invalid ID', () => {
            const kbinfo = createKbinfoWithFragments();

            expect(service.getFragmentNameById(kbinfo, 999)).toBeUndefined();
        });

        it('returns undefined when no fragments', () => {
            const kbinfo = createTestKeyboardInfo({ rows: 4, cols: 4 });

            expect(service.getFragmentNameById(kbinfo, FRAGMENT_IDS.FINGER_5KEY)).toBeUndefined();
        });
    });

    describe('getFragmentId()', () => {
        it('returns fragment ID for valid name', () => {
            const kbinfo = createKbinfoWithFragments();

            expect(service.getFragmentId(kbinfo, FRAGMENT_NAMES.FINGER_5KEY)).toBe(FRAGMENT_IDS.FINGER_5KEY);
        });

        it('returns 0xFF for invalid name', () => {
            const kbinfo = createKbinfoWithFragments();

            expect(service.getFragmentId(kbinfo, 'nonexistent')).toBe(0xFF);
        });
    });

    describe('getFragmentDisplayName()', () => {
        it('returns description if available', () => {
            const kbinfo = createKbinfoWithFragments();

            const result = service.getFragmentDisplayName(kbinfo, FRAGMENT_NAMES.FINGER_5KEY);

            expect(result).toBe('5-key finger cluster');
        });

        it('converts snake_case to Title Case if no description', () => {
            const kbinfo = createTestKeyboardInfo({ rows: 4, cols: 4 });
            kbinfo.fragments = {
                'my_custom_fragment': { id: 1, kle: [] },
            };

            const result = service.getFragmentDisplayName(kbinfo, 'my_custom_fragment');

            expect(result).toBe('My Custom Fragment');
        });
    });

    describe('getInstanceDisplayName()', () => {
        it('converts snake_case to Title Case', () => {
            expect(service.getInstanceDisplayName('left_finger')).toBe('Left Finger');
            expect(service.getInstanceDisplayName('right_thumb_cluster')).toBe('Right Thumb Cluster');
        });
    });

    describe('getFragmentOptions()', () => {
        it('returns options for selectable instance', () => {
            const instance = createSelectableInstance();

            const result = service.getFragmentOptions(instance);

            expect(result).toContain(FRAGMENT_NAMES.FINGER_5KEY);
            expect(result).toContain(FRAGMENT_NAMES.FINGER_6KEY);
        });

        it('returns empty array for fixed instance', () => {
            const instance = createFixedInstance();

            const result = service.getFragmentOptions(instance);

            expect(result).toEqual([]);
        });
    });

    describe('getOptionIndex()', () => {
        it('returns correct index for fragment', () => {
            const instance = createSelectableInstance();

            expect(service.getOptionIndex(instance, FRAGMENT_NAMES.FINGER_5KEY)).toBe(0);
            expect(service.getOptionIndex(instance, FRAGMENT_NAMES.FINGER_6KEY)).toBe(1);
        });

        it('returns 0 for unknown fragment', () => {
            const instance = createSelectableInstance();

            expect(service.getOptionIndex(instance, 'unknown')).toBe(0);
        });
    });
});

// Helper function to create kbinfo with fragments for tests
function createKbinfoWithFragments(fragmentStateOverrides?: {
    hwDetection?: [number, number][];
    eepromSelections?: [number, number][];
    userSelections?: [string, string][];
}): KeyboardInfo {
    const kbinfo = createTestKeyboardInfo({
        rows: 5,
        cols: 14,
        layers: 4,
        kbid: 'fragment_test_kb',
    });

    kbinfo.fragments = createTestFragments();
    kbinfo.composition = {
        instances: [
            createSelectableInstance({ id: 'left_finger' }),
            createSelectableInstance({ id: 'right_finger' }),
        ],
    };

    kbinfo.fragmentState = createFragmentState({
        hwDetection: fragmentStateOverrides?.hwDetection,
        eepromSelections: fragmentStateOverrides?.eepromSelections,
        userSelections: fragmentStateOverrides?.userSelections,
    });

    return kbinfo;
}
