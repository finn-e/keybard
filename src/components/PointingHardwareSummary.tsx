import type { FC } from "react";

import { cn } from "@/lib/utils";
import { usePointingHardware } from "@/hooks/usePointingHardware";
import { MODULE_NAMES, summarizePointingHardware, type PointingHalfSummary } from "@/utils/pointing-hardware";

// Prototype: what each half has attached, from Sval POINTING_HARDWARE (0x2C).
// Groundwork for per-device tuning; the firmware-mismatch advice stays in TrackballMismatchDialog.

const label = (half: PointingHalfSummary) => {
    switch (half.module) {
        case "none": return "None";
        case "unknown": return "Unrecognized trackball sensor";
        case "checking": return "Checking…";
        case "silent": return "Not reporting";
        default: return MODULE_NAMES[half.module];
    }
};

const capitalized = (side: string) => side[0].toUpperCase() + side.slice(1);

interface Props {
    compact?: boolean;
}

/** Each half's pointing module, on firmware that reports it; nothing otherwise. */
const PointingHardwareSummary: FC<Props> = ({ compact }) => {
    const report = usePointingHardware();
    if (!report) return null;
    const halves = summarizePointingHardware(report);
    return (
        <dl
            data-testid="pointing-hardware-summary"
            className={cn("grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm", compact ? "py-1" : "pb-4 pr-[26px]")}
        >
            {halves.map((half, i) => (
                <div key={`${half.side}-${i}`} className="contents">
                    <dt className="text-slate-500 dark:text-neutral-400">{capitalized(half.side)}</dt>
                    <dd className={cn(half.module === "checking" || half.module === "silent" ? "text-slate-500 dark:text-neutral-400" : "text-foreground")}>
                        {label(half)}
                        {!half.firmwareMatches && <span className="text-amber-600 dark:text-amber-400"> (wrong firmware)</span>}
                    </dd>
                </div>
            ))}
        </dl>
    );
};

export default PointingHardwareSummary;
