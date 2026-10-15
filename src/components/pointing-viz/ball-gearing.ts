// How far the drawn trackball turns for the motion the board reports.
//
// POINTING_MOTION (0x2D) carries each hand's raw sensor counts, tapped before
// sniper, boost and scroll conversion (svalboard-qmk protocol.md, "Pointing
// motion"). The drawn ball turns by the distance its surface travelled over the
// physical radius of the ball chosen for that hand (44 or 52 mm), whatever size
// it is drawn at: radians = mm / (diameter / 2). It never reads the hand's DPI
// setting, sniper or boost; those change the cursor, not how far the ball turns.

/**
 * Counts the board reports per mm of ball surface travel. The sensor runs at
 * a nominal 800 CPI by default (31.5 counts/mm), but on the ball the stream
 * delivers about half of that: rolling a real 52 mm ball half a turn turned the
 * drawn one only a quarter at 800/25.4. Set from that observation: 400 counts
 * per inch of surface.
 */
export const TRACKBALL_COUNTS_PER_MM = 400 / 25.4;

/** Radians the ball turns for `counts` of surface travel on a ball `diameterMm` across. */
export function ballRollRadians(counts: number, diameterMm: number): number {
    return counts / (TRACKBALL_COUNTS_PER_MM * (diameterMm / 2));
}
