# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Git Workflow Guidelines

**Work in your fork of `svalboard/keybard`, never directly in `svalboard/keybard`.** A local clone of `svalboard/keybard` is a read-only reference: don't branch, commit or push there.

```bash
# In a clone of your fork, with svalboard/keybard as the `upstream` remote
git fetch upstream
git checkout -b feature/description-of-work upstream/main
# ... make changes ...
git push -u origin feature/description-of-work
gh pr create --repo svalboard/keybard --base main --head <your-github-user>:feature/description-of-work
```

This applies to all work, no matter how small. Changes only reach `main` through a reviewed PR.

### Deployments

| Site | What it serves | How it updates |
|------|----------------|----------------|
| https://keybard.svalboard.com (stable) | A launch tag on `main` that was promoted | Manually: `gh workflow run svalboard-deploy.yml -R svalboard/keybard -f ref=<launch tag>` (`.github/workflows/svalboard-deploy.yml`). It deploys only a `vLaunch` tag that is on `main`. |
| https://next.keybard.svalboard.com (bleeding edge) | The tip of `main`, with a "Bleeding edge" banner and its own storage (`.env.next`) | Automatically on every merge to `main` (`.github/workflows/next-deploy.yml`, pushing to the `gh-pages` branch of `svalboard/keybard-next` with a deploy key; a `next.keybard` CNAME on svalboard.com points at `svalboard.github.io`) |
| https://morganvenable.github.io/keybard-test/ | Any branch, for testing before it merges | `gh workflow run deploy.yml -R morganvenable/keybard-test -f repo=morganvenable/keybard -f ref=<branch>` |

**Merging to `main` no longer changes the stable site.** Promote to stable only after checking the build on the bleeding-edge site.

**Launch tags:** `vLaunch<N>` (e.g. `vLaunch2`) is shared by the firmware (`svalboard/qmk`), Keybard Host (`keybard-host-release.yml`) and the stable site, so one name means the same release everywhere. `vLaunch<N>.<M>` (e.g. `vLaunch2.3`) is a Keybard and Keybard Host release only; never tag it on `svalboard/qmk`. Bleeding-edge firmware uses `vNext<N>` prereleases. Tag the Keybard commit on `main` after `HOST_RELEASE_TAG` (`src/features/trainer/HostInstall.tsx`) names the same tag, then promote it with `-f ref=<that tag>`.

Keybard Host accepts calls only from exact origins: https://keybard.svalboard.com and https://next.keybard.svalboard.com (`REMOTE_ORIGINS` in `companion/overlay-host/keybard_host/server.py`). Installed Hosts learn a new origin only from a Host update. Never allow a `*.github.io` origin: every Pages site of that account shares it. To try Host features on another site, start the Host with `--allow-origin <origin>`.

**ALWAYS run `npm run build` before pushing** to catch TypeScript errors. The CI deploy will fail on TS errors, so catch them locally first. If you touch anything that could reach the network, also run `npm run build:paranoid`.

---

## Related Repositories

| Repository | Branch | Purpose |
|------------|--------|---------|
| `svalboard/qmk` | `svalboard` | Svalboard QMK firmware, the source of truth for the Sval protocol. Releases: https://github.com/svalboard/qmk/releases |
| `svalboard/vial-qmk` | `vial` | The old Vial firmware. Customers who haven't updated still run it; Keybard detects it and asks them to update |
| `svalboard/keybard-ng` | `main` | Archived earlier lineage of this app. Don't use it |

## Project Overview

