# Command Reference Page — Design

## Problem

PH has comprehensive OSC command docs in README.md and docs/qlab-guide.md, but both are markdown files in the repo. There's no way to pull up a command reference on a phone in the booth, or hand someone a URL while they're setting up Stream Deck buttons or QLab cues.

## Solution

A self-contained HTML page served from the hub at `GET /docs`. Dark theme matching the MOD UI. Context-aware: defaults to showing only configured devices, with a toggle to show everything PH supports.

## Approach

**Option A: Static HTML file** (chosen) — single `docs/command-reference.html` with inline CSS/JS. Served by the HTTP server. A new `GET /api/devices` endpoint provides the configured device list so the page can filter.

## URL + API

- `GET /docs` — serves `docs/command-reference.html`
- `GET /api/devices` — returns `[{ type, prefix }]` from current config

## Page Structure

- **Top bar** — title + "My Devices" / "All Commands" toggle
- **Sidebar nav** (left, collapses on mobile) — device section links
- **Main content** — scrollable sections per device:
  - Device header (icon + name + prefix)
  - Command tables: Address | Args | Description
  - Copy button on each address row
  - Expandable example blocks for common commands
- **Footer** — version, GitHub link

## Device Sections

### Audio (Avantis)
- Faders: ch, dca, grp, mix, fxsend, fxrtn, mtx, main
- Mutes: ch, dca, main
- Pan: ch
- Timed fades with easing (linear, scurve, easein, easeout)
- Scene recall (0-127)
- Fader value reference

### Lights (ChamSys QuickQ)
- Playback go, fader level, flash, pause, release
- Warning: `/pb/{N}/go 1` not `/pb/{N}/1`

### Cameras (VISCA)
- Preset recall/store, home
- Pan/tilt speed + stop, zoom speed/direct/stop
- Focus, power

### OBS Studio
- Scene (program + preview), transition trigger
- Stream/record start/stop/toggle
- Transition type + duration

### TouchDesigner
- Transparent relay, example addresses

### Global / Hub
- `/fade/stop` — stop fades
- `/hub/go`, `/hub/stop`, `/hub/back` — cue stack
- `/hub/panic` — emergency stop

### Per-device examples
2-3 common recipes each with exact address + args to copy.

## Style

Dark theme matching MOD UI:
- Background: `#0F172A`
- Text: `#E2E8F0`
- Slate palette for borders, cards
- Monospace for addresses
- Copy button highlight on click

## Toggle Behavior

- Default: "My Devices" (fetches `/api/devices`, hides unconfigured sections)
- Fallback: "All Commands" if API call fails
- Toggle grays out / collapses unconfigured device sections

## Files Changed

- `docs/command-reference.html` — new, self-contained HTML/CSS/JS
- `src/hub/http-server.ts` — add `GET /docs` + `GET /api/devices` routes

## No New Dependencies
