# QLab Driver + Emulator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add QLab show control support to Production Hub — fire named cues and GO from two workspaces (utility SFX + show), with playback feedback and a two-port emulator.

**Architecture:** Two QLab driver instances (one per workspace), differentiated by port. Each is a transparent UDP OSC relay modeled on the ChamSys driver. The driver listens for QLab reply messages for state feedback (playhead position, running cues). A two-port emulator in production-emulator handles both workspaces.

**Tech Stack:** Node.js `dgram` (UDP), `osc` library for encoding/decoding, Zod for config validation, `node:test` for tests.

**Design doc:** `docs/plans/2026-02-20-qlab-driver-design.md`

---

### Task 1: Config Schema — Add `qlab` Device Type

**Files:**
- Modify: `src/config-schema.ts:31` (deviceTypeSchema enum)
- Modify: `src/config-schema.ts:86` (add qlabDeviceSchema after touchdesignerDeviceSchema)
- Modify: `src/config-schema.ts:90-96` (discriminated union)

**Step 1: Add 'qlab' to the device type enum**

In `src/config-schema.ts`, line 31, add `'qlab'` to the enum:

```typescript
const deviceTypeSchema = z.enum(['avantis', 'chamsys', 'obs', 'visca', 'touchdesigner', 'qlab']);
```

**Step 2: Add qlabDeviceSchema**

After the `touchdesignerDeviceSchema` block (~line 86), add:

```typescript
const qlabDeviceSchema = baseDeviceSchema.extend({
  type: z.literal('qlab'),
  passcode: z.string().optional().default(''),
});
```

**Step 3: Add to discriminated union**

In the `deviceSchema` discriminated union (~line 90-96), add `qlabDeviceSchema`:

```typescript
const deviceSchema = z.discriminatedUnion('type', [
  avantisDeviceSchema,
  chamsysDeviceSchema,
  obsDeviceSchema,
  viscaDeviceSchema,
  touchdesignerDeviceSchema,
  qlabDeviceSchema,
]);
```

**Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS (no errors)

**Step 5: Commit**

```bash
git add src/config-schema.ts
git commit -m "feat(config): add qlab device type to schema"
```

---

### Task 2: Driver Stats + Factory Wiring

**Files:**
- Modify: `src/driver-stats.ts:49-58` (inferTransportType switch)
- Modify: `src/index.ts:28-33` (imports)
- Modify: `src/index.ts:37-43` (EMULATOR_DEFAULTS)
- Modify: `src/index.ts:261-285` (createDriver switch)
- Modify: `src/drivers/index.ts` (exports)

**Step 1: Add qlab to inferTransportType**

In `src/driver-stats.ts`, add before the `default` case (~line 57):

```typescript
case 'qlab': return 'udp';
```

**Step 2: Add QLab driver import to index.ts**

In `src/index.ts`, after line 32 (TouchDesigner import), add:

```typescript
import { QLabDriver } from './drivers/qlab-driver';
```

**Step 3: Add emulator defaults**

In `src/index.ts`, add to `EMULATOR_DEFAULTS` (~line 42):

```typescript
qlab: { host: '127.0.0.1', port: 53100 },
```

**Step 4: Add to createDriver switch**

In `src/index.ts`, add before the `default` case (~line 283):

```typescript
case 'qlab': return new QLabDriver(deviceConfig as any, hubContext, verbose);
```

**Step 5: Add barrel export**

In `src/drivers/index.ts`, add:

```typescript
export { QLabDriver } from './qlab-driver';
```

Note: These changes will not compile until Task 3 (the driver file) is created. That's fine — we'll verify after Task 3.

**Step 6: Commit**

```bash
git add src/driver-stats.ts src/index.ts src/drivers/index.ts
git commit -m "feat(wiring): add qlab to driver factory, stats, and exports"
```

---

### Task 3: QLab Driver — Core Implementation

**Files:**
- Create: `src/drivers/qlab-driver.ts`
- Reference: `src/drivers/chamsys-driver.ts` (template)
- Reference: `src/drivers/device-driver.ts` (interface)

**Step 1: Create the driver file**

Create `src/drivers/qlab-driver.ts`. This is modeled on `chamsys-driver.ts` — a transparent UDP OSC relay. Key differences from ChamSys:

- On connect: sends `/connect` (with optional passcode) and `/updates 1`
- Polls QLab every ~1s for playhead + running cues
- Parses `/reply/...` JSON messages for state feedback
- No fade support needed (handleFadeTick is a no-op)

