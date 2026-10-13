# Pointing fragments: contract

Status: binding for the five parallel builders. Where this file and a builder's own judgement disagree, this file wins. If something here cannot work, the builder implements the closest working variant and says so in its report. It does not edit another builder's files.

Goal: each hand's pointing module (trackball, touchpad, TrackPoint, or none) is detected by firmware, reported through the existing fragment protocol (0x18), and drawn as an animated slot in the Keybard layout viewer. The slot sits in the pocket between that hand's finger clusters and thumb. A new read-and-clear Sval command (0x2D) drives it with live data. The Pointing panel no longer shows hardware.

Shared code already written in this stage (compiles, do not edit; ask in your report if a change is needed):
- `src/components/pointing-viz/types.ts`: `PointingModuleKind`, `PointingMode`, `AxisLock`, `PointingLiveSample`, `PointingSampleSource`, `PointingVizTheme`, `readPointingVizTheme()`, `PointingVizProps`, `setupPointingCanvas()`, `normalizeSpeed()`, `derivePointingMode()`, `POINTING_SMOOTHING_MS` (120), `POINTING_IDLE_MS` (1500), `POINTING_FULL_SCALE_COUNTS_PER_MS` (4).
- `src/components/pointing-viz/simulate.ts`: `simulateSample()` (pure, deterministic), `createSimulatedSource()`, `DEFAULT_SIM_CYCLE` (pointer 4 s, scroll/vertical 3 s, precision 3 s, boost 2 s, idle 2 s), `parsePointingDemo(search)`.

Sign conventions everywhere: dx +right, dy +down (HID). v +up, h +right (HID wheel). Touch positions are 0..1, with the origin at the top-left of the pad.

---


> **What ships.** Keybard's `main` draws each hand's detected module as a still icon in its pointing slot and lists the slot, locked, in the Fragments panel. The live `0x2D` motion poll, the three animations and the demo pages are not on `main`: they are kept on the `feat/pointing-motion` branch of `morganvenable/keybard`. Sections C4, C5's animation components, D and the animation tests in E describe that branch.

## A. Board definition (sval.json)

The firmware builder edits `keyboards/svalboard/keymaps/sval/sval.json` and adds the same fragments and composition to `keyboards/svalboard/keymaps/blank/sval.json`, converting blank to the fragment schema. If converting blank is impractical, the builder leaves blank alone, says so, and tests with `:sval`.

### Fragments (zero-key widget fragments)

Add to `fragments`. Existing ids 0-3 stay unchanged.

| name | id | widget.module | widget.sensor |
|---|---|---|---|
| `pointing_none` | 4 | `none` | (absent) |
| `pointing_trackball_pmw3360` | 5 | `trackball` | `pmw3360` |
| `pointing_trackball_pmw3389` | 6 | `trackball` | `pmw3389` |
| `pointing_touchpad_azoteq` | 7 | `touchpad` | `azoteq` |
| `pointing_trackpoint` | 8 | `trackpoint` | `trackpoint` |
| `pointing_unknown` | 9 | `unknown` | (absent) |

Each fragment has exactly this shape:

```json
"pointing_trackball_pmw3360": {
  "id": 5,
  "description": "PMW3360 trackball",
  "kle": [],
  "widget": { "kind": "pointing", "module": "trackball", "sensor": "pmw3360", "w": 2.5, "h": 2.5 }
}
```

`w` and `h` are in key units and are 2.5 for every pointing fragment. The validator ignores unknown keys, so `widget` passes.

### Composition instances

Append these two instances at the end of `composition.instances`. That makes them indices 10 and 11, so the EEPROM bytes for indices 0-9 do not move.

```json
{
  "id": "left_pointing",
  "hardware_detect": true,
  "fragment_options": [
    { "fragment": "pointing_none",              "placement": {"x": 4.2, "y": 5.25}, "matrix_map": [], "default": true, "allow_override": false },
    { "fragment": "pointing_trackball_pmw3360", "placement": {"x": 4.2, "y": 5.25}, "matrix_map": [], "allow_override": false },
    { "fragment": "pointing_trackball_pmw3389", "placement": {"x": 4.2, "y": 5.25}, "matrix_map": [], "allow_override": false },
    { "fragment": "pointing_touchpad_azoteq",   "placement": {"x": 4.2, "y": 5.25}, "matrix_map": [], "allow_override": false },
    { "fragment": "pointing_trackpoint",        "placement": {"x": 4.2, "y": 5.25}, "matrix_map": [], "allow_override": false },
    { "fragment": "pointing_unknown",           "placement": {"x": 4.2, "y": 5.25}, "matrix_map": [], "allow_override": false }
  ]
}
```

