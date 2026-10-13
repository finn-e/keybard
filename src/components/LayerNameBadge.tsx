import { useLayerNames } from "@/hooks/useLayerNames";
import React, { useState, useRef, useEffect } from "react";
import { EllipsisVertical } from "lucide-react";
import Settings2Icon from "@/components/icons/Settings2Icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { useChanges } from "@/contexts/ChangesContext";
import { svalService } from "@/services/sval.service";
import { usbInstance } from "@/services/usb.service";
import { layerColors } from "@/utils/colors";
import { getPresetHsv, hsvToHex, hexToHsv } from "@/utils/color-conversion";

import { cn } from "@/lib/utils";
import { useIsDark } from "@/lib/theme";
import { needsDarkIndicatorOutline } from "@/components/layer3DColors";
import { KEYMAP } from "@/constants/keygen";
import { MATRIX_COLS } from "@/constants/svalboard-layout";
import CustomColorDialog from "@/components/CustomColorDialog";
import { setLayerColorPreview, useLayerColorPreview } from "@/hooks/useLayerColorPreview";
import { PublishLayerDialog } from "@/components/PublishLayerDialog";
import { useLayerClipboardActions } from "@/hooks/useLayerClipboardActions";

interface LayerNameBadgeProps {
    selectedLayer: number;
    /** Position in pixels from top-left of keyboard layout. If omitted, renders relatively. */
    x?: number;
    y?: number;
    className?: string;
    isActive?: boolean;
    onToggleLayerOn?: (layer: number) => void;
    defaultLayerIndex?: number;
    trailingAction?: React.ReactNode;
}

/**
 * Centered layer name badge with color picker.
 * Positioned between thumb clusters in the keyboard layout.
 */
