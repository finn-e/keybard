# KeyBard-NG Architecture Documentation

## Overview

KeyBard-NG is a modern web-based keyboard configuration tool for Svalboard-QMK keyboards, with specific support for the Svalboard. Built with React 19, TypeScript, and Vite, it leverages the WebHID API for direct USB communication with keyboards running Svalboard-QMK firmware.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser Runtime                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  React Application                    │   │
│  │  ┌────────────────────────────────────────────────┐  │   │
│  │  │         UI Layer (Components)                  │  │   │
│  │  └────────────────────────────────────────────────┘  │   │
│  │           ↕ KeyboardContext (State Management)           │   │
│  │  ┌────────────────────────────────────────────────┐  │   │
│  │  │         Service Layer                          │  │   │
│  │  └────────────────────────────────────────────────┘  │   │
│  │           ↕ SvilUSB (Communication Layer)            │   │
│  └──────────────────────────────────────────────────────┘   │
│                      ↕ WebHID API                            │
└─────────────────────────────────────────────────────────────┘
                      ↕ USB Protocol
┌─────────────────────────────────────────────────────────────┐
│                 Physical Keyboard Hardware                   │
│         (Svalboard-QMK firmware with VIA protocol)                │
└─────────────────────────────────────────────────────────────┘
```

## Core Layers

### 1. UI Layer (React Components)
- **KeyboardConnector**: Main orchestration component
- **Keyboard**: Visual keyboard layout rendering
- **Key**: Individual key component
- **QMKSettings**: Settings configuration UI

### 2. State Management Layer
- **KeyboardContext**: Centralized state management using React Context
- Provides keyboard state and operations to all components
- Manages connection lifecycle and data loading

### 3. Service Layer
- **KeyboardService**: Core Sval protocol implementation
- **QMKService**: QMK settings management
- **SvalService**: Svalboard-specific features
- **KeyService**: Keycode translation and management

### 4. Communication Layer
- **SvilUSB**: WebHID API abstraction
- Handles all USB HID communication
- Implements wrapped VIA and Sval protocol commands

## Data Flow

### Connection Sequence
1. User initiates connection via UI
2. WebHID API prompts for device selection
3. SvilUSB establishes communication channel
4. KeyboardService queries keyboard information
5. Keyboard layout and features are loaded
6. UI renders based on loaded configuration

### Key Update Flow
1. User modifies key mapping
2. Component triggers update via KeyboardContext
3. KeyboardService sends update command
4. Keyboard firmware updates EEPROM
5. UI state updates for immediate feedback

## Key Technologies

- **React 19**: Modern UI framework
- **TypeScript**: Type-safe development
- **Vite**: Fast build tooling
- **WebHID API**: Direct USB communication
- **xz-decompress**: Keyboard data decompression

## Project Structure

```
keybard/
├── src/
│   ├── components/     # React components
│   ├── services/       # Business logic services
│   ├── contexts/       # React contexts
│   ├── types/          # TypeScript definitions
│   └── constants/      # Static configurations
├── tests/              # Test suites
└── docs/               # Documentation
```

## Service Architecture

### KeyboardService
Central service for Sval protocol operations:
- Protocol version negotiation
- Keyboard information retrieval
- Keymap management
- Feature discovery

### QMKService
Manages QMK-specific settings:
- Query supported settings (QSIDs)
- Fetch current values
- Update settings on keyboard

### SvalService
Svalboard-specific extensions:
- Custom protocol detection
- Layer color management
- Firmware version queries

### KeyService
Keycode translation utilities:
- Numeric to string conversion
- String parsing to keycodes
- Modifier combination handling
- Custom keycode generation

## Testing Strategy

- **Unit Tests**: Service layer coverage
- **Mocked USB**: WebHID API simulation
- **Fixtures**: Predefined test data
- **Coverage Goal**: >90% for critical paths

## Future Enhancements

- Macro editor interface
- Combo configuration
- Tap dance setup
- Multi-keyboard support
- Configuration persistence
- Cloud synchronization

## Browser Compatibility

Requires browsers with WebHID API support:
- Chrome/Chromium 89+
- Edge 89+
- Opera 75+
- Brave (with experimental features)

## Security Considerations

- WebHID requires user permission
- No direct firmware modification
- Sandboxed browser environment
- HTTPS required for WebHID access