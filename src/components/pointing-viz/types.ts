// Types for each hand's detected pointing module. Nothing here may
// import React components.

export type PointingSide = "left" | "right";

/**
 * What sits in a hand's pointing slot.
 * - "pending": connected, but the board has not finished probing (0x18 says 0xFF).
 * - "unknown": the trackball bus answered with an ID we don't know (0x2C detected=4),
 *   or the hand never reported a module (0x18 still 0xFF after the last read).
 */
export type PointingModuleKind = "none" | "pending" | "unknown" | "trackball" | "touchpad" | "trackpoint";

/** The finer detail behind a kind, for tooltips only. */
export type PointingSensor = "pmw3360" | "pmw3389" | "azoteq" | "trackpoint";
