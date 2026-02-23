# NDI Recording Driver Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add NDI recording control to Production Hub — a Windows agent that spawns NDI Record.exe processes, and a hub driver that connects to it over WebSocket.

**Architecture:** Two components: (1) a standalone Node.js WebSocket agent on the Windows recording PC that manages NDI Record.exe child processes and post-stop robocopy archival, and (2) a hub driver (`ndi-recorder`) that connects to the agent, translates OSC commands to JSON, and relays state to the UI. The hub driver follows the same patterns as the existing OBS driver (WebSocket, reconnect, getState).

**Tech Stack:** Node.js, `ws` WebSocket library, NDI Record.exe (stdin/stdout XML), robocopy (Windows)

**Design doc:** `docs/plans/2026-02-23-ndi-recording-driver-design.md`

---

### Task 1: Config schema — add `ndi-recorder` device type

**Files:**
- Modify: `src/config-schema.ts`

**Step 1: Add `ndi-recorder` to the device type enum**

In `src/config-schema.ts`, find the `deviceTypeSchema` at line 31:

```typescript
const deviceTypeSchema = z.enum(['avantis', 'chamsys', 'obs', 'visca', 'touchdesigner', 'qlab']);
```

Change to:

```typescript
const deviceTypeSchema = z.enum(['avantis', 'chamsys', 'obs', 'visca', 'touchdesigner', 'qlab', 'ndi-recorder']);
```

**Step 2: Add the device-specific schema**

After the `qlabDeviceSchema` (line 91), add:

```typescript
const ndiRecorderDeviceSchema = baseDeviceSchema.extend({
  type: z.literal('ndi-recorder'),
});
```

**Step 3: Add to the discriminated union**

In the `deviceSchema` discriminated union (line 95), add `ndiRecorderDeviceSchema`:

```typescript
const deviceSchema = z.discriminatedUnion('type', [
  avantisDeviceSchema,
  chamsysDeviceSchema,
  obsDeviceSchema,
  viscaDeviceSchema,
  touchdesignerDeviceSchema,
  qlabDeviceSchema,
  ndiRecorderDeviceSchema,
]);
```

**Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors)

**Step 5: Commit**

```bash
git add src/config-schema.ts
git commit -m "feat: add ndi-recorder device type to config schema"
```

---

### Task 2: Hub driver — `ndi-recorder-driver.ts`

**Files:**
- Create: `src/drivers/ndi-recorder-driver.ts`
- Reference: `src/drivers/obs-driver.ts` (WebSocket pattern), `src/drivers/device-driver.ts` (interface)

This is the main hub-side driver. It connects to the Windows agent via WebSocket, sends JSON commands (`start`, `stop`, `status`), receives JSON feedback, and emits OSC feedback events.

**Step 1: Create the driver file**

Create `src/drivers/ndi-recorder-driver.ts` with this content:

