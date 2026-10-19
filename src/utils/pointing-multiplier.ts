// The sniper and boost multipliers shown in the pills. POINTING_MOTION (0x2D)
// says whether sniper or boost is on, not by how much: the factor comes from the
// keys that turn them on (Svalboard QMK keymap_support.h, QK_USER_0 + n).
//   SV_SNIPER_2/3/5 = 12/13/14, SV_SNIPER_2/3/5_TG = 21/22/23 (divide by 2, 3, 5)
//   SV_BOOST_2/3/5 = 24/25/26, SV_BOOST_2/3/5_TG = 27/28/29 (multiply by 2, 3, 5)
// If the keymap holds exactly one sniper factor, that one is shown; otherwise the
// default (sniper x0.33, the default keymap's SV_SNIPER_3; boost x2).

const QK_USER_0 = 0x7e40;
const SNIPER: Record<number, number> = { 12: 2, 13: 3, 14: 5, 21: 2, 22: 3, 23: 5 };
const BOOST: Record<number, number> = { 24: 2, 25: 3, 26: 5, 27: 2, 28: 3, 29: 5 };
export const DEFAULT_SNIPER_DIVISOR = 3;
export const DEFAULT_BOOST_FACTOR = 2;

export interface PointingFactors { sniperDivisor: number; boostFactor: number }

/** The factors the keymap's sniper and boost keys use. */
export function pointingFactors(keymap: number[][] | undefined | null): PointingFactors {
    const sniper = new Set<number>(), boost = new Set<number>();
    for (const layer of keymap ?? []) for (const code of layer ?? []) {
        const n = Number(code) - QK_USER_0;
        if (SNIPER[n]) sniper.add(SNIPER[n]);
        if (BOOST[n]) boost.add(BOOST[n]);
    }
    return {
        sniperDivisor: sniper.size === 1 ? [...sniper][0] : DEFAULT_SNIPER_DIVISOR,
        boostFactor: boost.size === 1 ? [...boost][0] : DEFAULT_BOOST_FACTOR,
    };
}

/** "×0.33" for a divisor of 3, "×0.5" for 2, "×0.2" for 5. */
export function sniperLabel(divisor: number): string {
    return `×${Math.round(100 / divisor) / 100}`;
}
export function boostLabel(factor: number): string {
    return `×${factor}`;
}

/** The labels in effect for the modes that are on, sniper first. */
export function multiplierLabels(modes: { sniper: boolean; boost: boolean }, f: PointingFactors): string[] {
    const out: string[] = [];
    if (modes.sniper) out.push(sniperLabel(f.sniperDivisor));
    if (modes.boost) out.push(boostLabel(f.boostFactor));
    return out;
}
