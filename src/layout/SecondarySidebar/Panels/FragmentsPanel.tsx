import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useChanges } from "@/contexts/ChangesContext";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { isWidgetInstance } from "@/services/fragment-composer.service";
import { keyboardService } from "@/services/keyboard.service";
import type { FragmentInstance, KeyboardInfo } from "@/types/keyboard.types";

/**
 * Safely get a value from something that might be a Map or a plain object
 * (handles JSON deserialization where Maps become objects)
 */
function safeMapGet<K extends string | number, V>(
    mapOrObj: Map<K, V> | Record<string, V> | undefined,
    key: K
): V | undefined {
    if (!mapOrObj) return undefined;
    if (mapOrObj instanceof Map) {
        return mapOrObj.get(key);
    }
    // Plain object - convert key to string for lookup
    return (mapOrObj as Record<string, V>)[String(key)];
}

/**
 * Hardware presets for the finger positions (thumbs always get the thumb cluster):
 * Default is 5-key everywhere, 6-key adds the 2S key everywhere, and Fang uses
 * 6-key on index and pinky and 5-key on middle and ring.
 */
type FragmentPreset = "default" | "six" | "fang";

const PRESETS: Array<{ preset: FragmentPreset; label: string; description: string }> = [
    { preset: "default", label: "Default", description: "Restore default hardware selections" },
    { preset: "six", label: "6-key", description: "Use 6-key finger clusters" },
    { preset: "fang", label: "Fang", description: "Use 6-key index and pinky clusters, 5-key middle and ring" },
];

function wantsSixKey(instanceId: string, preset: FragmentPreset): boolean {
    if (preset === "six") return true;
    if (preset === "fang") return /index|pinky/i.test(instanceId);
    return false;
}

/**
 * Fragment Selections Panel
 *
 * Allows users to select which physical component (fragment) is installed
 * at each position. Hardware-detected components are shown and some may
 * be locked depending on the keyboard configuration.
 */
