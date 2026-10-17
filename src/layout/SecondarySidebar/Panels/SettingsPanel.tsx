import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import OnOffToggle from "@/components/ui/OnOffToggle";
import { useChanges } from "@/contexts/ChangesContext";
import { usePanels } from "@/contexts/PanelsContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { useNavigation } from "@/App";
import { cn } from "@/lib/utils";
import { useLayoutImport } from "@/hooks/useLayoutImport";
import { fileService } from "@/services/file.service";
import { printService } from "@/services/print.service";
import { useRef, useState } from "react";
import BackupsSection from "./BackupsSection";
import BoardIdentitySection from "./BoardIdentitySection";
import FragmentsPanel from "./FragmentsPanel";
import DynamicMenuPanel from "./DynamicMenuPanel";
import { selectPointingMenu } from "@/utils/pointing-menu";
import type { CustomUIMenuItem } from "@/types/keyboard.types";

/** ?category=<name> (a review link) opens Settings on that category; anything else is General. */
function initialSettingsCategory(names: string[]): string {
    try {
        const params = new URLSearchParams(window.location.search);
        const asked = (params.get("category") ?? (params.get("panel") === "fragments" ? "fragments" : null))?.trim().toLowerCase();
        if (asked && names.includes(asked)) return asked;
    } catch { /* no URL */ }
    return "general";
}

