# Production Hub

Multi-device OSC control for live production. One UDP port, one GO button, whole booth moves.

## Architecture

```
QLab (OSC) ──UDP:9000──▶ ProductionHub
                              │
               ┌──────────┬───┼───────────┬──────────────┐
               ▼          ▼   ▼           ▼              ▼
        AvantisDriver  ChamSys  VISCA   OBSDriver   TouchDesigner
        (MIDI TCP)     (OSC)   (TCP)    (WebSocket)  (OSC relay)
        :51325         :7000   :5678    :4455        :12000
```

## Quick Start

```bash
npm install
cp config.example.yml config.yml
# Edit config.yml with your device IPs
npm run dev
```

## Configuration

Production Hub reads `config.yml` at startup. The hub auto-detects legacy single-device config for backward compatibility.

### Multi-Device Config

```yaml
osc:
  listenAddress: "0.0.0.0"
  listenPort: 9000

devices:
  # Allen & Heath Avantis (MIDI over TCP)
  - type: avantis
    prefix: /avantis
    host: "192.168.1.70"
    port: 51325
    midiBaseChannel: 12
    feedback:
      enabled: true
      echoSuppressionMs: 100

  # ChamSys QuickQ 20 (OSC relay)
  - type: chamsys
    prefix: /lights
    host: "192.168.1.71"
    port: 7000

  # OBS Studio (WebSocket v5)
  - type: obs
    prefix: /obs
    host: "127.0.0.1"
    port: 4455
    password: "your-obs-websocket-password"

  # PTZ Camera 1 (VISCA over IP)
  - type: visca
    prefix: /cam1
    host: "192.168.1.80"
    port: 5678

  # PTZ Camera 2 (VISCA over IP)
  - type: visca
    prefix: /cam2
    host: "192.168.1.81"
    port: 5678

  # TouchDesigner (OSC relay to OSC In CHOP)
  - type: touchdesigner
    prefix: /td
    host: "127.0.0.1"
    port: 12000

logging:
  verbose: false
```

### Device Types

**avantis** — Allen & Heath Avantis console via MIDI TCP. Sends audio fader, mute, and scene recall commands. Supports real-time feedback translation from MIDI to OSC.

**chamsys** — ChamSys QuickQ 20 via OSC relay. Forwards OSC commands directly to the desk (minus prefix).

**obs** — OBS Studio via WebSocket v5. Controls scenes, streaming, recording, and transitions. Sends back scene/stream/record status.

**visca** — PTZ cameras via VISCA over IP protocol on standard TCP port 5678.

**touchdesigner** — TouchDesigner via OSC relay. Forwards to an OSC In CHOP. The address path (minus prefix) becomes the CHOP channel name. Transparent relay — design your OSC namespace in TD to match.

## OSC Address Reference

### Avantis (`/avantis`)

| Address | Args | Description |
|---------|------|-------------|
| /avantis/ch/{1-64}/mix/fader | float 0.0-1.0 | Input fader level |
| /avantis/ch/{1-64}/mix/mute | int 0\|1 | Input mute |
| /avantis/ch/{1-64}/mix/pan | float 0.0-1.0 | Input pan |
| /avantis/mix/{1-12}/mix/fader | float 0.0-1.0 | Mix/Aux fader |
| /avantis/mix/{1-12}/mix/mute | int 0\|1 | Mix/Aux mute |
| /avantis/fxsend/{1-4}/mix/fader | float 0.0-1.0 | FX Send fader |
| /avantis/fxrtn/{1-8}/mix/fader | float 0.0-1.0 | FX Return fader |
| /avantis/dca/{1-16}/fader | float 0.0-1.0 | DCA fader |
| /avantis/dca/{1-16}/mute | int 0\|1 | DCA mute |
| /avantis/grp/{1-16}/mix/fader | float 0.0-1.0 | Group fader |
| /avantis/mtx/{1-6}/mix/fader | float 0.0-1.0 | Matrix fader |
| /avantis/main/mix/fader | float 0.0-1.0 | Main LR fader |
| /avantis/main/mix/mute | int 0\|1 | Main LR mute |
| /avantis/scene/recall | int 0-127 | Scene recall |
| /avantis/ch/{n}/mix/fade | float target, float duration_s, [string easing] | Timed fader fade |
| /avantis/dca/{n}/fade | float target, float duration_s, [string easing] | DCA timed fade |
| /avantis/main/mix/fade | float target, float duration_s, [string easing] | Main timed fade |

Easing options: `linear`, `scurve` (default), `easein`, `easeout`. Fades interpolate at 50Hz.

### ChamSys QuickQ 20 (`/lights`)

