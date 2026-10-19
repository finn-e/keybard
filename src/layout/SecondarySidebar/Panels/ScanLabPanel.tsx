import { developerSettingsCopy } from "@/utils/developer-settings-copy";
import { appStorage } from "@/utils/app-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useKeyboard } from "@/contexts/KeyboardContext";
import DeveloperTuningSection from "./DeveloperTuningSection";
import { useLayoutSettings } from "@/contexts/LayoutSettingsContext";
import DescriptionBlock from "@/layout/SecondarySidebar/components/DescriptionBlock";
import { customValueService } from "@/services/custom-value.service";
import {
    scanlabService,
    hwRevisionName,
    colNames,
    lowestCleanValue,
    suggestWithMargin,
    predictDutyPct,
    predictCurrentMa,
    DEFAULT_BASELINE_MA,
    DEFAULT_LIT_ROW_MA,
    DEEP_CLOCK_CHOICES_MHZ,
    IDLE_FEATURES,
    IDLE_PRESETS,
    IDLE_STAGE_NAMES,
    SENSOR_MODE_NAMES,
    type IdleFeature,
    type ScanLabIdle,
    type IdleSettings,
    HAND_NAMES,
    ROW_NAMES,
    SweepState,
    type Hand,
    type ProbeRow,
    type ScanLabStatus,
    type ScanLabPower,
    type SweepStep,
} from "@/services/scanlab.service";
import { cn } from "@/lib/utils";
import { PARANOID, userIsLooking } from "@/lib/paranoid";

type Axis = "pre" | "post";
type ByHand<T> = { 0: T; 1: T };

interface SweepPoint {
    value: number;
    byHand: ByHand<SweepStep | null>;
}

const HANDS: Hand[] = [0, 1];

const sectionTitle = "font-semibold text-lg text-kb-ink";
const mono = "font-mono tabular-nums";

