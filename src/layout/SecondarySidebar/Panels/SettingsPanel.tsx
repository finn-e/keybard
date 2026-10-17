import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import ExportDialog from "@/components/ExportDialog";
import { useNavigation } from "@/App";
import { usePanels } from "@/contexts/PanelsContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { useLayoutImport } from "@/hooks/useLayoutImport";
import { useFirmwareUpdates } from "@/features/firmware/FirmwareUpdateProvider";
import { cn } from "@/lib/utils";
import BackupsSection from "./BackupsSection";
import BoardIdentitySection from "./BoardIdentitySection";
import ClustersPanel from "./ClustersPanel";
import TypingBehaviorPanel from "./TypingBehaviorPanel";
import AboutSection from "./settings/AboutSection";
import FirmwareRow from "./settings/FirmwareRow";
import SettingRow from "./settings/SettingRow";
import { onSettingsSectionRequest, takeSettingsSectionRequest } from "./settings/anchor";
import { SETTINGS_LAYOUTS, settingsLayoutId, type SettingsBlock, type SettingsRow, type SettingsSection } from "./settings/layout";
import { highlightParts, rowKey, searchSettings } from "./settings/search";

const sectionDomId = (id: string) => `settings-section-${id}`;
const groupDomId = (id: string) => `settings-group-${id}`;

