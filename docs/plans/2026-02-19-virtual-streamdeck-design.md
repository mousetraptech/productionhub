# Virtual StreamDeck Design

**Date:** 2026-02-19
**Status:** Approved

## Overview

A virtual StreamDeck — a 4×8 grid of programmable buttons at `/deck` — providing the middle ground between the power-user CueStack and the natural-language Booth Brain. Dual audience: the MOD uses it as a hot-panel on a second screen, volunteers bookmark `/deck?profile=Audio` on a tablet.

## Requirements

- 4×8 button grid at a dedicated `/deck` route (separate page, not embedded in main UI)
- Buttons fire actions immediately on press — no confirmation
- Composite buttons: drag multiple actions onto one slot to build mini-cues
- Parallel or series execution modes per button
- Populated by dragging from ActionPalette (reuses existing drag infrastructure)
- Multiple named deck profiles, saved globally (not per-show)
- Rich live state feedback from device state (fill bars, active glows, LIVE dots)
- Tablet-optimized touch targets

## Data Model

```typescript
interface DeckButton {
  id: string
  label: string              // user-editable, defaults to first action's label
  icon: string               // emoji, defaults to first action's icon
  color: string              // hex, defaults to first action's color
  actions: DeckAction[]      // 1+ actions
  mode: 'parallel' | 'series'  // default: parallel
  seriesGap: number          // ms between actions in series mode (default: 1000)
}

interface DeckAction {
  actionId: string           // registry action ID or "inline:..."
  osc?: InlineOSC            // for inline/CommandBuilder actions
}

interface GridSlot {
  row: number                // 0-3
  col: number                // 0-7
  button: DeckButton
}

interface DeckProfile {
  name: string
  grid: GridSlot[]           // sparse — only occupied slots
}
```

## Page Layout

### Play Mode (default)

```
┌──────────────────────────────────────────────────┐
│ Profile: [Camera Ops ▾]          [✏️ Edit] [⚙️]  │
├──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
│      │      │      │      │      │      │      │      │
│ Btn  │ Btn  │ Btn  │ Btn  │ Btn  │ Btn  │ Btn  │ Btn  │
│      │      │      │      │      │      │      │      │
├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
│      │      │      │      │      │      │      │      │
│ Btn  │ Btn  │ Btn  │ Btn  │ Btn  │ Btn  │ Btn  │ Btn  │
│      │      │      │      │      │      │      │      │
├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
│      │      │      │      │      │      │      │      │
│ Btn  │ Btn  │ Btn  │ Btn  │ Btn  │ Btn  │ Btn  │ Btn  │
│      │      │      │      │      │      │      │      │
├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
│      │      │      │      │      │      │      │      │
│ Btn  │ Btn  │ Btn  │ Btn  │ Btn  │ Btn  │ Btn  │ Btn  │
│      │      │      │      │      │      │      │      │
└──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┘
```