`right_pointing` is identical except that every placement is `{"x": 18.3, "y": 5.25}`.

These are raw placements. Keybard's composer applies the same X and Y correction that `applyPlacementCorrections` gives that side's thumb cluster. With 6-key fingers that is +0.3/-0.5 on the left and -0.3/-0.5 on the right, so the slots compose to left (4.5, 4.75) and right (18.0, 4.75), each 2.5 by 2.5. The two slots mirror about x = 12.5. They sit under the ring/middle gap, inside the curled fingers, outboard of the thumb, with at least 0.75u clearance. With 5-key fingers the thumbs' shared Y shift moves the slots to y 3.75. Both cases fit the existing 25 by 8.5u canvas.

---

## B. Firmware (builder `firmware`, everything under /home/morga/GitHub/sval-pointing-detect)

### B1. Generated index defines

`modules/svalboard/core/sval_config.py` also emits `SVAL_FRAGMENT_IDX_<UPPER_INSTANCE_ID>` for every instance (for example `SVAL_FRAGMENT_IDX_LEFT_POINTING 10`). It also emits `SVAL_FRAGMENT_ID_<UPPER_FRAGMENT_NAME>` for every fragment (for example `SVAL_FRAGMENT_ID_POINTING_TRACKPOINT 8`). Firmware code uses these names and never hard-codes 10/11 or 4-9. Code using them is guarded with `#ifdef SVAL_FRAGMENT_IDX_LEFT_POINTING`, so keymaps without the instances still build.

### B2. `sval_fragment_detect(uint8_t idx)` override

The strong definition goes in `keyboards/svalboard/svalboard.c`, where `sval_local_pointer_identity()` and `other_pointer` are reachable.

- idx is `LEFT_POINTING`: use whichever identity block (local first, then `other_pointer`, but only if `is_connected`) has `SVAL_POINTER_REPORTED` and `SVAL_POINTER_LEFT`. idx is `RIGHT_POINTING`: use the block that has REPORTED and not LEFT.
- No such block, or `detected == 0` (not checked yet), returns `0xFF` (not settled).
- Map `detected`: 1 to `POINTING_TRACKBALL_PMW3360`, 2 to `..._PMW3389`, 3 to `POINTING_NONE`, 4 to `POINTING_UNKNOWN`, 5 to `POINTING_TOUCHPAD_AZOTEQ`, 6 to `POINTING_TRACKPOINT`. Any other value returns `0xFF`.
- Every other idx returns `0xFF`, as the weak default does.

The firmware uses the existing 0x18 handler, the existing detection, and the existing split identity ping. It adds no new transport for identity.

### B3. New command 0x2D POINTING_MOTION