| Address | Args | Description |
|---------|------|-------------|
| /lights/pb/{X}/{Y} | (none) | Go playback X, button Y |
| /lights/pb/{X}/{Y}/level | float 0.0-1.0 | Playback fader level |
| /lights/exec/{X} | (none) | Execute cue X |
| /lights/release/{X} | (none) | Release playback X |

Commands are forwarded as-is to QuickQ (minus the `/lights` prefix).

### OBS Studio (`/obs`)

| Address | Args | Description |
|---------|------|-------------|
| /obs/scene/{name} | (none) | Switch program scene |
| /obs/scene/preview/{name} | (none) | Switch preview scene |
| /obs/stream/start | (none) | Start streaming |
| /obs/stream/stop | (none) | Stop streaming |
| /obs/stream/toggle | (none) | Toggle streaming |
| /obs/record/start | (none) | Start recording |
| /obs/record/stop | (none) | Stop recording |
| /obs/record/toggle | (none) | Toggle recording |
| /obs/transition/{name} | (none) | Set scene transition |
| /obs/transition/duration | int ms | Set transition duration |

OBS sends feedback back on these addresses:
- `/obs/scene/current` (string) — current program scene
- `/obs/stream/status` (int 0\|1) — stream active
- `/obs/record/status` (int 0\|1) — record active

### PTZ Cameras (`/cam1`, `/cam2`, etc.)

| Address | Args | Description |
|---------|------|-------------|
| /cam{N}/preset/recall/{N} | (none) | Recall preset N (0-255) |
| /cam{N}/preset/store/{N} | (none) | Store preset N |
| /cam{N}/home | (none) | Home position |
| /cam{N}/pantilt/speed | float pan, float tilt | Pan/tilt speed (-1 to +1) |
| /cam{N}/pantilt/stop | (none) | Stop pan/tilt |
| /cam{N}/pan/speed | float -1.0 to 1.0 | Pan only |
| /cam{N}/tilt/speed | float -1.0 to 1.0 | Tilt only |
| /cam{N}/zoom/speed | float -1.0 to 1.0 | Zoom speed (neg=wide, pos=tele) |
| /cam{N}/zoom/direct | float 0.0-1.0 | Absolute zoom position |
| /cam{N}/zoom/stop | (none) | Stop zoom |
| /cam{N}/power/on | (none) | Power on |
| /cam{N}/power/off | (none) | Power off |
| /cam{N}/focus/auto | (none) | Auto focus |
| /cam{N}/focus/manual | (none) | Manual focus |

### TouchDesigner (`/td`)

Transparent OSC relay to TouchDesigner's OSC In CHOP. Any address you send gets forwarded as-is (minus the `/td` prefix). Design your namespace in TD to match.

| Address | Args | Description |
|---------|------|-------------|
| /td/{anything} | any | Forwarded to TD as /{anything} |

Example addresses (define these in your TD project):

| Address | Args | Description |
|---------|------|-------------|
| /td/render/start | (none) | Trigger render |
| /td/render/stop | (none) | Stop render |
| /td/param/{name} | float 0.0-1.0 | Control any named parameter |
| /td/cue/{n} | int | Trigger cue N |
| /td/opacity | float 0.0-1.0 | Master opacity |
| /td/blend/{layer} | float 0.0-1.0 | Layer blend level |

### Global

| Address | Args | Description |
|---------|------|-------------|
| /fade/stop | (none) or string key | Stop all fades, or stop a specific fade |

## Feedback

The Avantis driver listens for MIDI feedback from the console and translates it to OSC messages, which are sent back to all connected clients with the device prefix prepended. For example, a fader move on the Avantis generates:

```
/avantis/ch/5/mix/fader 0.75
```

Echo suppression (default 100ms, configurable) prevents feedback loops when the hub commands the console.

## CLI Options

```bash
npm run dev [options]

--config <path>     Load config from custom path (default: config.yml)
--port <number>     Override OSC listen port
--verbose           Enable verbose logging
--help              Show help
```

## Testing

Run the full suite:

```bash
npm test  # 233 tests total
```

Run individual suites:

```bash
npm run test:protocol   # Protocol parsing
npm run test:parser     # OSC address parsing
npm run test:fade       # Fade engine
npm run test:hub        # Hub routing
npm run test:chamsys    # ChamSys driver
npm run test:visca      # VISCA driver
```

## Tech Stack

- **TypeScript** — strict type safety
- **Node.js** — runtime
- **osc** — UDP OSC messages
- **ws** — WebSocket v5 for OBS
- **net** — TCP for MIDI (Avantis) and VISCA (cameras)
- **yaml** — config parsing

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on reporting issues, submitting PRs, and code style.

## License

[GPLv3](LICENSE) — Production Hub is free and open source, and must stay that way.
