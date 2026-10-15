import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import ExportDialog from "@/components/ExportDialog";
import { useNavigation } from "@/App";
import { usePanels } from "@/contexts/PanelsContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { useLayoutImport } from "@/hooks/useLayoutImport";
import { useFirmwareUpdates } from "@/features/firmware/FirmwareUpdateProvider";
import { DEVELOPER_OPENED_SETTING } from "@/lib/appearance-settings";
import { cn } from "@/lib/utils";
import BackupsSection from "./BackupsSection";
import BoardIdentitySection from "./BoardIdentitySection";
import AboutSection from "./settings/AboutSection";
import FirmwareRow from "./settings/FirmwareRow";
import SettingRow from "./settings/SettingRow";
import { onSettingsSectionRequest, takeSettingsSectionRequest } from "./settings/anchor";
import { SETTINGS_ANCHORS, SETTINGS_PAGE, type SettingsBlock, type SettingsRow, type SettingsSection } from "./settings/layout";

const sectionDomId = (id: string) => `settings-section-${id}`;

/**
 * Settings: one scrolling page of app preferences and board and firmware
 * management, in three groups (This keyboard, This browser, Keybard). Its
 * content is declared in settings/layout.ts.
 */
const SettingsPanel = () => {
    const { getSetting, updateSetting, getSettingDefinition } = useSettings();
    const { isConnected } = useKeyboard();
    const { setActivePanel } = usePanels();
    const { navigateTo } = useNavigation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isExportOpen, setIsExportOpen] = useState(false);
    const { handleFileImport, reviewFile, importReview } = useLayoutImport();
    // The update the rail's dot pointed at: marked on the Firmware chip for this visit
    // (opening Settings clears the rail dot).
    const firmwareDotNow = !!useFirmwareUpdates()?.status.dot;
    const [firmwareDot] = useState(firmwareDotNow);

    const developerOpenedBefore = getSetting(DEVELOPER_OPENED_SETTING, false) === true;
    const [developerOpen, setDeveloperOpen] = useState(developerOpenedBefore);
    useEffect(() => {
        if (developerOpenedBefore) setDeveloperOpen(true);
    }, [developerOpenedBefore]);

    const toggleSection = (section: SettingsSection) => {
        if (section.id !== "developer") return;
        const next = !developerOpen;
        setDeveloperOpen(next);
        if (next && !developerOpenedBefore) updateSetting(DEVELOPER_OPENED_SETTING, true);
    };

    const scrollToSection = (id: string) => {
        if (id === "developer") setDeveloperOpen(true);
        document.getElementById(sectionDomId(id))?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    };

    // Opened at a section from elsewhere (the rail's About item).
    useEffect(() => {
        const pending = takeSettingsSectionRequest();
        if (pending) requestAnimationFrame(() => scrollToSection(pending));
        return onSettingsSectionRequest((id) => scrollToSection(id));
    }, []);

    const runAction = (action: string) => {
        if (action === "import-settings") fileInputRef.current?.click();
        else if (action === "export-settings") setIsExportOpen(true);
        else if (action === "open-scan-lab") setActivePanel("scanlab");
        else if (action === "open-proof-sheet") navigateTo("proof-sheet");
    };

    const renderBlock = (block: SettingsBlock) => {
        switch (block) {
            case "firmware":
                return <FirmwareRow />;
            case "board":
                return isConnected
                    ? <BoardIdentitySection />
                    : <p className="px-3 py-2.5 text-sm text-muted-foreground">Connect a keyboard to see its name and serial.</p>;
            case "backups":
                return <div className="px-1"><BackupsSection onRestore={reviewFile} /></div>;
            case "about":
                return <AboutSection />;
        }
    };

    const renderRow = (row: SettingsRow) => {
        if ("block" in row) return <div key={row.block}>{renderBlock(row.block)}</div>;
        const definition = getSettingDefinition(row.setting);
        if (!definition) return null;
        const label = row.label ?? definition.label;
        return (
            <SettingRow
                key={row.setting}
                definition={definition}
                label={label}
                description={row.description ?? definition.description}
                value={getSetting(definition.name, definition.defaultValue)}
                onChange={(value) => updateSetting(definition.name, value)}
                onAction={runAction}
            />
        );
    };

    return (
        <div className="@container flex w-full flex-col gap-5 pb-6">
            {importReview}
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".svil,.viable,.vil,.json"
                onChange={handleFileImport}
            />
            <ExportDialog open={isExportOpen} onOpenChange={setIsExportOpen} />

            <nav aria-label="Settings sections" className="sticky top-0 z-10 -mx-1 flex flex-row flex-wrap gap-1.5 bg-kb-surface px-1 py-1.5">
                {SETTINGS_ANCHORS.map(({ id, label }) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => scrollToSection(id)}
                        aria-label={id === "firmware" && firmwareDot ? `${label}, update available` : undefined}
                        className="inline-flex items-center gap-1.5 rounded-full border border-kb-gray-border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-kb-ink"
                    >
                        {label}
                        {id === "firmware" && firmwareDot && <span aria-hidden="true" data-testid="firmware-chip-dot" className="h-1.5 w-1.5 rounded-full bg-kb-primary" />}
                    </button>
                ))}
            </nav>

            {SETTINGS_PAGE.map((group) => (
                <section key={group.id} aria-labelledby={`settings-group-${group.id}`} className="flex flex-col gap-3">
                    <h3 id={`settings-group-${group.id}`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.title}
                    </h3>
                    {group.sections.map((section) => {
                        const expanded = !section.collapsible || (section.id === "developer" && developerOpen);
                        const bodyId = `${sectionDomId(section.id)}-body`;
                        return (
                            <section
                                key={section.id}
                                id={sectionDomId(section.id)}
                                aria-labelledby={`${sectionDomId(section.id)}-title`}
                                className="scroll-mt-12 flex flex-col"
                            >
                                {section.collapsible ? (
                                    <h4 id={`${sectionDomId(section.id)}-title`} className="text-sm font-semibold text-kb-ink">
                                        <button
                                            type="button"
                                            aria-expanded={expanded}
                                            aria-controls={bodyId}
                                            onClick={() => toggleSection(section)}
                                            className="flex w-full flex-row items-center justify-between gap-2 py-1 text-left"
                                        >
                                            {section.title}
                                            <ChevronDown aria-hidden="true" className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
                                        </button>
                                    </h4>
                                ) : (
                                    <h4 id={`${sectionDomId(section.id)}-title`} className="py-1 text-sm font-semibold text-kb-ink">
                                        {section.title}
                                    </h4>
                                )}
                                {expanded && (
                                    <div id={bodyId} className="panel-layer-item flex flex-col divide-y divide-kb-gray-border rounded-lg">
                                        {section.rows.map(renderRow)}
                                    </div>
                                )}
                            </section>
                        );
                    })}
                </section>
            ))}
        </div>
    );
};

export default SettingsPanel;
