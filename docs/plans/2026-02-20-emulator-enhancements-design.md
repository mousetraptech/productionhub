# Emulator Enhancements Design

Date: 2026-02-20

## Summary

Three enhancements to the emulator ecosystem:
1. PH cue list panel in the production-emulator web UI
2. Tiled view showing all emulator panels simultaneously
3. `--emulate-all` CLI flag that sets all devices to emulate mode and auto-launches the emulator

## 1. PH Cue List Panel

New "Production Hub" tab in the production-emulator web UI. Connects to the hub's DashboardWebSocket at `ws://localhost:8081` to receive cue sequencer state in real time.

### UI Elements

- Connection status indicator (green dot = connected, red = disconnected)
- Cue list name + cue count header
- Scrollable cue table: cue id, name, action count, autoFollow flag
- Playhead row highlight with arrow marker
- Running state indicator (pulsing glow on active cue)
- GO button sends `/hub/go` OSC to the hub on UDP 9000

### Data Flow

Hub DashboardWS broadcasts `cue-fired`, `cue-complete`, and `state` events. The emulator's `app.js` opens a second WebSocket to `ws://localhost:8081`, parses messages, updates the panel. GO button sends OSC via the emulator's existing UDP socket (same one used for ChamSys TX on port 9000).

### Fallback

If the hub isn't running, shows "Disconnected — start the hub to see cue state."

### Files Changed (production-emulator)

- `server.js` — no changes needed (state comes from hub WS, not local)
- `public/index.html` — add PH tab template
- `public/app.js` — add hub WS connection, PH panel rendering, GO button OSC send
- `public/styles.css` — PH panel styles

## 2. Tiled View

Query param `?view=tiled` on the existing emulator page switches from tabs to a CSS grid showing all panels at once.

### Layout

```css
.tiled-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(480px, 1fr));
  gap: 12px;
}
```

Each panel gets a header with the device name and a bordered card container. Protocol log spans full width at the bottom.

### Behavior

- Default view remains tabbed
- Toggle link in the header switches between tab/tiled modes
- URL updates with `?view=tiled` or `?view=tabs` for bookmarking
- All panels render simultaneously — SSE drives all of them

### Files Changed (production-emulator)

- `public/index.html` — add tiled container div, toggle button
- `public/app.js` — view mode detection from URL, show/hide logic
- `public/styles.css` — tiled grid styles, panel card borders

## 3. `--emulate-all` CLI Flag

Hub CLI flag that overrides all devices to emulate mode and auto-launches the production-emulator process.

### Behavior

1. Parse `--emulate-all` from `process.argv` in `src/index.ts`
2. Set `emulate: true` on every device config before driver creation
3. Spawn production-emulator: `spawn('node', ['server.js'], { cwd })` with stdio piped through `[emulator]` prefix
4. Wait for emulator HTTP port 8080 to respond (retry loop, max 5s timeout)
5. Proceed with normal hub startup
6. On hub shutdown (`stop()`), kill the child process
7. Add `npm run dev:emulate` script as shorthand for `npm run dev -- --emulate-all`

### Emulator Path Resolution

Look for the production-emulator relative to the hub project: `../production-emulator`. Fall back to `EMULATOR_PATH` env var if set. Error with clear message if not found.

### Files Changed (productionhub)

- `src/index.ts` — arg parsing, emulate override, child process spawn/teardown
- `package.json` — add `dev:emulate` script

## Non-Goals

- No QLab emulator work needed — production-emulator already has QLab (ports 53100/53101)
- No changes to existing Avantis/ChamSys/OBS/VISCA/TouchDesigner emulator panels
- No new protocol emulation
