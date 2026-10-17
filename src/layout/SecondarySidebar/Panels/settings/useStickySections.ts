import { useCallback, useEffect, useRef, useState } from "react";
import { sectionStateSetting, type SettingsSection } from "./layout";

/** How a section's state is stored: as a word, so an unset setting (read as false) means a first visit. */
export type StoredSectionState = "open" | "collapsed";

/** A stored value as open or collapsed, or the section's default when nothing usable is stored. */
export function storedOpen(value: unknown, defaultOpen: boolean): boolean {
    if (value === "open") return true;
    if (value === "collapsed") return false;
    return defaultOpen;
}

type Read = (name: string) => unknown;
type Write = (name: string, value: string) => void;

/**
 * Open and collapsed state for the Settings cards, the same for every card.
 * A card opens the way it was left in this browser, or as declared on a first
 * visit. Toggling it remembers the new state. Opening it for a visit (a link,
 * a chip, an available update) changes nothing that is remembered. Remembering
 * is a convenience: when storage fails, cards follow their defaults.
 */
export function useStickySections(sections: SettingsSection[], read: Read, write: Write) {
    const readSafe = (name: string): unknown => {
        try { return read(name); } catch { return undefined; }
    };
    const initial = (s: SettingsSection) => storedOpen(readSafe(sectionStateSetting(s.id)), s.defaultOpen);

    const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(sections.map((s) => [s.id, initial(s)])));
    // Opened for this visit, which a late load of stored settings must not close.
    const forVisit = useRef(new Set<string>());

    // Settings load after the page can first render: follow the stored state when it arrives.
    const stored = sections.map((s) => `${s.id}=${initial(s)}`).join(" ");
    useEffect(() => {
        setOpen((prev) => {
            const next = { ...prev };
            for (const pair of stored.split(" ")) {
                const [id, value] = pair.split("=");
                if (!forVisit.current.has(id)) next[id] = value === "true";
            }
            return next;
        });
    }, [stored]);

    const toggle = (id: string) => {
        const next = !open[id];
        forVisit.current.delete(id);
        setOpen((prev) => ({ ...prev, [id]: next }));
        try { write(sectionStateSetting(id), next ? "open" : "collapsed"); } catch { /* not remembered this time */ }
    };

    const openForVisit = useCallback((id: string) => {
        forVisit.current.add(id);
        setOpen((prev) => ({ ...prev, [id]: true }));
    }, []);

    return { isOpen: (id: string) => !!open[id], toggle, openForVisit };
}