Keybard (https://keybard.svalboard.com) is a React 19 + TypeScript web application for configuring Svalboard keyboards running Svalboard QMK, via the WebHID API. It enables real-time keymap editing, macro programming, and QMK settings management.

**Note:** Keybard speaks the Sval protocol (`0xDF`), with VIA commands passed through, all inside a client ID wrapper (`0xDD`) for multi-client concurrent access. Older code and docs call it "Svil" or "Viable" (e.g. `SvilUSB`); those identifiers are kept, but the protocol and firmware are Sval / Svalboard QMK.

## Development Commands

```bash
npm run dev            # Dev server at http://localhost:5173/ (port per branch in vite.config.ts; main uses 5170)
npm run build          # Production build (TypeScript check + Vite build)
npm test               # Run all tests
npm run test:watch     # Watch mode for development
npm run test:coverage  # Tests with coverage report (75-90% thresholds)
npm run test:ui        # Interactive Vitest UI
```

## Architecture

### Layer Structure
```
UI Components → React Contexts → Services → SvilUSB → WebHID API → Physical Keyboard
```

### Key Architectural Patterns

**Context-Based State Management:** Seven specialized contexts handle different domains:
- `KeyboardContext` - Keyboard state and operations
- `KeyBindingContext` - Key selection and editing
- `ChangesContext` - Change tracking
- `LayerContext` - Layer management
- `PanelsContext` - UI panel visibility
- `SettingsContext` - Application settings
- `LayoutSettingsContext` - Keyboard layout preferences

**Service Layer:** Each feature has a dedicated service class that encapsulates protocol details:
- `KeyboardService` - Sval protocol service (keyboard loading, keymap read/write)
- `SvilUSB` - WebHID API abstraction; reports are 32 or 64 bytes, read per device from its HID descriptor (`src/services/hid-report.ts`)
- `KeyService` - Keycode parsing and stringification
- `QMKService` - QMK settings management
- `SvalService` - Svalboard-specific features
- `MacroService`, `TapdanceService`, `ComboService`, `OverrideService` - Feature-specific services

**USB Communication:** SvilUSB class handles queue-based async operations with command/response protocol.

### Import Aliases
```typescript
@/           → src/
@services/   → src/services/
@contexts/   → src/contexts/
@components/ → src/components/
@types/      → src/types/
@constants/  → src/constants/
```

### Key Constants
- `KEYMAP` - Maps keycode names to numeric codes
- `CODEMAP` - Reverse mapping (code to name)
- `KEYALIASES` - Alternative keycode names

## Testing

Tests use Vitest with jsdom environment. WebHID API is mocked in `tests/setup.ts`.

**Test Structure:**
- `tests/services/` - Service layer tests
- `tests/components/` - Component tests
- `tests/contexts/` - Context tests
- `tests/fixtures/` - Test keyboard definitions and keymaps
- `tests/mocks/` - Mock implementations (especially USB)

**Coverage Thresholds:** 90% branches, 75% functions/lines/statements

## Key Components

- `KeyboardConnector` - Main orchestration component
- `Keyboard` - Keyboard layout renderer
- `Key` - Individual key component with binding support
- `MatrixTester` - USB polling and key press detection
- `QMKSettings` - QMK settings UI panel
- `MainScreen` - Root application UI

## CRITICAL: Dual Layout Modes (Sidebar vs Bottom Bar)

**The application supports TWO distinct UI layout modes that must be maintained separately:**

### Layout Mode Detection
```typescript
const { layoutMode } = useLayoutSettings();
const isHorizontal = layoutMode === "bottombar";  // Bottom bar mode
const isVertical = layoutMode !== "bottombar";    // Sidebar mode (default)
```

### Sidebar Mode (Vertical)
- **When:** Default mode, panels appear in right sidebar
- **Panel container:** `SecondarySidebar` components
- **Layout direction:** Vertical, stacked content
- **Panel width:** Fixed (e.g., 450px, 520px for leaders)
- **Key sizes:** Larger (50px sequence, 60px output)

### Bottom Bar Mode (Horizontal)
- **When:** User enables bottom bar layout in settings
- **Panel container:** `BottomPanel` component
- **Layout direction:** Horizontal, inline content
- **Panel height:** Constrained, content must be compact
- **Key sizes:** Smaller (45px for all keys)

### Editor Component Pattern
Many editor components (LeaderEditor, ComboEditor, etc.) have TWO render paths:

```typescript
// Check layout mode
if (isHorizontal) {
    // BOTTOM BAR layout - horizontal, compact
    return (
        <div className="flex flex-row items-center gap-4 px-4 py-2">
            {/* Horizontal layout with smaller keys */}
        </div>
    );
}

// SIDEBAR layout - vertical, more spacious
return (
    <div className="flex flex-col gap-4 py-4 px-5">
        {/* Vertical layout with larger keys */}
    </div>
);
```

### WARNING: Do Not Confuse Layout Modes!
When making changes to editor panels:
1. **Identify which layout mode** you're modifying (check `isHorizontal`)
2. **Test BOTH modes** after making changes
3. **Keep changes isolated** - don't accidentally modify one mode when fixing the other
4. The `horizontal` or `compact` prop on components indicates bottom bar mode

### MANDATORY: Every Feature Needs Both Modes
**Every new panel or feature MUST be implemented for BOTH sidebar AND bottom bar modes.**

When creating a new panel:
1. **Register in SecondarySidebar.tsx** - Import and add case in `renderContent()` switch
2. **Register in BottomPanel.tsx** - Import and add case in `renderContent()` switch
3. **Test both modes** - Even if crude at first, both must work

Files to update for new panels:
- `src/layout/SecondarySidebar/SecondarySidebar.tsx` - Sidebar panel registration
- `src/layout/BottomPanel/BottomPanel.tsx` - Bottom bar panel registration

### MANDATORY: Key Sizing Consistency Within a Panel

Every row of assignable keys inside one panel must get its size from the **same** source:
one shared renderer (e.g. `MouseKeysSection.renderKey`) or one computed `effectiveVariant`
(`variantOverride || (compact ? "small" : keyVariant)`) plus the matching `keySizeClass`.
Never hard-code `variant="default"` on an ad-hoc `<Key>` next to rows that honour the
user's key-size setting. (Regression that motivated this rule: the Pointing panel's Boost
row rendered at full size while Mouse Buttons and Sniper followed the key-size setting.)

