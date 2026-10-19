// How far the drawn trackball turns for the motion the board reports.
//
// POINTING_MOTION (0x2D) carries each hand's raw sensor counts at that hand's
// CPI, tapped before sniper, boost and scroll conversion (svalboard-qmk
// protocol.md, "Pointing motion"). Firmware with per-reader counts also reports
// each hand's CPI, so counts / (CPI / 25.4) is the distance the ball's surface
// travelled, and the drawn ball turns by that over the physical radius of the
// ball chosen for that hand (44 or 52 mm), whatever size it is drawn at:
// radians = mm / (diameter / 2). Sniper and boost change the cursor, not how
// far the ball turns.

/** CPI assumed when the board doesn't report one: the firmware's default (800). */
export const DEFAULT_TRACKBALL_CPI = 800;

/** Millimeters of ball surface travel for `counts` at `cpi` (the default when unknown). */
export function countsToMm(counts: number, cpi?: number): number {
    const c = cpi && cpi > 0 ? cpi : DEFAULT_TRACKBALL_CPI;
    return counts / (c / 25.4);
}

/** Radians the ball turns for `counts` at `cpi` on a ball `diameterMm` across. */
export function ballRollRadians(counts: number, diameterMm: number, cpi?: number): number {
    return countsToMm(counts, cpi) / (diameterMm / 2);
}
