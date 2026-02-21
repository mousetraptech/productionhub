# VISCA Emulator + Emulate Mode

Date: 2026-02-19

## Summary

Three changes:
1. Add VISCA over TCP emulation to the standalone production-emulator
2. Remove built-in emulators from Production Hub (`src/emulators/`)
3. Add `emulate: true` config flag that auto-overrides host+port to emulator defaults

## 1. VISCA Emulator (production-emulator)

### Protocol

Single TCP server on port 5678 (env: `VISCA_PORT`). Hub model — multiple cameras on one port, distinguished by VISCA address byte (0x81=cam1, 0x82=cam2, 0x83=cam3). Default 3 cameras (env: `VISCA_CAMERA_COUNT`).

### State per camera

- `power`: boolean (default true)
- `currentPreset`: number 0-15 (default 0)
- `presets`: array of 16 stored positions (pan/tilt/zoom snapshots)
- `pan`: float -1.0 to 1.0 (default 0.0 = center)
- `tilt`: float -1.0 to 1.0 (default 0.0 = center)
- `zoom`: float 0.0 to 1.0 (default 0.0 = wide)
- `panSpeed`: float -1.0 to 1.0 (current movement, 0 = stopped)
- `tiltSpeed`: float -1.0 to 1.0 (current movement, 0 = stopped)
- `focusMode`: 'auto' | 'manual' (default 'auto')

### VISCA commands handled

Matching what VISCADriver sends:

| Command | Bytes | Action |
|---------|-------|--------|
| Preset Recall | `8x 01 04 3F 02 pp FF` | Load stored position for preset pp |
| Preset Store | `8x 01 04 3F 01 pp FF` | Save current pan/tilt/zoom to preset pp |
| Home | `8x 01 06 04 FF` | Reset pan=0, tilt=0, zoom=0 |
| Pan/Tilt Drive | `8x 01 06 01 VV WW DD1 DD2 FF` | Set pan/tilt speed+direction |
| Pan/Tilt Stop | `8x 01 06 01 VV WW 03 03 FF` | Stop pan/tilt movement |
| Zoom Tele | `8x 01 04 07 2p FF` | Zoom in at speed p |
| Zoom Wide | `8x 01 04 07 3p FF` | Zoom out at speed p |
| Zoom Stop | `8x 01 04 07 00 FF` | Stop zoom |
| Zoom Direct | `8x 01 04 47 0p 0q 0r 0s FF` | Set absolute zoom position |
| Power On | `8x 01 04 00 02 FF` | Power on |
| Power Off | `8x 01 04 00 03 FF` | Power off/standby |
| Focus Auto | `8x 01 04 38 02 FF` | Auto focus |
| Focus Manual | `8x 01 04 38 03 FF` | Manual focus |

### Responses

Every command gets:
- ACK: `x0 41 FF` (where x = camera address nibble)
- Completion: `x0 51 FF`

### Movement simulation

Pan/tilt/zoom speeds are applied via a 60Hz tick loop that updates positions based on current speed values. When a preset is recalled, positions animate toward the stored values over ~1 second.

### UI

New "PTZ Cameras" tab. Per camera: a visual viewport rectangle that shifts based on pan/tilt/zoom, preset buttons (1-16), power toggle, focus mode toggle, and numeric P/T/Z readouts.

### SSE events

- `visca-camera`: camera state change (index, pan, tilt, zoom, preset, power, focus)
- Protocol log entries with `protocol: 'visca'`

### REST API

- `GET /api/state` — extended to include `visca` key
- `POST /api/visca/camera` — update camera state from UI (preset recall, power toggle, etc.)

### Env vars

- `VISCA_PORT` (default 5678)
- `VISCA_CAMERA_COUNT` (default 3)

## 2. Remove built-in emulators from Production Hub

Delete `src/emulators/` directory and all references to it in driver-manager.ts. The standalone production-emulator replaces this entirely.

## 3. Emulate mode in config.yml

When a device has `emulate: true`, driver-manager overrides host and port to emulator defaults before creating the driver instance:

| Device type | Emulator host | Emulator port |
|-------------|--------------|---------------|
| avantis | 127.0.0.1 | 51325 |
| chamsys | 127.0.0.1 | 7000 |
| obs | 127.0.0.1 | 4455 |
| visca | 127.0.0.1 | 5678 |

Config example:
```yaml
- type: visca
  prefix: /cam1
  host: "192.168.10.31"
  port: 5678
  emulate: true   # overrides to 127.0.0.1:5678
```

For production: remove `emulate: true` and the real IPs take effect.
