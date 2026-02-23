# NDI Recording Driver & Post-Show Archive

Date: 2026-02-23

## Overview

Add NDI recording control to Production Hub via a two-component architecture: a lightweight Node.js agent on the Windows recording PC that spawns and controls `NDI Record.exe` processes, and a hub driver that connects to the agent over WebSocket. Recordings are saved to local SSD, then auto-archived to a network share via robocopy when recording stops.

## Architecture

```
Hub (Mac)                              Windows PC
┌─────────────────┐    WebSocket    ┌──────────────────────┐
│ ndi-recorder    │◄──────────────►│  ndi-record-agent     │
│ driver          │    :7200       │                       │
│                 │                │  ┌─ NDI Record.exe ─┐ │
│ OSC:            │  JSON cmds     │  │ stdin: <start/>   │ │
│ /recorder/start │ ──────────►   │  │ stdout: XML stats │ │
│ /recorder/stop  │                │  └───────────────────┘ │
│                 │  JSON feedback │  ┌─ NDI Record.exe ─┐ │
│ Dashboard WS ◄─│ ◄────────────  │  │ (per source)      │ │
│ Device Panel    │                │  └───────────────────┘ │
└─────────────────┘                │                       │
                                   │  robocopy on stop     │
                                   │  D:\Recordings → NAS  │
                                   └──────────────────────┘
```

## 1. Windows Agent (`ndi-record-agent`)

A standalone Node.js script that runs on the Windows PC. Single file, minimal dependencies (just `ws`).

### Responsibilities

- Listen on a configurable WebSocket port (default 7200)
- Accept JSON commands from the hub: `start`, `stop`, `status`
- On `start`: spawn one `NDI Record.exe` child process per configured NDI source using `-noautostart`, then send `<start/>` via stdin for frame-accurate sync
- On `stop`: send `<exit/>` to each recorder process, wait for clean shutdown, then auto-trigger robocopy
- Parse XML stdout from each recorder (frame count, timecode, audio VU levels) and stream back to the hub as JSON
- Run robocopy as a child process after stop — report progress/completion to hub

### Config (`config.json` on Windows PC)

```json
{
  "port": 7200,
  "ndiRecordPath": "C:\\Program Files\\NDI\\NDI 6 Tools\\NDI Record.exe",
  "recordingPath": "D:\\Recordings",
  "archivePath": "\\\\nas\\shows",
  "sources": [
    { "name": "OBS (Program)", "id": "program" },
    { "name": "CAM1 (PTZ1)", "id": "cam1" },
    { "name": "CAM2 (PTZ2)", "id": "cam2" },
    { "name": "CAM3 (PTZ3)", "id": "cam3" }
  ]
}
```

Each recording session creates a timestamped folder (e.g., `D:\Recordings\2026-02-23_0900`) containing one `.mov` per source.

### WebSocket Protocol

Agent listens for JSON messages from hub:

```json
{ "type": "start" }
{ "type": "stop" }
{ "type": "status" }
```

Agent sends JSON messages to hub:

```json
{ "type": "state", "state": "recording" | "stopped" | "archiving" }
{ "type": "source-update", "id": "cam1", "frames": 1234, "vuDb": -18.5 }
{ "type": "archive-progress", "progress": 0.45 }
{ "type": "archive-done", "path": "\\\\nas\\shows\\2026-02-23_0900" }
{ "type": "error", "message": "NDI source not found: CAM3" }
```

### NDI Record.exe Control

Per-source process spawned as:
```
"NDI Record.exe" -i "OBS (Program)" -o "D:\Recordings\2026-02-23_0900\program.mov" -noautostart
```

Stdin commands (XML):
- `<start/>` — begin recording
- `<exit/>` — stop and close file

Stdout feedback (XML, parsed by agent):
```xml
<recording no_frames="1234" timecode="732241356791" vu_dB="-18.5" />
<record_stopped no_frames="5678" last_timecode="732273722393"/>
```

### Post-Stop Archive

After all recorder processes exit cleanly, agent runs:
```
robocopy "D:\Recordings\2026-02-23_0900" "\\nas\shows\2026-02-23_0900" /E /R:3 /W:5
```

Robocopy exit codes 0-7 are success. Agent parses robocopy output for progress (file count based) and reports to hub.

## 2. Hub Driver (`ndi-recorder-driver`)

New driver at `src/drivers/ndi-recorder-driver.ts` implementing `DeviceDriver`. Connects to the Windows agent over WebSocket.

### Config

```yaml
- type: ndi-recorder
  prefix: /recorder
  host: "192.168.10.11"
  port: 7200
  heartbeat:
    enabled: true
    intervalMs: 5000
```

### OSC Commands

| Address | Args | Action |
|---------|------|--------|
| `/start` | (none) | Start all configured sources |
| `/stop` | (none) | Stop all, triggers auto-archive |
| `/status` | (none) | Request current state |

### Feedback Emitted

| Address | Args | Description |
|---------|------|-------------|
| `/state` | `s: recording\|stopped\|archiving` | Overall state |
| `/source/{id}/frames` | `i: frameCount` | Per-source frame count |
| `/source/{id}/vu` | `f: dB` | Per-source audio level |
| `/archive/progress` | `f: 0.0-1.0` | Copy progress |
| `/archive/done` | (none) | Archive complete |

### getState()

Returns `{ state, sources: [...], archiveProgress }` for the device panel and dashboard WebSocket.

### Connection Lifecycle

Standard WebSocket reconnect. No ReconnectQueue — recording commands aren't meaningful to buffer during disconnect.

## 3. UI Device Panel

`RecorderPanel` in the right sidebar.

### Display

- State indicator: green "STOPPED", red pulsing "RECORDING", amber "ARCHIVING"
- Per-source rows: name, frame count, audio VU bar
- During archive: progress bar with percentage
- Start/Stop buttons

### State Type

```typescript
export interface RecorderSource {
  id: string;
  name: string;
  frames: number;
  vuDb: number;
}

export interface RecorderState {
  state: 'stopped' | 'recording' | 'archiving';
  sources: RecorderSource[];
  archiveProgress: number;
}
```

## 4. Cue Engine Integration

### actions.yml Entries

```yaml
- id: recorder-start
  label: "Start Recording"
  category: Recording
  commands:
    - device: ndi-recorder
      address: /recorder/start

- id: recorder-stop
  label: "Stop Recording"
  category: Recording
  commands:
    - device: ndi-recorder
      address: /recorder/stop
```

### CommandTile Category

Add "Recording" category (red, `#EF4444`) to `TILE_CATEGORIES` in `command-defs.ts`:
- Start Recording (zero-field, auto-submit)
- Stop Recording (zero-field, auto-submit)

## 5. Out of Scope

- NDI source auto-discovery (sources configured by name in agent config)
- Multiple output formats (`.mov` only, from NDI Record.exe)
- Agent web UI (headless, all monitoring through hub)
- Live preview/thumbnails (metadata only: frames, VU, state)
