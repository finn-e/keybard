import { useState, useEffect, useRef } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { hsvToHex, hexToHsv } from "@/utils/color-conversion";
import { cn } from "@/lib/utils";

interface CustomColorDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    // LED color initial values (hardware HSV)
    initialLedHue?: number;
    initialLedSat?: number;
    initialLedVal?: number;
    // Display color initial values (for UI)
    initialDisplayHue?: number;
    initialDisplaySat?: number;
    initialDisplayVal?: number;
    // Callback with both colors
    onApply: (
        displayHsv: { hue: number; sat: number; val: number },
        ledHsv: { hue: number; sat: number; val: number }
    ) => void;
    // Shows an LED color on the board while it's being picked (not saved).
    // Called at most every PREVIEW_INTERVAL_MS, and with the initial color
    // again if the dialog closes without Apply.
    onPreviewLed?: (ledHsv: Hsv) => void;
    // Shows the key color on the layout while it's being picked; null ends the
    // preview (on Apply, Cancel or close), leaving the saved color.
    onPreviewDisplay?: (displayHsv: Hsv | null) => void;
    layerName?: string;
    onCloseAutoFocus?: (event: Event) => void;
}

type ColorTarget = 'display' | 'led';
type Hsv = { hue: number; sat: number; val: number };

/** Live LED previews go out at most this often (10 Hz). */
export const PREVIEW_INTERVAL_MS = 100;

/**
 * Dialog for selecting custom HSV colors for layer lights
 * Supports independent Display and LED color selection
 * Uses 0-255 range for all HSV values (QMK/Svalboard format)
 */
