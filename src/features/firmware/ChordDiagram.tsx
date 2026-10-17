import { handName, type Hand } from "@/services/updater/protocol";

/**
 * The half with USB, drawn as its four finger clusters, with the approval chord's two
 * keys lit: Index South and Middle South, labeled with their layer-0 legends.
 */
export function ChordDiagram({ hand, legends }: { hand: Hand; legends: [string, string] }) {
    // Clusters from the thumb side outward: index, middle, ring, pinky.
    const order = hand === 1 ? [0, 1, 2, 3] : [3, 2, 1, 0];
    return (
        <div className="flex items-end gap-2" role="img" aria-label={`${handName(hand)} half: hold ${legends[0]} and ${legends[1]}`}>
            {order.map((finger) => {
                const lit = finger === 0 || finger === 1;
                return (
                    <div key={finger} className="grid grid-cols-3 grid-rows-3 gap-0.5" style={{ width: 42, height: 42 }}>
                        <span />
                        <span className="rounded-sm border border-kb-gray-border" />
                        <span />
                        <span className="rounded-sm border border-kb-gray-border" />
                        <span className="rounded-sm border border-kb-gray-border" />
                        <span className="rounded-sm border border-kb-gray-border" />
                        <span />
                        <span className={lit ? "flex items-center justify-center rounded-sm bg-kb-primary text-[9px] font-semibold text-white" : "rounded-sm border border-kb-gray-border"}>
                            {lit ? legends[finger] : null}
                        </span>
                        <span />
                    </div>
                );
            })}
        </div>
    );
}
