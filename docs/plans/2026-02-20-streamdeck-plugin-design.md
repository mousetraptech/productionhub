# Stream Deck XL Plugin Design

Elgato Stream Deck XL plugin for Production Hub. Connects to the hub's existing WebSocket endpoints and uses PH deck profiles to drive all 32 hardware keys with live state feedback.

## Architecture

```
Stream Deck XL (32 keys)
  │
  └── com.productionhub.deck plugin (Node.js 20)
        ├── ModWS (:3001) ── deck-load, deck-fire, get-actions
        └── DashboardWS (:8081) ── device-state (live feedback)
```

The plugin is a thin client. All intelligence (profile storage, composite action execution, parallel/series logic, device routing) stays in the hub. The Stream Deck is a dumb trigger + display surface.

## Plugin Structure

```
streamdeck-plugin/
  package.json
  tsconfig.json
  rollup.config.mjs
  src/
    plugin.ts                 # Entry — register action, connect hub client
    actions/
      ph-button.ts            # SingletonAction for all 32 keys
    lib/
      hub-client.ts           # ModWS + DashboardWS connection manager
      button-renderer.ts      # SVG generator for 96x96 button images
      state-matcher.ts        # getDeckButtonState (ported from virtual deck)
  com.productionhub.deck.sdPlugin/
    manifest.json
    imgs/
      plugin-icon.png         # 256x256 + 512x512 plugin icon
      action-icon.png         # 20x20 + 40x40 action icon
    profiles/
      ProductionHub.streamDeckProfile  # Pre-built XL profile (32 keys)
    bin/                      # Rollup output
```

## Manifest

```json
{
  "$schema": "https://schemas.elgato.com/streamdeck/plugins/manifest.json",
  "Actions": [{
    "Icon": "imgs/action-icon",
    "Name": "PH Button",
    "States": [{ "Image": "imgs/action-icon" }],
    "UUID": "com.productionhub.deck.button",
    "UserTitleEnabled": false
  }],
  "Author": "Production Hub",
  "CodePath": "bin/plugin.js",
  "Description": "Live production control — house lights, stage, cameras, audio, OBS.",
  "Icon": "imgs/plugin-icon",
  "Name": "Production Hub",
  "Nodejs": { "Version": "20", "Debug": "enabled" },
  "OS": [
    { "Platform": "mac", "MinimumVersion": "13" },
    { "Platform": "windows", "MinimumVersion": "10" }
  ],
  "UUID": "com.productionhub.deck",
  "Version": "1.0.0.0",
  "SDKVersion": 2,
  "Software": { "MinimumVersion": "6.6" },
  "Profiles": [{
    "Name": "ProductionHub",
    "DeviceType": 2,
    "AutoInstall": true,
    "DontAutoSwitchWhenInstalled": false,
    "Readonly": false
  }]
}
```

## Hub Client

`hub-client.ts` — singleton managing two WebSocket connections.

### ModWS (:3001)
- On connect: sends `deck-load` (profile name from global settings, default "main") and `get-actions`
- Receives: `deck-state` (profile grid), `actions` (action registry with commands), `deck-fired`
- Sends: `deck-fire` on key press

### DashboardWS (:8081)
- Receives: `device-state` with deviceType + state payload
- Stores latest state per device type (chamsys, obs, visca, avantis, touchdesigner)

### Events emitted
- `profile-loaded(grid: GridSlot[])` — re-render all 32 keys
- `actions-loaded(categories: ActionCategory[])` — build command lookup for state matching
- `device-state(deviceType, state)` — re-render affected keys
- `connected` / `disconnected` — show connection status on keys

### Configuration
Global settings via Property Inspector:
- `hubHost` (default: `localhost`)
- `modWsPort` (default: `3001`)
- `dashboardPort` (default: `8081`)
- `profileName` (default: `main`)

Auto-reconnect on both connections with 2s delay.

## Key Mapping

Stream Deck XL: 32 keys, 4 rows x 8 columns. Keys numbered 0-31 left-to-right, top-to-bottom.

