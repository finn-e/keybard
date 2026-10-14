import { hueToken } from "@/utils/combo-hues";

/** Small folded-corner glyph: a combo's swatch in the Combos list and the preview readout. */
export function FoldGlyph({ hue, size = 12, disabled = false }: { hue: number; size?: number; disabled?: boolean }) {
    const c = hueToken(hue, "light");
    return (
        <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" data-fold-glyph={hue} className="flex-shrink-0">
            <path d="M0 12 L12 0 L12 9 Q12 12 9 12 Z" fill={disabled ? `color-mix(in srgb, ${c} 42%, #099e7c)` : c} />
            <path d="M0 12 L12 0" stroke="var(--kb-combo-fold-crease)" strokeWidth={1.25} />
        </svg>
    );
}