```typescript
import { EventEmitter } from 'events';
import * as dgram from 'dgram';
import * as osc from 'osc';
import { DeviceConfig, DeviceDriver, HubContext, FeedbackEvent } from './device-driver';
import { ReconnectQueue } from './reconnect-queue';

export interface QLabConfig extends DeviceConfig {
  type: 'qlab';
  passcode?: string;
}

export class QLabDriver extends EventEmitter implements DeviceDriver {
  readonly name: string;
  readonly prefix: string;
  private host: string;
  private port: number;
  private passcode: string;
  private socket: dgram.Socket | null = null;
  private connected = false;
  private verbose: boolean;
  private queue = new ReconnectQueue(64);
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  // State
  private playhead = '';
  private runningCues: string[] = [];

  constructor(config: QLabConfig, _hubContext: HubContext, verbose = false) {
    super();
    this.name = config.name || 'qlab';
    this.prefix = config.prefix;
    this.host = config.host;
    this.port = config.port;
    this.passcode = config.passcode || '';
    this.verbose = verbose;
  }

  connect(): void {
    const socket = dgram.createSocket('udp4');
    this.socket = socket;

    socket.on('listening', () => {
      this.log(`UDP socket bound on port ${socket.address().port}`);
      // Send connect handshake
      if (this.passcode) {
        this.sendOsc('/connect', [{ type: 's', value: this.passcode }]);
      } else {
        this.sendOsc('/connect', []);
      }
      // Subscribe to updates
      this.sendOsc('/updates', [{ type: 'i', value: 1 }]);

      this.connected = true;
      this.emit('connected');
      this.queue.flush((address, args) => this.sendOsc(address, args));

      // Start polling for playhead + running cues
      this.pollTimer = setInterval(() => this.poll(), 1000);
    });

    socket.on('message', (msg, rinfo) => {
      try {
        const packet = osc.readPacket(msg, {});
        if (packet.address) {
          this.handleReply(packet.address, packet.args || []);
        }
      } catch (err) {
        this.log(`Reply parse error: ${err}`);
      }
    });

    socket.on('error', (err) => {
      this.log(`Socket error: ${err.message}`);
      this.emit('error', err);
    });

    socket.bind(0);
  }

  disconnect(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.connected = false;
    this.emit('disconnected');
  }

  isConnected(): boolean {
    return this.connected;
  }

  handleOSC(address: string, args: any[]): void {
    if (!this.connected) {
      this.queue.push(address, args);
      return;
    }
    const oscArgs = args.map((a) => this.toOscArg(a));
    this.sendOsc(address, oscArgs);
    this.log(`TX ${address} ${args.map(String).join(' ')}`);
  }

  handleFadeTick(_key: string, _value: number): void {
    // no-op — QLab handles its own fades
  }

  getState(): Record<string, any> {
    return {
      connected: this.connected,
      playhead: this.playhead,
      runningCues: this.runningCues,
      runningCount: this.runningCues.length,
    };
  }

  private poll(): void {
    if (!this.connected) return;
    this.sendOsc('/cue/playhead/text', []);
    this.sendOsc('/runningCues', []);
  }

  private handleReply(address: string, args: any[]): void {
    // QLab replies come as /reply/{original_address} with JSON string arg
    if (!address.startsWith('/reply/')) return;

    const originalAddress = address.slice('/reply'.length);
    const jsonStr = args[0]?.value ?? args[0];
    if (typeof jsonStr !== 'string') return;

    try {
      const reply = JSON.parse(jsonStr);
      const data = reply.data;

      if (originalAddress === '/cue/playhead/text') {
        const newPlayhead = typeof data === 'string' ? data : '';
        if (newPlayhead !== this.playhead) {
          this.playhead = newPlayhead;
          this.emitFeedback('/playhead', [{ type: 's', value: this.playhead }]);
        }
      } else if (originalAddress === '/runningCues') {
        const cueNames = Array.isArray(data)
          ? data.map((c: any) => c.listName || c.name || c.number || '').filter(Boolean)
          : [];
        const prev = this.runningCues.join(',');
        this.runningCues = cueNames;
        if (cueNames.join(',') !== prev) {
          this.emitFeedback('/running', [{ type: 'i', value: cueNames.length }]);
          this.emitFeedback('/runningCues', [{ type: 's', value: cueNames.join(', ') }]);
        }
      }
    } catch {
      // Not JSON — ignore
    }
  }

  private sendOsc(address: string, args: any[]): void {
    if (!this.socket) return;
    try {
      const buf = osc.writeMessage({ address, args });
      this.socket.send(buf, 0, buf.length, this.port, this.host);
    } catch (err) {
      this.log(`Send error: ${err}`);
    }
  }

  private emitFeedback(address: string, args: any[]): void {
    const ev: FeedbackEvent = { address: `${this.prefix}${address}`, args };
    this.emit('feedback', ev);
  }

  private toOscArg(value: any): any {
    if (typeof value === 'number') {
      return Number.isInteger(value) ? { type: 'i', value } : { type: 'f', value };
    }
    if (typeof value === 'string') return { type: 's', value };
    return value;
  }

  private log(msg: string): void {
    if (this.verbose) console.log(`[${this.name}] ${msg}`);
  }
}
```

