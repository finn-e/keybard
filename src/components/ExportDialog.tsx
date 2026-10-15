import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { cn } from "@/lib/utils";
import { fileService } from "@/services/file.service";
import { printService } from "@/services/print.service";

export type ExportFormat = "svil" | "vil" | "print";

const FORMATS: Array<{ value: ExportFormat; label: string; description: string }> = [
    { value: "svil", label: ".svil", description: "Everything on the board, including names, colors and cluster choices. Recommended." },
    { value: "vil", label: ".vil", description: "For Vial. Leaves out Svalboard settings, names, colors and cluster choices." },
    { value: "print", label: "Print", description: "Every layer that has keys on it, as a page to print or save as a PDF." },
];

interface ExportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/**
 * The one Export dialog: every file that leaves the board, Print included.
 * Settings > Backups and files and the toolbar's Export icon both open it.
 */
export default function ExportDialog({ open, onOpenChange }: ExportDialogProps) {
    const { keyboard } = useKeyboard();
    const [format, setFormat] = useState<ExportFormat>("svil");
    const [includeMacros, setIncludeMacros] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) setError(null);
    }, [open]);

    const printableLayers = keyboard ? printService.getNonEmptyLayers(keyboard) : [];

    const handleExport = async () => {
        if (!keyboard) return;
        setError(null);
        try {
            if (format === "print") {
                if (printableLayers.length === 0) {
                    setError("No layer has keys on it, so there is nothing to print.");
                    return;
                }
                // PrintableKeymapWrapper listens for this and opens the print view.
                window.dispatchEvent(new CustomEvent("keybard-print", { detail: { keyboard, layers: printableLayers } }));
            } else if (format === "svil") {
                await fileService.downloadSvil(keyboard, includeMacros);
            } else {
                await fileService.downloadVIL(keyboard, includeMacros);
            }
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const selected = FORMATS.find((f) => f.value === format)!;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Export layout</DialogTitle>
                    <DialogDescription>Save this board's layout to a file, or print it.</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4 py-2">
                    <div role="radiogroup" aria-label="Format" className="inline-flex w-fit max-w-full rounded-full border border-kb-gray-border bg-muted/60 p-0.5">
                        {FORMATS.map((f) => (
                            <button
                                key={f.value}
                                type="button"
                                role="radio"
                                aria-checked={format === f.value}
                                onClick={() => setFormat(f.value)}
                                className={cn(
                                    "rounded-full px-4 py-1 text-sm font-medium transition-colors",
                                    format === f.value ? "bg-kb-active text-kb-active-fg" : "text-muted-foreground hover:bg-muted hover:text-kb-ink",
                                )}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                    <p className="text-sm text-muted-foreground">{selected.description}</p>
                    {format === "print" ? (
                        keyboard && (
                            <p className="text-sm text-muted-foreground">
                                {printableLayers.length} of {keyboard.keymap?.length ?? 0} layers have keys on them.
                            </p>
                        )
                    ) : (
                        <div className="flex items-center gap-2">
                            <Switch id="export-include-macros" checked={includeMacros} onCheckedChange={(c: boolean) => setIncludeMacros(c)} />
                            <Label htmlFor="export-include-macros">Include macros</Label>
                        </div>
                    )}
                </div>
                {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
                <DialogFooter>
                    <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button type="button" disabled={!keyboard} onClick={handleExport}>
                        {format === "print" ? "Print" : "Export"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