const CustomColorDialog = ({
    open,
    onOpenChange,
    onCloseAutoFocus,
    initialLedHue = 85,
    initialLedSat = 255,
    initialLedVal = 200,
    initialDisplayHue = 85,
    initialDisplaySat = 255,
    initialDisplayVal = 200,
    onApply,
    onPreviewLed,
    onPreviewDisplay,
    layerName,
}: CustomColorDialogProps) => {
    // Display color state
    const [displayHue, setDisplayHue] = useState(initialDisplayHue);
    const [displaySat, setDisplaySat] = useState(initialDisplaySat);
    const [displayVal, setDisplayVal] = useState(initialDisplayVal);

    // LED color state
    const [ledHue, setLedHue] = useState(initialLedHue);
    const [ledSat, setLedSat] = useState(initialLedSat);
    const [ledVal, setLedVal] = useState(initialLedVal);

    // Which color is being edited
    const [activeTarget, setActiveTarget] = useState<ColorTarget>('led');

    // Hex editing state
    const [isEditingHex, setIsEditingHex] = useState(false);
    const [hexInput, setHexInput] = useState('');
    const hexInputRef = useRef<HTMLInputElement>(null);
    const hexButtonRef = useRef<HTMLButtonElement>(null);
    const cancelHex = useRef(false);
    const hexStart = useRef<Hsv | null>(null);

    // Live LED preview, throttled; `changed` means the board may differ from the initial color.
    const preview = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null; pending: Hsv | null; changed: boolean }>(
        { last: 0, timer: null, pending: null, changed: false });
    const onPreviewRef = useRef(onPreviewLed);
    onPreviewRef.current = onPreviewLed;
    const onPreviewDisplayRef = useRef(onPreviewDisplay);
    onPreviewDisplayRef.current = onPreviewDisplay;

    const flushPreview = () => {
        const p = preview.current;
        p.timer = null;
        if (!p.pending) return;
        p.last = Date.now();
        onPreviewRef.current?.(p.pending);
        p.pending = null;
    };
    const previewLed = (hsv: Hsv) => {
        const p = preview.current;
        if (!onPreviewRef.current) return;
        p.pending = hsv;
        p.changed = true;
        if (!p.timer) p.timer = setTimeout(flushPreview, Math.max(0, PREVIEW_INTERVAL_MS - (Date.now() - p.last)));
    };
    const stopPreview = () => {
        const p = preview.current;
        if (p.timer) clearTimeout(p.timer);
        p.timer = null;
        p.pending = null;
    };
    useEffect(() => () => {
        stopPreview();
        onPreviewDisplayRef.current?.(null);
    }, []);

    // Reset to initial values when dialog opens
    useEffect(() => {
        if (open) {
            setDisplayHue(initialDisplayHue);
            setDisplaySat(initialDisplaySat);
            setDisplayVal(initialDisplayVal);
            setLedHue(initialLedHue);
            setLedSat(initialLedSat);
            setLedVal(initialLedVal);
            setActiveTarget('led');
            setIsEditingHex(false);
            preview.current.changed = false;
        }
    }, [open, initialDisplayHue, initialDisplaySat, initialDisplayVal, initialLedHue, initialLedSat, initialLedVal]);

    // Get active color values
    const getActiveHsv = () => {
        if (activeTarget === 'display') {
            return { hue: displayHue, sat: displaySat, val: displayVal };
        }
        return { hue: ledHue, sat: ledSat, val: ledVal };
    };

    // Set active color values; LED changes are shown on the board as they happen
    const setActiveHsv = (hsv: Hsv) => {
        if (activeTarget === 'display') {
            setDisplayHue(hsv.hue);
            setDisplaySat(hsv.sat);
            setDisplayVal(hsv.val);
            onPreviewDisplay?.(hsv);
            return;
        }
        setLedHue(hsv.hue);
        setLedSat(hsv.sat);
        setLedVal(hsv.val);
        if (hsv.hue !== ledHue || hsv.sat !== ledSat || hsv.val !== ledVal) previewLed(hsv);
    };
    const setActiveHue = (v: number) => setActiveHsv({ ...getActiveHsv(), hue: v });
    const setActiveSat = (v: number) => setActiveHsv({ ...getActiveHsv(), sat: v });
    const setActiveVal = (v: number) => setActiveHsv({ ...getActiveHsv(), val: v });

    const activeHsv = getActiveHsv();
    const displayColor = hsvToHex(displayHue, displaySat, displayVal);
    const ledColor = hsvToHex(ledHue, ledSat, ledVal);
    const activeColor = hsvToHex(activeHsv.hue, activeHsv.sat, activeHsv.val);

    const handleOpenChange = (next: boolean) => {
        if (!next) {
            stopPreview();
            onPreviewDisplay?.(null);
            // Closed without Apply: put the board's LEDs back.
            if (preview.current.changed) {
                preview.current.changed = false;
                onPreviewRef.current?.({ hue: initialLedHue, sat: initialLedSat, val: initialLedVal });
            }
        }
        onOpenChange(next);
    };

    const handleApply = () => {
        stopPreview();
        preview.current.changed = false;
        onApply(
            { hue: displayHue, sat: displaySat, val: displayVal },
            { hue: ledHue, sat: ledSat, val: ledVal }
        );
        onPreviewDisplay?.(null);
        onOpenChange(false);
    };

    // Handle hex input
    const startEditingHex = () => {
        cancelHex.current = false;
        setHexInput(activeColor);
        hexStart.current = activeHsv;
        setIsEditingHex(true);
        setTimeout(() => hexInputRef.current?.select(), 0);
    };

    const parseHex = (text: string): Hsv | null => {
        let hex = text.trim();
        if (!hex.startsWith('#')) hex = '#' + hex;
        return /^#[0-9A-Fa-f]{6}$/.test(hex) ? hexToHsv(hex) : null;
    };

    // A complete hex code takes effect while typing; Escape restores the color from before editing.
    const handleHexChange = (text: string) => {
        setHexInput(text);
        const hsv = parseHex(text);
        if (hsv) setActiveHsv(hsv);
    };

    const cancelHexInput = () => {
        cancelHex.current = true;
        setIsEditingHex(false);
        if (hexStart.current) setActiveHsv(hexStart.current);
    };

    const applyHexInput = () => {
        if (cancelHex.current) return;
        setIsEditingHex(false);
        const hsv = parseHex(hexInput);
        if (hsv) setActiveHsv(hsv);
    };

    const handleHexKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === 'Enter') applyHexInput();
            else cancelHexInput();
            requestAnimationFrame(() => hexButtonRef.current?.focus());
        }
    };

    // Generate hue gradient for the slider track
    const hueGradient = `linear-gradient(to right,
        hsl(0, 100%, 50%),
        hsl(60, 100%, 50%),
        hsl(120, 100%, 50%),
        hsl(180, 100%, 50%),
        hsl(240, 100%, 50%),
        hsl(300, 100%, 50%),
        hsl(360, 100%, 50%)
    )`;

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-[400px]" onCloseAutoFocus={onCloseAutoFocus}
                onEscapeKeyDown={(event) => {
                    if (isEditingHex) {
                        event.preventDefault();
                        cancelHexInput();
                        requestAnimationFrame(() => hexButtonRef.current?.focus());
                    }
                }}>
                <DialogHeader>
                    <DialogTitle>
                        {layerName ? `Colors for ${layerName}` : "Colors"}
                    </DialogTitle>
                    <DialogDescription className="sr-only">Choose an LED or key color, then adjust its hue, saturation, and brightness.</DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                    {/* Color Preview Section */}
                    <div className="flex items-center justify-start gap-8">
                        {/* LED Color Circle */}
                        <button
                            type="button"
                            aria-pressed={activeTarget === 'led'}
                            className="flex items-center gap-3 cursor-pointer group rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
                            onClick={() => setActiveTarget('led')}
                        >
                            <div
                                className={cn(
                                    "w-8 h-8 rounded-full transition-all",
                                    activeTarget === 'led' ? "" : "group-hover:scale-105"
                                )}
                                style={{
                                    backgroundColor: ledColor,
                                    boxShadow: activeTarget === 'led'
                                        ? `0 0 0 4px var(--kb-ink), 0 0 20px ${ledColor}80`
                                        : `0 0 0 4px transparent`
                                }}
                            />
                            <span className={cn(
                                "text-sm font-semibold transition-colors",
                                activeTarget === 'led' ? "text-kb-ink" : "text-kb-ink/60 group-hover:text-kb-ink"
                            )}>
                                LED color
                            </span>
                        </button>

                        {/* Display Color Key Shape */}
                        <button
                            type="button"
                            aria-pressed={activeTarget === 'display'}
                            className="flex items-center gap-3 cursor-pointer group rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
                            onClick={() => setActiveTarget('display')}
                        >
                            <div
                                className={cn(
                                    "w-16 h-16 rounded-lg transition-all",
                                    activeTarget === 'display' ? "" : "group-hover:scale-105"
                                )}
                                style={{
                                    backgroundColor: displayColor,
                                    boxShadow: activeTarget === 'display'
                                        ? `0 0 0 4px var(--kb-ink), 0 0 20px ${displayColor}80`
                                        : `0 0 0 4px transparent`
                                }}
                            />
                            <span className={cn(
                                "text-sm font-semibold transition-colors",
                                activeTarget === 'display' ? "text-kb-ink" : "text-kb-ink/60 group-hover:text-kb-ink"
                            )}>
                                Key color
                            </span>
                        </button>
                    </div>

                    {/* Hue Slider */}
                    <div className="grid gap-2">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="hue">Hue</Label>
                            <span className="text-sm text-muted-foreground w-12 text-right">{activeHsv.hue}</span>
                        </div>
                        <div
                            className="relative rounded-full h-3 overflow-hidden"
                            style={{ background: hueGradient }}
                        >
                            <Slider
                                id="hue"
                                aria-label="Hue"
                                min={0}
                                max={255}
                                step={1}
                                value={[activeHsv.hue]}
                                onValueChange={([v]) => setActiveHue(v)}
                                className="absolute inset-0 [&_[data-slot=slider-track]]:bg-transparent [&_[data-slot=slider-range]]:bg-transparent"
                            />
                        </div>
                    </div>

                    {/* Saturation Slider */}
                    <div className="grid gap-2">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="sat">Saturation</Label>
                            <span className="text-sm text-muted-foreground w-12 text-right">{activeHsv.sat}</span>
                        </div>
                        <div
                            className="relative rounded-full h-3 overflow-hidden"
                            style={{
                                background: `linear-gradient(to right,
                                    ${hsvToHex(activeHsv.hue, 0, activeHsv.val)},
                                    ${hsvToHex(activeHsv.hue, 255, activeHsv.val)}
                                )`
                            }}
                        >
                            <Slider
                                id="sat"
                                aria-label="Saturation"
                                min={0}
                                max={255}
                                step={1}
                                value={[activeHsv.sat]}
                                onValueChange={([v]) => setActiveSat(v)}
                                className="absolute inset-0 [&_[data-slot=slider-track]]:bg-transparent [&_[data-slot=slider-range]]:bg-transparent"
                            />
                        </div>
                    </div>

                    {/* Value/Brightness Slider */}
                    <div className="grid gap-2">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="val">Brightness</Label>
                            <span className="text-sm text-muted-foreground w-12 text-right">{activeHsv.val}</span>
                        </div>
                        <div
                            className="relative rounded-full h-3 overflow-hidden"
                            style={{
                                background: `linear-gradient(to right,
                                    ${hsvToHex(activeHsv.hue, activeHsv.sat, 0)},
                                    ${hsvToHex(activeHsv.hue, activeHsv.sat, 255)}
                                )`
                            }}
                        >
                            <Slider
                                id="val"
                                aria-label="Brightness"
                                min={0}
                                max={255}
                                step={1}
                                value={[activeHsv.val]}
                                onValueChange={([v]) => setActiveVal(v)}
                                className="absolute inset-0 [&_[data-slot=slider-track]]:bg-transparent [&_[data-slot=slider-range]]:bg-transparent"
                            />
                        </div>
                        {activeTarget === 'led' && (
                            <p className="text-xs text-muted-foreground">LED brightness applies to every layer, like the brightness keys.</p>
                        )}
                    </div>

                    {/* Hex value display / input */}
                    <div className="grid gap-2">
                        <Label htmlFor="hex">Hex</Label>
                        <div className="flex items-center justify-start">
                            {isEditingHex ? (
                                <Input
                                    ref={hexInputRef}
                                    aria-label="Hex color"
                                    value={hexInput}
                                    onChange={(e) => handleHexChange(e.target.value)}
                                    onBlur={applyHexInput}
                                    onKeyDown={handleHexKeyDown}
                                    className="w-28 text-left text-sm font-mono"
                                    maxLength={7}
                                    autoFocus
                                />
                            ) : (
                                <button
                                    type="button"
                                    ref={hexButtonRef}
                                    aria-label={`Edit hex color ${activeColor.toUpperCase()}`}
                                    onClick={startEditingHex}
                                    className="text-sm text-foreground hover:underline cursor-pointer font-mono text-left"
                                >
                                    {activeColor.toUpperCase()}
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <DialogFooter className="gap-3 sm:gap-4">
                    <Button
                        variant="outline"
                        onClick={() => handleOpenChange(false)}
                        className="rounded-full px-8 py-5 text-base border-slate-300 dark:border-neutral-500 hover:bg-slate-50 dark:hover:bg-neutral-800 transition-colors"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleApply}
                        className="rounded-full px-8 py-5 text-base font-bold transition-colors"
                    >
                        Apply
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default CustomColorDialog;