Whenever you touch key sizing, variants, or layout classes in a panel, do a **consistency
pass** before finishing:

1. List every key row/section the panel renders (including rows pulled in from shared
   sections and any rows added by other panels that embed the same section).
2. Check all of them in **sidebar**, **bottom-bar** (`compact` / `variant="medium"`) and
   **picker** (`isPicker`) modes.
3. Prefer moving an inconsistent row into the shared section over duplicating `<Key>` props.
4. Add or extend a test that asserts the rows share one `variant` / size class
   (see `tests/components/MouseKeysSection.test.tsx` and `PointingPanel.test.tsx`).

## Dynamic Finger Cluster Squeeze

The keyboard layout dynamically squeezes finger clusters toward the center when the keyboard doesn't fit in the available container width. This enables medium-sized keys (45px) to fit in half-screen view (~960px).

### How It Works

1. **LayoutSettingsContext** calculates `fingerClusterSqueeze` based on overflow
2. **Keyboard.tsx** applies the squeeze at render time (not stored in keylayout)
3. Only **finger clusters** (y < 5) are squeezed; **thumb clusters** (y >= 5) stay fixed
4. A global left offset keeps the keyboard left-aligned after squeeze

### Key Constants

```typescript
// src/constants/keyboard-visuals.ts
export const MAX_FINGER_CLUSTER_SQUEEZE_U = 0.9;  // Max squeeze per side in key units
```

With a typical 2.3u gap between left/right halves, squeezing 0.9u per side leaves ~0.5u total gap.

### Dual Width Approach

EditorLayout passes **two sets of widths** to the context:
- `keyboardWidths` - Squeeze-aware widths (used for auto-sizing decisions)
- `rawKeyboardWidths` - Original widths without squeeze (used to calculate squeeze amount)

This avoids a chicken-and-egg problem: auto-sizing needs to know medium keys CAN fit (with squeeze), but squeeze calculation needs to know the actual overflow.

### Key Files

| File | Role |
|------|------|
| `src/constants/keyboard-visuals.ts` | `MAX_FINGER_CLUSTER_SQUEEZE_U` constant |
| `src/contexts/LayoutSettingsContext.tsx` | Squeeze calculation, exposes `fingerClusterSqueeze` |
| `src/layout/EditorLayout.tsx` | Passes raw and squeeze-aware widths |
| `src/components/Keyboard.tsx` | Applies squeeze to key X positions |

### Squeeze Logic in Keyboard.tsx

```typescript
const isThumbCluster = layout.y >= 5;
if (fingerClusterSqueeze > 0) {
    if (!isThumbCluster) {
        const keyCenterX = layout.x + layout.w / 2;
        if (keyCenterX < layoutMidline) {
            xPos = layout.x + fingerClusterSqueeze;  // Left side: shift right
        } else {
            xPos = layout.x - fingerClusterSqueeze;  // Right side: shift left
        }
    }
    // Offset ALL keys left to keep keyboard left-aligned
    xPos -= fingerClusterSqueeze;
}
```