const FragmentsPanel: React.FC = () => {
    const { keyboard, setKeyboard, isConnected, getKeyboardSnapshot } = useKeyboard();
    const { queue } = useChanges();
    const [updating, setUpdating] = useState<number | "bulk" | null>(null);

    const fragmentService = keyboardService.getFragmentService();

    const applyLocalSelections = useCallback((
        baseKeyboard: KeyboardInfo,
        selections: Array<{ instanceId: string; fragmentName: string }>
    ) => {
        const newKeyboard = { ...baseKeyboard };
        const oldState = baseKeyboard.fragmentState;
        const newHwDetection: Map<number, number> = oldState?.hwDetection instanceof Map
            ? new Map(oldState.hwDetection)
            : new Map(Object.entries(oldState?.hwDetection ?? {}).map(([k, v]) => [Number(k), v as number]));
        const newEepromSelections: Map<number, number> = oldState?.eepromSelections instanceof Map
            ? new Map(oldState.eepromSelections)
            : new Map(Object.entries(oldState?.eepromSelections ?? {}).map(([k, v]) => [Number(k), v as number]));
        const newUserSelections: Map<string, string> = oldState?.userSelections instanceof Map
            ? new Map(oldState.userSelections)
            : new Map(Object.entries(oldState?.userSelections ?? {}).map(([k, v]) => [k, v as string]));

        newKeyboard.fragmentState = {
            hwDetection: newHwDetection,
            eepromSelections: newEepromSelections,
            userSelections: newUserSelections,
            selectionsRead: oldState?.selectionsRead,
        };

        selections.forEach(({ instanceId, fragmentName }) => {
            newKeyboard.fragmentState?.userSelections.set(instanceId, fragmentName);
            const entry = fragmentService.getSelectableInstances(baseKeyboard).find(({instance}) => instance.id === instanceId);
            if (entry) newEepromSelections.set(entry.idx, fragmentService.getOptionIndex(entry.instance, fragmentName));
        });

        const fragmentComposer = keyboardService.getFragmentComposer();
        const composedLayout = fragmentComposer.composeLayout(newKeyboard);
        if (Object.keys(composedLayout).length > 0) {
            newKeyboard.keylayout = { ...composedLayout };
            console.log("Fragment layout recomposed:", Object.keys(composedLayout).length, "keys");
        }

        setKeyboard(newKeyboard);
    }, [setKeyboard, fragmentService]);

    // Handle fragment selection change
    const handleSelectionChange = useCallback(async (
        instanceIdx: number,
        instance: FragmentInstance,
        newFragmentName: string
    ) => {
        if (!keyboard) return;

        setUpdating(instanceIdx);

        try {
            // Get option index for the selected fragment
            const optionIdx = fragmentService.getOptionIndex(instance, newFragmentName);

            applyLocalSelections(keyboard, [{ instanceId: instance.id, fragmentName: newFragmentName }]);
            if (isConnected) await queue(`Hardware position ${instance.id}`, async () => {
                if (!await keyboardService.updateFragmentSelection(getKeyboardSnapshot() ?? keyboard, instanceIdx, optionIdx)) {
                    throw new Error(`Keyboard rejected the selection for ${instance.id}`);
                }
                await keyboardService.saveSvil();
            }, {writeKey: `fragment:${instanceIdx}`});
        } catch (error) {
            console.error("Failed to update fragment selection:", error);
        } finally {
            setUpdating(null);
        }
    }, [keyboard, fragmentService, applyLocalSelections, isConnected, queue, getKeyboardSnapshot]);

    const resolvePresetFragmentName = useCallback((instance: FragmentInstance, preset: FragmentPreset): string | undefined => {
        const options = instance.fragment_options ?? [];
        if (options.length === 0) return undefined;

        const isThumb = instance.id.toLowerCase().includes("thumb");
        const findByName = (pattern: RegExp) => options.find((opt) => pattern.test(opt.fragment))?.fragment;
        const findByMatrixSize = (size: number) => options.find((opt) => opt.matrix_map.length === size)?.fragment;
        const fallback = options.find((opt) => opt.default)?.fragment ?? options[0]?.fragment;

        if (isThumb) {
            return (
                findByName(/thumb/i) ||
                findByName(/finger[_-]?6|6key|_6\b|6\b/i) ||
                findByMatrixSize(6) ||
                fallback
            );
        }

        if (wantsSixKey(instance.id, preset)) {
            return (
                findByName(/finger[_-]?6|6key|_6\b|6\b/i) ||
                findByMatrixSize(6) ||
                fallback
            );
        }

        return (
            findByName(/finger[_-]?5|5key|_5\b|5\b/i) ||
            findByMatrixSize(5) ||
            fallback
        );
    }, []);

    const handleApplyPreset = useCallback(async (preset: FragmentPreset) => {
        if (!keyboard) return;

        const instances = fragmentService.getSelectableInstances(keyboard);
        const updates: Array<{
            idx: number;
            instance: FragmentInstance;
            fragmentName: string;
        }> = [];

        for (const { idx, instance } of instances) {
            const hwFragmentId = safeMapGet(keyboard.fragmentState?.hwDetection, idx);
            const hwDetected = hwFragmentId !== undefined && hwFragmentId !== 0xff;
            const allowOverride = instance.allow_override !== false;
            if (hwDetected && !allowOverride) {
                continue;
            }

            const targetFragment = resolvePresetFragmentName(instance, preset);
            if (!targetFragment) continue;

            const currentFragment = fragmentService.resolveFragment(keyboard, idx, instance);
            if (currentFragment === targetFragment) continue;

            updates.push({ idx, instance, fragmentName: targetFragment });
        }

        if (updates.length === 0) return;

        setUpdating("bulk");

        applyLocalSelections(
            keyboard,
            updates.map(({ instance, fragmentName }) => ({ instanceId: instance.id, fragmentName }))
        );
        if (isConnected) for (const update of updates) {
            const optionIdx = fragmentService.getOptionIndex(update.instance, update.fragmentName);
            await queue(`Hardware position ${update.instance.id}`, async () => {
                if (!await keyboardService.updateFragmentSelection(getKeyboardSnapshot() ?? keyboard, update.idx, optionIdx)) {
                    throw new Error(`Keyboard rejected the selection for ${update.instance.id}`);
                }
                await keyboardService.saveSvil();
            }, {writeKey: `fragment:${update.idx}`});
        }

        setUpdating(null);
    }, [keyboard, fragmentService, resolvePresetFragmentName, applyLocalSelections, isConnected, queue, getKeyboardSnapshot]);

    // Check if keyboard has fragments
    if (!keyboard || !fragmentService.hasFragments(keyboard)) {
        return (
            <section className="space-y-3 flex flex-col pt-0">
                <div className="text-center text-gray-500 dark:text-neutral-400 mt-10">
                    No fragment configuration available for this keyboard.
                </div>
            </section>
        );
    }

    const selectableInstances = fragmentService.getSelectableInstances(keyboard);

    if (selectableInstances.length === 0) {
        return (
            <section className="space-y-3 flex flex-col pt-0">
                <div className="text-center text-gray-500 dark:text-neutral-400 mt-10">
                    No selectable fragment positions available.
                </div>
            </section>
        );
    }

    const getSide = (instanceId: string): "left" | "right" | "other" => {
        if (instanceId.startsWith("left")) return "left";
        if (instanceId.startsWith("right")) return "right";
        return "other";
    };

    const formatInstanceLabel = (displayName: string): string => {
        return displayName.replace(/^Left\s+/i, "").replace(/^Right\s+/i, "");
    };

    const leftInstances = selectableInstances.filter(({ instance }) => getSide(instance.id) === "left");
    const rightInstances = selectableInstances.filter(({ instance }) => getSide(instance.id) === "right");
    const otherInstances = selectableInstances.filter(({ instance }) => getSide(instance.id) === "other");

    // Pointing slots follow hardware detection only: shown, never selectable.
    const pointingInstances = (keyboard.composition?.instances ?? [])
        .map((instance, idx) => ({ idx, instance }))
        .filter(({ instance }) => isWidgetInstance(keyboard, instance));
    const renderPointingRows = (side: "left" | "right") => pointingInstances
        .filter(({ instance }) => getSide(instance.id) === side)
        .map(({ idx, instance }) => {
            const hwFragmentId = safeMapGet(keyboard.fragmentState?.hwDetection, idx);
            const hwDetected = hwFragmentId !== undefined && hwFragmentId !== 0xff;
            const hwFragmentName = hwDetected ? fragmentService.getFragmentNameById(keyboard, hwFragmentId) : undefined;
            const value = hwFragmentName ? fragmentService.getFragmentDisplayName(keyboard, hwFragmentName) : "Detecting";
            const label = formatInstanceLabel(fragmentService.getInstanceDisplayName(instance.id));
            return (
                <div
                    key={instance.id}
                    data-pointing-instance={instance.id}
                    className="flex flex-row flex-wrap items-center p-3 gap-3 panel-layer-item group/item rounded-md"
                >
                    <div className="flex flex-col items-start gap-1 shrink-0 w-[100px]">
                        <Label className="text-sm font-medium">{label}</Label>
                        {hwFragmentName && <span className="text-xs text-amber-600 dark:text-amber-400">Locked</span>}
                    </div>
                    <div
                        role="status"
                        aria-label={fragmentService.getInstanceDisplayName(instance.id)}
                        className="flex-1 basis-36 min-w-0 rounded-md border border-input px-3 py-2 text-sm opacity-70"
                    >
                        {value}
                    </div>
                </div>
            );
        });

    return (
        <div className="flex flex-col">
            <div className="flex flex-col px-4 gap-3 py-2">
                <div className="flex flex-wrap gap-2">
                    {PRESETS.map(({ preset, label, description }) => (
                        <Button
                            key={preset}
                            type="button"
                            variant="default"
                            size="sm"
                            className="rounded-full px-4 bg-kb-active text-kb-active-fg hover:bg-gray-800 dark:hover:bg-neutral-300"
                            aria-label={description}
                            title={description}
                            onClick={() => handleApplyPreset(preset)}
                            disabled={updating !== null}
                        >
                            {label}
                        </Button>
                    ))}
                </div>
                {leftInstances.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <div className="text-sm font-semibold text-kb-ink">Left</div>
                        {leftInstances.map(({ idx, instance }) => {
                            const options = fragmentService.getFragmentOptions(instance);
                            const currentFragment = fragmentService.resolveFragment(keyboard, idx, instance);

                            // Get hardware detection info (safe access handles Map or object)
                            const hwFragmentId = safeMapGet(keyboard.fragmentState?.hwDetection, idx);
                            const hwDetected = hwFragmentId !== undefined && hwFragmentId !== 0xff;
                            const hwFragmentName = hwDetected
                                ? fragmentService.getFragmentNameById(keyboard, hwFragmentId)
                                : undefined;

                            const allowOverride = instance.allow_override !== false;
                            const isLocked = hwDetected && !allowOverride;
                            const isUpdating = updating === idx || updating === "bulk";

                            // Build label with detection info
                            const instanceDisplayName = formatInstanceLabel(fragmentService.getInstanceDisplayName(instance.id));
                            let statusText = "";
                            if (hwDetected && hwFragmentName) {
                                const hwDisplayName = fragmentService.getFragmentDisplayName(keyboard, hwFragmentName);
                                statusText = isLocked
                                    ? `Locked: ${hwDisplayName}`
                                    : `Detected: ${hwDisplayName}`;
                            }

                            return (
                                <div
                                    key={instance.id}
                                    className="flex flex-row flex-wrap items-center p-3 gap-3 panel-layer-item group/item rounded-md"
                                >
                                    <div className="flex flex-col items-start gap-1 shrink-0 w-[100px]">
                                        <Label className="text-sm font-medium">
                                            {instanceDisplayName}
                                        </Label>
                                        {statusText && (
                                            <span className={`text-xs ${isLocked ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`}>
                                                {statusText}
                                            </span>
                                        )}
                                    </div>

                                    <Select
                                        value={currentFragment}
                                        onValueChange={(value) => handleSelectionChange(idx, instance, value)}
                                        disabled={isLocked || isUpdating}
                                    >
                                        <SelectTrigger
                                            aria-label={fragmentService.getInstanceDisplayName(instance.id)}
                                            aria-description={statusText || undefined}
                                            className="flex-1 basis-36 min-w-0">
                                            <SelectValue placeholder="Select fragment" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {options.map((fragmentName) => (
                                                <SelectItem key={fragmentName} value={fragmentName}>
                                                    {fragmentService.getFragmentDisplayName(keyboard, fragmentName)}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            );
                        })}
                        {renderPointingRows("left")}
                    </div>
                )}
                {rightInstances.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <div className="text-sm font-semibold text-kb-ink">Right</div>
                        {rightInstances.map(({ idx, instance }) => {
                            const options = fragmentService.getFragmentOptions(instance);
                            const currentFragment = fragmentService.resolveFragment(keyboard, idx, instance);

                            // Get hardware detection info (safe access handles Map or object)
                            const hwFragmentId = safeMapGet(keyboard.fragmentState?.hwDetection, idx);
                            const hwDetected = hwFragmentId !== undefined && hwFragmentId !== 0xff;
                            const hwFragmentName = hwDetected
                                ? fragmentService.getFragmentNameById(keyboard, hwFragmentId)
                                : undefined;

                            const allowOverride = instance.allow_override !== false;
                            const isLocked = hwDetected && !allowOverride;
                            const isUpdating = updating === idx || updating === "bulk";

                            // Build label with detection info
                            const instanceDisplayName = formatInstanceLabel(fragmentService.getInstanceDisplayName(instance.id));
                            let statusText = "";
                            if (hwDetected && hwFragmentName) {
                                const hwDisplayName = fragmentService.getFragmentDisplayName(keyboard, hwFragmentName);
                                statusText = isLocked
                                    ? `Locked: ${hwDisplayName}`
                                    : `Detected: ${hwDisplayName}`;
                            }

                            return (
                                <div
                                    key={instance.id}
                                    className="flex flex-row flex-wrap items-center p-3 gap-3 panel-layer-item group/item rounded-md"
                                >
                                    <div className="flex flex-col items-start gap-1 shrink-0 w-[100px]">
                                        <Label className="text-sm font-medium">
                                            {instanceDisplayName}
                                        </Label>
                                        {statusText && (
                                            <span className={`text-xs ${isLocked ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`}>
                                                {statusText}
                                            </span>
                                        )}
                                    </div>

                                    <Select
                                        value={currentFragment}
                                        onValueChange={(value) => handleSelectionChange(idx, instance, value)}
                                        disabled={isLocked || isUpdating}
                                    >
                                        <SelectTrigger
                                            aria-label={fragmentService.getInstanceDisplayName(instance.id)}
                                            aria-description={statusText || undefined}
                                            className="flex-1 basis-36 min-w-0">
                                            <SelectValue placeholder="Select fragment" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {options.map((fragmentName) => (
                                                <SelectItem key={fragmentName} value={fragmentName}>
                                                    {fragmentService.getFragmentDisplayName(keyboard, fragmentName)}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            );
                        })}
                        {renderPointingRows("right")}
                    </div>
                )}
                {otherInstances.map(({ idx, instance }) => {
                    const options = fragmentService.getFragmentOptions(instance);
                    const currentFragment = fragmentService.resolveFragment(keyboard, idx, instance);

                    // Get hardware detection info (safe access handles Map or object)
                    const hwFragmentId = safeMapGet(keyboard.fragmentState?.hwDetection, idx);
                    const hwDetected = hwFragmentId !== undefined && hwFragmentId !== 0xff;
                    const hwFragmentName = hwDetected
                        ? fragmentService.getFragmentNameById(keyboard, hwFragmentId)
                        : undefined;

                    const allowOverride = instance.allow_override !== false;
                    const isLocked = hwDetected && !allowOverride;
                    const isUpdating = updating === idx || updating === "bulk";

                    // Build label with detection info
                    const instanceDisplayName = fragmentService.getInstanceDisplayName(instance.id);
                    let statusText = "";
                    if (hwDetected && hwFragmentName) {
                        const hwDisplayName = fragmentService.getFragmentDisplayName(keyboard, hwFragmentName);
                        statusText = isLocked
                            ? `Locked: ${hwDisplayName}`
                            : `Detected: ${hwDisplayName}`;
                    }

                    return (
                        <div
                            key={instance.id}
                            className="flex flex-row flex-wrap items-center p-3 gap-3 panel-layer-item group/item rounded-md"
                        >
                            <div className="flex flex-col items-start gap-1 shrink-0 w-[100px]">
                                <Label className="text-sm font-medium">
                                    {instanceDisplayName}
                                </Label>
                                {statusText && (
                                    <span className={`text-xs ${isLocked ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`}>
                                        {statusText}
                                    </span>
                                )}
                            </div>

                            <Select
                                value={currentFragment}
                                onValueChange={(value) => handleSelectionChange(idx, instance, value)}
                                disabled={isLocked || isUpdating}
                            >
                                <SelectTrigger
                                            aria-label={fragmentService.getInstanceDisplayName(instance.id)}
                                            aria-description={statusText || undefined}
                                            className="flex-1 basis-36 min-w-0">
                                    <SelectValue placeholder="Select fragment" />
                                </SelectTrigger>
                                <SelectContent>
                                    {options.map((fragmentName) => (
                                        <SelectItem key={fragmentName} value={fragmentName}>
                                            {fragmentService.getFragmentDisplayName(keyboard, fragmentName)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default FragmentsPanel;