```
Key  0  1  2  3  4  5  6  7     Row 0
Key  8  9 10 11 12 13 14 15     Row 1
Key 16 17 18 19 20 21 22 23     Row 2
Key 24 25 26 27 28 29 30 31     Row 3
```

Mapping: `row = Math.floor(keyIndex / 8)`, `col = keyIndex % 8`

The SDK provides `ev.payload.coordinates: { row, column }` on each event — direct 1:1 match to GridSlot positions.

## Action Class (ph-button.ts)

Single `@action({ UUID: "com.productionhub.deck.button" })` class extending `SingletonAction`.

### State
- `actionMap: Map<string, Action>` — visible action instances keyed by `"row:col"`
- `grid: GridSlot[]` — current profile grid (from hub)
- `actionCommands: Map<string, ActionCommandRef[]>` — registry action commands for state matching
- `deviceStates: Record<string, any>` — latest device state per type
- `lastRendered: Map<string, string>` — last SVG hash per key (skip redundant setImage calls)

### Lifecycle
- `onWillAppear(ev)` — store action instance in actionMap, render current button
- `onWillDisappear(ev)` — remove from actionMap
- `onKeyDown(ev)` — look up button at coordinates, send deck-fire, render flash, re-render after 200ms

### State update flow
1. `device-state` arrives from DashboardWS
2. For each key in actionMap, compute `getDeckButtonState(button, deviceStates, actionCommands)`
3. Generate SVG via `button-renderer`
4. Compare SVG hash to lastRendered — only call `setImage()` if changed

## Button Renderer (SVG)

96x96 pixel SVGs for Stream Deck XL keys.

### Layout
```
┌──────────────────┐
│ ● LIVE           │  red dot + text (top-left, when live)
│                  │
│       💡         │  emoji icon (centered, 28px)
│    Full Wash     │  label (centered, 12px, white)
│              3   │  action count (bottom-right, if >1)
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  fill bar (bottom, color at 60%)
└──────────────────┘
```

### States
- **Idle**: background = button color at 15%, border = button color at 30%
- **Active**: border = #10B981 (green)
- **Live**: border = #EF4444 (red), LIVE dot top-left
- **Firing flash**: background = button color at 50%, revert after 200ms
- **Empty slot**: background = #1E293B, thin #334155 border
- **Disconnected**: all keys show dark background with "PH" text and "disconnected" label

### SVG generation
```typescript
function renderButton(button: DeckButton | null, state: ButtonState, firing: boolean): string
```
Returns SVG string. Called with `setImage(`data:image/svg+xml,${encodeURIComponent(svg)}`)`.

## State Matcher

`state-matcher.ts` — port of `ui/src/components/deck/useDeckButtonState.ts` to plain TypeScript (no React imports). Same logic:

1. Resolve address from inline OSC or registry action lookup
2. Determine device type from address or registry command
3. Match against device state:
   - ChamSys: playback level + active
   - OBS: current scene (live) + preview (active)
   - VISCA: current preset (active)
   - Avantis: fader level, mute state

Returns `{ level: number | null, active: boolean, live: boolean }`.

## Pre-built Profile

`ProductionHub.streamDeckProfile` — Stream Deck profile JSON that pre-maps all 32 key positions with the `com.productionhub.deck.button` action. Auto-installs on plugin install. User sees all 32 keys immediately, no manual dragging.

## Install Flow

### Development
```bash
cd streamdeck-plugin
npm install
npm run build          # rollup → .sdPlugin/bin/plugin.js
streamdeck link        # symlink into SD plugins dir
# Restart Stream Deck app — plugin loads, profile auto-installs
```

### Production
Copy `com.productionhub.deck.sdPlugin/` to:
- macOS: `~/Library/Application Support/com.elgato.StreamDeck/Plugins/`
- Windows: `%APPDATA%\Elgato\StreamDeck\Plugins\`

Restart Stream Deck app.

## Data Flow Summary

```
Key Press → onKeyDown → hub-client.fire(button) → ModWS deck-fire → hub executes actions
                                                                         │
ChamSys/OBS/VISCA feedback → hub driver → DashboardWS device-state ──────┘
         │
         └── hub-client receives → state-matcher → button-renderer → setImage()
```