```typescript
/**
 * NDI Recorder Device Driver
 *
 * Connects to a remote ndi-record-agent over WebSocket.
 * Translates OSC commands to JSON and relays recording state to the UI.
 *
 * OSC namespace (after prefix stripping):
 *   /start        Start all configured sources
 *   /stop         Stop all, triggers auto-archive
 *   /status       Request current state
 *
 * Feedback events (agent → OSC clients):
 *   /state                     string (recording|stopped|archiving)
 *   /source/{id}/frames        int frame count
 *   /source/{id}/vu            float dB
 *   /archive/progress          float 0.0-1.0
 *   /archive/done              (no args)
 */

import { EventEmitter } from 'events';
import { DeviceDriver, DeviceConfig, HubContext, FeedbackEvent, OscArg } from './device-driver';

export interface NDIRecorderConfig extends DeviceConfig {
  type: 'ndi-recorder';
}

export interface RecorderSource {
  id: string;
  name: string;
  frames: number;
  vuDb: number;
}

export interface RecorderDriverState {
  state: 'stopped' | 'recording' | 'archiving';
  sources: RecorderSource[];
  archiveProgress: number;
}

let WebSocket: any;

export class NDIRecorderDriver extends EventEmitter implements DeviceDriver {
  readonly name: string;
  readonly prefix: string;

  private host: string;
  private port: number;
  private ws: any = null;
  private connected: boolean = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private verbose: boolean;

  private recorderState: RecorderDriverState = {
    state: 'stopped',
    sources: [],
    archiveProgress: 0,
  };

  constructor(config: NDIRecorderConfig, _hubContext: HubContext, verbose = false) {
    super();
    this.name = config.name ?? 'ndi-recorder';
    this.prefix = config.prefix;
    this.host = config.host;
    this.port = config.port;
    this.verbose = verbose;
  }

  connect(): void {
    this.loadWebSocket();
    this.doConnect();
  }

  private loadWebSocket(): void {
    if (!WebSocket) {
      try {
        WebSocket = require('ws');
      } catch {
        throw new Error('[NDI-Rec] "ws" package not installed. Run: npm install ws');
      }
    }
  }

  private doConnect(): void {
    const url = `ws://${this.host}:${this.port}`;
    if (this.verbose) {
      console.log(`[NDI-Rec] Connecting to ${url}`);
    }

    try {
      this.ws = new WebSocket(url);
    } catch (err: any) {
      console.error(`[NDI-Rec] WebSocket creation failed: ${err.message}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this.connected = true;
      this.emit('connected');
      if (this.verbose) console.log('[NDI-Rec] Connected to agent');
      // Request initial state
      this.sendToAgent({ type: 'status' });
    });

    this.ws.on('message', (data: any) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleAgentMessage(msg);
      } catch (err: any) {
        console.error(`[NDI-Rec] Parse error: ${err.message}`);
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      this.emit('disconnected');
      if (this.verbose) console.log('[NDI-Rec] WebSocket closed');
      this.scheduleReconnect();
    });

    this.ws.on('error', (err: Error) => {
      console.error(`[NDI-Rec] WebSocket error: ${err.message}`);
      this.emit('error', err);
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.verbose) console.log('[NDI-Rec] Attempting reconnect...');
      this.doConnect();
    }, 5000);
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  handleOSC(address: string, _args: any[]): void {
    const cmd = address.replace(/^\//, '').toLowerCase();

    switch (cmd) {
      case 'start':
        this.sendToAgent({ type: 'start' });
        break;
      case 'stop':
        this.sendToAgent({ type: 'stop' });
        break;
      case 'status':
        this.sendToAgent({ type: 'status' });
        break;
      default:
        if (this.verbose) console.warn(`[NDI-Rec] Unrecognized: ${address}`);
    }
  }

  handleFadeTick(_key: string, _value: number): void {
    // No-op — recorder doesn't use fades
  }

  getState(): RecorderDriverState {
    return { ...this.recorderState };
  }

  private handleAgentMessage(msg: any): void {
    switch (msg.type) {
      case 'state':
        this.recorderState.state = msg.state;
        this.emitFeedback('/state', [{ type: 's', value: msg.state }]);
        break;

      case 'source-update': {
        const existing = this.recorderState.sources.find(s => s.id === msg.id);
        if (existing) {
          existing.frames = msg.frames;
          existing.vuDb = msg.vuDb;
        } else {
          this.recorderState.sources.push({
            id: msg.id,
            name: msg.name ?? msg.id,
            frames: msg.frames,
            vuDb: msg.vuDb,
          });
        }
        this.emitFeedback(`/source/${msg.id}/frames`, [{ type: 'i', value: msg.frames }]);
        this.emitFeedback(`/source/${msg.id}/vu`, [{ type: 'f', value: msg.vuDb }]);
        break;
      }

      case 'archive-progress':
        this.recorderState.archiveProgress = msg.progress;
        this.emitFeedback('/archive/progress', [{ type: 'f', value: msg.progress }]);
        break;

      case 'archive-done':
        this.recorderState.archiveProgress = 1;
        this.recorderState.state = 'stopped';
        this.emitFeedback('/archive/done', []);
        break;

      case 'error':
        console.error(`[NDI-Rec] Agent error: ${msg.message}`);
        this.emit('error', new Error(msg.message));
        break;

      case 'sources':
        // Agent sends full source list on connect
        this.recorderState.sources = (msg.sources ?? []).map((s: any) => ({
          id: s.id,
          name: s.name,
          frames: 0,
          vuDb: -60,
        }));
        // Trigger a state broadcast
        this.emitFeedback('/state', [{ type: 's', value: this.recorderState.state }]);
        break;
    }
  }

  private sendToAgent(msg: Record<string, any>): void {
    if (!this.ws || !this.connected) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (err: any) {
      console.error(`[NDI-Rec] Send error: ${err.message}`);
    }
  }

  private emitFeedback(address: string, args: OscArg[]): void {
    this.emit('feedback', { address, args } as FeedbackEvent);
  }
}
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/drivers/ndi-recorder-driver.ts
git commit -m "feat: add NDI recorder hub driver"
```

---

### Task 3: Register driver in hub entry point

**Files:**
- Modify: `src/index.ts`

**Step 1: Add import**

At line 34 (after the QLabDriver import), add:

```typescript
import { NDIRecorderDriver } from './drivers/ndi-recorder-driver';
```

**Step 2: Add switch case**

In the `createDriver` function (line 278), add a case before the `default`:

```typescript
    case 'ndi-recorder':
      return new NDIRecorderDriver(deviceConfig as any, hubContext, verbose);
```

No `EMULATOR_DEFAULTS` entry is needed — there's no emulator for this device.

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: register ndi-recorder driver in hub entry point"
```

---

### Task 4: UI state types and hook

**Files:**
- Modify: `ui/src/hooks/useDeviceStates.ts`

**Step 1: Add RecorderSource and RecorderState interfaces**

After the `TouchDesignerState` interface (line 60), add:

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

**Step 2: Add to DeviceStates interface**

In the `DeviceStates` interface (line 62), add after `touchdesigner`:

```typescript
  'ndi-recorder': RecorderState | null;
```

**Step 3: Update initial state**

In the `useState` call (line 71), add:

```typescript
    'ndi-recorder': null,
```

**Step 4: Run type check**

Run: `cd ui && npx tsc --noEmit`
Expected: Likely type errors in App.tsx and other consumers — that's OK, we'll fix in subsequent tasks.

**Step 5: Commit**

```bash
git add ui/src/hooks/useDeviceStates.ts
git commit -m "feat: add RecorderState types to useDeviceStates hook"
```

---

### Task 5: RecorderPanel UI component

**Files:**
- Create: `ui/src/components/devices/RecorderPanel.tsx`
- Modify: `ui/src/components/devices/index.ts`
- Reference: `ui/src/components/devices/OBSPanel.tsx` (pattern)

**Step 1: Create RecorderPanel component**

Create `ui/src/components/devices/RecorderPanel.tsx`:

```tsx
import { RecorderState } from '../../hooks/useDeviceStates';

interface RecorderPanelProps {
  state: RecorderState | null;
}

function StateIndicator({ state }: { state: string }) {
  const config: Record<string, { color: string; label: string; pulse: boolean }> = {
    stopped:   { color: '#10B981', label: 'STOPPED',   pulse: false },
    recording: { color: '#EF4444', label: 'RECORDING', pulse: true },
    archiving: { color: '#F59E0B', label: 'ARCHIVING', pulse: false },
  };
  const { color, label, pulse } = config[state] ?? config.stopped;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 12px',
      background: '#1E293B',
      borderRadius: 6,
      marginBottom: 12,
    }}>
      <div style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 8px ${color}`,
        animation: pulse ? 'pulse 1.5s ease-in-out infinite' : 'none',
      }} />
      <span style={{
        fontSize: 12,
        fontWeight: 700,
        color,
        letterSpacing: '0.05em',
      }}>
        {label}
      </span>
    </div>
  );
}

function VUBar({ vuDb }: { vuDb: number }) {
  // Map -60..0 dB to 0..100%
  const pct = Math.max(0, Math.min(100, ((vuDb + 60) / 60) * 100));
  const barColor = vuDb > -6 ? '#EF4444' : vuDb > -18 ? '#F59E0B' : '#10B981';

  return (
    <div style={{
      flex: 1,
      height: 6,
      background: '#334155',
      borderRadius: 3,
      overflow: 'hidden',
    }}>
      <div style={{
        width: `${pct}%`,
        height: '100%',
        background: barColor,
        borderRadius: 3,
        transition: 'width 0.15s',
      }} />
    </div>
  );
}

function SourceRow({ name, frames, vuDb }: { name: string; frames: number; vuDb: number }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '6px 10px',
      background: '#1E293B',
      borderRadius: 4,
    }}>
      <span style={{ fontSize: 11, color: '#94A3B8', width: 70, flexShrink: 0 }}>
        {name}
      </span>
      <VUBar vuDb={vuDb} />
      <span style={{
        fontSize: 10,
        color: '#64748B',
        fontFamily: 'monospace',
        width: 50,
        textAlign: 'right',
        flexShrink: 0,
      }}>
        {frames.toLocaleString()}
      </span>
    </div>
  );
}

export default function RecorderPanel({ state }: RecorderPanelProps) {
  const sources = state?.sources ?? [];
  const archiveProgress = state?.archiveProgress ?? 0;
  const currentState = state?.state ?? 'stopped';

  return (
    <div style={{ padding: '8px 0' }}>
      <StateIndicator state={currentState} />

      {sources.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
          <div style={{
            display: 'flex', gap: 10, padding: '0 10px',
            fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            <span style={{ width: 70 }}>Source</span>
            <span style={{ flex: 1 }}>VU</span>
            <span style={{ width: 50, textAlign: 'right' }}>Frames</span>
          </div>
          {sources.map(s => (
            <SourceRow key={s.id} name={s.name} frames={s.frames} vuDb={s.vuDb} />
          ))}
        </div>
      )}

      {currentState === 'archiving' && (
        <div style={{ padding: '0 10px' }}>
          <div style={{
            fontSize: 10, color: '#F59E0B', marginBottom: 4, fontWeight: 600,
          }}>
            Archiving... {Math.round(archiveProgress * 100)}%
          </div>
          <div style={{
            height: 6, background: '#334155', borderRadius: 3, overflow: 'hidden',
          }}>
            <div style={{
              width: `${archiveProgress * 100}%`,
              height: '100%',
              background: '#F59E0B',
              borderRadius: 3,
              transition: 'width 0.3s',
            }} />
          </div>
        </div>
      )}

      {!state && (
        <div style={{ fontSize: 11, color: '#475569', fontStyle: 'italic' }}>
          No recorder connected
        </div>
      )}
    </div>
  );
}
```

**Step 2: Export from index**

In `ui/src/components/devices/index.ts`, add:

```typescript
export { default as RecorderPanel } from './RecorderPanel';
```

**Step 3: Run type check**

Run: `cd ui && npx tsc --noEmit`
Expected: PASS (or errors only from App.tsx which we fix next)

**Step 4: Commit**

```bash
git add ui/src/components/devices/RecorderPanel.tsx ui/src/components/devices/index.ts
git commit -m "feat: add RecorderPanel device panel component"
```

---

### Task 6: Wire RecorderPanel into App.tsx

**Files:**
- Modify: `ui/src/App.tsx`

**Step 1: Add RecorderPanel import**

In the device panel imports (line 14-19), add `RecorderPanel`:

```typescript
import {
  AvantisPanel,
  OBSPanel,
  ChamSysPanel,
  PTZPanel,
  TouchDesignerPanel,
  RecorderPanel,
} from './components/devices';
```

**Step 2: Add the panel to the right sidebar**

After the TouchDesigner `CollapsiblePanel` block (line 165), add:

```tsx
        <CollapsiblePanel title="NDI Recorder" icon="record">
          <RecorderPanel state={deviceStates['ndi-recorder']} />
        </CollapsiblePanel>
```

**Step 3: Run type check**

Run: `cd ui && npx tsc --noEmit`
Expected: PASS

**Step 4: Verify in browser**

Open http://localhost:5173/ — the right sidebar should show a "NDI Recorder" collapsible panel at the bottom with "No recorder connected" placeholder text.

**Step 5: Commit**

```bash
git add ui/src/App.tsx
git commit -m "feat: wire RecorderPanel into App sidebar"
```

---

### Task 7: Actions + CommandTile category for Recording

**Files:**
- Modify: `actions.yml`
- Modify: `ui/src/components/command-defs.ts`

**Step 1: Add actions to actions.yml**

At the bottom of `actions.yml`, add:

```yaml

  # ─── Recording (NDI) ───
  recorder-start:
    label: "Start Recording"
    category: "Recording"
    icon: "⏺️"
    color: "#EF4444"
    description: "Start NDI recording on all sources"
    commands:
      - device: ndi-recorder
        address: /start

  recorder-stop:
    label: "Stop Recording"
    category: "Recording"
    icon: "⏹️"
    color: "#EF4444"
    description: "Stop NDI recording, auto-archive to NAS"
    commands:
      - device: ndi-recorder
        address: /stop
```

**Step 2: Add CmdType entries**

In `ui/src/components/command-defs.ts`, add to the `CmdType` union (line 3-20):

```typescript
  | 'recorder-start'
  | 'recorder-stop'
```

**Step 3: Add command definitions to getCommands**

At the end of the array returned by `getCommands` (before the `raw-osc` entry), add:

```typescript
    {
      type: 'recorder-start',
      label: 'Start Recording',
      fields: [],
      build: () => ({ address: '/recorder/start', args: [], label: 'Start Recording' }),
    },
    {
      type: 'recorder-stop',
      label: 'Stop Recording',
      fields: [],
      build: () => ({ address: '/recorder/stop', args: [], label: 'Stop Recording' }),
    },
```

**Step 4: Add Recording tile category**

In `TILE_CATEGORIES` (line 259), add before the "Custom" category:

```typescript
  {
    category: 'Recording',
    icon: '\u23FA',
    color: '#EF4444',
    commands: [
      { type: 'recorder-start', label: 'Start Recording' },
      { type: 'recorder-stop', label: 'Stop Recording' },
    ],
  },
```

**Step 5: Run type check**

Run: `cd ui && npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```bash
git add actions.yml ui/src/components/command-defs.ts
git commit -m "feat: add Recording actions and CommandTile category"
```

---

### Task 8: Config entry

**Files:**
- Modify: `config.yml`

**Step 1: Add ndi-recorder device**

After the QLab device entries (around line 93), add:

```yaml

  # NDI Recorder — remote recording via ndi-record-agent
  - type: ndi-recorder
    prefix: /recorder
    host: "192.168.10.11"
    port: 7200
    heartbeat:
      enabled: true
      intervalMs: 5000
```

**Step 2: Verify config loads**

Restart the hub (or check with `npx ts-node src/index.ts --help` to verify no parse errors).

**Step 3: Commit**

```bash
git add config.yml
git commit -m "feat: add ndi-recorder device to config.yml"
```

---

### Task 9: Windows agent — `ndi-record-agent/`

**Files:**
- Create: `ndi-record-agent/package.json`
- Create: `ndi-record-agent/agent.js`
- Create: `ndi-record-agent/config.json`

This is a standalone Node.js script that lives in its own directory (separate from the hub — it runs on the Windows recording PC). Single file, minimal dependencies.

**Step 1: Create package.json**

Create `ndi-record-agent/package.json`:

```json
{
  "name": "ndi-record-agent",
  "version": "1.0.0",
  "description": "NDI Record agent — spawns NDI Record.exe processes, controlled by Production Hub over WebSocket",
  "main": "agent.js",
  "scripts": {
    "start": "node agent.js"
  },
  "dependencies": {
    "ws": "^8.16.0"
  }
}
```

**Step 2: Create config.json**

Create `ndi-record-agent/config.json`:

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

**Step 3: Create agent.js**

Create `ndi-record-agent/agent.js`:

```javascript
#!/usr/bin/env node

/**
 * NDI Record Agent
 *
 * Lightweight WebSocket server that spawns and controls NDI Record.exe
 * processes. Designed to run on the Windows recording PC.
 *
 * Protocol:
 *   Hub sends:  { type: "start" | "stop" | "status" }
 *   Agent sends: { type: "state", state: "recording" | "stopped" | "archiving" }
 *                { type: "source-update", id, frames, vuDb }
 *                { type: "archive-progress", progress: 0.0-1.0 }
 *                { type: "archive-done", path }
 *                { type: "sources", sources: [...] }
 *                { type: "error", message }
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

// Load config
const configPath = process.argv[2] || path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error(`Config not found: ${configPath}`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const PORT = config.port || 7200;
const NDI_RECORD_PATH = config.ndiRecordPath;
const RECORDING_PATH = config.recordingPath;
const ARCHIVE_PATH = config.archivePath;
const SOURCES = config.sources || [];

// State
let state = 'stopped'; // 'stopped' | 'recording' | 'archiving'
let recorders = new Map(); // id -> { process, frames, vuDb }
let sessionDir = '';
let hubSocket = null;

// --- WebSocket Server ---

const wss = new WebSocket.Server({ port: PORT });
console.log(`[Agent] Listening on ws://0.0.0.0:${PORT}`);
console.log(`[Agent] NDI Record: ${NDI_RECORD_PATH}`);
console.log(`[Agent] Sources: ${SOURCES.map(s => s.name).join(', ')}`);

wss.on('connection', (ws) => {
  console.log('[Agent] Hub connected');
  hubSocket = ws;

  // Send current sources and state
  send(ws, { type: 'sources', sources: SOURCES });
  send(ws, { type: 'state', state });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleCommand(msg, ws);
    } catch (err) {
      console.error(`[Agent] Parse error: ${err.message}`);
    }
  });

  ws.on('close', () => {
    console.log('[Agent] Hub disconnected');
    if (hubSocket === ws) hubSocket = null;
  });
});

function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  });
}

// --- Command Handler ---

function handleCommand(msg, ws) {
  switch (msg.type) {
    case 'start':
      startRecording(ws);
      break;
    case 'stop':
      stopRecording(ws);
      break;
    case 'status':
      send(ws, { type: 'state', state });
      send(ws, { type: 'sources', sources: SOURCES });
      break;
    default:
      console.warn(`[Agent] Unknown command: ${msg.type}`);
  }
}

// --- Recording ---

function startRecording(ws) {
  if (state !== 'stopped') {
    send(ws, { type: 'error', message: `Cannot start: currently ${state}` });
    return;
  }

  // Create timestamped session directory
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace(/[T:]/g, '_').replace(/-/g, '-');
  sessionDir = path.join(RECORDING_PATH, stamp);

  try {
    fs.mkdirSync(sessionDir, { recursive: true });
  } catch (err) {
    send(ws, { type: 'error', message: `Cannot create dir: ${err.message}` });
    return;
  }

  console.log(`[Agent] Starting recording in ${sessionDir}`);

  // Spawn one NDI Record.exe per source
  for (const source of SOURCES) {
    const outFile = path.join(sessionDir, `${source.id}.mov`);
    const args = ['-i', source.name, '-o', outFile, '-noautostart'];

    console.log(`[Agent] Spawning: "${NDI_RECORD_PATH}" ${args.join(' ')}`);

    const proc = spawn(NDI_RECORD_PATH, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const recorder = { process: proc, frames: 0, vuDb: -60 };
    recorders.set(source.id, recorder);

    // Parse XML stdout for stats
    let buffer = '';
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      // Process complete XML tags
      let match;
      while ((match = buffer.match(/<(\w+)\s+([^>]*)\/>/)) !== null) {
        parseRecorderXml(source.id, match[1], match[2], recorder);
        buffer = buffer.slice(match.index + match[0].length);
      }
    });

    proc.stderr.on('data', (chunk) => {
      console.error(`[${source.id}] ${chunk.toString().trim()}`);
    });

    proc.on('exit', (code) => {
      console.log(`[Agent] ${source.id} exited with code ${code}`);
      recorders.delete(source.id);
      checkAllStopped();
    });
  }

  // Send <start/> to all recorders for frame-accurate sync
  setTimeout(() => {
    for (const [id, rec] of recorders) {
      try {
        rec.process.stdin.write('<start/>\n');
        console.log(`[Agent] Sent <start/> to ${id}`);
      } catch (err) {
        console.error(`[Agent] Failed to start ${id}: ${err.message}`);
      }
    }
    state = 'recording';
    broadcast({ type: 'state', state: 'recording' });
  }, 500); // Brief delay to let processes initialize
}

function stopRecording(ws) {
  if (state !== 'recording') {
    send(ws, { type: 'error', message: `Cannot stop: currently ${state}` });
    return;
  }

  console.log('[Agent] Stopping recording');

  for (const [id, rec] of recorders) {
    try {
      rec.process.stdin.write('<exit/>\n');
      console.log(`[Agent] Sent <exit/> to ${id}`);
    } catch (err) {
      console.error(`[Agent] Failed to stop ${id}: ${err.message}`);
    }
  }

  // Processes will exit, triggering checkAllStopped()
}

function checkAllStopped() {
  if (recorders.size === 0 && state === 'recording') {
    console.log('[Agent] All recorders stopped');
    startArchive();
  }
}

function parseRecorderXml(sourceId, tag, attrs, recorder) {
  const attrMap = {};
  attrs.replace(/(\w+)="([^"]*)"/g, (_, key, val) => {
    attrMap[key] = val;
  });

  if (tag === 'recording') {
    const frames = parseInt(attrMap.no_frames, 10) || 0;
    const vuDb = parseFloat(attrMap.vu_dB) || -60;
    recorder.frames = frames;
    recorder.vuDb = vuDb;

    broadcast({
      type: 'source-update',
      id: sourceId,
      frames,
      vuDb,
    });
  } else if (tag === 'record_stopped') {
    const frames = parseInt(attrMap.no_frames, 10) || 0;
    console.log(`[Agent] ${sourceId} stopped after ${frames} frames`);
  }
}

// --- Archive (robocopy) ---

function startArchive() {
  if (!ARCHIVE_PATH || !sessionDir) {
    state = 'stopped';
    broadcast({ type: 'state', state: 'stopped' });
    return;
  }

  state = 'archiving';
  broadcast({ type: 'state', state: 'archiving' });

  const destDir = path.join(ARCHIVE_PATH, path.basename(sessionDir));
  console.log(`[Agent] Archiving: ${sessionDir} -> ${destDir}`);

  const robo = spawn('robocopy', [sessionDir, destDir, '/E', '/R:3', '/W:5'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let totalFiles = 0;
  let copiedFiles = 0;

  robo.stdout.on('data', (chunk) => {
    const text = chunk.toString();

    // Parse robocopy output for file count
    const filesMatch = text.match(/Files\s*:\s*(\d+)/);
    if (filesMatch) totalFiles = parseInt(filesMatch[1], 10);

    // Count "New File" or "Newer" lines
    const newFileLines = (text.match(/(New File|Newer|Modified)/g) || []).length;
    copiedFiles += newFileLines;

    if (totalFiles > 0) {
      const progress = Math.min(copiedFiles / totalFiles, 1);
      broadcast({ type: 'archive-progress', progress });
    }
  });

  robo.stderr.on('data', (chunk) => {
    console.error(`[Archive] ${chunk.toString().trim()}`);
  });

  robo.on('exit', (code) => {
    // Robocopy exit codes 0-7 are success
    if (code <= 7) {
      console.log(`[Agent] Archive complete (exit ${code}): ${destDir}`);
      broadcast({ type: 'archive-done', path: destDir });
    } else {
      console.error(`[Agent] Archive failed with exit code ${code}`);
      broadcast({ type: 'error', message: `Robocopy failed with exit code ${code}` });
    }
    state = 'stopped';
    broadcast({ type: 'state', state: 'stopped' });
  });
}

// --- Graceful shutdown ---

process.on('SIGINT', () => {
  console.log('\n[Agent] Shutting down...');
  for (const [id, rec] of recorders) {
    try {
      rec.process.stdin.write('<exit/>\n');
    } catch {}
  }
  wss.close();
  process.exit(0);
});
```

**Step 4: Commit**

```bash
git add ndi-record-agent/
git commit -m "feat: add ndi-record-agent Windows service"
```

---

### Task 10: CollapsiblePanel icon support for "record"

**Files:**
- Modify: `ui/src/components/CollapsiblePanel.tsx` (only if `icon="record"` is not already handled)

Check if the `CollapsiblePanel` component already handles the `"record"` icon value. If not, add it to the icon map.

**Step 1: Check CollapsiblePanel**

Read `ui/src/components/CollapsiblePanel.tsx` and find the icon mapping. Add a `record` case that renders a red circle (similar to a record icon). For example, if icons are mapped in a switch or object:

```typescript
case 'record': return '●'; // or an SVG circle
```

If the component uses a generic fallback for unknown icons, this step may be unnecessary. Adapt accordingly.

**Step 2: Run type check**

Run: `cd ui && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit (if changes made)**

```bash
git add ui/src/components/CollapsiblePanel.tsx
git commit -m "feat: add record icon to CollapsiblePanel"
```

---

Plan complete and saved to `docs/plans/2026-02-23-ndi-recording-driver.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