**Step 2: Verify full project compiles**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/drivers/qlab-driver.ts
git commit -m "feat(qlab): add QLab driver — UDP OSC relay with reply parsing"
```

---

### Task 4: QLab Driver Tests

**Files:**
- Create: `src/__tests__/qlab-driver.test.ts`
- Reference: `src/__tests__/chamsys-driver.test.ts` (template)

**Step 1: Write tests**

Create `src/__tests__/qlab-driver.test.ts`. Test the same things as chamsys-driver.test.ts adapted for QLab:

```typescript
import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as dgram from 'dgram';
import * as osc from 'osc';
import { QLabDriver } from '../drivers/qlab-driver';
import { HubContext } from '../drivers/device-driver';

const mockHubContext: HubContext = {
  startFade: () => {},
  cancelFade: () => {},
  cancelAllFades: () => {},
  setCurrentValue: () => {},
  getCurrentValue: () => undefined,
};

const defaultConfig = {
  type: 'qlab' as const,
  prefix: '/sfx',
  host: '127.0.0.1',
  port: 53900, // use high port to avoid conflicts
};

describe('QLabDriver', () => {

  let driver: QLabDriver | null = null;

  afterEach(() => {
    if (driver) {
      driver.disconnect();
      driver = null;
    }
  });

  describe('constructor', () => {
    it('should set name to "qlab" by default', () => {
      driver = new QLabDriver(defaultConfig, mockHubContext);
      assert.equal(driver.name, 'qlab');
    });

    it('should set prefix from config', () => {
      driver = new QLabDriver(defaultConfig, mockHubContext);
      assert.equal(driver.prefix, '/sfx');
    });

    it('should accept custom name via config', () => {
      const config = { ...defaultConfig, name: 'myQLab' };
      driver = new QLabDriver(config, mockHubContext);
      assert.equal(driver.name, 'myQLab');
    });
  });

  describe('connection state', () => {
    it('should return false for isConnected before connect', () => {
      driver = new QLabDriver(defaultConfig, mockHubContext);
      assert.equal(driver.isConnected(), false);
    });

    it('should return true after connect completes', (_, done) => {
      driver = new QLabDriver(defaultConfig, mockHubContext);
      driver.on('connected', () => {
        assert.equal(driver!.isConnected(), true);
        done();
      });
      driver.connect();
    });

    it('should return false after disconnect', (_, done) => {
      driver = new QLabDriver(defaultConfig, mockHubContext);
      driver.on('connected', () => {
        driver!.disconnect();
        assert.equal(driver!.isConnected(), false);
        driver = null; // already disconnected
        done();
      });
      driver.connect();
    });
  });

  describe('handleOSC', () => {
    it('should send OSC messages to the target port', (_, done) => {
      // Create a UDP server to receive the message
      const receiver = dgram.createSocket('udp4');
      receiver.bind(53901, '127.0.0.1', () => {
        const config = { ...defaultConfig, port: 53901 };
        driver = new QLabDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const packet = osc.readPacket(msg, {});
          // Skip /connect and /updates messages from handshake
          if (packet.address === '/cue/applause/start') {
            receiver.close();
            done();
          }
        });

        driver.on('connected', () => {
          driver!.handleOSC('/cue/applause/start', []);
        });
        driver.connect();
      });
    });

    it('should send connect handshake on startup', (_, done) => {
      const receiver = dgram.createSocket('udp4');
      receiver.bind(53902, '127.0.0.1', () => {
        const config = { ...defaultConfig, port: 53902 };
        driver = new QLabDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const packet = osc.readPacket(msg, {});
          if (packet.address === '/connect') {
            receiver.close();
            done();
          }
        });

        driver.connect();
      });
    });
  });

  describe('getState', () => {
    it('should return initial state', () => {
      driver = new QLabDriver(defaultConfig, mockHubContext);
      const state = driver.getState();
      assert.equal(state.connected, false);
      assert.equal(state.playhead, '');
      assert.deepEqual(state.runningCues, []);
      assert.equal(state.runningCount, 0);
    });
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `npx node --test src/__tests__/qlab-driver.test.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/__tests__/qlab-driver.test.ts
git commit -m "test(qlab): add QLab driver unit tests"
```

---

### Task 5: Config + Actions

**Files:**
- Modify: `config.yml` (add two qlab devices after touchdesigner, ~line 76)
- Modify: `actions.yml` (add SFX + Show categories at end)
- Modify: `src/brain/system-prompt.ts:63-136` (add QLab OSC address reference)

**Step 1: Add QLab devices to config.yml**

Add after the touchdesigner device entry (before the `health:` block):

```yaml
  # QLab — SFX / utility workspace
  - type: qlab
    prefix: /sfx
    host: 192.168.1.50
    port: 53000
    emulate: true
    heartbeat:
      enabled: false

  # QLab — show-specific workspace
  - type: qlab
    prefix: /show
    host: 192.168.1.50
    port: 53001
    emulate: true
    heartbeat:
      enabled: false
```

**Step 2: Add QLab actions to actions.yml**

Append to end of file:

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

**Step 3: Add QLab section to brain system prompt**

In `src/brain/system-prompt.ts`, after the VISCA address reference section (~line 134), add a QLab section to the OSC address reference:

```typescript
### QLab SFX (prefix: /sfx)
- /sfx/go — advance SFX playhead to next cue
- /sfx/cue/{name}/start — fire a specific SFX cue by name
- /sfx/cue/{name}/stop — stop a specific SFX cue
- /sfx/stop — stop all SFX cues
- /sfx/pause — pause all SFX cues
- /sfx/resume — resume all SFX cues
- /sfx/panic — panic (fade out all SFX)

### QLab Show (prefix: /show)
- /show/go — advance show playhead to next cue
- /show/cue/{name}/start — fire a specific show cue by name
- /show/cue/{name}/stop — stop a specific show cue
- /show/stop — stop all show cues
- /show/pause — pause all show cues
- /show/resume — resume all show cues
- /show/panic — panic (fade out all show cues)
```

**Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 5: Run all tests**

Run: `npm test`
Expected: All tests PASS (existing + new QLab tests)

**Step 6: Commit**

```bash
git add config.yml actions.yml src/brain/system-prompt.ts
git commit -m "feat(qlab): add config, actions, and brain prompt for QLab"
```

---

### Task 6: QLab Emulator — production-emulator

**Files:**
- Modify: `/Users/dave/projects/production-emulator/server.js` (add QLab state, handlers, UDP servers)

The production-emulator is a single `server.js` monolith (~2145 lines). Add QLab support following the same patterns as the existing QuickQ (OSC/UDP) emulator.

**Step 1: Add constants and state**

After the VISCA constants (~line 27), add:

```javascript
const QLAB_SFX_PORT = Number(process.env.QLAB_SFX_PORT || 53100);
const QLAB_SHOW_PORT = Number(process.env.QLAB_SHOW_PORT || 53101);
```

After the existing state objects (~line 65), add:

```javascript
const qlabSfxState = buildQlabWorkspace('Utility', [
  { number: '1', name: 'Applause', type: 'audio', duration: 5 },
  { number: '2', name: 'Intro Sting', type: 'audio', duration: 3 },
  { number: '3', name: 'Transition Whoosh', type: 'audio', duration: 1 },
  { number: '4', name: 'Walk-in Music', type: 'audio', duration: 120 },
  { number: '5', name: 'Countdown', type: 'audio', duration: 10 },
]);

const qlabShowState = buildQlabWorkspace('Sunday Service', [
  { number: '1', name: 'Pre-Show', type: 'group', duration: 5 },
  { number: '2', name: 'Opening', type: 'group', duration: 10 },
  { number: '3', name: 'Song 1', type: 'audio', duration: 240 },
  { number: '4', name: 'Transition A', type: 'audio', duration: 3 },
  { number: '5', name: 'Speaker Intro', type: 'audio', duration: 2 },
  { number: '6', name: 'Message', type: 'group', duration: 0 },
  { number: '7', name: 'Song 2', type: 'audio', duration: 240 },
  { number: '8', name: 'Closing', type: 'group', duration: 10 },
  { number: '9', name: 'Walk-out', type: 'audio', duration: 120 },
]);
```

**Step 2: Add helper functions**

Before the `// Start all servers` section (~line 2121), add:

```javascript
function buildQlabWorkspace(name, cueList) {
  return {
    name,
    connected: false,
    cues: cueList,
    playheadIndex: 0,
    runningCues: [], // { number, name, startedAt, duration, timer }
    paused: false,
  };
}

function qlabReply(socket, rinfo, originalAddress, data) {
  const replyAddress = '/reply' + originalAddress;
  const json = JSON.stringify({ address: originalAddress, data, status: 'ok' });
  const buf = encodeOscMessage(replyAddress, [json]);
  socket.send(buf, 0, buf.length, rinfo.port, rinfo.address);
}

function qlabStartCue(state, cue, socket, rinfo) {
  // Remove if already running
  qlabStopCue(state, cue.number);

  const entry = {
    number: cue.number,
    name: cue.name,
    startedAt: Date.now(),
    duration: cue.duration,
    timer: cue.duration > 0
      ? setTimeout(() => qlabStopCue(state, cue.number), cue.duration * 1000)
      : null,
  };
  state.runningCues.push(entry);
  emitEvent('qlab-cue-started', { workspace: state.name, cue: cue.name });
}

function qlabStopCue(state, number) {
  const idx = state.runningCues.findIndex((c) => c.number === number);
  if (idx !== -1) {
    const entry = state.runningCues[idx];
    if (entry.timer) clearTimeout(entry.timer);
    state.runningCues.splice(idx, 1);
    emitEvent('qlab-cue-stopped', { workspace: state.name, cue: entry.name });
  }
}

function qlabStopAll(state) {
  for (const entry of state.runningCues) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  state.runningCues = [];
  emitEvent('qlab-stop-all', { workspace: state.name });
}

function qlabFindCue(state, nameOrNumber) {
  return state.cues.find((c) =>
    c.number === nameOrNumber || c.name.toLowerCase() === nameOrNumber.toLowerCase()
  );
}

function handleQlabMessage(state, socket, message, rinfo) {
  const address = message.address;
  const args = message.args || [];

  appendProtocolLog({
    protocol: 'qlab',
    direction: 'rx',
    summary: `${address} ${args.map(formatOscArg).join(' ')}`,
    detail: { address, args, from: `${rinfo.address}:${rinfo.port}` },
  });

  if (address === '/connect') {
    state.connected = true;
    qlabReply(socket, rinfo, '/connect', 'ok');
    emitEvent('qlab-connected', { workspace: state.name });
    return;
  }

  if (address === '/updates') {
    // Acknowledge updates subscription — no-op for emulator
    return;
  }

  if (address === '/go') {
    const cue = state.cues[state.playheadIndex];
    if (cue) {
      qlabStartCue(state, cue, socket, rinfo);
      state.playheadIndex = Math.min(state.playheadIndex + 1, state.cues.length - 1);
      emitEvent('qlab-go', { workspace: state.name, cue: cue.name, playhead: state.playheadIndex });
    }
    return;
  }

  if (address === '/stop') {
    qlabStopAll(state);
    return;
  }

  if (address === '/pause') {
    state.paused = true;
    emitEvent('qlab-paused', { workspace: state.name });
    return;
  }

  if (address === '/resume') {
    state.paused = false;
    emitEvent('qlab-resumed', { workspace: state.name });
    return;
  }

  if (address === '/panic') {
    qlabStopAll(state);
    state.paused = false;
    emitEvent('qlab-panic', { workspace: state.name });
    return;
  }

  // /cue/{name}/start, /cue/{name}/stop
  const cueMatch = address.match(/^\/cue\/(.+)\/(start|stop|text)$/);
  if (cueMatch) {
    const [, nameOrNumber, action] = cueMatch;

    if (nameOrNumber === 'playhead' && action === 'text') {
      const cue = state.cues[state.playheadIndex];
      qlabReply(socket, rinfo, '/cue/playhead/text', cue ? cue.name : '');
      return;
    }

    const cue = qlabFindCue(state, nameOrNumber);
    if (!cue) return;

    if (action === 'start') {
      qlabStartCue(state, cue, socket, rinfo);
    } else if (action === 'stop') {
      qlabStopCue(state, cue.number);
    }
    return;
  }

  // /runningCues
  if (address === '/runningCues') {
    const data = state.runningCues.map((c) => ({
      number: c.number,
      listName: c.name,
      name: c.name,
      type: 'audio',
    }));
    qlabReply(socket, rinfo, '/runningCues', data);
    return;
  }
}
```

**Step 3: Create UDP servers and bind**

Before the `// Start all servers` section, add:

```javascript
// =========================================================================
// QLab UDP Servers
// =========================================================================

const qlabSfxServer = dgram.createSocket('udp4');
const qlabShowServer = dgram.createSocket('udp4');

qlabSfxServer.on('message', (msg, rinfo) => {
  try {
    const packet = decodeOscPacket(msg);
    const messages = packet.address ? [packet] : (packet.elements || []);
    for (const message of messages) {
      handleQlabMessage(qlabSfxState, qlabSfxServer, message, rinfo);
    }
  } catch (err) {
    console.error(`QLab SFX parse error: ${err.message}`);
  }
});

qlabShowServer.on('message', (msg, rinfo) => {
  try {
    const packet = decodeOscPacket(msg);
    const messages = packet.address ? [packet] : (packet.elements || []);
    for (const message of messages) {
      handleQlabMessage(qlabShowState, qlabShowServer, message, rinfo);
    }
  } catch (err) {
    console.error(`QLab Show parse error: ${err.message}`);
  }
});
```

In the `// Start all servers` section, add after the VISCA listen:

```javascript
qlabSfxServer.bind(QLAB_SFX_PORT, '0.0.0.0', () => {
  console.log(`QLab SFX UDP server listening on port ${QLAB_SFX_PORT}`);
});

qlabShowServer.bind(QLAB_SHOW_PORT, '0.0.0.0', () => {
  console.log(`QLab Show UDP server listening on port ${QLAB_SHOW_PORT}`);
});
```

**Step 4: Add to REST API state endpoint**

Find the HTTP handler that serves state for the web UI. Add QLab state to the response. Look for where `avantisState`, `quickqState`, etc. are serialized and add:

```javascript
qlabSfx: {
  name: qlabSfxState.name,
  connected: qlabSfxState.connected,
  playhead: qlabSfxState.cues[qlabSfxState.playheadIndex]?.name || '',
  playheadIndex: qlabSfxState.playheadIndex,
  cueCount: qlabSfxState.cues.length,
  runningCues: qlabSfxState.runningCues.map(c => c.name),
  paused: qlabSfxState.paused,
},
qlabShow: {
  name: qlabShowState.name,
  connected: qlabShowState.connected,
  playhead: qlabShowState.cues[qlabShowState.playheadIndex]?.name || '',
  playheadIndex: qlabShowState.playheadIndex,
  cueCount: qlabShowState.cues.length,
  runningCues: qlabShowState.runningCues.map(c => c.name),
  paused: qlabShowState.paused,
},
```

**Step 5: Test manually**

Start the emulator:
```bash
cd /Users/dave/projects/production-emulator && node server.js
```

Expected output includes:
```
QLab SFX UDP server listening on port 53100
QLab Show UDP server listening on port 53101
```

Test with a quick OSC send (from another terminal):
```bash
echo -ne '/go\x00\x00,\x00\x00\x00' | nc -u -w1 127.0.0.1 53100
```

**Step 6: Commit**

```bash
cd /Users/dave/projects/production-emulator
git add server.js
git commit -m "feat(qlab): add two-port QLab emulator (SFX 53100, Show 53101)"
```

---

### Task 7: Integration Test — End to End

**Files:**
- No new files — manual test

**Step 1: Start the emulator**

```bash
cd /Users/dave/projects/production-emulator && node server.js
```

**Step 2: Start Production Hub with emulate mode**

```bash
cd /Users/dave/projects/productionhub && npm run dev
```

Verify logs show:
- `[qlab] UDP socket bound on port ...`
- `[qlab] TX /connect`
- QLab drivers appear as connected in health output

**Step 3: Test firing a cue via the web UI or OSC**

Send a test OSC message:
```bash
# Install oscsend if needed: brew install liblo
oscsend 127.0.0.1 9000 /sfx/go
```

Or use the action palette in the web UI to fire "SFX GO".

Verify the emulator received the `/go` command and advanced its playhead.

**Step 4: Verify feedback**

Check that the dashboard shows QLab state (playhead position, running cues). Check brain system prompt includes QLab state info.

**Step 5: Commit all remaining changes**

```bash
cd /Users/dave/projects/productionhub
git add -A
git commit -m "feat(qlab): complete QLab integration with emulator support"
```
