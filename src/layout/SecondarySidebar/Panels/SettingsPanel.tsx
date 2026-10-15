import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
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
import { highlightParts, rowKey, searchSettings } from "./settings/search";

const sectionDomId = (id: string) => `settings-section-${id}`;

/** Focus is in a field that takes typed text, where "/" is a character. */
const isTextField = (target: EventTarget | null) =>
    target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * Settings: one scrolling page of app preferences and board and firmware
 * management, in three groups (This keyboard, This browser, Keybard). Its
 * content is declared in settings/layout.ts. A search field at the top
 * filters it (settings/search.ts).
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

    const searchRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState("");
    const matches = useMemo(() => searchSettings(SETTINGS_PAGE, query, getSettingDefinition), [query, getSettingDefinition]);
    const searching = matches !== null;

    const highlight = useCallback((text: string): ReactNode => {
        if (!searching) return text;
        return highlightParts(text, query).map((part, i) =>
            part.match
                ? <mark key={i} className="rounded-sm bg-kb-yellow/45 px-px text-kb-ink">{part.text}</mark>
                : <span key={i}>{part.text}</span>,
        );
    }, [searching, query]);

    const clearSearch = (refocus = false) => {
        setQuery("");
        if (refocus) searchRef.current?.focus();
    };

    // "/" or Ctrl+F (Cmd+F) while focus is inside Settings goes to the search field.
    const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const find = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f";
        const slash = e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTextField(e.target);
        if (!find && !slash) return;
        e.preventDefault();
        e.stopPropagation();
        searchRef.current?.focus();
        searchRef.current?.select();
    };

    // Esc clears a search; with the field already empty it does what it did before.
    const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key !== "Escape" || query === "") return;
        e.preventDefault();
        e.stopPropagation();
        clearSearch();
    };

    const toggleSection = (section: SettingsSection) => {
        if (section.id !== "developer") return;
        const next = !developerOpen;
        setDeveloperOpen(next);
        if (next && !developerOpenedBefore) updateSetting(DEVELOPER_OPENED_SETTING, true);
    };

    const scrollToSection = (id: string) => {
        if (id === "developer") setDeveloperOpen(true);
        const jump = () => document.getElementById(sectionDomId(id))?.scrollIntoView?.({ block: "start", behavior: "smooth" });
        // A chip jumps on the whole page: clear a search first, then jump once it renders.
        if (matches) {
            setQuery("");
            requestAnimationFrame(jump);
        } else jump();
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
                return (
                    <BackupsSection
                        onRestore={reviewFile}
                        forceOpen={!!matches?.get("backups")?.rows.has("block:backups")}
                        highlight={highlight}
                    />
                );
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
                highlight={highlight}
            />
        );
    };

    const visibleGroups = SETTINGS_PAGE
        .map((group) => ({ ...group, sections: group.sections.filter((section) => !matches || matches.has(section.id)) }))
        .filter((group) => group.sections.length > 0);

    return (
        <div className="@container flex w-full flex-col gap-5 pb-6" onKeyDown={onPanelKeyDown}>
            {importReview}
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".svil,.viable,.vil,.json"
                onChange={handleFileImport}
            />
            <ExportDialog open={isExportOpen} onOpenChange={setIsExportOpen} />

            <div className="sticky top-0 z-10 -mx-1 flex flex-col gap-2 bg-kb-surface px-1 pt-1.5 pb-1">
                <div role="search" className="relative">
                    <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                        ref={searchRef}
                        type="text"
                        inputMode="search"
                        enterKeyHint="search"
                        autoComplete="off"
                        spellCheck={false}
                        aria-label="Search settings"
                        aria-keyshortcuts="/ Control+F"
                        placeholder="Search settings"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={onSearchKeyDown}
                        className="h-9 w-full rounded-md border border-input bg-kb-surface pl-8 pr-8 text-sm text-kb-ink placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    {query !== "" && (
                        <button
                            type="button"
                            aria-label="Clear search"
                            onClick={() => clearSearch(true)}
                            className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-kb-ink"
                        >
                            <X aria-hidden="true" className="h-4 w-4" />
                        </button>
                    )}
                </div>
                <nav aria-label="Settings sections" className="flex flex-row flex-wrap gap-1.5">
                    {SETTINGS_ANCHORS.map(({ id, label }) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => scrollToSection(id)}
                            aria-label={id === "firmware" && firmwareDot ? `${label}, update available` : undefined}
                            className={cn(
                                "inline-flex items-center gap-1.5 rounded-full border border-kb-gray-border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-kb-ink",
                                matches && !matches.has(id) && "opacity-50",
                            )}
                        >
                            {label}
                            {id === "firmware" && firmwareDot && <span aria-hidden="true" data-testid="firmware-chip-dot" className="h-1.5 w-1.5 rounded-full bg-kb-primary" />}
                        </button>
                    ))}
                </nav>
            </div>

            {searching && visibleGroups.length === 0 && (
                <div role="status" className="panel-layer-item flex flex-col items-start gap-1.5 rounded-lg px-3 py-4">
                    <p className="text-sm text-kb-ink">Nothing in Settings matches &ldquo;{query.trim()}&rdquo;.</p>
                    <p className="text-xs text-muted-foreground">Layers, pointing and other board configuration live in their own panels on the rail.</p>
                    <button
                        type="button"
                        onClick={() => clearSearch(true)}
                        className="mt-1 text-xs font-medium text-kb-ink underline underline-offset-2"
                    >
                        Clear search
                    </button>
                </div>
            )}

            {visibleGroups.map((group) => (
                <section key={group.id} aria-labelledby={`settings-group-${group.id}`} className="flex flex-col gap-3">
                    <h3 id={`settings-group-${group.id}`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.title}
                    </h3>
                    {group.sections.map((section) => {
                        const match = matches?.get(section.id);
                        const expanded = !section.collapsible || !!match || (section.id === "developer" && developerOpen);
                        const bodyId = `${sectionDomId(section.id)}-body`;
                        const rows = match ? section.rows.filter((row) => match.rows.has(rowKey(row))) : section.rows;
                        return (
                            <section
                                key={section.id}
                                id={sectionDomId(section.id)}
                                aria-labelledby={`${sectionDomId(section.id)}-title`}
                                className="scroll-mt-32 flex flex-col"
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
                                            <span>{highlight(section.title)}</span>
                                            <ChevronDown aria-hidden="true" className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
                                        </button>
                                    </h4>
                                ) : (
                                    <h4 id={`${sectionDomId(section.id)}-title`} className="py-1 text-sm font-semibold text-kb-ink">
                                        {highlight(section.title)}
                                    </h4>
                                )}
                                {expanded && (
                                    <div id={bodyId} className="panel-layer-item flex flex-col divide-y divide-kb-gray-border rounded-lg">
                                        {rows.map(renderRow)}
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
