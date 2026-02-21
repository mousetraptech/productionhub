# Production Hub

Multi-device OSC control hub for live production. Routes OSC messages to device-specific protocols (MIDI TCP, OSC relay, WebSocket, VISCA IP) and provides a React web UI for show control.

## Quick Start

```bash
npm run dev          # Start backend (ts-node, auto-loads config.yml)
npm run dev:emulate  # Start with all devices in emulate mode + auto-launch emulator
cd ui && npm run dev # Start React frontend (Vite dev server)
```

The hub listens on UDP 9000 for OSC, WebSocket 3001 for the MOD UI, and HTTP 8081 for health/dashboard.

## Architecture

```
OSC (UDP 9000) ──> Hub ──> DriverManager ──> Device Drivers
                    │                           ├── avantis-driver (MIDI TCP :51325)
                    │                           ├── chamsys-driver (OSC relay)
                    │                           ├── obs-driver (WebSocket v5)
                    │                           ├── visca-driver (VISCA over IP)
                    │                           └── touchdesigner-driver (OSC relay)
                    │
                    ├── CueEngine (show state, cue firing, auto-follow)
                    ├── FadeEngine (timed interpolation at 50Hz)
                    ├── ActionRegistry (actions.yml -> OSC commands)
                    ├── ModWebSocket (:3001, React UI sync)
                    └── DashboardWebSocket (:8081, monitoring)
```

**Routing:** Each device in `config.yml` has a prefix (e.g., `/avantis`, `/lights`). Incoming OSC messages are matched by prefix and forwarded to the corresponding driver.

**Cue system:** `CueAction` supports both registry actions (by `actionId` from `actions.yml`) and inline OSC commands (with `osc: { address, args, label }` payload). The UI sidebar has a CommandBuilder for creating inline commands by drag-and-drop.

## Key Files

| Path | Purpose |
|------|---------|
| `config.yml` | Device configuration (hosts, ports, prefixes, emulation flags) |
| `actions.yml` | Pre-defined action catalog (house lights, audio, camera, etc.) |
| `src/index.ts` | CLI entry point |
| `src/hub.ts` | Main orchestrator — creates OSC server, drivers, cue engine, WS servers |
| `src/osc-server.ts` | UDP OSC listener (port 9000) |
| `src/midi-protocol.ts` | Avantis MIDI TCP protocol — NRPN builders, channel mapping, TCP transport |
| `src/midi-parser.ts` | Incoming MIDI stream parser |
| `src/fade-engine.ts` | Timed parameter interpolation (linear, S-curve, ease-in/out) |
| `src/config.ts` | YAML config loader with Zod validation |
| `src/drivers/avantis-driver.ts` | Avantis: translates OSC addresses to MIDI NRPN/Note On messages |
| `src/drivers/chamsys-driver.ts` | ChamSys QuickQ: transparent OSC relay over UDP |
| `src/drivers/obs-driver.ts` | OBS Studio: WebSocket v5 protocol |
| `src/drivers/visca-driver.ts` | PTZ cameras: VISCA over IP |
| `src/cue-engine/engine.ts` | Show state manager — cue list, fire, auto-follow |
| `src/cue-engine/types.ts` | Cue, CueAction, InlineOSC, ShowState types |
| `src/server/websocket.ts` | ModWebSocket — UI communication (port 3001) |
| `src/hub/driver-manager.ts` | Driver lifecycle, prefix routing |
| `src/health/types.ts` | ConnectionState, DeviceHealth, ReconnectConfig |

## UI (React + Vite)

Located in `ui/`. Key components:

| Component | Purpose |
|-----------|---------|
| `App.tsx` | Main layout — template picker, sidebar, cue stack, device panels |
| `ActionPalette.tsx` | Browsable action categories + CommandBuilder section |
| `CommandBuilder.tsx` | Parameterized inline OSC command builder (drag to create cues) |
| `CueStack.tsx` | Cue list display with drag-drop and fire controls |
| `CueRow.tsx` | Single cue row — shows action chips, handles drops |
| `ActionChip.tsx` | Renders action buttons (registry or inline OSC) |
| `GoBar.tsx` | Large GO / PAUSE controls |
| `devices/AvantisPanel.tsx` | Avantis fader strips, mutes, scene display |
| `devices/ChamSysPanel.tsx` | ChamSys playback controls |

### Inline OSC Commands (CommandBuilder)

The sidebar CommandBuilder supports these command types:
- **Set Fader** — `/avantis/ch/{n}/mix/fader [val]`
- **Set DCA** — `/avantis/dca/{n}/fader [val]`
- **Mute / Unmute** — `/avantis/ch/{n}/mix/mute [1|0]`
- **Recall Scene** — `/avantis/scene/recall [n]`
- **Playback** (level) — `/lights/pb/{n} [level]`
- **PB Go** — `/lights/pb/{n}/go [1]` (advance to next cue)
- **PB Jump** — `/lights/pb/{pb}/go [1, cue]` (jump to specific cue)
- **Cam {1-3} Preset** — `/{cam}/preset/recall/{n}`
- **Cam {1-3} Zoom** — `/{cam}/zoom/direct [0.0-1.0]`
- **Cam {1-3} Home** — `/{cam}/home`
- **OBS Scene** — `/obs/scene/{name}` (sets program scene directly)
- **OBS Preview** — `/obs/scene/preview/{name}` (sets preview scene)
- **OBS Transition** — `/obs/transition/trigger` (preview → program)
- **Raw OSC** — any address + args

Drag a configured command onto the cue stack to create an inline OSC cue action.

## Protocols

### Avantis (MIDI TCP on port 51325)