## Documentation

Comprehensive docs in `/docs/`:
- `ARCHITECTURE.md` - System design and data flow
- `API.md` - Service API reference
- `COMPONENTS.md` - Component hierarchy and patterns
- `TYPES.md` - TypeScript type reference

## Sval Protocol

### Protocol Differences from Vial

| Aspect | Vial | Sval |
|--------|------|--------|
| **Wrapper** | None | `0xDD` client ID wrapper |
| **Protocol Prefix** | `0xFE` | `0xDF` (Sval) / `0xFE` (VIA, wrapped) |
| **Client Auth** | None | 20-byte nonce bootstrap, TTL-based renewal |
| **Detection** | HID filter | Raw HID usage page plus the bootstrap handshake (WebHID can't read the USB serial number) |

### Message Format

```
Bootstrap:  [0xDD][0x00000000][nonce:20] → [0xDD][0x00000000][nonce:20][client_id:4][ttl:2]
Sval cmd: [0xDD][client_id:4][0xDF][cmd][args...] → [0xDD][client_id:4][0xDF][response...]
VIA cmd:    [0xDD][client_id:4][0xFE][via_cmd...] → [0xDD][client_id:4][0xFE][response...]
```

### Sval Command IDs (0xDF protocol)

`src/services/usb.service.ts` (`SvilUSB.CMD_SVIL_*`) is the authoritative list.

- `0x00` - get_info (protocol version, UID, feature flags, QMK keycode numbering)
- `0x01/0x02` - tap_dance get/set
- `0x03/0x04` - combo get/set
- `0x05/0x06` - key_override get/set
- `0x07/0x08` - alt_repeat_key get/set
- `0x09/0x0A` - one_shot get/set
- `0x0B` - save, `0x0C` - reset
- `0x0D/0x0E` - definition size/chunk
- `0x10-0x13` - QMK settings query/get/set/reset
- `0x14/0x15` - leader get/set
- `0x16/0x17` - layer state get/set
- `0x18-0x1A` - fragments: hardware, get/set selections
- `0x1B-0x1D` - labels (layer, tap dance, macro names) get/set/clear
- `0x1E-0x20` - macro buffer size/get/set (32-bit offsets)
- `0x21` - table scan
- `0x2A` - storage reset clear (after the host has told the user about a reset reported in get_info)
- `0x2B` - default layer set (saved, like a `PDF` key); advertised by bit 0 of the second feature byte in get_info, after the storage flags

Protocol versions: v2 widened table indices to 2 bytes (256 entries); v3 added the macro buffer commands and table scan. Released firmware (vRC0 onward) is v3.

## VIA3 Custom UI System

The keyboard definition JSON includes a `menus` array that defines dynamic, keyboard-specific settings UI. This enables keyboards like Svalboard to expose custom settings (DPI, scroll mode, layer colors) without hardcoding them in the GUI.

### Menu Structure

```json
{
  "menus": [
    {
      "label": "Pointing Device",
      "content": [
        {
          "label": "Left Pointer",
          "content": [
            {
              "label": "DPI",
              "type": "dropdown",
              "options": ["200", "400", "800", "1600"],
              "content": ["id_left_dpi", 0, 0]
            },
            {
              "label": "Scroll Mode",
              "type": "toggle",
              "content": ["id_left_scroll", 0, 1]
            }
          ]
        }
      ]
    }
  ]
}
```

### Control Types

| Type | Description | Options Format |
|------|-------------|----------------|
| `dropdown` | Select from list | `["opt1", "opt2", ...]` |
| `toggle` | Boolean switch | None |
| `range` | Slider/number input | `[min, max]` |
| `color` | HSV color picker | None |

### Content Array Format

`["value_id", channel, value_index]`

- `value_id` - Human-readable identifier for the setting
- `channel` - VIA channel ID (usually 0 for keyboard-specific)
- `value_index` - Index within the channel's value space

### Conditional Visibility

```json
{
  "showIf": "{id_automouse_enable} == 1",
  "content": [ /* shown only when automouse is enabled */ ]
}
```

## Browser-Based Test Plan (Claude-in-Chrome)

This test plan can be executed autonomously via Claude-in-Chrome browser automation against `http://localhost:5173/`. Tests are organized by feature area and include expected results.

### Prerequisites
- Dev server running: `npm run dev`
- Browser tab open to Keybard
- Keyboard data loaded (file import or connected keyboard)

### Test Suite 1: Sidebar Navigation

| Test | Steps | Expected Result |
|------|-------|-----------------|
| **1.1 Open Keyboard Panel** | Click "Keyboard" in sidebar | Secondary panel shows QWERTY key picker |
| **1.2 Open Special Panel** | Click "Special" in sidebar | Panel shows Media, Audio, Backlight, Steno sections |
| **1.3 Open One-Shot Panel** | Click "One-Shot" in sidebar | Panel shows one-shot modifier keys (OSM) |
| **1.4 Open Layer Keys Panel** | Click "Layer Keys" in sidebar | Panel shows MO, DF, TG, TT, OSL, TO tabs |
| **1.5 Open Mouse Panel** | Click "Mouse" in sidebar | Panel shows mouse buttons, movement, wheel, Svalboard keys |
| **1.6 Open Tap Dances Panel** | Click "Tap Dances" in sidebar | Panel shows tap dance list with Tap/Hold/Tap-Hold/Double-Tap columns |
| **1.7 Open Macros Panel** | Click "Macros" in sidebar | Panel shows macro list with action sequences |
| **1.8 Open Combos Panel** | Click "Combos" in sidebar | Panel shows combo list with input keys → output |
| **1.9 Open Overrides Panel** | Click "Overrides" in sidebar | Panel shows override list with trigger → replacement |
| **1.10 Open Fragments Panel** | Click "Fragments" in sidebar | Panel shows fragment selection dropdowns |
| **1.11 Open About Panel** | Click "About" in sidebar | Panel shows application info |
| **1.12 Open Matrix Tester** | Click "Matrix Tester" in sidebar | Matrix tester view appears |
| **1.13 Open Settings Panel** | Click "Settings" in sidebar | Settings panel opens with category tabs |
| **1.14 Hide Menu Toggle** | Click "Hide Menu" | Left sidebar collapses; click again to expand |

### Test Suite 2: Settings Panel

| Test | Steps | Expected Result |
|------|-------|-----------------|
| **2.1 General Tab** | Open Settings → Click "General" | Shows Live Updating, Typing binds key, Serial Assignment, International Keyboards, QMK Settings |
| **2.2 Pointing Tab** | Open Settings → Click "Pointing" | Shows DPI sliders (left/right), scroll settings |
| **2.3 Import/Export Tab** | Open Settings → Click "Import / Export" | Shows Import..., Export..., Print Layers... options |
| **2.4 Toggle Live Updating** | In General tab, toggle "Live Updating" | Toggle switches state; bottom bar shows "Live Updating" or "Update Changes" button |
| **2.5 Open Export Dialog** | Click "Export..." | Dialog opens with format dropdown (SVIL/VIL/KBI) and Include Macros toggle |
| **2.6 Cancel Export Dialog** | In Export dialog, click "Cancel" | Dialog closes without action |
| **2.7 Open Print Dialog** | Click "Print Layers..." | Dialog opens showing keyboard name and non-empty layer count |
| **2.8 Cancel Print Dialog** | In Print dialog, click "Cancel" | Dialog closes without action |
| **2.9 Change International Keyboard** | Change "International Keyboards" dropdown | Selection updates (verify dropdown value changes) |

### Test Suite 3: Layer Navigation

| Test | Steps | Expected Result |
|------|-------|-----------------|
| **3.1 Switch to Layer 1** | Click layer "1" tab | Keyboard display updates to show Layer 1 keys |
| **3.2 Switch to Layer 2** | Click layer "2" tab | Keyboard display updates to show Layer 2 keys |
| **3.3 Switch to NAS Layer** | Click "NAS" tab | Keyboard display updates to show NAS layer |
| **3.4 Switch to Fn Keys Layer** | Click "Fn Keys" tab | Keyboard display shows function keys |
| **3.5 Switch to Mouse Layer** | Click "Mouse" tab | Keyboard display shows mouse layer |
| **3.6 Return to Default Layer** | Click "default" tab | Keyboard returns to default layer view |
| **3.7 Hide Blank Layers** | Click "Hide Blank Layers" button | Empty layers are hidden from tab bar |

### Test Suite 4: Key Selection & Binding

| Test | Steps | Expected Result |
|------|-------|-----------------|
| **4.1 Select a Key** | Click any key on keyboard layout | Key highlights with selection indicator |
| **4.2 Open Keyboard Picker** | With key selected, click "Keyboard" panel | QWERTY picker visible, can assign new keycode |
| **4.3 Clear Selection** | Press Escape or click elsewhere | Key selection clears |
| **4.4 Select Different Key** | Click different key | Previous selection clears, new key selected |

### Test Suite 5: Combo Panel Interaction

| Test | Steps | Expected Result |
|------|-------|-----------------|
| **5.1 View Combo List** | Open Combos panel | Shows numbered combo entries (0, 1, 2...) |
| **5.2 View Combo Details** | Look at combo entry | Shows input keys (e.g., "D + F") and output key |
| **5.3 Click Combo Entry** | Click on a combo row | Entry becomes editable/selectable |
| **5.4 Scroll Combo List** | Scroll in combo panel | Can view all combo slots |

### Test Suite 6: Tap Dance Panel Interaction

| Test | Steps | Expected Result |
|------|-------|-----------------|
| **6.1 View Tap Dance List** | Open Tap Dances panel | Shows entries with Tap/Hold/Tap-Hold/Double-Tap columns |
| **6.2 View TD Entry Details** | Look at tap dance row | Shows assigned keys for each action type |
| **6.3 Click TD Slot** | Click on a tap dance slot (Tap, Hold, etc.) | Slot becomes selectable for binding |

### Test Suite 7: Override Panel Interaction

| Test | Steps | Expected Result |
|------|-------|-----------------|
| **7.1 View Override List** | Open Overrides panel | Shows override entries with trigger → replacement |
| **7.2 Toggle Override** | Click ON/OFF toggle on an override | Toggle switches state |

### Test Suite 8: Size Controls

| Test | Steps | Expected Result |
|------|-------|-----------------|
| **8.1 Set Normal Size** | Click "NORMAL" button in bottom bar | Keyboard renders at normal size |
| **8.2 Set Medium Size** | Click "MEDIUM" button | Keyboard renders at medium size |
| **8.3 Set Small Size** | Click "SMALL" button | Keyboard renders at small size |

### Test Suite 9: File Import (UI Only)

| Test | Steps | Expected Result |
|------|-------|-----------------|
| **9.1 Open Import Dialog** | Settings → Import/Export → Click "Import..." | File picker dialog triggers (native browser dialog) |

### Test Suite 10: Print Layers (UI Verification)

| Test | Steps | Expected Result |
|------|-------|-----------------|
| **10.1 Open Print Dialog** | Settings → Import/Export → Print Layers | Dialog shows with keyboard name and layer count |
| **10.2 Verify Layer Count** | Check "Non-empty layers" count | Count matches actual non-empty layers in keymap |
| **10.3 Execute Print** | Click "Print" button | Browser print dialog appears |

### Test Execution Commands

To run these tests via Claude-in-Chrome:

```
1. Get tab context: mcp__claude-in-chrome__tabs_context_mcp
2. Navigate if needed: mcp__claude-in-chrome__navigate (url: "http://localhost:5173/")
3. Find elements: mcp__claude-in-chrome__find (query: "element description")
4. Click elements: mcp__claude-in-chrome__computer (action: "left_click", ref: "ref_X")
5. Take screenshots: mcp__claude-in-chrome__computer (action: "screenshot")
6. Read page structure: mcp__claude-in-chrome__read_page (filter: "interactive")
```

### Limitations

**Cannot Test Without Hardware:**
- Actual USB communication with keyboard
- Live keycode changes persisting to device
- Matrix tester key detection
- Connect/disconnect flow with real keyboard

**Can Test (UI Only):**
- All panel navigation and visibility
- Settings toggles and dropdowns
- Dialog open/close flows
- Visual keyboard layout rendering
- Layer switching (UI state)
- Key selection highlighting
- Export dialog options
- Print dialog information
