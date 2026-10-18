import "./firmware.css";
import { LIGHT_LABEL, type LightPattern } from "./lights";

/** A small dot that behaves like the half's light right now. */
export function LightSwatch({ light, className }: { light: LightPattern; className?: string }) {
    return <span role="img" aria-label={`Light: ${LIGHT_LABEL[light]}`} title={LIGHT_LABEL[light]} data-light={light} className={`fw-swatch${className ? ` ${className}` : ""}`} />;
}
