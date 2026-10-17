// Key inspector: the one card that shows key details on the layout. It describes the hovered,
// focused or pinned layout key: the key's action, tap dance or macro,
// every combo it is in, key overrides, alt repeat, leaders and where else it is used. It
// overlays the space under the layout, so showing it never moves a key, and it stops short
// of any editor or control below (the "lane"). Sections render only when they have content.
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { COMBO_EDITOR_MOVED_EVENT as EDITOR_MOVED_EVENT } from "@/lib/comboEditorPlacement";
import { cn } from "@/lib/utils";
import type { ComboEntry, KeyboardInfo } from "@/types/keyboard.types";
import { useComboPreview } from "@/contexts/ComboPreviewContext";
import { useLayoutSettings } from "@/contexts/LayoutSettingsContext";
import { comboInputs, type ComboMembership } from "@/utils/combo-membership";
import { comboSentence, shortKeyName } from "@/utils/combo-labels";
import { hiddenOnKey } from "@/utils/combo-fold";
import { comboName } from "@/utils/combo-names";
import { layerHexFor } from "@/utils/combo-hues";
import { buildKeyIndex, inspectKey, type KeyInspection, type Part, type Row, type Section } from "@/utils/key-inspect";
import { ComboOptions } from "@/types/keyboard.types";
import { FoldGlyph } from "./FoldGlyph";

/** Combo lines a hovering card lists before "+N More Combos" (a pinned card lists all). */
export const HOVER_COMBO_CAP = 6;
/** Lane heights (px) for the full card and the one-line strip. */
export const FULL_MIN_LANE = 120;
export const STRIP_MIN_LANE = 40;
const MAX_CARD_HEIGHT = 340;
const MAX_CARD_WIDTH = 560;
const MIN_CARD_WIDTH = 320;
const GAP = 12;
const VIEWPORT_GUTTER = 16;
const LEAVE_FADE_MS = 90;
/** What the lane stops at: editors and controls under the layout. */
const OBSTACLES = ".binding-workspace, aside.detail-panel[data-placement='bottom'], [data-inspector-avoid]";
/** Small controls level with the card's top edge (the add-view button): the card starts to their right. */
const BESIDE = "[data-inspector-beside]";


function membershipOf(combos: ComboEntry[], index: number): ComboMembership | null {
    const c = combos[index];
    if (!c) return null;
    return { index, enabled: !!(c.options & ComboOptions.ENABLED), output: c.output, inputs: comboInputs(c) };
}

function Chip({ children, out = false, label, edge }: { children: React.ReactNode; out?: boolean; label?: string; edge?: string }) {
    return (
        <span
            className={cn(
                "inline-flex items-center justify-center min-w-[22px] max-w-[140px] h-[22px] px-1.5 rounded-[5px] text-[11px] font-semibold uppercase whitespace-nowrap",
                "bg-kb-combo-chip border border-kb-combo-chip-border text-kb-ink",
                out && "font-bold",
            )}
            aria-label={label}
            style={edge ? { borderLeftWidth: 3, borderLeftColor: edge } : undefined}
        ><span className="truncate">{children}</span></span>
    );
}

const Off = () => <span className="text-[11px] text-muted-foreground border border-kb-combo-chip-border rounded-full px-1.5">off</span>;

export function ComboLine({ c, hue, name, notShown = false, showHue = true }: { c: ComboMembership; hue: number; name?: string; notShown?: boolean; showHue?: boolean }) {
    return (
        <li className="grid grid-cols-[18px_86px_1fr] items-center gap-x-2 min-h-6 text-[13px]" data-readout-combo={c.index} data-inspector-row="">
            <span className="inline-flex w-[18px] h-4 items-center justify-center">{showHue && <FoldGlyph hue={hue} disabled={!c.enabled} />}</span>
            {/* A named combo shows its name in place of its number. */}
            {name
                ? <span className="text-muted-foreground text-[12.5px] truncate" title={`Combo ${c.index}`} data-readout-combo-name="">{name}</span>
                : <span className="text-muted-foreground tabular-nums text-[12.5px]">Combo {c.index}</span>}
            <span className="inline-flex items-center gap-[3px] flex-wrap min-w-0">
                <span className="inline-flex items-center gap-[3px] flex-wrap" aria-label={comboSentence(c, name)}>
                    {c.inputs.map((x, i) => (
                        <React.Fragment key={i}>
                            {i > 0 && <span className="text-muted-foreground text-[11px]" aria-hidden="true">+</span>}
                            <Chip>{shortKeyName(x)}</Chip>
                        </React.Fragment>
                    ))}
                    <span className="text-muted-foreground mx-0.5" aria-hidden="true">→</span>
                    <Chip out>{shortKeyName(c.output)}</Chip>
                </span>
                {!c.enabled && <Off />}
                {notShown && <span className="text-[11px] text-muted-foreground" data-readout-not-shown="">not shown on key</span>}
            </span>
        </li>
    );
}