- NRPN fader: `Bn 63 <strip> Bn 62 17 Bn 06 <level>` (level 0x00-0x7F)
- Mute: Note On `9n <note> <vel>` (vel >= 0x40 = mute on, <= 0x3F = mute off)
- Scene recall: Program Change `Cn <scene>`
- MIDI channels (0-indexed, base=0): +0 inputs 1-48, +1 inputs 49-64, +2 mix/FX, +3 DCA/groups, +4 main
- `NRPN_PARAM.FADER_LEVEL = 0x17` (hex, not decimal 17)

### ChamSys QuickQ (OSC over UDP)

Documented OSC commands (QuickQ RX port 8000):
- `/pb/{N}` — Set playback N fader level (float 0.0-1.0 or int 0-100)
- `/pb/{N}/go` — Advance to next cue on playback N (requires non-zero int arg)
- `/pb/{N}/flash` — Flash playback N (non-zero=on, zero=off)
- `/pb/{N}/pause` — Pause playback N
- `/pb/{N}/release` — Release playback N

**WARNING:** `/pb/{N}/{cue}` (two integers) jumps to a specific cue number — it does NOT mean "button number". Do NOT use `/pb/{N}/1` for "go" — use `/pb/{N}/go` instead.

The hub's ChamSys driver is a transparent OSC relay — addresses are forwarded verbatim (minus the `/lights` prefix).

## Testing

```bash
npm test                    # All tests
npm run test:protocol       # MIDI protocol tests
npm run test:fade           # Fade engine tests
npm run test:hub            # Hub integration tests
npx tsc --noEmit            # Type check backend
cd ui && npx tsc --noEmit   # Type check frontend
```

## Configuration Notes

- `heartbeat.enabled: false` should be set for the Avantis device when using the emulator (emulator doesn't send unsolicited MIDI) and for all VISCA cameras (VISCA cameras never send unsolicited data, so heartbeat timeout causes a reconnect loop)
- The OSC server has an error listener in `hub.ts` to prevent crashes from malformed packets
- The MIDI TCP transport uses socket identity guards to prevent reconnect loops from stale socket close events
- `emulate: true` on a device config overrides host/port to point at the standalone production-emulator defaults (127.0.0.1 + emulator port). Emulator default ports: avantis=51325, chamsys=7000, obs=4455, visca=5678, touchdesigner=12000
- `--emulate-all` CLI flag sets all devices to emulate mode and auto-launches the production-emulator process. Requires `../production-emulator` or `EMULATOR_PATH` env var. Use `npm run dev:emulate` for convenience.

## Booth Brain (AI Reasoning Layer)

The Brain is an AI-powered reasoning layer that lets the MOD (director) control production devices via natural language chat. Located in `src/brain/`.

| File | Purpose |
|------|---------|
| `src/brain/brain-service.ts` | Core service — manages Claude API calls, conversation history, tool execution, confirm/trusted modes |
| `src/brain/system-prompt.ts` | Builds system prompt from manual, device state, and action registry |
| `src/brain/tools.ts` | Tool definitions and execution for Claude function calling |
| `src/brain/types.ts` | BrainConfig, ChatRequest, ChatResponse, ProposedAction, etc. |

**Modes:**
- `confirm` — Brain proposes actions, MOD must approve before execution
- `trusted` — Brain executes actions immediately (except forced-confirm like `/hub/panic`, `/fade/stop`)

**Conversation history:** BrainService maintains a rolling `MessageParam[]` buffer (10 turns / 20 messages max). Assistant responses are stored as text-only (no tool_use blocks) to avoid needing matching tool_result messages. History is trimmed on overflow and can be cleared via `clearHistory()` (e.g., on show change). On API error, the failed user message is rolled back from history.

**System prompt rules:**
- Fade in/out commands MUST always be smooth timed fades (default 3 seconds), never instant jumps
- Brain uses Anthropic Claude API with tool definitions for `execute_action`, `send_osc`, `fire_cue`, `get_device_state`, `get_show_state`, `get_actions`, `recall_scene`, `camera_preset`

**Avantis output fader addressing (OSC):**
- Groups: `/avantis/grp/{N}/mix/fader`
- Aux/Mix: `/avantis/mix/{N}/mix/fader`
- Matrix: `/avantis/mtx/{N}/mix/fader`
- FX Send: `/avantis/fxsend/{N}/mix/fader`
- FX Return: `/avantis/fxrtn/{N}/mix/fader`
- Main: `/avantis/main/mix/fader`
- DCA: `/avantis/dca/{N}/fader`

### ChamSys Driver Notes

The ChamSys QuickQ 20 does NOT support scenes via OSC. The driver is a transparent OSC relay — no `/scene` address exists. Playback state feedback includes: `/pb/{N}/level`, `/pb/{N}/active`, `/pb/{N}/flash`, `/pb/{N}/cue`, `/master`.

### VISCA Driver Notes

- VISCA driver does NOT have built-in reconnect — reconnection is handled exclusively by DeviceHealthManager
- Heartbeat MUST be disabled for VISCA cameras in `config.yml` because VISCA cameras never send unsolicited data (heartbeat timeout would cause a reconnect loop)
- Each camera gets its own driver instance with a unique prefix (e.g., `/cam1`, `/cam2`, `/cam3`)

## Companion Project

The **production-emulator** (`/Users/dave/projects/production-emulator`) is a standalone multi-protocol emulator that simulates an Allen & Heath Avantis (MIDI TCP), ChamSys QuickQ 20 (OSC UDP), OBS Studio (WebSocket v5), and PTZ cameras (VISCA TCP). It provides a web UI at http://localhost:8080 for visual feedback. Set `emulate: true` on devices in `config.yml` to auto-redirect to localhost emulator ports. See its own CLAUDE.md for details.
