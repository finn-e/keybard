import { cn } from "@/lib/utils";
import { ModifierSide } from "@/utils/modifierUtils";

interface Props {
    side: ModifierSide;
    onChange: (side: ModifierSide) => void;
    /** Bottom-bar sizing (smaller text and height). */
    compact?: boolean;
    className?: string;
}

const OPTIONS: { side: ModifierSide; label: string; title: string }[] = [
    { side: "left", label: "L", title: "Left-hand modifiers (LSFT, LCTL, LALT, LGUI)" },
    { side: "right", label: "R", title: "Right-hand modifiers (RSFT, RCTL, RALT, RGUI)" },
];

/**
 * Compact Left/Right switch for the modifier pickers. A key's modifiers are
 * all-left or all-right; mixing hands in one key isn't supported.
 */
const ModifierSideToggle = ({ side, onChange, compact, className }: Props) => (
    <div
        role="group"
        aria-label="Modifier hand"
        data-testid="modifier-side-toggle"
        className={cn("inline-flex shrink-0 rounded-md bg-kb-gray-medium p-0.5", className)}
    >
        {OPTIONS.map((opt) => {
            const isActive = side === opt.side;
            return (
                <button
                    key={opt.side}
                    type="button"
                    aria-pressed={isActive}
                    title={opt.title}
                    onClick={() => onChange(opt.side)}
                    className={cn(
                        "rounded font-bold transition-all cursor-pointer border-none",
                        compact ? "h-5 px-1.5 text-[10px]" : "h-6 px-2 text-xs",
                        isActive
                            ? "bg-kb-active text-kb-active-fg shadow-sm"
                            : "bg-transparent text-slate-600 dark:text-neutral-300 hover:bg-kb-surface dark:hover:bg-neutral-700"
                    )}
                >
                    {opt.label}
                </button>
            );
        })}
    </div>
);

export default ModifierSideToggle;