function Parts({ parts, kb }: { parts: Part[]; kb: KeyboardInfo }) {
    return (
        <>
            {parts.map((p, i) => {
                if (p.t === "plus") return <span key={i} className="text-muted-foreground text-[11px]" aria-hidden="true">+</span>;
                if (p.t === "arrow") return <span key={i} className="text-muted-foreground mx-0.5" aria-hidden="true">→</span>;
                if (p.t === "text") return <span key={i} className={cn("text-[12px] text-muted-foreground", p.mono && "font-mono text-kb-ink truncate max-w-full")}>{p.text}</span>;
                const edge = p.layer != null ? layerHexFor(kb.cosmetic?.layer_colors?.[String(p.layer)] || "green") : undefined;
                return <Chip key={i} out={p.out} label={p.label} edge={edge}>{p.label}</Chip>;
            })}
        </>
    );
}

function RowLine({ row, kb }: { row: Row; kb: KeyboardInfo }) {
    return (
        <li className="grid grid-cols-[18px_86px_1fr] items-center gap-x-2 min-h-6 text-[13px]" data-inspector-row="">
            <span />
            <span className="text-muted-foreground tabular-nums text-[12.5px] truncate">{row.label}</span>
            <span className="inline-flex items-center gap-[3px] flex-wrap min-w-0">
                <Parts parts={row.parts} kb={kb} />
                {row.off && <Off />}
                {row.note && <span className="text-[11px] text-muted-foreground">{row.note}</span>}
            </span>
        </li>
    );
}

function SectionBlock({ title, note, off, id, children }: { title: string; note?: string; off?: boolean; id: string; children: React.ReactNode }) {
    return (
        <section className="mt-2.5 first:mt-2" data-inspector-section={id}>
            <h3 className="text-[12px] font-medium text-muted-foreground flex items-center gap-1.5 m-0">
                <span>{title}</span>
                {note && <span className="font-normal">{note}</span>}
                {off && <Off />}
            </h3>
            <ul className="list-none mt-1 p-0 grid gap-1">{children}</ul>
        </section>
    );
}

const Sections = ({ list, kb }: { list: Section[]; kb: KeyboardInfo }) => (
    <>
        {list.map(sec => (
            <SectionBlock key={sec.id} id={sec.id} title={sec.title} note={sec.titleNote} off={sec.off}>
                {sec.rows.map((r, i) => <RowLine key={i} row={r} kb={kb} />)}
            </SectionBlock>
        ))}
    </>
);

/**
 * Space under the layout for the card: from GAP below the layout to GAP above the nearest
 * editor or control under it, or the viewport bottom. Also the card width: up to 560px and
 * the layout's width, but never past the visible canvas (a narrow canvas, with the picker and
 * an editor open, would otherwise push the card off screen).
 */
