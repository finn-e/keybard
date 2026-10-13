# KeyBard

[![Tests](https://img.shields.io/github/actions/workflow/status/svalboard/keybard/test.yml?branch=main&style=flat-square&label=tests)](https://github.com/svalboard/keybard/actions/workflows/test.yml)

A modern Vite-based keyboard configuration UI built with React and TypeScript.

## User manual

The illustrated user manual, at [keybard.svalboard.com/manual/](https://keybard.svalboard.com/manual/), walks through connecting, editing, layers, behaviors, backups and the overlay. Its source is in [docs/manual](docs/manual/README.md), with a printable PDF; that README covers regenerating the screenshots and the review record. The production build copies it to `dist/manual/` (see `build/manual.ts`).

## Quick Start

```bash
npm install        # Install dependencies
npm run dev        # Start development server
# → http://localhost:5173
```

## Project Structure

```text
keybard-ng/
├── src/           # Vite + React + TypeScript
│   ├── constants/      # KeyMap constants
│   ├── components/     # React components
│   ├── contexts/       # KeyboardContext
│   ├── services/       # TypeScript keyboard services
│   │   ├── key.service.ts
│   │   ├── usb.ts
│   │   ├── utils.ts
│   │   └── keyboard.service.ts
│   └── types/         # TypeScript definitions
├── tests/         # Test suite
│   ├── services/       # Service layer tests
│   ├── contexts/       # React Context tests
│   ├── fixtures/       # Test data and mocks
│   └── mocks/          # USB and API mocks
└── dist/          # Build output (gitignored)
```

## Key Technologies

- **React 19** with TypeScript
- **Vite** for fast dev server and builds
- **js-lzma** for board-provided compressed definitions
- **WebHID API** for USB keyboard communication

## Available Commands

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run preview  # Preview production build
```

## Loading Keyboard Configurations

KeyBard supports two ways to view keyboard configurations:

### 1. Connect to Physical Keyboard

Click "Connect Keyboard" to connect to a Svalboard-QMK keyboard via WebHID.

**Browser Support**: Chrome (89+), Edge (89+), Opera (75+), Brave
**Not Supported**: Firefox, Safari (WebHID unavailable)

### 2. Load Configuration File

Click "Load File" to load a `.svil` or `.vil` configuration file.

**Supported formats**:
- `.svil` - Native Svalboard layout format (recommended). Legacy `.viable` files still load.
- `.vil` - Vial-compatible format

**File size limit**: 1MB maximum

### Switching Between Sources

You can freely switch between connected keyboards and loaded files. The display always shows the most recent source. The "Loaded From" field indicates whether you're viewing a device or a file.

## Integration Points

### KeyboardContext Hook

```tsx
import { useKeyboard } from './contexts/KeyboardContext';

function MyComponent() {
  const {
    keyboard,
    isConnected,
    loadedFrom,
    connect,
    loadKeyboard,
    loadFromFile
  } = useKeyboard();

  // Use keyboard services...
}
```

### Services Available

- `SvilUSB` - USB HID communication
- `KeyboardService` - Keyboard operations (load, getKeyboardInfo, etc.)
- `KeyService` - Keycode parsing and stringifying (parse, stringify, define, etc.)
- Utilities - Byte manipulation (LE16, BE16, etc.)

## What's Working

✅ TypeScript conversion of core Sval modules
✅ USB communication layer
✅ Board-definition decompression via js-lzma
✅ KEY utilities (keycode parsing, CODEMAP, KEYMAP, KEYALIASES)
✅ React Context provider
✅ Basic connection UI
✅ File loading (.svil and .vil configuration files)

## Configuration and the overlay

The editor includes keymaps, macros, combos, tap dances, overrides, leaders and pointing settings. The Overlay item installs and connects the separate native Keybard Host overlay. See [the companion README](companion/overlay-host/README.md) for setup.

## Theming

The app has light and dark themes (Settings > General > Appearance: System, Light or Dark). Dark mode is the `dark` class on `<html>`, set before first paint by the inline script in `src/index.html` and kept in sync by `src/components/ThemeSync.tsx`. Helpers live in `src/lib/theme.ts`.

### Tokens

Chrome colours come from tokens defined in `src/index.css` (`:root` for light, `.dark` for dark). Each light value equals the literal it replaced, so light mode is unchanged.

| Utility | Light | Dark | Use for |
|---|---|---|---|
| `bg-kb-gray` | `#f1f2f2` | `#141517` | Page background, row borders |
| `border-kb-key-border` | `#f1f2f2` | `#3a3d42` | Key gap/outline (`Key.tsx` only) |
| `bg-kb-gray-medium` | `#eaeae9` | `#26282b` | Raised/recessed panels, unselected chips |
| `border-kb-gray-border` | `#a7a9ac` | `#6b6f76` | Strong borders, control outlines |
| `bg-kb-surface` | `#ffffff` | `#1d1e21` | Panels and cards (instead of `bg-white` / `border-white`) |
| `text-kb-ink` (`fill-`, `border-`, `ring-`) | `#000000` | `#f1f2f2` | Chrome text, icons, logos, focus rings (instead of `text-black` etc.) |
| `bg-kb-active` / `text-kb-active-fg` | `#000` / `#fff` | `#e8e9ea` / `#111214` | Selected pill or chip |
| `bg-kb-popover` | `#EEEEEE` | `#33363b` | Colour-picker popovers |

The shadcn variables (`--background`, `--foreground`, `--popover`, `--primary`, `--muted`, `--border`, `--input`, `--ring`, ...) are also redefined under `.dark`, so shadcn primitives in `src/components/ui` theme themselves.

### Rules

1. **Chrome uses a token or a `dark:` partner.** Never write `bg-white`, `text-black`, `border-black`, `fill-black`, `ring-black`, `bg-[#hex]` or `fill="black"` for chrome; use the tokens above. For a `gray-*`/`slate-*` utility, put a `dark:` class for the same property and variants in the same string literal: `text-gray-500 dark:text-neutral-400`, `hover:bg-gray-100 dark:hover:bg-neutral-800`. Never change the light class itself.
2. **Key data is never themed.** Layer colours (`src/utils/colors.ts`), key face colours and `headerClassName` key headers (e.g. `bg-kb-sidebar-dark`) look the same in both themes. Never put `kb-active` or other theme tokens in a `headerClassName`.
3. **Printed output stays light.** `PrintableKeymap*` is not themed, and `index.css` forces a light page under `@media print`.

`tests/theme/no-hardcoded-chrome-colors.test.ts` enforces rules 1 and 2 on `src/**/*.tsx` as part of `npm test`. Justified exceptions (dead code, developer tools, data lookups) go in `tests/theme/allowlist.ts` with a reason.

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage report
npm run test:coverage

# Run in watch mode (during development)
npm run test:watch

# Open Vitest UI
npm run test:ui
```

### Test Coverage

This project maintains **90% code coverage** across:

- ✅ Utility functions and byte manipulation
- ✅ KeyService (keycode parsing, custom keys, layers)
- ✅ USB communication layer (mocked WebHID API)
- ✅ KeyboardService (keyboard loading, keymap management)
- ✅ QMK settings service
- ✅ React Context state management

### Test Structure

```text
tests/
├── services/       # Service layer tests
├── contexts/       # React Context tests
├── fixtures/       # Test data and mocks
├── mocks/          # USB and API mocks
└── utils/          # Test utilities
```

### Writing Tests

Tests follow the AAA (Arrange-Act-Assert) pattern:

```typescript
it('should update key at specific position', async () => {
  // Arrange
  const layer = 0, row = 1, col = 2;
  const keymask = 0x0004; // KC_A

  // Act
  await keyboardService.updateKey(layer, row, col, keymask);

  // Assert
  expect(mockUSB.send).toHaveBeenCalledWith(/* ... */);
});
```

### CI/CD

Tests run automatically on:

- Pull requests (all commits)
- Pushes to main/master
- Coverage reports posted to PRs

## Documentation

See [VITE_SETUP.md](./VITE_SETUP.md) for detailed setup and development documentation.

## Overlay dialog and Keybard Host

The Overlay item in the left navigation panel opens a small dialog, as do `/#overlay` and `/#trainer` links. It offers the Keybard Host download and connects Keybard to a running Host, so the overlay refreshes after edits and uses Keybard's keyboard language. The overlay's settings live in Keybard Host's own menus.

The [native Keybard Host](companion/overlay-host/README.md) serves this same web UI and runs its renderer as a transparent tray-managed desktop overlay. It has an isolated Windows runtime and read-only Svalboard device worker. Host mode supports live active/default layers, optional held-key feedback, remembered-board reconnect, and settings in its overlay and tray menus. Keybard keeps its standard WebHID connection flow; the native overlay uses a separate read-only client.