/** Focus is in a field that takes typed text, where "/" is a character. */
const isTextField = (target: EventTarget | null) =>
    target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * Settings: one scrolling page of the setup a board needs once (hardware,
 * firmware, backups, typing behavior) and app preferences. Its content and
 * the organizations under review (?settingsLayout=a|b|c) are declared in
 * settings/layout.ts. A search field at the top filters it (settings/search.ts).
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

    // The organization under review: ?settingsLayout=a|b|c, for this page load only.
    const layout = SETTINGS_LAYOUTS[settingsLayoutId()];
    const page = layout.groups;
    const sections = useMemo(() => page.flatMap((g) => g.sections), [page]);

    // Collapsible sections: closed unless they start open, or were opened before
    // in this browser (Developer).
    const remembered = (section: SettingsSection) => !!section.rememberOpen && getSetting(section.rememberOpen, false) === true;
    const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
        Object.fromEntries(sections.filter((s) => s.collapsible).map((s) => [s.id, !!s.defaultOpen || remembered(s)])));
    const rememberedNow = sections.filter(remembered).map((s) => s.id).join(" ");
    useEffect(() => {
        if (!rememberedNow) return;
        setOpenSections((prev) => ({ ...prev, ...Object.fromEntries(rememberedNow.split(" ").map((id) => [id, true])) }));
    }, [rememberedNow]);

    const searchRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState("");
    const matches = useMemo(() => searchSettings(page, query, getSettingDefinition), [page, query, getSettingDefinition]);
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
        const next = !openSections[section.id];
        setOpenSections((prev) => ({ ...prev, [section.id]: next }));
        if (next && section.rememberOpen && !remembered(section)) updateSetting(section.rememberOpen, true);
    };

    const scrollToSection = (id: string, group = false) => {
        if (!group && sections.some((s) => s.id === id && s.collapsible)) setOpenSections((prev) => ({ ...prev, [id]: true }));
        const jump = () => document.getElementById(group ? groupDomId(id) : sectionDomId(id))?.scrollIntoView?.({ block: "start", behavior: "smooth" });
        // A chip jumps on the whole page: clear a search first, then jump once it renders.
        if (matches) {
            setQuery("");
            requestAnimationFrame(jump);
        } else jump();
    };

    // Opened at a section from elsewhere (the rail's About item, an old ?panel= link).
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
            case "hardware":
                return <div className="px-3 pt-3"><ClustersPanel /></div>;
            case "typing":
                return <div className="px-3 pt-3 pb-1"><TypingBehaviorPanel /></div>;
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

    const visibleGroups = page
        .map((group) => ({ ...group, sections: group.sections.filter((section) => !matches || matches.has(section.id)) }))
        .filter((group) => group.sections.length > 0);

    // The chip (or, with no chips, the section heading) that carries the update dot.
    const holdsFirmware = (anchor: { id: string; group?: boolean }) =>
        anchor.group ? !!page.find((g) => g.id === anchor.id)?.sections.some((s) => s.id === "firmware") : anchor.id === "firmware";

    const renderSection = (section: SettingsSection) => {
        const match = matches?.get(section.id);
        const expanded = !section.collapsible || !!match || !!openSections[section.id];
        const domId = sectionDomId(section.id);
        const bodyId = `${domId}-body`;
        const rows = match ? section.rows.filter((row) => match.rows.has(rowKey(row))) : section.rows;
        const style = layout.style;
        const card = style === "cards" || style === "list";
        const dot = firmwareDot && section.id === "firmware" && layout.anchors.length === 0;
        const title = (
            <span className="flex flex-row items-center gap-2">
                {highlight(section.title)}
                {dot && <span aria-label="update available" data-testid="firmware-heading-dot" className="h-1.5 w-1.5 rounded-full bg-kb-primary" />}
            </span>
        );
        const headingClass = cn(
            "text-kb-ink",
            style === "list" ? "text-base font-semibold" : "text-sm font-semibold",
            style === "cards" && "border-kb-gray-border bg-muted/60 px-3 py-2",
            style === "cards" && expanded && "border-b",
            style === "list" && "px-4",
            style === "list" && expanded && !section.summary && "border-b border-kb-gray-border",
            style === "tasks" && section.collapsible && "rounded-lg border border-kb-gray-border px-3 py-1.5",
            style === "tasks" && section.collapsible && expanded && "mb-2",
        );
        const summary = style === "list" && section.summary && (
            <p
                id={`${domId}-summary`}
                onClick={() => toggleSection(section)}
                className={cn("-mt-1 cursor-pointer px-4 pb-3 text-xs text-muted-foreground", expanded && "border-b border-kb-gray-border")}
            >
                {section.summary}
            </p>
        );
        return (
            <section
                key={section.id}
                id={domId}
                aria-labelledby={`${domId}-title`}
                data-settings-section={section.id}
                className={cn(
                    "scroll-mt-32 flex flex-col",
                    card && "overflow-hidden rounded-xl border border-kb-gray-border bg-kb-surface shadow-sm",
                )}
            >
                {section.collapsible ? (
                    <h4 id={`${domId}-title`} className={headingClass}>
                        <button
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={bodyId}
                            aria-describedby={summary ? `${domId}-summary` : undefined}
                            onClick={() => toggleSection(section)}
                            className={cn(
                                "flex w-full flex-row items-center justify-between gap-2 text-left",
                                style === "list" ? "py-3" : "py-1",
                            )}
                        >
                            {title}
                            <ChevronDown aria-hidden="true" className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
                        </button>
                    </h4>
                ) : (
                    <h4 id={`${domId}-title`} className={cn(headingClass, style === "tasks" && "py-1", style === "list" && "py-3")}>
                        {title}
                    </h4>
                )}
                {summary}
                {expanded && (
                    <div
                        id={bodyId}
                        className={cn(
                            "flex flex-col divide-y divide-kb-gray-border",
                            style === "tasks" && "panel-layer-item rounded-lg border border-kb-gray-border",
                        )}
                    >
                        {rows.map(renderRow)}
                    </div>
                )}
            </section>
        );
    };

    return (
        <div className="@container flex w-full flex-col gap-5 pb-6" data-settings-layout={layout.id} onKeyDown={onPanelKeyDown}>
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
                {layout.anchors.length > 0 && (
                    <nav aria-label="Settings sections" className="flex flex-row flex-wrap gap-1.5">
                        {layout.anchors.map((anchor) => {
                            const { id, label, group } = anchor;
                            const dotted = firmwareDot && holdsFirmware(anchor);
                            const dimmed = matches && (group
                                ? !page.find((g) => g.id === id)?.sections.some((s) => matches.has(s.id))
                                : !matches.has(id));
                            return (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => scrollToSection(id, group)}
                                    aria-label={dotted ? `${label}, update available` : undefined}
                                    className={cn(
                                        "inline-flex items-center gap-1.5 rounded-full border border-kb-gray-border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-kb-ink",
                                        dimmed && "opacity-50",
                                    )}
                                >
                                    {label}
                                    {dotted && <span aria-hidden="true" data-testid="firmware-chip-dot" className="h-1.5 w-1.5 rounded-full bg-kb-primary" />}
                                </button>
                            );
                        })}
                    </nav>
                )}
            </div>

            {searching && visibleGroups.length === 0 && (
                <div role="status" className="panel-layer-item flex flex-col items-start gap-1.5 rounded-lg px-3 py-4">
                    <p className="text-sm text-kb-ink">Nothing in Settings matches &ldquo;{query.trim()}&rdquo;.</p>
                    <p className="text-xs text-muted-foreground">Layers, combos and the other parts of a layout live in their own panels on the rail.</p>
                    <button
                        type="button"
                        onClick={() => clearSearch(true)}
                        className="mt-1 text-xs font-medium text-kb-ink underline underline-offset-2"
                    >
                        Clear search
                    </button>
                </div>
            )}

            {visibleGroups.map((group, index) => (
                <section
                    key={group.id}
                    aria-labelledby={groupDomId(group.id)}
                    className={cn(
                        "flex flex-col",
                        layout.style === "tasks" ? "gap-4" : "gap-3",
                        layout.style === "cards" && index > 0 && "mt-3",
                        layout.style === "tasks" && index > 0 && !group.footer && "border-t-2 border-kb-gray-border pt-5",
                        group.footer && "mt-2 border-t border-kb-gray-border pt-4",
                    )}
                >
                    <h3
                        id={groupDomId(group.id)}
                        className={cn(
                            "scroll-mt-32",
                            group.hideTitle && "sr-only",
                            layout.style === "tasks" && !group.footer
                                ? "text-lg font-semibold text-kb-ink"
                                : "text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                        )}
                    >
                        {group.title}
                    </h3>
                    {group.sections.map(renderSection)}
                </section>
            ))}
        </div>
    );
};

export default SettingsPanel;