export const LayerNameBadge: React.FC<LayerNameBadgeProps> = ({
    selectedLayer,
    x,
    y,
    className,
    isActive,
    onToggleLayerOn,
    defaultLayerIndex = 0,
    trailingAction,
}) => {
    const { renameLayer, nameError } = useLayerNames();
    const { keyboard, setKeyboard, isConnected, updateKey } = useKeyboard();
    const { copy, paste, clipboardError } = useLayerClipboardActions();
    const { queue } = useChanges();
    const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
    const [isCustomColorOpen, setIsCustomColorOpen] = useState(false);
    // The board's LED brightness (shared by every layer), read when the color dialog opens.
    const [ledBrightness, setLedBrightness] = useState(128);
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState("");
    const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const pickerRef = useRef<HTMLDivElement>(null);
    const colorButtonRef = useRef<HTMLButtonElement>(null);
    const renameButtonRef = useRef<HTMLButtonElement>(null);
    const cancelRename = useRef(false);
    const savingRename = useRef(false);
    const isDark = useIsDark();
    const colorPreview = useLayerColorPreview();
    const restoreRenameFocus = () => requestAnimationFrame(() => renameButtonRef.current?.focus());

    useEffect(() => {
        if (isColorPickerOpen) pickerRef.current?.querySelector<HTMLButtonElement>("[data-color-choice]")?.focus();
    }, [isColorPickerOpen]);

    // Close picker when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
                setIsColorPickerOpen(false);
            }
        };

        if (isColorPickerOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isColorPickerOpen]);

    if (!keyboard) return null;

    const currentLayerColorName = keyboard.cosmetic?.layer_colors?.[selectedLayer] || "green";

    // Get the display color from the preset hex value or custom hex
    const getDisplayColorHex = (): string => {
        if (currentLayerColorName && currentLayerColorName.startsWith("#")) {
            return currentLayerColorName;
        }
        const preset = layerColors.find(c => c.name === currentLayerColorName);
        return preset?.hex || "#099e7c";
    };



    // The saved color seeds the dialog; the swatch shows the color being picked.
    const savedColorHex = getDisplayColorHex();
    const displayColorHex = colorPreview?.layer === selectedLayer ? colorPreview.color : savedColorHex;
    // Dark mode only: a status dot whose colour is too close to the dark page (e.g. a very
    // dark custom colour) gets a thin kb-gray-border outline so it stays visible.
    const showDarkDotOutline = isDark && needsDarkIndicatorOutline(displayColorHex);
    // const hardwareColorHex = getHardwareColorHex();

    const allColors = [...layerColors];
    const isDefaultLayer = selectedLayer === defaultLayerIndex;
    const isLayerActive = !!isActive;
    const showStatusRing = isDefaultLayer || isLayerActive;
    const useInsetDotStyle = isLayerActive && !isDefaultLayer;
    const layerDotTooltipText = isDefaultLayer ? "Default Layer" : "Layer Color";

    const handleStartEditing = () => {
        const currentName = svalService.getLayerName(keyboard, selectedLayer);
        cancelRename.current = false;
        setEditValue(currentName);
        setIsEditing(true);
        setTimeout(() => inputRef.current?.focus(), 0);
    };

    const handleSave = async (restoreFocus = false) => {
        if (cancelRename.current || savingRename.current) return;
        savingRename.current = true;
        try {
            if (await renameLayer(selectedLayer, editValue)) {
                setIsEditing(false);
                if (restoreFocus) restoreRenameFocus();
            }
        } finally { savingRename.current = false; }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            void handleSave(true);
        } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            cancelRename.current = true;
            setIsEditing(false);
            restoreRenameFocus();
        }
    };

    const handleSetColor = async (colorName: string) => {
        if (keyboard) {
            const cosmetic = JSON.parse(JSON.stringify(keyboard.cosmetic || { layer: {}, layer_colors: {} }));
            if (!cosmetic.layer_colors) cosmetic.layer_colors = {};
            cosmetic.layer_colors[selectedLayer.toString()] = colorName;

            const hsv = getPresetHsv(colorName);
            const updatedLayerColors = [...(keyboard.layer_colors || [])];
            updatedLayerColors[selectedLayer] = { hue: hsv.hue, sat: hsv.sat, val: hsv.val };

            setKeyboard({ ...keyboard, cosmetic, layer_colors: updatedLayerColors });

            if (isConnected) {
                await queue(`Layer ${selectedLayer} LED color`, async () => { await usbInstance.setLayerColor(selectedLayer, hsv.hue, hsv.sat); }, { type: "setting", writeKey: `layer-color:${selectedLayer}` });
            }
        }
        setIsColorPickerOpen(false);
        colorButtonRef.current?.focus();
    };

    const handleSetCustomColor = async (
        displayHsv: { hue: number; sat: number; val: number },
        ledHsv: { hue: number; sat: number; val: number }
    ) => {
        if (keyboard) {
            // Convert display HSV to hex and store directly as cosmetic color
            const displayHex = hsvToHex(displayHsv.hue, displayHsv.sat, displayHsv.val);

            const cosmetic = JSON.parse(JSON.stringify(keyboard.cosmetic || { layer: {}, layer_colors: {} }));
            if (!cosmetic.layer_colors) cosmetic.layer_colors = {};
            cosmetic.layer_colors[selectedLayer.toString()] = displayHex;

            // Store LED color as hardware HSV
            const updatedLayerColors = [...(keyboard.layer_colors || [])];
            updatedLayerColors[selectedLayer] = { hue: ledHsv.hue, sat: ledHsv.sat, val: updatedLayerColors[selectedLayer]?.val ?? 255 };

            setKeyboard({ ...keyboard, cosmetic, layer_colors: updatedLayerColors });

            if (isConnected) {
                await queue(`Layer ${selectedLayer} LED color`, async () => { await usbInstance.setLayerColor(selectedLayer, ledHsv.hue, ledHsv.sat); }, { type: "setting", writeKey: `layer-color:${selectedLayer}` });
                setLedBrightness(ledHsv.val);
                await queue("LED brightness", async () => { await usbInstance.setLedBrightness(ledHsv.val); }, { type: "setting", writeKey: "led-brightness" });
            }
        }
    };

    // Live key color preview from the color dialog: shown on the layout, kept out of the keyboard state.
    const handlePreviewDisplayColor = (displayHsv: { hue: number; sat: number; val: number } | null) => {
        setLayerColorPreview(displayHsv && { layer: selectedLayer, color: hsvToHex(displayHsv.hue, displayHsv.sat, displayHsv.val) });
    };

    // Live LED preview from the color dialog: shown on the board, not saved (Apply saves).
    const handlePreviewLedColor = (ledHsv: { hue: number; sat: number; val: number }) => {
        if (!isConnected) return;
        usbInstance.setLayerColor(selectedLayer, ledHsv.hue, ledHsv.sat, false)
            .then(() => usbInstance.setLedBrightness(ledHsv.val, false))
            .catch(() => {});
    };

    // Layer Actions
    const handleCopyLayer = () => copy(selectedLayer);
    const handlePasteLayer = () => { void paste(selectedLayer); };

    const batchWipeKeys = (targetKeycode: number, filterFn: (currentValue: number) => boolean) => {
        if (!keyboard || !keyboard.keymap) return;
        const matrixCols = keyboard.cols || MATRIX_COLS;
        const currentLayerKeymap = keyboard.keymap[selectedLayer] || [];
        const updatedKeyboard = JSON.parse(JSON.stringify(keyboard));
        let hasChanges = false;

        for (let r = 0; r < keyboard.rows; r++) {
            for (let c = 0; c < keyboard.cols; c++) {
                const idx = r * matrixCols + c;
                const currentValue = currentLayerKeymap[idx] as number;
                if (filterFn(currentValue)) {
                    hasChanges = true;
                    updatedKeyboard.keymap[selectedLayer][idx] = targetKeycode;
                    const row = r;
                    const col = c;
                    const previousValue = currentValue;
                    queue(
                        `key_${selectedLayer}_${row}_${col}`,
                        async () => updateKey(selectedLayer, row, col, targetKeycode),
                        { type: "key", writeKey: `key:${selectedLayer}:${row}:${col}`, layer: selectedLayer, row, col, keycode: targetKeycode, previousValue }
                    );
                }
            }
        }
        if (hasChanges) setKeyboard(updatedKeyboard);
    };

    const handleWipeDisable = () => {
        const KC_NO = 0;
        batchWipeKeys(KC_NO, (v) => v !== KC_NO);
    };
    const handleWipeTransparent = () => {
        const KC_TRNS = KEYMAP['KC_TRNS']?.code ?? 1;
        batchWipeKeys(KC_TRNS, (v) => v !== KC_TRNS);
    };
    const handleChangeDisabledToTransparent = () => {
        const KC_TRNS = KEYMAP['KC_TRNS']?.code ?? 1;
        const KC_NO = 0;
        batchWipeKeys(KC_TRNS, (v) => v === KC_NO);
    };
    const handleChangeTransparentToDisabled = () => {
        const KC_TRNS = KEYMAP['KC_TRNS']?.code ?? 1;
        const KC_NO = 0;
        batchWipeKeys(KC_NO, (v) => v === KC_TRNS);
    };

    const layerKeymap = keyboard?.keymap?.[selectedLayer] || [];
    const hasBlankKeys = layerKeymap.some((v) => v === 0);
    const hasTransparentKeys = layerKeymap.some((v) => v === (KEYMAP['KC_TRNS']?.code ?? 1));

    const style: React.CSSProperties = (x !== undefined && y !== undefined) ? {
        left: `${x}px`,
        top: `${y}px`,
        transform: "translate(-50%, -50%)",
        position: 'absolute',
        marginLeft: "24px",
    } : {
        position: 'relative',
        marginLeft: "24px",
    };

    return (
        <>
            {clipboardError && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{clipboardError}</p>}
            {nameError && <div role="alert" className="text-red-600 dark:text-red-400">{nameError}</div>}
            <div
                className={cn(
                    "group/layer-badge flex items-center gap-2 z-50 transition-[margin] duration-150",
                    className
                )}
                style={style}
                onClick={(e) => e.stopPropagation()}
            >
                <div
                    className="relative"
                    ref={pickerRef}
                    onKeyDown={(e) => {
                        if (e.key === "Escape" && isColorPickerOpen) {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsColorPickerOpen(false);
                            colorButtonRef.current?.focus();
                        }
                    }}
                    onBlur={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsColorPickerOpen(false);
                    }}
                >
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                ref={colorButtonRef}
                                aria-label={`Change color for layer ${selectedLayer}`}
                                aria-expanded={isColorPickerOpen}
                                className={cn(
                                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 relative w-7 h-7 shrink-0 p-0 border-0 rounded-full cursor-pointer transition-transform hover:scale-110",
                                    isColorPickerOpen && "z-30"
                                )}
                                onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    onToggleLayerOn?.(selectedLayer);
                                }}
                                onClick={() => setIsColorPickerOpen(!isColorPickerOpen)}
                            >
                                <svg viewBox="0 0 28 28" className="absolute inset-0 block h-full w-full" aria-hidden="true">
                                    {showDarkDotOutline && <circle cx="14" cy="14" r={showStatusRing ? 13.5 : 9.5} fill="none" stroke="var(--kb-gray-border)" strokeWidth="1" />}
                                    {showStatusRing && <circle cx="14" cy="14" r="13" fill="none" stroke={displayColorHex} strokeWidth="2" />}
                                    <circle cx="14" cy="14" r={useInsetDotStyle ? 6 : 9}
                                        fill={useInsetDotStyle ? "none" : displayColorHex}
                                        stroke={useInsetDotStyle ? displayColorHex : "none"}
                                        strokeWidth={useInsetDotStyle ? 6 : 0} />
                                </svg>
                                {isColorPickerOpen && (
                                    <span className="absolute -inset-[3px] rounded-full border-2 border-kb-ink pointer-events-none z-20" />
                                )}
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">{layerDotTooltipText}</TooltipContent>
                    </Tooltip>

                    {isColorPickerOpen && (
                        <div className="absolute top-[calc(100%+4px)] left-1/2 -translate-x-1/2 z-[100] bg-kb-popover rounded-3xl p-2 flex flex-col items-center gap-2 shadow-xl border border-gray-200 dark:border-neutral-700 min-w-[40px]">
                            {allColors.map((color) => (
                                <button
                                    key={color.name}
                                    type="button"
                                    data-color-choice
                                    aria-label={color.name}
                                    aria-pressed={currentLayerColorName === color.name}
                                    className={cn(
                                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 w-5 h-5 rounded-full transition-all hover:scale-110 border-2 dark:ring-1 dark:ring-kb-gray-border",
                                        currentLayerColorName === color.name
                                            ? "border-kb-ink dark:ring-2 dark:ring-kb-ink dark:ring-offset-2 dark:ring-offset-kb-popover"
                                            : "border-transparent"
                                    )}
                                    style={{ backgroundColor: color.hex }}
                                    onClick={() => handleSetColor(color.name)}
                                />
                            ))}
                            {/* Custom color button - always available, hardware write only happens when connected */}
                            <button
                                type="button"
                                aria-label="Custom layer color"
                                className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 w-5 h-5 rounded-full transition-all hover:scale-110 border-2 border-transparent bg-gray-200 dark:bg-neutral-700 flex items-center justify-center"
                                onClick={async () => {
                                    setIsColorPickerOpen(false);
                                    if (isConnected) {
                                        try { setLedBrightness(await usbInstance.getLedBrightness()); } catch { /* keep the last known value */ }
                                    }
                                    setIsCustomColorOpen(true);
                                }}
                            >
                                <Settings2Icon className="w-3 h-3 text-gray-600 dark:text-neutral-300" />
                            </button>
                        </div>
                    )}
                </div>

                {/* Layer Name */}
                {isEditing ? (
                    <Input
                        ref={inputRef}
                        aria-label={`Rename layer ${selectedLayer}`}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => void handleSave()}
                        onKeyDown={handleKeyDown}
                        className="h-6 py-0 px-2 text-xs font-bold border border-kb-ink rounded w-24 bg-kb-surface"
                        autoFocus
                    />
                ) : (
                    <button
                        type="button"
                        ref={renameButtonRef}
                        aria-label={`Rename layer ${selectedLayer}: ${svalService.getLayerName(keyboard, selectedLayer)}`}
                        className={cn(
                            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 rounded text-base font-medium text-kb-ink cursor-pointer hover:underline whitespace-nowrap select-none"
                        )}
                        onClick={handleStartEditing}
                        title="Click to rename layer"
                    >
                        {svalService.getLayerName(keyboard, selectedLayer)}
                    </button>
                )}

                {/* Layer Actions Menu */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button type="button" aria-label={`Actions for layer ${selectedLayer}`} className="focus-visible:ring-2 focus-visible:ring-kb-ink hover:bg-black/10 dark:hover:bg-white/10 p-1 rounded-full transition-colors flex items-center justify-center text-kb-ink outline-none">
                            <EllipsisVertical size={16} strokeWidth={1.5} />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56 z-[1000]">
                        <DropdownMenuItem onSelect={handleCopyLayer}>
                            Copy Layer
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={handlePasteLayer}>
                            Paste Layer
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={handleWipeDisable}>
                            Make All Blank
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={handleWipeTransparent}>
                            Make All Transparent
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={handleChangeDisabledToTransparent} disabled={!hasBlankKeys}>
                            Switch Blank to Transparent
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={handleChangeTransparentToDisabled} disabled={!hasTransparentKeys}>
                            Switch Transparent to Blank
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setIsPublishDialogOpen(true)}>
                            Save Layer...
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                {trailingAction}

                {/* LED Color Indicator - Hidden per user request */}
                {/* <Tooltip>
                    <TooltipTrigger asChild>
                        <div
                            className="w-2.5 h-2.5 rounded-full shadow-sm border border-gray-300"
                            style={{ backgroundColor: hardwareColorHex }}
                        />
                    </TooltipTrigger>
                    <TooltipContent side="top">LED Color</TooltipContent>
                </Tooltip> */}

                {/* Publish Layer Dialog */}
                <PublishLayerDialog
                    isOpen={isPublishDialogOpen}
                    onClose={() => setIsPublishDialogOpen(false)}
                    layerIndex={selectedLayer}
                />
            </div>

            {/* Custom Color Dialog */}
            {/* Custom Color Dialog */}
            <CustomColorDialog
                open={isCustomColorOpen}
                onOpenChange={setIsCustomColorOpen}
                onCloseAutoFocus={(event) => { event.preventDefault(); colorButtonRef.current?.focus(); }}
                // LED Color (Hardware)
                initialLedHue={keyboard.layer_colors?.[selectedLayer]?.hue ?? 85}
                initialLedSat={keyboard.layer_colors?.[selectedLayer]?.sat ?? 255}
                initialLedVal={ledBrightness}
                // Display Color (UI) - Convert current display hex to HSV
                initialDisplayHue={hexToHsv(savedColorHex).hue}
                initialDisplaySat={hexToHsv(savedColorHex).sat}
                initialDisplayVal={hexToHsv(savedColorHex).val}
                onApply={handleSetCustomColor}
                onPreviewLed={handlePreviewLedColor}
                onPreviewDisplay={handlePreviewDisplayColor}
                layerName={svalService.getLayerName(keyboard, selectedLayer)}
            />
        </>
    );
};
