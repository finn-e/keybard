import { useState, type FC, type ReactNode } from "react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FirmwareLink } from "@/components/FirmwareUpdate";
import { useKeyboard } from "@/contexts/KeyboardContext";
import {
    findPointingProblems,
    MODULE_NAMES,
    type PointingHalfReport,
    type PointingModule,
    type PointingProblem,
} from "@/utils/pointing-hardware";

const File = ({ name }: { name: string }) => <span className="break-all font-mono text-kb-ink">{name}</span>;

const halfName = (half: PointingHalfReport) => `The ${half.side} half`;

/** A module's name with "a" or "an" in front. */
const aModule = (module: PointingModule) => `${/^[AEIOU]/.test(MODULE_NAMES[module]) ? "an" : "a"} ${MODULE_NAMES[module]}`;

const hex = (n: number) => `0x${n.toString(16).padStart(2, "0").toUpperCase()}`;

function describe(problem: PointingProblem): ReactNode {
    switch (problem.kind) {
        case "wrong-module":
            return (
                <>
                    {problem.builtFor === "none"
                        ? <>{halfName(problem.half)}'s firmware has no pointing-device support, but {aModule(problem.actual)} is attached, so it won't work.</>
                        : <>{halfName(problem.half)}'s firmware is for {aModule(problem.builtFor)}, but {aModule(problem.actual)} is attached, so it won't work.</>}{" "}
                    Flash it with <File name={problem.file} />.
                </>
            );
        case "no-module":
            return (
                <>
                    {halfName(problem.half)}'s firmware is for {aModule(problem.builtFor)}, but no pointing device
                    answered. If this half has one, check its cable. If it has none, flash <File name={problem.file} />.
                </>
            );
        case "unknown-sensor":
            return (
                <>
                    {halfName(problem.half)}'s firmware is for {aModule(problem.builtFor)}, but its sensor
                    didn't identify as a PMW3360 or PMW3389 (ID {hex(problem.half.productId)}/{hex(problem.half.inverseProductId)})
                    and didn't start. Check its cable.
                </>
            );
    }
}

/**
 * Shown once per connection when a half's firmware doesn't match its pointing
 * device (or lack of one). Names the .uf2 that fixes it.
 */
export const TrackballMismatchDialog: FC = () => {
    const { keyboard, isConnected } = useKeyboard();
    const [acknowledged, setAcknowledged] = useState<string | null>(null);
    const kbid = keyboard?.kbid ?? "";
    const problems = isConnected ? findPointingProblems(keyboard?.pointing_hardware) : [];
    const open = problems.length > 0 && acknowledged !== kbid;
    const acknowledge = () => setAcknowledged(kbid);

    return (
        <Dialog open={open} onOpenChange={(next) => !next && acknowledge()}>
            <DialogContent className="sm:max-w-[520px]">
                <DialogHeader>
                    <DialogTitle>Wrong pointing-device firmware</DialogTitle>
                    <DialogDescription asChild>
                        <div className="space-y-2 text-sm">
                            <ul className="list-disc space-y-2 pl-5">
                                {problems.map((p, i) => (
                                    <li key={i}>{describe(p)}</li>
                                ))}
                            </ul>
                            <p>
                                Download it from <FirmwareLink />; <span className="font-mono">&lt;release&gt;</span> is
                                that release's version. To flash a half, double-tap its reset button so it shows up as a
                                drive named <span className="font-mono">RPI-RP2</span>, then copy the .uf2 onto that drive.
                            </p>
                        </div>
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button onClick={acknowledge}>OK</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