function useLane(anchor: React.RefObject<HTMLDivElement | null>, deps: unknown[]): { lane: number; width: number; inset: number; drop: number } {
    const [lane, setLane] = useState(MAX_CARD_HEIGHT);
    const [drop, setDrop] = useState(0);
    const [width, setWidth] = useState(MAX_CARD_WIDTH);
    const [inset, setInset] = useState(0);
    useLayoutEffect(() => {
        const el = anchor.current;
        if (!el) return;
        const measure = () => {
            const a = el.getBoundingClientRect();
            const canvas = el.closest(".keyboard-canvas-scroll");
            let right = window.innerWidth - VIEWPORT_GUTTER;
            if (canvas) right = Math.min(right, canvas.getBoundingClientRect().left + canvas.clientWidth - GAP);
            let left = 0;
            document.querySelectorAll<HTMLElement>(BESIDE).forEach(o => {
                const r = o.getBoundingClientRect();
                if (!r.width || !r.height || r.bottom <= a.top || r.top >= a.top + 40) return;
                if (r.right <= a.left || r.left >= a.left + MAX_CARD_WIDTH) return;
                left = Math.max(left, Math.ceil(r.right - a.left + 8));
            });
            // Obstacles at the top of the lane (the card Under a Half, an editor
            // beside the layout): sit beside one when that side has room,
            // otherwise drop below it. Obstacles further down end the lane.
            const blockers: DOMRect[] = [];
            const below: DOMRect[] = [];
            document.querySelectorAll<HTMLElement>(OBSTACLES).forEach(o => {
                const r = o.getBoundingClientRect();
                if (!r.width || !r.height) return;
                if (r.bottom <= a.top + 1) return; // wholly above the lane
                if (r.right <= a.left + left || r.left >= a.left + Math.max(a.width, 1)) return;
                // Only an editor card steps aside; panels and controls end the lane as before.
                if (r.top >= a.top + FULL_MIN_LANE || !o.matches(".binding-workspace")) { below.push(r); return; }
                if (r.left - GAP - (a.left + left) >= MIN_CARD_WIDTH) { right = Math.min(right, r.left - GAP); return; }
                if (right - (r.right + GAP) >= MIN_CARD_WIDTH) { left = Math.max(left, Math.ceil(r.right + GAP - a.left)); return; }
                blockers.push(r);
            });
            const drop = blockers.length ? Math.max(0, ...blockers.map(r => Math.ceil(r.bottom + GAP - a.top))) : 0;
            let bottom = window.innerHeight - VIEWPORT_GUTTER;
            for (const r of below) if (r.bottom > a.top + drop) bottom = Math.min(bottom, r.top - GAP);
            setDrop(drop);
            setLane(Math.max(0, Math.round(bottom - a.top - drop)));
            setInset(left);
            const room = Math.floor(right - a.left - left);
            setWidth(Math.max(0, Math.min(MAX_CARD_WIDTH, Math.max(MIN_CARD_WIDTH, Math.round(a.width) - left), room)));
        };
        measure();
        const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
        ro?.observe(document.body);
        if (el.parentElement) ro?.observe(el.parentElement);
        document.querySelectorAll<HTMLElement>(OBSTACLES).forEach(o => ro?.observe(o));
        window.addEventListener("resize", measure);
        // A fixed editor card can move without resizing anything observed.
        window.addEventListener(EDITOR_MOVED_EVENT, measure);
        return () => { ro?.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener(EDITOR_MOVED_EVENT, measure); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return { lane, width, inset, drop };
}

export function KeyInspector({ keyboard, hues, className }: {
    keyboard: KeyboardInfo;
    hues: ReadonlyMap<number, number>;
    className?: string;
}) {
    const { enabled: indicators, active: previewed, activeVia: previewedVia, isPinned } = useComboPreview();
    // Layout keys only. A side panel list row (a combo row) already shows its item, so the card
    // would only echo it; the row's preview still lights its keys on the layout.
    const active = previewed?.kind === "key" ? previewed : null;
    const activeVia = active ? previewedVia : null;
    const { internationalLayout } = useLayoutSettings();
    const combos = keyboard.combos || [];
    const index = useMemo(
        () => buildKeyIndex(keyboard),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [keyboard.combos, keyboard.tapdances, keyboard.macros, keyboard.key_overrides, keyboard.alt_repeat_keys, keyboard.leaders, keyboard.custom_keycodes],
    );
    const model: KeyInspection | null = useMemo(
        () => (active?.kind === "key" && active.key ? inspectKey(keyboard, active.key, index, internationalLayout || "us") : null),
        [active, keyboard, index, internationalLayout],
    );

    // Keep the last card for the leave fade.
    const [leaving, setLeaving] = useState<React.ReactNode>(null);
    const lastBody = useRef<React.ReactNode>(null);
    const wasShown = useRef(false);

    const anchor = useRef<HTMLDivElement>(null);
    const { lane, width, inset, drop } = useLane(anchor, [active?.id, keyboard]);
    const bodyRef = useRef<HTMLDivElement>(null);
    const [hiddenRows, setHiddenRows] = useState(0);

    const pinned = !!active && isPinned(active.id);
    const form: "full" | "strip" | "none" = lane >= FULL_MIN_LANE ? "full" : lane >= STRIP_MIN_LANE ? "strip" : "none";

    let body: React.ReactNode = null;
    let summary = "";
    if (active && form !== "none") {
        let title: string;
        let meta: string;
        let list: ComboMembership[];
        if (model) {
            list = model.combos;
            title = model.title;
            const inN = list.length ? `in ${list.length} combo${list.length === 1 ? "" : "s"}` : "";
            meta = [model.kind, inN].filter(Boolean).join(" · ");
            summary = model.summary;
        } else {
            list = active.combos.map(i => membershipOf(combos, i)).filter((c): c is ComboMembership => !!c);
            title = shortKeyName(active.keycode);
            meta = `in ${list.length} combo${list.length === 1 ? "" : "s"}`;
            summary = `${title}, ${meta}`;
        }
        // A key draws its three lowest-numbered combos; the inspector names the rest too.
        const hidden = hiddenOnKey(list);
        const capped = !pinned && list.length > HOVER_COMBO_CAP;
        const shownCombos = capped ? list.slice(0, HOVER_COMBO_CAP) : list;
        const comboLines = shownCombos.map(c => (
            <ComboLine key={c.index} c={c} hue={hues.get(c.index) ?? 0} name={comboName(keyboard.cosmetic, c.index)} notShown={hidden.has(c.index)} showHue={indicators} />
        ));

        const header = (
            <div className="flex items-baseline gap-2.5 text-[13px] text-muted-foreground min-w-0">
                <strong className="text-kb-ink font-semibold text-sm truncate max-w-[50%]" data-inspector-title="">{title}</strong>
                <span className="truncate">{meta}</span>
                {pinned && <span className="ml-auto text-xs whitespace-nowrap">Pinned · Esc clears</span>}
            </div>
        );

        if (form === "strip") {
            body = (
                <div className="h-8 flex items-center rounded-[10px] border border-kb-combo-chip-border bg-kb-surface text-kb-ink shadow-md px-3.5" data-key-inspector="strip" data-combo-readout="">
                    {header}
                </div>
            );
        } else {
            const combosBlock = list.length > 0 && (
                <SectionBlock id="combos" title="Combos">
                    {comboLines}
                    {capped && <li className="text-[12px] text-muted-foreground pl-[26px]" data-inspector-more-combos="">+{list.length - HOVER_COMBO_CAP} More Combos</li>}
                </SectionBlock>
            );
            body = (
                <div
                    className={cn(
                        "rounded-[10px] border border-kb-combo-chip-border bg-kb-surface text-kb-ink shadow-md flex flex-col",
                        pinned ? "pointer-events-auto" : "pointer-events-none",
                    )}
                    style={{ maxHeight: Math.min(lane, MAX_CARD_HEIGHT) }}
                    data-key-inspector="card"
                    data-combo-readout=""
                    aria-hidden={activeVia === "hover" ? true : undefined}
                >
                    <div ref={bodyRef} className={cn("px-3.5 pt-3 min-h-0", pinned ? "overflow-y-auto" : "overflow-hidden", !model && "pb-3")}>
                        {header}
                        {model && <Sections list={model.before} kb={keyboard} />}
                        {combosBlock}
                        {model && <Sections list={model.after} kb={keyboard} />}
                        {model && <div className="mt-2.5 pb-3 text-[11px] text-muted-foreground" data-inspector-footer="">{model.footer}</div>}
                    </div>
                    {!pinned && hiddenRows > 0 && (
                        <div className="px-3.5 py-1.5 text-[11px] text-muted-foreground border-t border-kb-combo-chip-border" data-inspector-clipped="">
                            +{hiddenRows} More · Click to Pin
                        </div>
                    )}
                </div>
            );
        }
    }

    // Count rows a hovering card clips, for its "+N More" footer.
    useLayoutEffect(() => {
        const el = bodyRef.current;
        if (!el) { setHiddenRows(0); return; }
        if (pinned) {
            el.querySelectorAll<HTMLElement>("[data-inspector-row]").forEach(r => { r.style.visibility = ""; });
            setHiddenRows(0);
            return;
        }
        const limit = el.getBoundingClientRect().bottom;
        let n = 0;
        el.querySelectorAll<HTMLElement>("[data-inspector-row]").forEach(r => {
            r.style.visibility = "";
            if (r.getBoundingClientRect().bottom > limit + 1) { n++; r.style.visibility = "hidden"; }
        });
        setHiddenRows(n);
    });

    // First show fades in; key to key swaps at once; leaving fades out.
    useLayoutEffect(() => {
        if (body) { lastBody.current = body; setLeaving(null); return; }
        if (!wasShown.current || !lastBody.current) return;
        setLeaving(lastBody.current);
        const t = window.setTimeout(() => setLeaving(null), LEAVE_FADE_MS);
        return () => window.clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [!!body]);
    // Each first show mounts a fresh wrapper, so its entrance animation runs once.
    const shows = useRef(0);
    if (body && !wasShown.current) shows.current++;
    useLayoutEffect(() => { wasShown.current = !!body; });

    const announce = activeVia && activeVia !== "hover" ? summary : "";

    return (
        <div ref={anchor} className={cn("w-full", className)}>
            <div style={{ width, marginLeft: inset || undefined, marginTop: drop || undefined }}>
                {body
                    ? <div className="kb-inspector-in" key={shows.current} data-inspector-live="">{body}</div>
                    : leaving && <div className="kb-inspector-out pointer-events-none" aria-hidden="true">{leaving}</div>}
            </div>
            <div aria-live="polite" className="sr-only" data-inspector-summary="">{announce}</div>
        </div>
    );
}