/**
 * Scan Lab: characterize the optical matrix's scan timing from the host.
 *
 * - Status: hardware revision and effective/saved pre-wait and post-wait per half.
 * - Probe: the firmware times each sense line's settle (row-on) and recovery
 *   (row-off) and reports each key's measured polarity. Nothing may be pressed.
 * - Sweep: run frames at a series of candidate timings and count per-key
 *   mismatches against a reference captured at safe timing. Keys held during
 *   the sweep are part of the reference, so pressed states can be covered.
 * - Apply: write explicit pre/post-wait to the keyboard (both halves).
 */
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)} s` : `${ms} ms`);
const fmtPeriod = (us: number) => (us >= 10000 ? `${(us / 1000).toFixed(us >= 100000 ? 0 : 1)} ms` : `${us} µs`);

/** How long the armed reboot button waits for its confirming click. Generous so scripted clicks fit too. */
const REBOOT_CONFIRM_WINDOW_MS = 20000;

const ScanLabPanel = () => {
    const { isConnected, connect } = useKeyboard();
    const { layoutMode } = useLayoutSettings();
    const isHorizontal = layoutMode === "bottombar";

    const [status, setStatus] = useState<ByHand<ScanLabStatus | null>>({ 0: null, 1: null });
    const [probes, setProbes] = useState<ByHand<ProbeRow[]>>({ 0: [], 1: [] });
    const [axis, setAxis] = useState<Axis>("pre");
    const [from, setFrom] = useState(300);
    const [to, setTo] = useState(10);
    const [step, setStep] = useState(10);
    const [fixed, setFixed] = useState(200);
    const [frames, setFrames] = useState(200);
    const [sweep, setSweep] = useState<{ axis: Axis; fixed: number; points: SweepPoint[] } | null>(null);
    const [applyPre, setApplyPre] = useState(0);
    const [applyPost, setApplyPost] = useState(0);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const cancelRef = useRef(false);
    const [power, setPower] = useState<ByHand<ScanLabPower | null>>({ 0: null, 1: null });
    const [periodUs, setPeriodUs] = useState(1000);
    const [idle, setIdle] = useState<IdleSettings>({ idleAfterMs: 1000, idlePeriodMs: 1, deepAfterS: 0, deepPeriodMs: 0 });
    const setIdleField = (k: keyof IdleSettings) => (v: number) => setIdle((i) => ({ ...i, [k]: v }));
    const [idleDiag, setIdleDiag] = useState<ByHand<ScanLabIdle | null>>({ 0: null, 1: null });
    const [rebootArmedFor, setRebootArmedFor] = useState<Hand | null>(null);
    const [rebootNote, setRebootNote] = useState<string | null>(null);
    const pacingSeededRef = useRef(false);
    // Per-browser current model (baseline mA, mA per lit row) so the panel can
    // turn measured duty into an expected total current without the ammeter.
    const [baselineMa, setBaselineMa] = useState(() => {
        try { return Number(appStorage.getItem("scanlab-baseline-ma")) || DEFAULT_BASELINE_MA; } catch { return DEFAULT_BASELINE_MA; }
    });
    const [litRowMa, setLitRowMa] = useState(() => {
        try { return Number(appStorage.getItem("scanlab-lit-row-ma")) || DEFAULT_LIT_ROW_MA; } catch { return DEFAULT_LIT_ROW_MA; }
    });
    useEffect(() => {
        try { appStorage.setItem("scanlab-baseline-ma", String(baselineMa)); appStorage.setItem("scanlab-lit-row-ma", String(litRowMa)); } catch { /* per-browser convenience only */ }
    }, [baselineMa, litRowMa]);

    const reachableHands = useMemo(() => HANDS.filter((h) => status[h]?.reachable), [status]);

    const refreshStatus = useCallback(async () => {
        const next: ByHand<ScanLabStatus | null> = { 0: null, 1: null };
        for (const h of HANDS) {
            try {
                next[h] = await scanlabService.getStatus(h);
            } catch (e) {
                next[h] = null;
                setError(e instanceof Error ? e.message : String(e));
            }
        }
        setStatus(next);
        const any = next[0]?.reachable ? next[0] : next[1];
        if (any) {
            setApplyPre(any.savedPrewaitUs || any.effPrewaitUs);
            setApplyPost(any.savedPostwaitUs || any.effPostwaitUs);
            setFixed(any.effPostwaitUs || 200);
        }
    }, []);

    useEffect(() => {
        if (isConnected) refreshStatus();
    }, [isConnected, refreshStatus]);

    // Live power readout: poll the firmware's measured frame interval and LED-on
    // time once a second while the panel is idle, so a changed setting shows up
    // next to the ammeter reading within a second.
    const refreshPower = useCallback(async () => {
        const next: ByHand<ScanLabPower | null> = { 0: null, 1: null };
        const nextIdle: ByHand<ScanLabIdle | null> = { 0: null, 1: null };
        for (const h of HANDS) {
            if (!status[h]?.reachable) continue;
            try {
                next[h] = await scanlabService.getPower(h);
                nextIdle[h] = await scanlabService.getIdle(h);
            } catch {
                next[h] = null;
            }
        }
        setPower(next);
        setIdleDiag(nextIdle);
        const any = next[0]?.reachable ? next[0] : next[1];
        if (any && !pacingSeededRef.current) {
            pacingSeededRef.current = true;
            setPeriodUs(any.periodUs);
            setIdle({ idleAfterMs: any.idleAfterMs, idlePeriodMs: any.idlePeriodMs, deepAfterS: any.deepAfterS, deepPeriodMs: any.deepPeriodMs });
        }
    }, [status]);

    useEffect(() => {
        if (!isConnected || busy) return;
        // Paranoid: idle readings reveal typing timing, so only take them while you're looking.
        const tick = () => { if (!PARANOID || userIsLooking()) refreshPower(); };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [isConnected, busy, refreshPower]);

    const run = async (label: string, fn: () => Promise<void>) => {
        setBusy(label);
        setError(null);
        cancelRef.current = false;
        try {
            await fn();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(null);
        }
    };

    const handleProbe = () =>
        run("Probing…", async () => {
            setProbes({ 0: [], 1: [] });
            for (const h of reachableHands) {
                await scanlabService.probeAll(h, (row) => {
                    setBusy(`Probing ${HAND_NAMES[h]} ${ROW_NAMES[row.row]}…`);
                    setProbes((p) => ({ ...p, [h]: [...p[h].filter((r) => r.row !== row.row), row].sort((a, b) => a.row - b.row) }));
                });
            }
            await refreshStatus();
        });

    const sweepValues = useMemo(() => {
        const vals: number[] = [];
        const s = Math.max(1, Math.abs(step));
        if (from >= to) for (let v = from; v >= to; v -= s) vals.push(v);
        else for (let v = from; v <= to; v += s) vals.push(v);
        return vals;
    }, [from, to, step]);

    const handleSweep = () =>
        run("Sweeping…", async () => {
            const points: SweepPoint[] = [];
            setSweep({ axis, fixed, points });
            for (const value of sweepValues) {
                if (cancelRef.current) break;
                const point: SweepPoint = { value, byHand: { 0: null, 1: null } };
                for (const h of reachableHands) {
                    if (cancelRef.current) break;
                    setBusy(`${axis === "pre" ? "Pre" : "Post"}-wait ${value} µs, ${HAND_NAMES[h]}…`);
                    const pre = axis === "pre" ? value : fixed;
                    const post = axis === "post" ? value : fixed;
                    point.byHand[h] = await scanlabService.runSweepStep(h, pre, post, frames);
                }
                points.push(point);
                setSweep({ axis, fixed, points: [...points] });
            }
            if (cancelRef.current) for (const h of reachableHands) await scanlabService.abort(h);
            await refreshStatus();
        });

    const handleStop = async () => {
        cancelRef.current = true;
        for (const h of reachableHands) {
            try { await scanlabService.abort(h); } catch { /* best effort */ }
        }
    };

    const handleApply = (pre: number, post: number) =>
        run("Applying…", async () => {
            await scanlabService.applyTiming(pre, post);
            customValueService.setCached("id_scan_prewait_us", pre);
            customValueService.setCached("id_scan_postwait_us", post);
            await refreshStatus();
        });

    const handleApplyPacing = () =>
        run("Applying pacing…", async () => {
            await scanlabService.applyPacing(periodUs, idle);
            customValueService.setCached("id_scan_period_us", periodUs);
            customValueService.setCached("id_scan_idle_period_ms", idle.idlePeriodMs);
            customValueService.setCached("id_scan_idle_after_ms", idle.idleAfterMs);
            customValueService.setCached("id_scan_deep_after_s", idle.deepAfterS);
            customValueService.setCached("id_scan_deep_period_ms", idle.deepPeriodMs);
            await refreshPower();
        });

    const handleIdleFeature = (feature: IdleFeature, on: boolean) => {
        const f = IDLE_FEATURES.find((x) => x.key === feature)!;
        return run(`${on ? "Enabling" : "Disabling"} ${f.label.toLowerCase()}…`, async () => {
            await scanlabService.setIdleFeature(feature, on);
            customValueService.setCached(f.cacheKey, on ? 1 : 0);
            await refreshPower();
        });
    };

    const handleDeepClock = (mhz: number) =>
        run(`Setting deep idle processor speed to ${mhz} MHz…`, async () => {
            await scanlabService.setDeepClock(mhz);
            customValueService.setCached("id_scan_deep_clock_idx", DEEP_CLOCK_CHOICES_MHZ.indexOf(mhz as 48 | 24 | 12));
            await refreshPower();
        });

    const handleReboot = (h: Hand) => {
        if (rebootArmedFor !== h) {
            setRebootArmedFor(h);
            setRebootNote(null);
            setTimeout(() => setRebootArmedFor((cur) => (cur === h ? null : cur)), REBOOT_CONFIRM_WINDOW_MS);
            return;
        }
        setRebootArmedFor(null);
        run(`Rebooting ${HAND_NAMES[h]}…`, async () => {
            const ok = await scanlabService.rebootToBootloader(h);
            if (!ok) throw new Error(`${HAND_NAMES[h]} half declined the reboot (token window expired?)`);
            setRebootNote(h === (status[0]?.isLeft ? 0 : 1)
                ? `${HAND_NAMES[h]} half is rebooting into the bootloader and will show up as the RPI-RP2 drive. Run keyboards/svalboard/tools/flash.sh <image.uf2>, then reconnect from the keyboard list.`
                : `${HAND_NAMES[h]} half is in bootloader mode on the link. Move the USB cable to it; it appears as the RPI-RP2 drive. Run flash.sh, then reconnect.`);
        });
    };

    // --- derived summaries -------------------------------------------------

    const probeSummary = useMemo(() => {
        let settle = { us: 0, where: "" };
        let recover = { us: 0, where: "" };
        let polarityIssues: string[] = [];
        for (const h of HANDS) {
            for (const r of probes[h]) {
                if (!r.valid) continue;
                const names = colNames(r.row);
                r.columns.forEach((c) => {
                    const where = `${HAND_NAMES[h]} ${ROW_NAMES[r.row]} ${names[c.col]}`;
                    if (c.settleUs > settle.us) settle = { us: c.settleUs, where };
                    if (c.recoverUs > recover.us) recover = { us: c.recoverUs, where };
                    if (c.col !== 5 && c.activeDark !== c.expectedActiveDark) polarityIssues.push(where);
                });
            }
        }
        return { settle, recover, polarityIssues };
    }, [probes]);

    const sweepSummary = useMemo(() => {
        if (!sweep || sweep.points.length === 0) return null;
        const perHand = HANDS.map((h) => {
            const steps = sweep.points
                .filter((p) => p.byHand[h])
                .map((p) => ({ value: p.value, totalMismatches: p.byHand[h]!.totalMismatches }));
            return { hand: h, lowestClean: steps.length ? lowestCleanValue(steps) : null };
        });
        const worst = perHand.reduce<number | null>((acc, p) => {
            if (p.lowestClean === null) return acc;
            return acc === null ? p.lowestClean : Math.max(acc, p.lowestClean);
        }, null);
        const anyUnclean = perHand.some((p) => p.lowestClean === null && sweep.points.some((pt) => pt.byHand[p.hand]));
        return { perHand, worst, suggestion: anyUnclean ? null : suggestWithMargin(worst) };
    }, [sweep]);

    // --- render --------------------------------------------------------------

    if (!isConnected) {
        return (
            <section className="h-full flex flex-col pt-2">
                <DescriptionBlock>
                    <button onClick={() => connect()} className="underline underline-offset-2 hover:text-foreground transition-all text-inherit">
                        Connect
                    </button>
                    {" a keyboard to use the Scan Lab."}
                </DescriptionBlock>
            </section>
        );
    }

    const statusCards = (
        <div className="grid gap-2 grid-cols-2">
            {HANDS.map((h) => {
                const s = status[h];
                return (
                    <div key={h} className="panel-layer-item p-2 rounded-md text-xs flex flex-col gap-0.5" data-testid={`status-${h}`}>
                        <div className="font-semibold text-sm">{HAND_NAMES[h]}</div>
                        {!s ? (
                            <span className="text-muted-foreground">no status</span>
                        ) : !s.reachable ? (
                            <span className="text-muted-foreground">not reachable</span>
                        ) : (
                            <>
                                <span>Revision <b>{hwRevisionName(s.hwRevision)}</b></span>
                                <span className={mono}>pre {s.effPrewaitUs} µs · post {s.effPostwaitUs} µs</span>
                                <span className="text-muted-foreground">
                                    {s.savedPrewaitUs || s.savedPostwaitUs ? "explicit" : `turbo table ${s.turboIndex}`}
                                    {s.sweepState !== SweepState.Idle && ` · sweep ${SweepState[s.sweepState]}`}
                                </span>
                            </>
                        )}
                    </div>
                );
            })}
        </div>
    );

    const probeSection = (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <span className={sectionTitle}>Settle probe</span>
                <Button size="sm" variant="kb-primary" onClick={handleProbe} disabled={!!busy || reachableHands.length === 0}>
                    Probe all rows
                </Button>
            </div>
            <p className="text-xs text-muted-foreground">Hands off the keys. Each cell shows settle / recovery in µs; AD = measured active dark, AL = active light.</p>
            {HANDS.filter((h) => probes[h].length > 0).map((h) => (
                <div key={h} className="overflow-x-auto">
                    <table className="text-[11px] w-full border-collapse" data-testid={`probe-${h}`}>
                        <thead>
                            <tr>
                                <th className="text-left pr-2 font-semibold">{HAND_NAMES[h]}</th>
                                {colNames(1).map((c, i) => <th key={i} className="px-1 text-center font-semibold">{c}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {probes[h].map((r) => (
                                <tr key={r.row} className="border-t border-kb-gray-border/40">
                                    <td className="pr-2 py-0.5 whitespace-nowrap">{ROW_NAMES[r.row]}{r.row === 0 && <span className="text-muted-foreground"> (OL OU D IL MODE DD)</span>}</td>
                                    {r.columns.map((c) => {
                                        const mismatch = c.col !== 5 && c.activeDark !== c.expectedActiveDark;
                                        return (
                                            <td key={c.col} className={cn("px-1 py-0.5 text-center", mono, mismatch && "text-red-600 dark:text-red-400 font-bold")} title={`${c.settleChanges} / ${c.recoverChanges} level changes`}>
                                                {r.valid ? `${c.settleUs}/${c.recoverUs}` : "–"}
                                                <span className="text-muted-foreground"> {c.activeDark ? "AD" : "AL"}</span>
                                                {(c.settleChanges > 1 || c.recoverChanges > 1) && <span className="text-amber-600 dark:text-amber-400">~</span>}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ))}
            {(probes[0].length > 0 || probes[1].length > 0) && (
                <div className="text-xs flex flex-col gap-0.5" data-testid="probe-summary">
                    <span>Slowest settle: <b className={mono}>{probeSummary.settle.us} µs</b> ({probeSummary.settle.where || "none moved"})</span>
                    <span>Slowest recovery: <b className={mono}>{probeSummary.recover.us} µs</b> ({probeSummary.recover.where || "none moved"})</span>
                    {probeSummary.polarityIssues.length > 0 ? (
                        <span className="text-red-600 dark:text-red-400">Polarity disagrees with the firmware table: {probeSummary.polarityIssues.join(", ")}</span>
                    ) : (
                        <span className="text-muted-foreground">Measured polarity matches the firmware table.</span>
                    )}
                    <span className="text-muted-foreground">~ marks a line that crossed the threshold more than once before settling.</span>
                </div>
            )}
        </div>
    );

    const chart = sweep && sweep.points.length > 1 ? (() => {
        const W = 320, H = 110, L = 28, B = 18;
        const xs = sweep.points.map((p) => p.value);
        const xmin = Math.min(...xs), xmax = Math.max(...xs);
        const ymax = Math.max(1, ...sweep.points.flatMap((p) => HANDS.map((h) => p.byHand[h]?.totalMismatches ?? 0)));
        const X = (v: number) => L + ((v - xmin) / Math.max(1, xmax - xmin)) * (W - L - 4);
        const Y = (m: number) => H - B - (m / ymax) * (H - B - 6);
        const colors: ByHand<string> = { 0: "#2b5fd9", 1: "#c0392b" };
        return (
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[420px]" role="img" aria-label="mismatches versus timing">
                <line x1={L} y1={H - B} x2={W - 4} y2={H - B} stroke="currentColor" strokeOpacity="0.3" />
                <line x1={L} y1={6} x2={L} y2={H - B} stroke="currentColor" strokeOpacity="0.3" />
                <text x={L} y={H - 4} fontSize="9" fill="currentColor">{xmin} µs</text>
                <text x={W - 4} y={H - 4} fontSize="9" fill="currentColor" textAnchor="end">{xmax} µs</text>
                <text x={L - 3} y={10} fontSize="9" fill="currentColor" textAnchor="end">{ymax}</text>
                {HANDS.map((h) => {
                    const pts = sweep.points.filter((p) => p.byHand[h]).map((p) => `${X(p.value)},${Y(p.byHand[h]!.totalMismatches)}`);
                    return pts.length > 1 ? <polyline key={h} points={pts.join(" ")} fill="none" stroke={colors[h]} strokeWidth="1.5" /> : null;
                })}
                {sweepSummary?.suggestion !== null && sweepSummary?.suggestion !== undefined && sweepSummary.suggestion >= xmin && sweepSummary.suggestion <= xmax && (
                    <line x1={X(sweepSummary.suggestion)} y1={6} x2={X(sweepSummary.suggestion)} y2={H - B} stroke="#1f7a4d" strokeDasharray="3 2" />
                )}
            </svg>
        );
    })() : null;

    const numberField = (label: string, value: number, set: (v: number) => void, id: string, onEnter?: () => void) => (
        <label className="flex flex-col text-[10px] text-muted-foreground gap-0.5">
            {label}
            <Input id={id} type="number" value={value} onChange={(e) => set(Number(e.target.value))} className="h-7 w-20 text-xs" disabled={!!busy}
                onKeyDown={onEnter ? (e) => { if (e.key === "Enter") { e.preventDefault(); onEnter(); } } : undefined} />
        </label>
    );

    const sweepSection = (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <span className={sectionTitle}>Validation sweep</span>
                {busy ? (
                    <Button size="sm" variant="destructive" onClick={handleStop}>Stop</Button>
                ) : (
                    <Button size="sm" variant="kb-primary" onClick={handleSweep} disabled={reachableHands.length === 0 || sweepValues.length === 0}>
                        Run sweep
                    </Button>
                )}
            </div>
            <div className="flex flex-wrap items-end gap-2">
                <div className="flex gap-1">
                    <Button size="sm" variant={axis === "pre" ? "default" : "secondary"} onClick={() => setAxis("pre")} disabled={!!busy}>Pre-wait</Button>
                    <Button size="sm" variant={axis === "post" ? "default" : "secondary"} onClick={() => setAxis("post")} disabled={!!busy}>Post-wait</Button>
                </div>
                {numberField("from µs", from, setFrom, "scanlab-from")}
                {numberField("to µs", to, setTo, "scanlab-to")}
                {numberField("step µs", step, setStep, "scanlab-step")}
                {numberField(`fixed ${axis === "pre" ? "post" : "pre"}-wait µs`, fixed, setFixed, "scanlab-fixed")}
                {numberField("frames", frames, setFrames, "scanlab-frames")}
            </div>
            <p className="text-xs text-muted-foreground">
                {sweepValues.length} steps. Each step captures a reference at 500/500 µs, then counts per-key mismatches over the frames. Hold keys to include pressed states; keep them held for the whole sweep.
            </p>
            {chart}
            {sweep && sweep.points.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="text-[11px] border-collapse" data-testid="sweep-table">
                        <thead><tr><th className="text-left pr-3">{sweep.axis === "pre" ? "Pre" : "Post"}-wait</th><th className="px-2">Left</th><th className="px-2">Right</th></tr></thead>
                        <tbody>
                            {sweep.points.map((p) => (
                                <tr key={p.value} className="border-t border-kb-gray-border/40">
                                    <td className={cn("pr-3", mono)}>{p.value} µs</td>
                                    {HANDS.map((h) => {
                                        const s = p.byHand[h];
                                        return (
                                            <td key={h} className={cn("px-2 text-center", mono, s && s.totalMismatches > 0 && "text-red-600 dark:text-red-400", s && s.state === SweepState.ReferenceFailed && "text-amber-600 dark:text-amber-400")}>
                                                {!s ? "–" : s.state === SweepState.ReferenceFailed ? "ref?" : s.totalMismatches}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {sweepSummary && (
                <div className="text-xs flex flex-col gap-0.5" data-testid="sweep-summary">
                    {sweepSummary.perHand.map((p) => (
                        <span key={p.hand}>{HAND_NAMES[p.hand]} lowest clean: <b className={mono}>{p.lowestClean === null ? "none" : `${p.lowestClean} µs`}</b></span>
                    ))}
                    {sweepSummary.suggestion !== null ? (
                        <span>Suggested {sweep!.axis}-wait with 50% margin: <b className={mono}>{sweepSummary.suggestion} µs</b>{" "}
                            <button className="underline" onClick={() => (sweep!.axis === "pre" ? setApplyPre(sweepSummary.suggestion!) : setApplyPost(sweepSummary.suggestion!))}>use it</button>
                        </span>
                    ) : (
                        <span className="text-amber-600 dark:text-amber-400">No clean value in this range. Widen the range or check the reference.</span>
                    )}
                </div>
            )}
        </div>
    );

    const applySection = (
        <div className="flex flex-col gap-2">
            <span className={sectionTitle}>Apply timing</span>
            <div className="flex flex-wrap items-end gap-2">
                {numberField("pre-wait µs", applyPre, setApplyPre, "scanlab-apply-pre")}
                {numberField("post-wait µs", applyPost, setApplyPost, "scanlab-apply-post")}
                <Button size="sm" variant="kb-primary" onClick={() => handleApply(applyPre, applyPost)} disabled={!!busy}>Apply to keyboard</Button>
                <Button size="sm" variant="secondary" onClick={() => handleApply(0, 0)} disabled={!!busy}>Back to turbo table</Button>
            </div>
            <p className="text-xs text-muted-foreground">Written to EEPROM on the connected half and pushed to the other half within half a second.</p>
        </div>
    );

    const anyPower = power[0]?.reachable ? power[0] : power[1]?.reachable ? power[1] : null;
    const expectedActive = anyPower ? predictDutyPct(anyPower, periodUs) : null;
    const expectedLight = anyPower && idle.idleAfterMs > 0 ? predictDutyPct(anyPower, Math.max(periodUs, idle.idlePeriodMs * 1000)) : null;
    const expectedDeep = anyPower && idle.deepAfterS > 0 ? predictDutyPct(anyPower, Math.max(periodUs, idle.deepPeriodMs * 1000)) : null;
    const fmtDuty = (d: number | null) => (d === null ? "depends on loop load" : `${d.toFixed(1)} % ≈ ${predictCurrentMa(baselineMa, litRowMa, d)!.toFixed(0)} mA`);

    // Typed values do nothing until applied; say so loudly when they differ from the board.
    const pacingDirty = !!anyPower && (
        periodUs !== anyPower.periodUs || idle.idleAfterMs !== anyPower.idleAfterMs || idle.idlePeriodMs !== anyPower.idlePeriodMs ||
        idle.deepAfterS !== anyPower.deepAfterS || idle.deepPeriodMs !== anyPower.deepPeriodMs);
    const onBoard = anyPower
        ? `On board: period ${anyPower.periodUs === 0 ? "unpaced" : `${anyPower.periodUs} µs`} · idle ${anyPower.idleAfterMs === 0 ? "off" : `${anyPower.idlePeriodMs} ms after ${fmtMs(anyPower.idleAfterMs)}`} · deep idle ${anyPower.deepAfterS === 0 ? "off" : `${anyPower.deepPeriodMs} ms after ${anyPower.deepAfterS} s`}`
        : null;

    const powerSection = (
        <div className="flex flex-col gap-2" data-testid="power-section">
            <div className="flex items-center justify-between gap-2">
                <span className={sectionTitle}>Power</span>

            </div>
            <p className="text-xs text-muted-foreground">
                Sensor LED duty = rows × (pre-wait + read) ÷ frame period. The firmware measures both; change a value, apply (or press Enter), and watch the ammeter.
            </p>
            {onBoard && <p className={cn("text-xs", pacingDirty ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")} data-testid="pacing-on-board">{onBoard}{pacingDirty ? " — the fields below differ; apply to change it." : ""}</p>}
            <div className={cn("grid gap-2", "grid-cols-2")}>
                {HANDS.map((h) => {
                    const p = power[h];
                    return (
                        <div key={h} className="panel-layer-item p-2 rounded-md text-xs flex flex-col gap-0.5" data-testid={`power-${h}`}>
                            <div className="font-semibold text-sm">{HAND_NAMES[h]}</div>
                            {!p || !p.reachable ? (
                                <span className="text-muted-foreground">no reading</span>
                            ) : (
                                <>
                                    <span>LED duty <b className={mono}>{p.dutyPct === null ? "–" : `${p.dutyPct.toFixed(1)} %`}</b>{p.dutyPct !== null && <span className={cn("text-muted-foreground", mono)} data-testid={`power-ma-${h}`}> ≈ {predictCurrentMa(baselineMa, litRowMa, p.dutyPct)!.toFixed(0)} mA</span>}{p.stage > 0 && <span className="text-muted-foreground"> · {IDLE_STAGE_NAMES[p.stage]}</span>}</span>
                                    <span className={mono}>frame {p.frameCapped ? `≈ ${fmtPeriod(p.effectivePeriodTrueUs)} (set)` : `${p.measuredFrameUs} µs`} · LED on {p.measuredLedUs} µs</span>
                                    {idleDiag[h]?.reachable && (() => {
                                        const d = idleDiag[h]!;
                                        const fmtQuiet = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s` : `${ms} ms`);
                                        return (
                                            <span className={cn("text-muted-foreground", mono)} data-testid={`idle-diag-${h}`}>
                                                {d.sensorPresent ? `sensor ${d.sensorMode === null ? "no read yet" : SENSOR_MODE_NAMES[d.sensorMode]}${d.sensorLifted ? " · lifted" : ""}${d.sensorRestEnabled ? "" : " · power saving off"}` : "no sensor"}
                                                {` · RGB ${d.rgbEnabled ? d.rgbValNow : "off"}/${d.rgbValAwake}${d.rgbStage === 1 ? " dimmed" : d.rgbStage === 2 ? " off" : ""}`}
                                                {` · quiet keys ${fmtQuiet(d.quietMatrixMs)}, ball ${fmtQuiet(d.quietPointerMs)}`}
                                                {d.sysClockMhz !== null && ` · clock ${d.sysClockMhz} MHz`}
                                            </span>
                                        );
                                    })()}
                                    <span className={cn("text-muted-foreground", mono)}>
                                        {p.scanHz === null ? "" : p.scanHz >= 10 ? `${p.scanHz.toFixed(0)} Hz` : `${p.scanHz.toFixed(2)} Hz`} · period {p.effectivePeriodTrueUs === 0 ? "unpaced" : fmtPeriod(p.effectivePeriodTrueUs)}
                                    </span>
                                </>
                            )}
                        </div>
                    );
                })}
            </div>
            <details>
                <summary className="cursor-pointer text-sm font-medium">Power tuning</summary>
                <div className="flex flex-col gap-2 pt-2">
                    <Button size="sm" variant={pacingDirty ? "kb-primary" : "secondary"} onClick={handleApplyPacing} disabled={!!busy || reachableHands.length === 0} data-testid="apply-pacing">
                        {pacingDirty ? "Apply pacing (not on board yet)" : "Apply pacing"}
                    </Button>
                    <div className="flex flex-wrap items-end gap-2">
                        {numberField("Active scan interval · µs", periodUs, setPeriodUs, "scanlab-period", handleApplyPacing)}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[10px] text-muted-foreground mr-1">Idle presets:</span>
                        {IDLE_PRESETS.map((pr) => (
                            <Button key={pr.name} size="sm" variant="secondary" title={pr.hint} disabled={!!busy}
                                onClick={() => setIdle({ idleAfterMs: pr.idleAfterMs, idlePeriodMs: pr.idlePeriodMs, deepAfterS: pr.deepAfterS, deepPeriodMs: pr.deepPeriodMs })}>
                                {pr.name}
                            </Button>
                        ))}
                    </div>
                    <div className="flex flex-col gap-1.5" data-testid="idle-stage-fields">
                        <div className="flex items-end gap-2">
                            {numberField(developerSettingsCopy.id_scan_idle_after_ms.label, idle.idleAfterMs, setIdleField("idleAfterMs"), "scanlab-idle-after", handleApplyPacing)}
                            {numberField(developerSettingsCopy.id_scan_idle_period_ms.label, idle.idlePeriodMs, setIdleField("idlePeriodMs"), "scanlab-idle-period", handleApplyPacing)}
                        </div>
                        <div className="flex items-end gap-2">
                            {numberField(developerSettingsCopy.id_scan_deep_after_s.label, idle.deepAfterS, setIdleField("deepAfterS"), "scanlab-deep-after", handleApplyPacing)}
                            {numberField(developerSettingsCopy.id_scan_deep_period_ms.label, idle.deepPeriodMs, setIdleField("deepPeriodMs"), "scanlab-deep-period", handleApplyPacing)}
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">Idle and deep idle reduce key scanning after inactivity. Input restores active scanning. Longer scan intervals can delay the first response. Zero disables a timeout.</p>
                    {anyPower && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1" data-testid="idle-features">
                            {IDLE_FEATURES.map((f) => (
                                <label key={f.key} className="flex items-center gap-1.5 text-xs" title={f.hint}>
                                    <input type="checkbox" checked={anyPower.idle[f.key]} disabled={!!busy} onChange={(e) => handleIdleFeature(f.key, e.target.checked)} data-testid={`idle-${f.key}`} />
                                    {f.label}
                                    {f.key === "lowClock" && (idleDiag[0]?.deepClockMhz ?? idleDiag[1]?.deepClockMhz) != null && (
                                        <select className="h-6 text-xs border rounded px-1" value={idleDiag[0]?.deepClockMhz ?? idleDiag[1]?.deepClockMhz ?? 48} disabled={!!busy}
                                            onChange={(e) => handleDeepClock(Number(e.target.value))} data-testid="deep-clock" aria-label="Deep idle processor speed">
                                            {DEEP_CLOCK_CHOICES_MHZ.map((m) => <option key={m} value={m}>{m} MHz</option>)}
                                        </select>
                                    )}
                                </label>
                            ))}
                        </div>
                    )}
                    {anyPower && (
                        <p className="text-xs text-muted-foreground" data-testid="power-expected">
                            Expected from {anyPower.measuredLedUs > 0 ? `measured ${anyPower.measuredLedUs} µs LED-on per frame` : `pre-wait ${anyPower.effPrewaitUs} µs`}: active {fmtDuty(expectedActive)}
                            {expectedLight !== null && `; idle ${fmtDuty(expectedLight)}`}
                            {expectedDeep !== null && `; deep idle ${fmtDuty(expectedDeep)}`}.
                        </p>
                    )}
                    <div className="flex flex-wrap items-end gap-2">
                        {numberField("baseline mA (LEDs off)", baselineMa, setBaselineMa, "scanlab-baseline-ma")}
                        {numberField("mA per lit row", litRowMa, setLitRowMa, "scanlab-lit-row-ma")}
                        <span className="text-[10px] text-muted-foreground max-w-[220px]">Current model for the ≈ figures. Measure baseline at a 65 ms period; the per-row figure is (total − baseline) ÷ duty.</span>
                    </div>
                </div>
            </details>
        </div>
    );

    const firmwareSection = (
        <div className="flex flex-col gap-2" data-testid="firmware-section">
            <span className={sectionTitle}>Firmware</span>
            <p className="text-xs text-muted-foreground">Reboot a half into the RP2040 bootloader without touching it. Two clicks: arm, then confirm within 20 s. The firmware applies its own arm-then-go rule on top.</p>
            <div className="flex flex-wrap gap-2">
                {HANDS.map((h) => {
                    const supported = !!power[h]?.hostBootloader;
                    const armed = rebootArmedFor === h;
                    return (
                        <Button key={h} size="sm" variant={armed ? "destructive" : "secondary"} disabled={!!busy || !supported} onClick={() => handleReboot(h)}
                            title={supported ? undefined : "This half's firmware was built without SVAL_HOST_BOOTLOADER"} data-testid={`reboot-${h}`}>
                            {armed ? `Confirm: reboot ${HAND_NAMES[h]}` : `Reboot ${HAND_NAMES[h]} into bootloader`}
                        </Button>
                    );
                })}
            </div>
            {rebootNote && <p className="text-xs" data-testid="reboot-note">{rebootNote}</p>}
        </div>
    );

    const feedback = (
        <div className="text-xs min-h-[1rem]" aria-live="polite">
            {busy && <span className="text-muted-foreground">{busy}</span>}
            {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
        </div>
    );

    if (isHorizontal) {
        return (
            <div className="flex flex-row gap-4 items-start flex-wrap content-start">
                <div className="flex flex-col gap-2 min-w-0 w-full max-w-[520px]">{statusCards}{feedback}{powerSection}{applySection}{firmwareSection}</div>
                <div className="min-w-0 w-full max-w-[520px]">{probeSection}</div>
                <div className="min-w-0 w-full max-w-[520px]">{sweepSection}</div>
                <div className="min-w-0 w-full max-w-[520px]"><DeveloperTuningSection /></div>
            </div>
        );
    }

    return (
        <section className="flex flex-col">
            <div className="flex flex-col gap-5 pb-4">
                <DescriptionBlock>
                    Measure how long the sense lines take to settle and recover, sweep the scan timing to find where reads go wrong, then apply explicit pre- and post-wait to the keyboard.
                </DescriptionBlock>
                {statusCards}
                {feedback}
                {powerSection}
                {probeSection}
                {sweepSection}
                {applySection}
                {firmwareSection}
                <DeveloperTuningSection />
            </div>
        </section>
    );
};

export default ScanLabPanel;
