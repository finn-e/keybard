import { useId } from "react";
import { useComboPreview } from "@/contexts/ComboPreviewContext";
import { cueInk, hueToken, paletteHues, textureOf } from "@/utils/combo-hues";

/**
 * Small folded-corner glyph: a combo's swatch in the Combos list and the preview readout.
 * With the colorblind palette it carries the combo's texture too, as its folds do.
 */
export function FoldGlyph({ hue, size = 12, disabled = false }: { hue: number; size?: number; disabled?: boolean }) {
    const { palette } = useComboPreview();
    const id = "kb-glyph-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const c = hueToken(hue, "light");
    const kind = palette === "colorblind" ? textureOf(hue) : "plain";
    const hues = paletteHues(palette);
    const ink = cueInk(hues[hue % hues.length].light);
    const shape = "M0 12 L12 0 L12 9 Q12 12 9 12 Z";
    return (
        <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" data-fold-glyph={hue} className="flex-shrink-0">
            {kind !== "plain" && (
                <defs>
                    <pattern id={id} width={3} height={3} patternUnits="userSpaceOnUse" patternTransform={kind === "lines" ? "rotate(45)" : undefined}>
                        {kind === "lines"
                            ? <rect x={0} y={0} width={1.08} height={3} fill={ink} />
                            : <circle cx={1.5} cy={1.5} r={0.72} fill={ink} />}
                    </pattern>
                </defs>
            )}
            <path d={shape} fill={disabled ? `color-mix(in srgb, ${c} 42%, #099e7c)` : c} />
            {kind !== "plain" && <path d={shape} fill={`url(#${id})`} data-fold-texture={kind} />}
            <path d="M0 12 L12 0" stroke="var(--kb-combo-fold-crease)" strokeWidth={1.25} />
        </svg>
    );
}
