# MOD UI Simplification & Stream Deck Fix

Date: 2026-02-22

## Overview

Three changes: (1) simplify the MOD UI by replacing inline form fields with drag-first tiles and parameter modals, (2) add dynamic OBS scene dropdowns powered by live scene list queries, and (3) fix the Stream Deck plugin manifest path issue that prevents buttons from populating.

## 1. MOD UI Simplification

### Problem

The CommandBuilder requires users to fill in form fields (channel, level, scene name, etc.) before they can drag a command to the cue stack. This is unintuitive — users want to drag first, then fill in details.

### Design

**Sidebar: CommandTile replaces BuilderRow**

Replace the 25 `BuilderRow` components (each with inline form inputs) with clean `CommandTile` draggable tiles grouped by device category:

- **Audio** (blue): Set Fader, Set DCA, Fade Fader, Fade DCA, Mute, Unmute, Recall Scene
- **Lighting** (amber): Playback Level, Playback Go, Playback Jump
- **Cameras** (teal): Cam 1/2/3 Preset, Cam 1/2/3 Zoom, Cam 1/2/3 Home
- **OBS** (purple): OBS Scene, OBS Preview, OBS Transition
- **Custom** (gray): Raw OSC

Each tile is a simple labeled draggable (icon + name, category-colored). No inline form fields. Drag payload carries the command type string (e.g., `set-fader`, `obs-scene`).

**CommandModal: Parameter prompt on drop**

When a command tile is dropped on the CueStack or a CueRow, a modal dialog appears:

- Title: command label
- Fields: dynamically generated per command type (same fields as current BuilderRow)
- Validation: same normalization logic (fader 0-100 → 0.0-1.0, range checks, etc.)
- Buttons: Cancel (abort) and Add (validate → create action)

On "Add", the modal builds the OSC payload (address, args, label) and sends the existing `add-action-to-cue` WebSocket message. Drop on CueStack creates a new cue; drop on CueRow adds to that cue.

**What stays the same:**

- Registry actions (DragTile) — unchanged, still drag directly with no modal
- CueStack and CueRow drop handling — same WebSocket messages
- GoBar, device panels, cue firing — untouched

### Component Changes

| Component | Change |
|-----------|--------|
| `CommandBuilder.tsx` | Replace with `CommandPalette.tsx` — renders CommandTile grid by category |
| New: `CommandTile.tsx` | Simple draggable tile (icon + label + color), carries command type |
| New: `CommandModal.tsx` | Modal dialog with dynamic parameter fields per command type |
| `ActionPalette.tsx` | Swap CommandBuilder for CommandPalette in sidebar |
| `CueStack.tsx` | On drop of command type, open modal instead of creating action immediately |
| `CueRow.tsx` | On drop of command type, open modal instead of adding action immediately |
| `App.tsx` | Host CommandModal state (open/close, target cue) |

## 2. OBS Scene Dropdowns

### Problem

OBS Scene and OBS Preview commands require manually typing scene names. The user must know the exact scene name string. The OBS driver doesn't currently query available scenes.

### Design

**Backend: OBS driver queries scene list on connect**

After the WebSocket v5 handshake completes (Identified), the OBS driver sends a `GetSceneList` request. The response contains all scene names. The driver stores this list and updates it when `SceneListChanged` events arrive.

The scene list is exposed via `getState()` alongside existing state, and broadcast to the UI through the existing `device-state` WebSocket message path.

**Frontend: CommandModal renders dropdown for OBS commands**

When the CommandModal opens for `obs-scene` or `obs-preview`, it renders a `<select>` dropdown populated from the OBS device state's scene list instead of a text input. Falls back to a text input if OBS is disconnected or scene list is unavailable.

### Changes

| File | Change |
|------|--------|
| `src/drivers/obs-driver.ts` | Add `GetSceneList` query after Identified. Store scene names. Handle `SceneListChanged` event. Expose in `getState()`. |
| `ui/src/components/CommandModal.tsx` | For OBS scene/preview commands, render dropdown from device state |
| `ui/src/App.tsx` | Pass OBS device state to CommandModal |

## 3. Stream Deck Fix

### Problem

The Stream Deck plugin crashes on startup with:
```
Error: Failed to read manifest.json as the file does not exist.
```

The Elgato SDK resolves `manifest.json` from `process.cwd()`. Stream Deck launches `bin/plugin.js`, making the working directory `bin/`. But `manifest.json` is in the parent `.sdPlugin/` directory.

### Fix

Add a copy step to `rollup.config.mjs` that copies `../com.productionhub.deck.sdPlugin/manifest.json` into the `bin/` output directory during build. This ensures the SDK finds it regardless of working directory.