const SettingsPanel = () => {
    const { getSetting, updateSetting, settingsDefinitions, settingsCategories } = useSettings();
    const [activeCategory, setActiveCategory] = useState<string>(() => initialSettingsCategory(settingsCategories.map((c) => c.name)));
    const { keyboard } = useKeyboard();
    const { setActivePanel } = usePanels();
    const { navigateTo } = useNavigation();

    const pointingMenuIndex = keyboard?.menus?.findIndex(menu => menu.label?.toLowerCase().includes("pointing")) ?? -1;
    const hasDeveloperControls = pointingMenuIndex >= 0 && selectPointingMenu(
        (keyboard?.menus?.[pointingMenuIndex]?.content ?? []) as CustomUIMenuItem[], "developer",
    ).length > 0;
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Export Dialog State
    const [isExportOpen, setIsExportOpen] = useState(false);
    const [exportFormat, setExportFormat] = useState<"svil" | "vil">("svil");
    const [includeMacros, setIncludeMacros] = useState(true);

    // Print Dialog State
    const [isPrintOpen, setIsPrintOpen] = useState(false);

    const { setInstant } = useChanges();
    const updateBooleanSetting = async (name: string, checked: boolean) => {
        if (name === 'live-updating' && !await setInstant(checked)) return;
        updateSetting(name, checked);
    };

    const { handleFileImport, reviewFile, importReview, fileError, setFileError } = useLayoutImport();

    const handleExport = async () => {
        if (!keyboard) {
            console.error("No keyboard loaded");
            return;
        }

        try {
            if (exportFormat === "svil") {
                // Custom values are already in keyboard.custom_values (loaded at connect time)
                await fileService.downloadSvil(keyboard, includeMacros);
            } else {
                await fileService.downloadVIL(keyboard, includeMacros);
            }
            setIsExportOpen(false);
        } catch (err) {
            setFileError(err instanceof Error ? err.message : String(err));
        }
    };

    const handlePrint = () => {
        if (!keyboard) {
            console.error("No keyboard loaded");
            return;
        }

        const nonEmptyLayers = printService.getNonEmptyLayers(keyboard);
        if (nonEmptyLayers.length === 0) {
            console.warn("No non-empty layers to print");
            return;
        }

        // Dispatch a custom event that the PrintableKeymap wrapper will listen for
        window.dispatchEvent(new CustomEvent('keybard-print', {
            detail: { keyboard, layers: nonEmptyLayers }
        }));

        setIsPrintOpen(false);
    };

    return (
        <section className="space-y-3 flex flex-col w-full mx-auto py-4">
            {importReview}
            {/* Hidden file input for import */}
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".svil,.viable,.vil,.json"
                onChange={handleFileImport}
            />

            {/* Export Dialog */}
            <Dialog open={isExportOpen} onOpenChange={setIsExportOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Export Configuration</DialogTitle>
                        <DialogDescription>
                            Choose the format to save your keyboard configuration. Native .svil preserves Sval features and names. Legacy .vil omits Sval-specific settings, names, colors, and hardware selections.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-4 py-4">
                        <div className="flex flex-col gap-2">
                            <Label>Format</Label>
                            <Select value={exportFormat} onValueChange={(v: "svil" | "vil") => setExportFormat(v)}>
                                <SelectTrigger aria-label="Export format">
                                    <SelectValue placeholder="Select format" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="svil">Svalboard (.svil) - Native Format</SelectItem>
                                    <SelectItem value="vil">Vial (.vil) - Legacy Compatibility</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Switch id="include-macros" checked={includeMacros} onCheckedChange={(c: boolean) => setIncludeMacros(c)} />
                            <label
                                htmlFor="include-macros"
                                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                            >
                                Include Macros
                            </label>
                        </div>
                    </div>
                    {fileError && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{fileError}</p>}
                    <DialogFooter>
                        <Button type="button" variant="secondary" onClick={() => setIsExportOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="button" onClick={handleExport}>
                            Export
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Print Dialog */}
            <Dialog open={isPrintOpen} onOpenChange={setIsPrintOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Print Keyboard Layout</DialogTitle>
                        <DialogDescription>
                            Print all layers that contain configured keys (excluding empty KC_NO and transparent KC_TRNS only layers).
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-4 py-4">
                        {keyboard && (
                            <div className="text-sm text-muted-foreground">
                                <p><strong>Keyboard:</strong> {keyboard.cosmetic?.name || keyboard.name || 'Unknown'}</p>
                                <p><strong>Non-empty layers:</strong> {printService.getNonEmptyLayers(keyboard).length} of {keyboard.keymap?.length || 0}</p>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="secondary" onClick={() => setIsPrintOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="button" onClick={handlePrint}>
                            Print
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <div className="flex flex-row gap-2 justify-stretch align-stretch mb-3 w-full px-4">
                {settingsCategories.map((category) => (
                    <button
                        type="button"
                        aria-pressed={activeCategory === category.name}
                        key={category.name}
                        onClick={() => setActiveCategory(category.name)}
                        className={cn(
                            "w-0 min-w-0 flex-1 flex items-center gap-2 flex-col cursor-pointer py-3 rounded-lg transition-all",
                            activeCategory === category.name ? "bg-kb-active text-kb-active-fg hover:bg-kb-active/80 hover:text-kb-active-fg" : "text-muted-foreground hover:bg-muted bg-muted/60"
                        )}
                    >
                        {category.icon && <category.icon className="h-4 w-4" />}
                        <span className="text-xs font-medium text-center break-words">{category.label}</span>
                    </button>
                ))}
            </div>
            <div className=" flex flex-col gap-2">
                {activeCategory === "fragments" ? (
                    <FragmentsPanel />
                ) : activeCategory === "backups" ? (
                    <div className="flex flex-col px-1 gap-2">
                        <BackupsSection onRestore={reviewFile} />
                    </div>
                ) : (
                    <div className="flex flex-col px-1 gap-2">
                        {activeCategory === "general" && <BoardIdentitySection />}
                        {activeCategory === "developer" && hasDeveloperControls && (
                            <DynamicMenuPanel menuIndex={pointingMenuIndex} section="developer" embedded />
                        )}
                        {settingsCategories
                            .find((cat) => cat.name === activeCategory)
                            ?.settings.map((se) => {
                                const setting = settingsDefinitions.find((s) => s.name === se);
                                if (!setting) return null;

                                if (setting.type === "boolean") {
                                    if (setting.name === "typing-binds-key") {
                                        return (
                                            <div className="flex flex-row flex-wrap items-center justify-between p-3 gap-3 panel-layer-item group/item" key={setting.name}>
                                                <div className="flex flex-col items-start gap-3 flex-1 basis-44 min-w-0">
                                                    <span className="text-md text-left">{setting.label}</span>
                                                    <span className="text-xs text-muted-foreground">{setting.description}</span>
                                                </div>
                                                <OnOffToggle
                                                    label={setting.label}
                                                    description={setting.description}
                                                    value={getSetting(setting.name, setting.defaultValue) as boolean}
                                                    onToggle={(checked) => {
                                                        void updateBooleanSetting(setting.name, checked);
                                                    }}
                                                />
                                            </div>
                                        );
                                    }
                                    return (
                                        <div className="flex flex-row flex-wrap items-center justify-between p-3 gap-3 panel-layer-item group/item" key={setting.name}>
                                            <div className="flex flex-col items-start gap-3 flex-1 basis-44 min-w-0">
                                                <span className="text-md text-left">{setting.label}</span>
                                                <span className="text-xs text-muted-foreground">{setting.description}</span>
                                            </div>
                                            <Switch
                                                aria-label={setting.label}
                                                aria-description={setting.description}
                                                checked={getSetting(setting.name, setting.defaultValue) as boolean}
                                                onCheckedChange={(checked) => {
                                                    void updateBooleanSetting(setting.name, checked);
                                                }}
                                            />
                                        </div>
                                    );
                                }
                                if (setting.type === "select") {
                                    return (
                                        <div className="flex flex-row flex-wrap items-center justify-between p-3 gap-3 panel-layer-item group/item" key={setting.name}>
                                            <div className="flex flex-col items-start gap-3 flex-1 basis-44 min-w-0">
                                                <div className="text-md text-left">{setting.label}</div>
                                                {setting.description && setting.description !== "" && <span className="text-xs text-muted-foreground">{setting.description}</span>}
                                            </div>
                                            <select
                                                aria-label={setting.label}
                                                aria-description={setting.description}
                                                value={getSetting(setting.name, setting.defaultValue) as string}
                                                onChange={(e) => {
                                                    updateSetting(setting.name, e.target.value);
                                                }}
                                                className="max-w-full h-8 px-3 font-bold rounded-md pr-3 cursor-pointer active:border-none focus:border-none"
                                            >
                                                {setting.items?.map((item) => (
                                                    <option key={item.value} value={item.value}>
                                                        {item.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    );
                                }
                                if (setting.type === "action") {
                                    return (
                                        <button
                                            type="button"
                                            aria-label={setting.label}
                                            aria-description={setting.description}
                                            className="flex flex-row items-center text-left justify-between p-3 gap-3 panel-layer-item group/item cursor-pointer hover:bg-accent hover:text-accent-foreground rounded-md"
                                            key={setting.name}
                                            onClick={() => {
                                                console.log(`Action ${setting.action} triggered`);
                                                if (setting.action === "import-settings") {
                                                    fileInputRef.current?.click();
                                                } else if (setting.action === "export-settings") {
                                                    setIsExportOpen(true);
                                                } else if (setting.action === "print-keymap") {
                                                    setIsPrintOpen(true);
                                                } else if (setting.action === "open-qmk-settings") {
                                                    setActivePanel("qmksettings");
                                                } else if (setting.action === "open-scan-lab") {
                                                    setActivePanel("scanlab");
                                                } else if (setting.action === "open-proof-sheet") {
                                                    navigateTo("proof-sheet");
                                                }
                                            }}
                                        >
                                            <div className="flex flex-col gap-2">
                                                <span className="text-md text-left">{setting.label}</span>
                                                {setting.description ? <span className="text-xs text-muted-foreground">{setting.description}</span> : undefined}
                                            </div>
                                            <span aria-hidden="true" className="text-xs text-muted-foreground">&rsaquo;</span>
                                        </button>
                                    );
                                }
                                if (setting.type === "slider") {
                                    return (
                                        <div className="flex flex-col gap-2 p-3 panel-layer-item group/item w-full" key={setting.name}>
                                            <span className="text-md text-left">{setting.label}</span>
                                            <span className="text-xs text-muted-foreground">{setting.description}</span>
                                            <div className="flex flex-row items-center justify-between">
                                                <Slider
                                                    aria-label={setting.label}
                                                    aria-description={setting.description}
                                                    value={[getSetting(setting.name, setting.defaultValue) as number]}
                                                    onValueChange={(values) => updateSetting(setting.name, values[0])}
                                                    min={setting.min}
                                                    max={setting.max}
                                                    step={setting.step}
                                                    key={setting.name}
                                                    className="flex-grow"
                                                />
                                                <Input
                                                    aria-label={setting.label}
                                                    aria-description={setting.description}
                                                    type="number"
                                                    value={getSetting(setting.name, setting.defaultValue) as number}
                                                    step={setting.step}
                                                    onChange={(e) => updateSetting(setting.name, (setting.step ?? 1) < 1 ? Math.min(setting.max ?? 1, Math.max(setting.min ?? 0, parseFloat(e.target.value) || 0)) : parseInt(e.target.value) || 0)}
                                                    className="w-22 ml-4 text-right select-text"
                                                />
                                            </div>
                                        </div>
                                    );
                                }

                                return null;
                            })}
                    </div>
                )}
            </div>
        </section>
    );
};

export default SettingsPanel;
