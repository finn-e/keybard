// Pointing slot visualizations. The layout viewer loads the three animations
// lazily through PointingSlot; this barrel is for callers (such as the Overlay)
// that want them directly. See docs/pointing-fragments-spec.md (C5).

import type React from "react";

import { TouchpadViz } from "./TouchpadViz";
import { TrackballFlowViz } from "./TrackballFlowViz";
import { TrackpointViz } from "./TrackpointViz";
import type { PointingModuleKind, PointingVizProps } from "./types";

export { TouchpadViz, TrackballFlowViz, TrackpointViz };
export { PointingPlaceholder, POINTING_KIND_CAPTION } from "./PointingPlaceholder";
export { PointingSlot, pointingSlotTitle } from "./PointingSlot";
export * from "./types";
export * from "./simulate";

/** The animation for each module kind that has one. */
export const VIZ_BY_KIND: Partial<Record<PointingModuleKind, (p: PointingVizProps) => React.JSX.Element>> = {
    trackball: TrackballFlowViz,
    touchpad: TouchpadViz,
    trackpoint: TrackpointViz,
};