- `sval.h`: `sval_cmd_pointing_motion = 0x2D`. Feature bit `sval_flag2_pointing_motion = (1 << 3)` (bit 2 is the modifier state, #17), OR'ed into `sval_get_feature_flags2()` only when `POINTING_DEVICE_ENABLE` is set.
- `sval.c`: a handler next to 0x2C that zeroes `data[2..]` and calls the weak `void sval_pointing_motion_kb(uint8_t *out, uint8_t length)`. The weak default leaves everything zero, so format 0 means "no data".
- The strong implementation goes in `svalboard.c`. Document the command in `keyboards/svalboard/docs/protocol.md`.

Request: `[0xDF] [0x2D]`

Response, after the wrapper: `[0xDF] [0x2D]` followed by 24 bytes. Offsets below are relative to the first byte after 0x2D.

| off | size | field |
|---|---|---|
| 0 | 1 | format = 1 |
| 1 | 1 | global mode bits: bit0 sniper/precision active, bit1 boost active, bit2 auto-mouse layer on, bit3 axis scroll lock enabled, bit4 natural scroll, bit5 scroll hold or scroll toggle key active, bits 6-7 zero |
| 2 | 1 | elapsed ms since the previous 0x2D read, saturating at 255; 0 on the first read after boot |
| 3 | 10 | LEFT block (physical left hand) |
| 13 | 10 | RIGHT block (physical right hand) |
| 23 | 1 | axis lock state: 0 free, 1 locked vertical, 2 locked horizontal |

Each 10-byte hand block:

| off | size | field |
|---|---|---|
| 0 | 1 | flags: bit0 valid (this hand has a started pointing driver and its data reaches the master), bit1 scrolling (this hand's motion is being converted to scroll), bit2 saturated (dx or dy clamped since last read), bit3 auto-mouse enabled for this hand, bit4 touch valid, bits 5-6 finger count 0..3 (0 when unknown), bit7 zero |
| 1 | 2 | dx, int16 LE |
| 3 | 2 | dy, int16 LE |
| 5 | 1 | h, int8 |
| 6 | 1 | v, int8 |
| 7 | 1 | buttons OR'ed since last read |
| 8 | 1 | touch x, uint8 (0..255 maps to 0..1), finger 1, meaningful only when touch valid |
| 9 | 1 | touch y, uint8 |

**Units and source.** Override the weak `pointing_device_task_combined_kb(left, right)` in `svalboard.c`. Add each hand's report x/y into int32 accumulators, and h/v into int16 accumulators. OR the buttons. Then `return pointing_device_task_combined_user(left, right);`. This is the native combined split path: the data comes after rotation and invert and before sniper, boost and scroll conversion. Skip the accumulation when `!sval_host_recent()`.

**Read-and-clear.** On each 0x2D call, clamp dx/dy to int16 and h/v to int8, set the saturated bit if any value was clamped or the accumulator overflowed, copy everything out, and zero the accumulators, buttons and saturation.

**Mode facts.** Add to `svalboard.h`:

```c
typedef struct { uint8_t global_bits; uint8_t axis_state; bool left_scroll, right_scroll, left_automouse, right_automouse; } sval_pointing_modes_t;
void sval_pointing_modes(sval_pointing_modes_t *m);
```

`svalboard.c` has a weak version that zero-fills. The real one goes in `keyboards/svalboard/keymaps/keymap_support.c`, because the statics live there. It computes per-hand scroll exactly as lines 272-273 do. There is no separate drag-scroll mode: drag-scroll is scroll hold or toggle, which shows up as bit5 plus the per-hand scrolling bit.

**Valid bit.** The local hand is valid when its identity has `INIT_OK`. The remote hand is valid when `is_connected` and its identity block has `INIT_OK`, and the build has split pointing combined (both halves' reports reach `pointing_device_task_combined_kb`). Otherwise the bit is 0 and that block is zero.

**Touch fields, phase 1.** The finger count can be reported for the USB half's Azoteq if the driver exposes `number_of_fingers` cheaply. Add a getter in `keyboards/svalboard/azoteq/azoteq.c` and do not add an extra I2C read. Touch valid stays 0.

**Out of scope.** Absolute touch positions (IQS5xx register offsets are unconfirmed). Any finger data from the non-USB half, which would need a new split RPC (KEYBOARD_SYNC_C). Second-finger positions. Keybard Host (Python) support.

### B4. Firmware verification

- `python3 -I tests/sval_pointing/test_detect.py` still passes. Add host tests for the detected-to-fragment-id mapping and for the 0x2D packing and clamping, written as pure functions in a header the test can include. Follow how `test_detect.py` already builds C. If it doesn't, put the logic in a small `.c`/`.h` pair and test it with a Python mirror.
- Build `svalboard/left:sval`, `svalboard/right:sval`, `svalboard/left:blank` and `svalboard/right:blank` with `-e SVAL_TEST_WIPE=yes`. All must compile.
- Do not commit, do not push, and do not flash.

---

## C. Keybard TypeScript

### C1. Types: `src/types/keyboard.types.ts` (keybard-slot)

```ts
export interface FragmentWidget { kind: "pointing"; module: "none" | "unknown" | "trackball" | "touchpad" | "trackpoint"; sensor?: "pmw3360" | "pmw3389" | "azoteq" | "trackpoint"; w: number; h: number; }
// FragmentDefinition gains:  widget?: FragmentWidget;   (kle stays unknown[]; [] is valid)
```


### C2. Composer: `src/services/fragment-composer.service.ts` (keybard-slot)

```ts
export interface ComposedWidget { instanceIdx: number; instanceId: string; side: "left" | "right"; fragmentName: string | null; widget: FragmentWidget | null; x: number; y: number; w: number; h: number; }
composeWidgets(kbinfo: KeyboardInfo, hwDetection: Map<number, number>): ComposedWidget[]
```

- An instance is a widget instance when every one of its options references a fragment that has `widget`. Such instances are never expanded into `keylayout`. Make `composeLayout` skip them explicitly.
- `side` is the id prefix (`left_`/`right_`).
- `fragmentName` and `widget` come only from `hwDetection.get(instanceIdx)` matched to a fragment id among that instance's options. Missing, 0xFF, or not an option gives `null`. EEPROM, user selections and defaults are ignored for widget instances.
- x and y are the option placement (all options share one) plus that side's thumb correction delta from `applyPlacementCorrections`. Expose the deltas from that function, or compute them once and share them; do not duplicate the math. w and h come from any option's `widget`.

### C3. Resolved slot state: `src/hooks/usePointingSlots.ts` (keybard-slot)

```ts
export interface PointingSlotState extends ComposedWidget { kind: PointingModuleKind; sensor?: PointingSensor; }
export function usePointingSlots(): PointingSlotState[]
```

- `kind` comes from `widget.module`. When `widget` is null it is `"pending"` while connected and reads remain, and `"none"` once retries are exhausted or when disconnected.
- **0x18 re-read.** Add `keyboardService.getFragmentHardware(kbinfo): Promise<Map<number, number>>`, which wraps the existing 0x18 call that FragmentService already makes. While any widget instance is unsettled, call it 1 s after connect and then every 1 s, at most 6 reads. Key the result to `connectionSessionId`, the same way `usePointingHardware` does. Store it in hook state, not the keyboard draft.
- No 0x2C fallback. A definition without widget instances gives `[]`, so no slot is drawn.
- **Demo mode.** If `parsePointingDemo(location.search)` returns a config, return the two slots with kinds from the config, whether or not a board is connected. Positions come from `composeWidgets` when the definition has widget instances. Otherwise they come from the fallback constants `POINTING_SLOT_FALLBACK = { left: {x:4.5,y:4.75,w:2.5,h:2.5}, right: {x:18,y:4.75,w:2.5,h:2.5} }` in composed units. The fallback is used only when the layout has `left_thumb` and `right_thumb` instances; otherwise the hook returns `[]`.
- **Offline.** With no connection and no demo, return `[]`. A file-loaded layout shows no slot.

### C4. Live data (branch `feat/pointing-motion` only)

`src/services/usb.service.ts`: `static readonly CMD_SVIL_POINTING_MOTION = 0x2d;`

`src/utils/pointing-motion.ts`:

```ts
export const SVIL_FLAG2_POINTING_MOTION = 0x08;
export interface PointingMotionHalf { valid: boolean; scrolling: boolean; saturated: boolean; autoMouse: boolean; touchValid: boolean; fingers: number; dx: number; dy: number; h: number; v: number; buttons: number; touchX: number; touchY: number; }
export interface PointingMotionReport { precision: boolean; boost: boolean; autoMouseLayer: boolean; axisLockEnabled: boolean; naturalScroll: boolean; scrollKey: boolean; elapsedMs: number; axisLock: AxisLock; left: PointingMotionHalf; right: PointingMotionHalf; }
export function parsePointingMotion(reply: Uint8Array, cmd = 0x2d): PointingMotionReport | null   // null unless reply[0]===cmd && reply[1]===1 && length >= 26
export function toLiveSample(r: PointingMotionReport, side: PointingSide, now: number, fallbackDtMs: number): PointingLiveSample | null  // null when !valid; dtMs = elapsedMs || fallbackDtMs; touches only when touchValid (x/255, y/255); fingers when > 0
```

`keyboardService.getPointingMotion(kbinfo): Promise<PointingMotionReport | null>` returns null without sending when the flag2 bit is absent, and null on error.

`src/services/pointing-live.service.ts` is a singleton poller shared by every Keyboard instance:

- `acquire(): () => void` is refcounted. Polling runs only while refcount > 0, `!document.hidden`, connected, and the flag bit is set, and `!(PARANOID && !userIsLooking())` (from `@/lib/paranoid`).
- The loop schedules itself with `setTimeout` 33 ms after each await completes, as MatrixTester does. Never use `setInterval`.
- After 3 consecutive null or error results it backs off to 1000 ms, and returns to 33 ms on the next success.
- It exposes `source(side): PointingSampleSource`, two stable objects. Samples are only pushed for a valid half.
- A `visibilitychange` listener resumes polling. `reset()` runs on disconnect and on `connectionSessionId` change.

`src/hooks/usePointingLive.ts`: `usePointingLive(side, enabled): PointingSampleSource | null`. In demo mode it returns a `createSimulatedSource(kind, side, {mode})`, one per side per page, memoized at module level and stopped when the refcount reaches 0. Otherwise it acquires the poller while `enabled` and returns `pointingLive.source(side)`. It returns null when the feature bit is absent. The slot then shows the static module icon, with no animation and no error.

### C5. Components (all under `src/components/pointing-viz/`)

| file | owner | export |
|---|---|---|
| `TrackballFlowViz.tsx` | trackball-viz | `export function TrackballFlowViz(props: PointingVizProps): JSX.Element` |
| `TouchpadViz.tsx` | touchpad-viz | `export function TouchpadViz(props: PointingVizProps): JSX.Element` |
| `TrackpointViz.tsx` | trackpoint-viz | `export function TrackpointViz(props: PointingVizProps): JSX.Element` |
| `PointingPlaceholder.tsx` | keybard-slot | `export function PointingPlaceholder(props: { kind: PointingModuleKind; width: number; height: number; theme: PointingVizTheme }): JSX.Element` |
| `PointingSlot.tsx` | keybard-slot | `export function PointingSlot(props: { slot: PointingSlotState; unitPx: number; style: React.CSSProperties }): JSX.Element` |
| `index.ts` | keybard-slot | re-exports the above, plus `VIZ_BY_KIND: Partial<Record<PointingModuleKind, (p: PointingVizProps) => JSX.Element>>` |

Each viz component renders one `<canvas>` with `aria-hidden="true"` inside a `<div role="img" aria-label="Left trackball">` (label built from side and kind). It may not read contexts, hooks from `@/contexts`, or the network. Its only inputs are its props. That keeps it reusable in the Overlay later, which is out of scope for this round.

**PointingSlot.** It picks `VIZ_BY_KIND[kind]` when the kind has a viz and `usePointingLive` returned a source. It draws `PointingPlaceholder` when the kind is none, pending or unknown, or when there is no source. The visual area is `w*unitPx - 8` by `h*unitPx - 8` CSS px. The slot has a 1px dashed `border` token outline with rounded corners of `0.35*unitPx`, a tooltip `title` (for example "Left: PMW3360 trackball (detected)"), `pointer-events: none` except on the outline element that carries the title, and `reducedMotion` from `src/hooks/usePrefersReducedMotion.ts` (new, keybard-slot). Its `theme` comes from `readPointingVizTheme()`, re-read when the `<html>` class attribute changes (MutationObserver).

**PointingPlaceholder** uses SVG with a lucide-react icon, centred at 40% of the slot size, `muted` colour. `none` is `CircleOff`, `pending` is `Loader` (spinning 1.2 s unless reduced motion), and `unknown` is `CircleHelp`. trackball, touchpad and trackpoint without a source use `CircleDot`, `RectangleHorizontal` and `Crosshair` respectively. Below the icon is a 10px caption: "None", "Detecting", "Unknown", "Trackball", "Touchpad" or "TrackPoint".

### C6. Mount point: `src/components/Keyboard.tsx` (keybard-slot)

- `const slots = usePointingSlots();` is rendered inside `.keyboard-layout`, after the thumb-cluster backdrop and before `{/* Keys */}`.
- Position: `left = (slot.x + offsetX - s) * currentUnitSize`, `top = getYPos-equivalent (slot.y + offsetY) * currentUnitSize`. `s` is the thumb squeeze amount, the same rule as thumb keys.
- In 3D the slot gets the thumbs' `translateY(900px)` treatment. It is hidden when `!is3DMode && isThumb3DOffsetActive` (same as the thumbs).
- New prop `showPointingSlots?: boolean`, default `true`. KeyboardViewInstance leaves it at the default. Any other caller of `<Keyboard>` that is a thumbnail or print passes `false`. MiniKeyboardPreview, LayoutCard, LayerRow, LayerPreviewModal and PrintableKeymap render their own keys and never show slots.
- Canvas bounds stay as they are. The slots are inside the existing bounds; verify in both the 6-key and 5-key layouts.
- Works in sidebar and bottom-bar layout modes. Unit size is 60/45/30 px. At 30 px the slot is 75 px, and viz components must stay legible down to a 60 px drawing area.

### C7. Removal from the Pointing panel (keybard-slot)

Delete `<PointingHardwareSummary ...>` and its import from `PointingPanel.tsx` (both modes). Delete `src/components/PointingHardwareSummary.tsx` and `tests/components/PointingHardwareSummary.test.tsx`. Update `tests/components/PointingPanel.test.tsx` so it asserts the summary is gone.

Keep `usePointingHardware` and `src/utils/pointing-hardware.ts`. TrackballMismatchDialog and the slot tooltip may use them.

### C8. Fragment plumbing guards (keybard-slot)

Widget instances, as defined in C2, are:

- hidden in `FragmentsPanel` and skipped by "Apply default";
- excluded from `.svil` `fragment_selections` export (`file.service.ts`) and from import preflight restore (`import-preflight.ts`);
- skipped by `composeLayout`;
- skipped in `FragmentService` resolution consumers that iterate instances for keys.

Selection bytes 10 and 11 from 0x19 are ignored.

Add a helper `isWidgetInstance(kbinfo, instance)` in `src/services/fragment-composer.service.ts` and use it everywhere.

---

## D. Rendering rules (all three viz builders) (branch `feat/pointing-motion` only)

**Engine.** Each viz uses one 2D `<canvas>` sized with `setupPointingCanvas(canvas, width, height)` from types.ts, re-run when width, height or devicePixelRatio change. If it returns null (jsdom), the component renders the DOM wrapper and draws nothing. It must never throw.

**Loop.** While the component is mounted and `!reducedMotion`, it runs `requestAnimationFrame` and cancels on unmount. It reads `source.latest()` each frame and subscribes only to wake from idle. It never calls `setState` per frame; all animation state lives in refs.

**Smoothing.** Rate is `(dx, dy) / dtMs`. Smooth it exponentially with `POINTING_SMOOTHING_MS`, using frame dt, so there is no jitter between 33 ms samples. Visual magnitude is `normalizeSpeed(|rate|)`. A sample with `saturated` draws at magnitude 1.

**Idle decay.** If `now - latest.t > POINTING_IDLE_MS`, or every sample in the last idle window was zero, ease into an idle state over 400 ms. The idle state is a low-alpha (0.35) still image specific to each viz, below. While idle, throttle to one frame every 250 ms, or stop the RAF until the next subscribed sample.

**Reduced motion.** No RAF loop. Redraw a single static frame on each subscribed sample, at most every 250 ms. That frame shows the current direction and magnitude as a still glyph, with no particles or trails.

**Theme.** Colours come from `props.theme` only: `foreground` for primary marks, `muted` for secondary and idle, `accent` for mode cues. No hard-coded colours. Clear to transparent each frame.

**Size.** Everything scales with `min(width, height)`. The graphic must be legible at a 60 px drawing area and at 140 px.

**Mode-specific animation.** Every viz must make every mode distinguishable:

| mode | TrackballFlowViz (flow field, inside a circle) | TouchpadViz (rounded rect, aspect 1.3:1) | TrackpointViz (single vector from centre) |
|---|---|---|---|
| idle | faint static field lines circling (no flow) | empty pad, faint grid | small dot at centre |
| pointer | about 60 particles advected by a field = smoothed velocity + gentle curl noise; trails length ∝ magnitude; particles wrap inside the circle | one dot (`foreground`) at `touches[0]`, or integrated from dx/dy and clamped to the pad when no touches; fading trail of the last 600 ms | arrow from centre in the push direction; length ∝ magnitude (max 45% of size); arrowhead width ∝ magnitude |
| scroll | particles become streaming dashes moving only along the scroll axis (vertical unless axisLock is "horizontal" or \|dx\| > \|dy\| with axisLock "free"); `accent` colour; speed from v/h when non-zero, otherwise dy/dx | two dots side by side (or `touches[0..1]`) moving in parallel, plus three streaming chevrons along the axis in `accent` | double-headed track along the axis with chevrons streaming in the push direction, `accent` |
| precision | particle count halved, speed visually ×0.5, a fine concentric ring overlay (`muted`) | smaller dot plus crosshair through it | thin 1px arrow plus three tick marks along its length (a scale) |
| boost | trails ×2 length, particles brighter, a single outward pulse ring when entering boost | larger dot, longer trail (1200 ms) | thick arrow with an `accent` glow (shadowBlur 6) |

`naturalScroll` reverses the drawn scroll direction (the user sees content direction). `buttons` not equal to 0 adds a brief (150 ms) `accent` ring flash on the module outline. `fingers === 2` on a touchpad always shows two dots, whatever the mode.

**Layer thumbnails and print.** Slots are hidden there (C6). In the main layout viewer every KeyboardViewInstance shows live slots and shares one poller.

---

## E. Tests (each builder owns its own tests)

- Viz builders write `tests/components/pointing-viz/<Component>.test.tsx`. Each test renders with a fake `PointingSampleSource` built from `simulateSample` under jsdom, where `getContext` returns null, and asserts: no throw; the aria-label contains the side and the module name; the unsubscribe and cancelAnimationFrame run on unmount; reduced motion schedules no RAF. Pure math helpers kept inside the component file (for example the particle step or the arrow geometry) are exported, prefixed `_test`, and unit-tested for each mode.
- keybard-slot owns `tests/services/fragment-composer.widgets.test.ts`, `tests/utils/pointing-motion.test.ts`, `tests/hooks/usePointingSlots.test.tsx`, `tests/components/pointing-viz/PointingSlot.test.tsx`, and updates to `tests/fixtures/fragments.fixture.ts`, `tests/components/PointingPanel.test.tsx` and FragmentsPanel tests.
- Every Keybard builder runs `npx tsc --noEmit -p .` and the tests it touched. keybard-slot also runs `npm run build` and the full `npm test`.
- The dev server already running on http://localhost:5173/keybard-ng/ must not be restarted or killed. Check the result visually at `?pointingDemo=trackball,touchpad` and `?pointingDemo=trackpoint,trackball&pointingDemoMode=scroll`.

---

## F. File ownership (no builder edits a file it does not own)

| builder | owns |
|---|---|
| (this spec stage, frozen) | `docs/pointing-fragments-spec.md`, `src/components/pointing-viz/types.ts`, `src/components/pointing-viz/simulate.ts` |
| `trackball-viz` | `src/components/pointing-viz/TrackballFlowViz.tsx`, `tests/components/pointing-viz/TrackballFlowViz.test.tsx` |
| `touchpad-viz` | `src/components/pointing-viz/TouchpadViz.tsx`, `tests/components/pointing-viz/TouchpadViz.test.tsx` |
| `trackpoint-viz` | `src/components/pointing-viz/TrackpointViz.tsx`, `tests/components/pointing-viz/TrackpointViz.test.tsx` |
| `keybard-slot` | every other Keybard file named in C1-C8: `src/types/keyboard.types.ts`, `src/services/fragment-composer.service.ts`, `src/services/keyboard.service.ts`, `src/services/usb.service.ts`, `src/services/pointing-live.service.ts`, `src/utils/pointing-motion.ts`, `src/hooks/usePointingSlots.ts`, `src/hooks/usePointingLive.ts`, `src/hooks/usePrefersReducedMotion.ts`, `src/components/pointing-viz/{PointingPlaceholder,PointingSlot}.tsx`, `src/components/pointing-viz/index.ts`, `src/components/Keyboard.tsx`, `src/layout/SecondarySidebar/Panels/PointingPanel.tsx`, `src/layout/SecondarySidebar/Panels/FragmentsPanel.tsx`, `src/services/file.service.ts`, `src/services/import-preflight.ts`, `src/services/fragment.service.ts`, `src/index.css` (optional `--kb-pointing-accent` token), deletion of `src/components/PointingHardwareSummary.tsx` and its test, and the keybard-slot tests listed in E |
| `firmware` | everything under `/home/morga/GitHub/sval-pointing-detect` |

**Integration seam.** `index.ts` (keybard-slot) imports the three viz components by the exact names in C5. If a viz file does not exist yet when keybard-slot builds, keybard-slot must not create it. Leave the build broken on that import only, and report it; the orchestrator integrates.

All builders: no commits, no pushes, and do not touch `/home/morga/GitHub/svalboard-qmk` or `/home/morga/GitHub/keybard`. Validation hardware is called "test board".
