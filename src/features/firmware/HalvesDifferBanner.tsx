import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { OPEN_FIRMWARE_EVENT, useBoardSummary } from "./useHalvesDiffer";
import type { BoardSummary } from "./board-summary";

/** F9 on any connect: the halves run different firmware. The one firmware message that interrupts. */
export function HalvesDifferView({ board, onFinish }: { board: BoardSummary; onFinish: () => void }) {
    const line = board.halves.map((h) => `${h.hand === 0 ? "Left" : "Right"} half ${h.answered ? h.tag : "not answering"}`).join(" · ");
    return (
        <div role="alert" aria-label="Halves differ" className="flex flex-col gap-2 whitespace-normal rounded-md border border-kb-gray-border bg-kb-surface p-3 text-sm text-kb-ink shadow-sm">
            <p className="flex items-center gap-2 font-semibold text-kb-orange"><AlertTriangle className="h-4 w-4" aria-hidden />Halves differ</p>
            <p>{line}</p>
            <Button size="sm" variant="kb-primary" className="self-start" onClick={onFinish}>Finish update</Button>
        </div>
    );
}

export function HalvesDifferBanner() {
    const board = useBoardSummary();
    if (!board?.updater || !board.differ) return null;
    return <HalvesDifferView board={board} onFinish={() => window.dispatchEvent(new CustomEvent(OPEN_FIRMWARE_EVENT))} />;
}
