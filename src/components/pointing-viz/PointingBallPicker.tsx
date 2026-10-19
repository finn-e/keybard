import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { usePointingKinds } from "@/hooks/usePointingDevices";
import { setBall, useBalls } from "@/services/pointing-look.service";
import { BALLS, MAT_ORDER } from "./webgl/materials";

/**
 * The Ball choice under a hand's pointing device in the Fragments panel, shown
 * when that hand has a trackball. It is the same choice as the right-click menu
 * on the ball, and it changes only how the ball is drawn (nothing is written to
 * the board).
 */
export function PointingBallPicker({ side, kbid }: { side: "left" | "right"; kbid: string | undefined }) {
    const kinds = usePointingKinds();
    const balls = useBalls(kbid);
    if (kinds[side] !== "trackball") return null;
    const current = balls[side];
    const labelId = `pointing-ball-${side}`;
    return (
        <div data-pointing-ball-picker={side} className="flex flex-row flex-wrap items-center p-3 gap-3 panel-layer-item group/item rounded-md">
            <div className="flex flex-col items-start gap-1 shrink-0 w-[100px]">
                <Label id={labelId} className="text-sm font-medium">Ball</Label>
                <span className="text-xs text-muted-foreground">{BALLS[current].name}</span>
            </div>
            <div role="radiogroup" aria-labelledby={labelId} className="flex flex-1 basis-36 flex-wrap gap-1.5">
                {MAT_ORDER.map((id) => (
                    <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={id === current}
                        aria-label={`${BALLS[id].name}, ${BALLS[id].mm} mm`}
                        title={`${BALLS[id].name} · ${BALLS[id].mm} mm`}
                        data-ball-option={id}
                        onClick={() => setBall(kbid, side, id)}
                        className={cn(
                            "h-7 w-7 rounded-full border border-kb-gray-border outline-none focus-visible:ring-2 focus-visible:ring-kb-ink",
                            id === current && "ring-2 ring-kb-ink ring-offset-2 ring-offset-kb-surface",
                        )}
                        style={{ background: BALLS[id].swatch }}
                    />
                ))}
            </div>
        </div>
    );
}