Full viewport, dark background (#0F172A). CSS grid with `grid-template-columns: repeat(8, 1fr)` and `aspect-ratio: 1` cells.

### Edit Mode

ActionPalette slides in from the left as a drag source. Empty slots show dashed borders as drop targets. Occupied slots get an ✕ remove button on hover/tap.

- Drag first action onto empty slot → creates single-action button
- Drag additional actions onto occupied slot → appends to action list (composite button)
- Click occupied button in edit mode → expands inline editor (action stack, label, color, mode toggle)

### Button Editor (expanded, edit mode)

```
┌──────────────┐
│  🎬 Show Go  │  ← editable label
│──────────────│
│ 1. House Off │  ← action chips, reorderable
│ 2. PB1 Go   │
│ 3. Cam1 Pst3│
│──────────────│
│ [+ drag here]│  ← additional drop target
│ ⚡ Parallel ○ Series │  ← mode toggle
│ Gap: [1000]ms        │  ← visible when series
│ [Label] [Color]      │  ← customization
└──────────────┘
```

## Button Behavior

### Press

Single press fires all actions via the `deck-fire` WS message:

- **Parallel mode**: all actions dispatched simultaneously (no delays)
- **Series mode**: actions dispatched sequentially with `seriesGap` ms between each

Brief ripple/pulse animation (200ms) confirms the button fired.

### Live State Feedback

Buttons connect to DashboardWS (:8080) via `useDeviceStates` for real-time state:

| Action type | Feedback | Visual |
|---|---|---|
| ChamSys playback level (`/pb/N`) | Current level 0-1 | Vertical fill bar behind label |
| ChamSys playback go (`/pb/N/go`) | Active state | Green border glow |
| Camera preset (`/cam1/preset/recall/N`) | Current preset match | Solid fill when active |
| OBS scene (`/obs/scene/NAME`) | Program scene match | Red "LIVE" dot |
| OBS preview (`/obs/scene/preview/NAME`) | Preview scene match | Green border |
| Avantis fader | Current level | Fill bar |
| Avantis mute | Mute state | Red strike-through |

For composite buttons, state feedback reflects the **first action** in the list.

State mapping is derived by parsing the action's OSC address — `/pb/N` → `ChamSysState.playbacks[N].level`, `/cam1/preset/recall/N` → `VISCAState.currentPreset === N`, etc.

### Visual States

```
┌────────────┐     ┌────────────┐     ┌────────────┐
│            │     │▓▓▓▓▓▓▓▓▓▓▓▓│     │   ● LIVE   │
│   🏠       │     │▓▓▓▓▓▓▓▓▓▓▓▓│     │   📹       │
│ House Full │     │▓▓ PB1 ▓▓▓▓▓│     │  Cam Pst 3 │
│            │     │▓▓▓▓▓▓▓▓▓▓▓▓│     │            │
└────────────┘     └────────────┘     └────────────┘
   idle              level=75%         active preset
```

- Idle: button color at ~15% opacity
- Fill bar: rises from bottom, button color at ~60% opacity
- Active: solid glow / border in button color
- Firing: brief bright pulse (200ms)

## Backend

### Profile Storage

JSON files in `decks/` directory at project root:

```
decks/
  camera-ops.json
  audio.json
  main.json
```

File format matches `DeckProfile` interface. Sparse grid — only occupied slots stored.

### WebSocket Messages (ModWS :3001)

**UI → Server:**

| Message | Purpose |
|---|---|
| `{ type: 'deck-list' }` | List all profile names |
| `{ type: 'deck-load', name }` | Load a profile |
| `{ type: 'deck-save', name, grid }` | Create or update a profile |
| `{ type: 'deck-delete', name }` | Delete a profile |
| `{ type: 'deck-fire', buttonId, actions, mode, seriesGap }` | Fire a button |

**Server → UI:**

| Message | Purpose |
|---|---|
| `{ type: 'deck-profiles', profiles: string[] }` | Profile name list |
| `{ type: 'deck-state', name, grid }` | Loaded profile data |
| `{ type: 'deck-saved', name }` | Save confirmation |
| `{ type: 'deck-fired', buttonId }` | Fire confirmation |

### Fire Execution

`deck-fire` handler reuses the existing `routeCommand()` / `sendCommands()` path:

- **Parallel**: iterate all actions, dispatch each immediately
- **Series**: dispatch actions sequentially with `setTimeout` gaps of `seriesGap` ms

Actions are sent in the `deck-fire` message (client already has them) — server doesn't need to load the profile to fire. Stateless and fast.

## React Components

### New Files

```
ui/src/
  pages/
    DeckPage.tsx              — route component, WS connections, state
  components/deck/
    DeckGrid.tsx              — 4×8 CSS grid container
    DeckButton.tsx            — single button (play mode): icon, label, state
    DeckSlot.tsx              — drop target wrapper (edit mode)
    DeckButtonEditor.tsx      — expanded editor: action stack, label, color, mode
    DeckToolbar.tsx           — header: profile selector, edit toggle
  hooks/
    useDeck.ts                — deck state, profile CRUD, fire logic
```

### Reused

- `ActionPalette` — drag source in edit mode
- `useDeviceStates` hook — live state from DashboardWS
- Types from `types.ts` — `InlineOSC`, action categories

### Routing

Lightweight pathname check (no react-router dependency):

- `/` → existing `App.tsx`
- `/deck` → `DeckPage.tsx`
- `/deck?profile=Camera+Ops` → auto-loads named profile

### Touch Optimization

- `onPointerDown` for immediate response (no 300ms tap delay)
- No hover-only states
- Minimum ~80px button targets
- `touch-action: manipulation` to prevent zoom/scroll interference
