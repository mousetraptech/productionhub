# QLab Driver + Emulator

Date: 2026-02-20

## Summary

Add QLab support to Production Hub. Two QLab workspaces (utility SFX/stingers + show-specific cue list) each get their own driver instance, differentiated by port. Includes a two-port emulator in production-emulator and actions for the Stream Deck.

## Architecture

### Port-Based Workspace Targeting

Each QLab workspace listens on its own OSC port (configured in QLab's workspace settings). No workspace IDs or name matching needed — just point each driver at the right port:

```yaml
devices:
  - type: qlab
    prefix: /sfx
    host: 192.168.1.50
    port: 53000
    emulate: true
    heartbeat:
      enabled: false
  - type: qlab
    prefix: /show
    host: 192.168.1.50
    port: 53001
    emulate: true
    heartbeat:
      enabled: false
```

### Driver Pattern

UDP relay (like ChamSys). The driver forwards OSC addresses verbatim to QLab — no address rewriting. Uses `dgram.createSocket('udp4')`.

Constructor: `(config: QLabConfig, hubContext: HubContext, verbose = false)`

### OSC Command Mapping

Prefix is stripped by DriverManager before reaching the driver. All addresses pass through unchanged:

| PH Address | Sent to QLab | Description |
|---|---|---|
| `/go` | `/go` | Advance playhead |
| `/cue/{name}/start` | `/cue/{name}/start` | Fire specific cue by name/number |
| `/cue/{name}/stop` | `/cue/{name}/stop` | Stop specific cue |
| `/stop` | `/stop` | Stop all |
| `/pause` | `/pause` | Pause all |
| `/resume` | `/resume` | Resume all |
| `/panic` | `/panic` | Panic (fade out all) |

### Connection Handshake

On connect:
1. Send `/connect` (with optional passcode arg if configured)
2. Wait for `/reply/connect` with `"ok"` status
3. Send `/updates 1` to subscribe to push notifications
4. Emit `'connected'` event

If no reply within 5 seconds, retry. On socket error or close, emit `'disconnected'` and schedule reconnect (2s delay, same as other drivers).

### Feedback & State

The driver listens for QLab reply messages on the send socket. QLab replies come as `/reply/{original_address}` with JSON data.

**Tracked state:**

| Key | Source | Description |
|---|---|---|
| `playhead` | Poll: `/cue/playhead/text` | Name of the cue at the playhead |
| `runningCues` | Poll: `/runningCues` | Array of currently running cue display names |
| `connected` | `/reply/connect` | QLab session status |

**Polling:** Every ~1 second, the driver sends:
- `/cue/playhead/text` — gets the playhead cue's display name
- `/runningCues` — gets list of running cues

**Feedback emission:** Emits `feedback` events for dashboard and brain:
- `/{prefix}/playhead` → current playhead cue name (string)
- `/{prefix}/running` → count of running cues (int)
- `/{prefix}/runningCues` → comma-separated names (string)

**Brain integration:** System prompt will include QLab state: "SFX workspace playhead: 'Walk-in Music', 2 cues running. Show workspace playhead: 'Cue 5.1', idle."

### Config Schema

Add to `config-schema.ts`:

```typescript
const qlabDeviceSchema = baseDeviceSchema.extend({
  type: z.literal('qlab'),
  passcode: z.string().optional().default(''),
});
```

Add `'qlab'` to `deviceTypeSchema` enum and discriminated union.

### Driver Stats

Add to `driver-stats.ts`: `case 'qlab': return 'udp';`

### Driver Factory

Add to `createDriver()` in `index.ts`:
```typescript
case 'qlab': return new QLabDriver(deviceConfig as any, hubContext, verbose);
```

Emulator defaults: `qlab: { host: '127.0.0.1', port: 53100 }`

Note: with two qlab instances and `emulate: true`, both would get port 53100. Need same approach as VISCA — the emulate override applies the base port, and the second instance should use 53101. Handle by adding a port offset based on instance index, or by letting the user specify `emulatorPort` explicitly in config.

## Actions

New category in `actions.yml`:

```yaml
# ─── SFX (QLab Utility) ───
sfx-go:
  label: "SFX GO"
  category: "SFX"
  icon: "🔈"
  color: "#6366F1"
  description: "Advance SFX playhead"
  commands:
    - device: qlab
      prefix: sfx
      address: /go

sfx-stop:
  label: "SFX Stop"
  category: "SFX"
  icon: "🔈"
  color: "#6366F1"
  description: "Stop all SFX"
  commands:
    - device: qlab
      prefix: sfx
      address: /stop

sfx-panic:
  label: "SFX Panic"
  category: "SFX"
  icon: "🔈"
  color: "#6366F1"
  description: "Panic — fade out all SFX"
  commands:
    - device: qlab
      prefix: sfx
      address: /panic

# ─── Show (QLab Show) ───
show-go:
  label: "Show GO"
  category: "Show"
  icon: "🎬"
  color: "#8B5CF6"
  description: "Advance show cue list"
  commands:
    - device: qlab
      prefix: show
      address: /go

show-stop:
  label: "Show Stop"
  category: "Show"
  icon: "🎬"
  color: "#8B5CF6"
  description: "Stop all show cues"
  commands:
    - device: qlab
      prefix: show
      address: /stop

show-panic:
  label: "Show Panic"
  category: "Show"
  icon: "🎬"
  color: "#8B5CF6"
  description: "Panic — fade out all show cues"
  commands:
    - device: qlab
      prefix: show
      address: /panic
```

Specific named cues (e.g., "applause", "intro-music") will be added as inline OSC commands via the CommandBuilder, or as additional actions.yml entries per show.

### CommandBuilder Support

Add QLab command types to the UI CommandBuilder sidebar:

- **QLab Cue** — `/sfx/cue/{name}/start` or `/show/cue/{name}/start`
- **QLab GO** — `/sfx/go` or `/show/go`

## Stream Deck

**Colors:**
- SFX actions: `#6366F1` (indigo) — distinct from existing categories
- Show actions: `#8B5CF6` (violet) — visually paired but distinguishable

**Icons:** `🔈` for SFX, `🎬` for Show. These render well on the 144x144 SVG buttons.

**Deck buttons:** SFX GO, Show GO, SFX Stop, Show Stop can all be assigned to deck grid positions via the PH profile. Named cue triggers via inline OSC commands.

## Emulator

### QLab Emulator (production-emulator)

Two UDP sockets, one per workspace:
- Port 53100 (env: `QLAB_SFX_PORT`) — utility/SFX workspace
- Port 53101 (env: `QLAB_SHOW_PORT`) — show workspace

### State per workspace

- `name`: string (e.g., "Utility", "Sunday Service")
- `connected`: boolean
- `cues`: array of `{ number: string, name: string, type: string, duration: number }`
- `playheadIndex`: number (index into cues array)
- `runningCues`: array of `{ number: string, name: string, startedAt: number }`
- `paused`: boolean

### Default cue lists

**SFX workspace (port 53100):**
1. "Applause" (audio, 5s)
2. "Intro Sting" (audio, 3s)
3. "Transition Whoosh" (audio, 1s)
4. "Walk-in Music" (audio, 120s)
5. "Countdown" (audio, 10s)

**Show workspace (port 53101):**
1. "Pre-Show" (group, 5s)
2. "Opening" (group, 10s)
3. "Song 1" (audio, 240s)
4. "Transition A" (audio, 3s)
5. "Speaker Intro" (audio, 2s)
6. "Message" (group, 0s — manual)
7. "Song 2" (audio, 240s)
8. "Closing" (group, 10s)
9. "Walk-out" (audio, 120s)

### Commands handled

| OSC Received | Action |
|---|---|
| `/connect` | Set connected=true, reply `{"data":"ok","status":"ok"}` |
| `/updates 1` | Enable push mode (no-op for emulator) |
| `/go` | Start cue at playhead, advance playhead |
| `/cue/{name}/start` | Find cue by name/number, add to running, auto-remove after duration |
| `/cue/{name}/stop` | Remove from running |
| `/stop` | Clear all running cues |
| `/pause` | Set paused=true |
| `/resume` | Set paused=false |
| `/panic` | Clear all running, reset paused |
| `/cue/playhead/text` | Reply with playhead cue name |
| `/runningCues` | Reply with JSON array of running cue info |

### Reply format

QLab replies are JSON, sent to the sender's IP+port:
```
/reply/{original_address} {"data": ..., "status": "ok"}
```

### Web UI panel

Shows per workspace:
- Workspace name
- Cue list with playhead indicator (arrow)
- Running cues highlighted
- Last received command
- Connected clients count

## Files Changed

### Production Hub
| File | Change |
|---|---|
| `src/drivers/qlab-driver.ts` | **New** — UDP driver |
| `src/drivers/index.ts` | Export QLabDriver |
| `src/config-schema.ts` | Add `qlab` type + schema |
| `src/driver-stats.ts` | Add `qlab` → `udp` |
| `src/index.ts` | Add to createDriver() + EMULATOR_DEFAULTS |
| `config.yml` | Add two qlab device entries |
| `actions.yml` | Add SFX + Show action categories |
| `src/brain/system-prompt.ts` | Include QLab state in brain context |

### production-emulator
| File | Change |
|---|---|
| `src/qlab-emulator.ts` | **New** — two-port UDP emulator |
| `src/index.ts` | Wire up QLab emulator |
| `src/web-ui.ts` | Add QLab panel to web UI |
