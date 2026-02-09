# Developer Guide: Avantis OSC Production Hub

This guide covers the architecture of the production hub and how to add new device drivers.

## 1. Architecture Overview

The hub is a multi-device OSC orchestrator that routes incoming OSC messages by prefix to device-specific drivers. Each driver handles a single physical or virtual device (audio console, lighting desk, camera, streaming software, etc.).

### Core Components

**ProductionHub** (`src/hub.ts`)
- Central orchestrator and OSC router
- Owns the single `AvantisOSCServer` instance (UDP endpoint on port 9000)
- Owns the shared `FadeEngine` (device-agnostic 50Hz interpolation)
- Registers and manages `DeviceDriver` instances
- Routes incoming OSC messages to drivers by longest-prefix match
- Collects feedback from drivers and relays to OSC clients with prefix prepended

**DeviceDriver Interface** (`src/drivers/device-driver.ts`)
- Contract that all drivers implement
- Extends `EventEmitter` for connection state and feedback events
- Handles device-specific protocol translation (MIDI, OSC relay, WebSocket, TCP binary)

**FadeEngine** (`src/fade-engine.ts`)
- Device-agnostic timed parameter interpolation at 50Hz (20ms tick rate)
- Supports concurrent fades on different parameters
- Provides easing curves: `linear`, `scurve` (sine S-curve), `easein`, `easeout`
- Tracks current values to seamlessly chain fades
- Emits `value` events at each tick and `fadeComplete` when done
- Shared by the hub, not per-driver (drivers request fades via `HubContext`)

**AvantisOSCServer** (`src/osc-server.ts`)
- Single UDP endpoint on configurable address/port (default: `0.0.0.0:9000`)
- Listens for OSC messages and routes them to the hub
- Tracks connected OSC clients for feedback transmission
- Implements client timeout (drops inactive clients after 60 seconds)

**Config Loader** (`src/config.ts`)
- Reads YAML configuration in either legacy (single-device) or hub (multi-device) format
- Auto-detects format and normalizes to runtime `Config`
- Validates required fields: `type`, `prefix`, `host`, `port`

### Data Flow

```
QLab / TouchOSC / etc.
  ↓ UDP:9000
ProductionHub.routeOSC(address, args)
  ↓ match longest prefix
  → /avantis/... → AvantisDriver
  → /lights/...  → ChamSysDriver
  → /obs/...     → OBSDriver
  → /cam1/...    → VISCADriver
  ↓ strip prefix
driver.handleOSC(remainder, args)
  ↓ translate to device protocol
  → MIDI TCP, OSC relay, WebSocket, VISCA binary, etc.
  → send to physical device

Physical Device
  ↓ receive response
  ↓ driver receives data
  ↓ driver emits 'feedback' event
ProductionHub collects feedback
  ↓ prepend prefix
  ↓ oscServer.sendToClients(fullAddress, args)
  → QLab / TouchOSC / etc.
```

## 2. The DeviceDriver Interface

All drivers implement the `DeviceDriver` interface and extend `EventEmitter`.

### Interface Definition

```typescript
interface DeviceDriver extends EventEmitter {
  readonly name: string;
  readonly prefix: string;

  connect(): void;
  disconnect(): void;
  isConnected(): boolean;

  handleOSC(address: string, args: any[]): void;
  handleFadeTick(key: string, value: number): void;

  // Events emitted:
  // 'feedback' (event: FeedbackEvent) — state change to relay to OSC clients
  // 'connected' — transport is connected
  // 'disconnected' — transport lost
  // 'error' (err: Error) — non-fatal error
}
```

### Supporting Types

```typescript
interface FeedbackEvent {
  address: string;   // relative to driver prefix, e.g. "/ch/1/mix/fader"
  args: OscArg[];
}

interface OscArg {
  type: string;  // 'f' (float), 'i' (int), 's' (string)
  value: any;
}

interface DriverFadeRequest {
  key: string;           // opaque key, e.g. "input/1/fader"
  startValue: number;    // fallback only — engine prefers tracked current value
  endValue: number;
  durationMs: number;
  easing: 'linear' | 'scurve' | 'easein' | 'easeout';
}

interface HubContext {
  startFade(req: DriverFadeRequest): void;
  cancelFade(key: string, snapToTarget?: boolean): void;
  cancelAllFades(): void;
  setCurrentValue(key: string, value: number): void;
  getCurrentValue(key: string): number | undefined;
}
```

### Property Details

- **`name`**: Human-readable driver name, e.g. `"avantis"`, `"chamsys"`, `"obs"`. Used for logging and fade key namespacing.
- **`prefix`**: OSC prefix this driver owns, e.g. `"/avantis"`. Case-insensitive. Must be unique across all drivers. Normalized to lowercase by the hub.

### Method Details

- **`connect()`**: Open transport connections. Called when the hub starts.
- **`disconnect()`**: Close transport connections gracefully. Called when the hub stops. If reconnect timers are pending, clear them.
- **`isConnected()`**: Return current transport state. The hub checks this at startup to know which drivers are available.
- **`handleOSC(address, args)`**: Route an incoming OSC message. The `address` has already been stripped of the driver prefix. For example, if the full OSC address is `/avantis/ch/1/mix/fader`, this receives `/ch/1/mix/fader`. The `args` array contains the OSC arguments; each may be a raw value or an object with `{ type, value }`.
- **`handleFadeTick(key, value)`**: Called at ~50Hz during active fades. The `key` is driver-local (prefix already stripped from what was passed to `startFade`). Only implement if your device supports continuous value control; it's OK to do nothing.

### Event Details

- **`'feedback'`** (FeedbackEvent): Emit when a state change on the device should be reported to OSC clients. The hub prepends the driver prefix and relays to all connected OSC clients.
- **`'connected'`**: Emit when the transport connection succeeds (after `connect()` is called).
- **`'disconnected'`**: Emit when the transport connection is lost. Useful for auto-reconnect logic (schedule a reconnect attempt).
- **`'error'`** (Error): Emit non-fatal errors. The hub logs them but doesn't stop.

## 3. How to Add a New Driver

This section walks through creating a hypothetical new device driver. Example: an ATEM video switcher or a Dante audio network device.

### Step 1: Create the Driver File

Create `src/drivers/mydevice-driver.ts`:

```typescript
import { EventEmitter } from 'events';
import {
  DeviceDriver,
  DeviceConfig,
  HubContext,
  FeedbackEvent,
  OscArg,
} from './device-driver';

export interface MyDeviceConfig extends DeviceConfig {
  type: 'mydevice';
  // Add device-specific config fields here
  // Example: password?: string; bandwidth?: number;
}

export class MyDeviceDriver extends EventEmitter implements DeviceDriver {
  readonly name = 'mydevice';
  readonly prefix: string;

  private host: string;
  private port: number;
  private connected: boolean = false;
  private hubContext: HubContext;
  private verbose: boolean;
  // Add transport field: net.Socket, WebSocket, dgram.Socket, etc.

  constructor(config: MyDeviceConfig, hubContext: HubContext, verbose = false) {
    super();
    this.prefix = config.prefix;
    this.host = config.host;
    this.port = config.port;
    this.hubContext = hubContext;
    this.verbose = verbose;

    // Initialize transport, parser, etc.
    // Set up event handlers for connection state and incoming data
  }

  connect(): void {
    // Open transport connection
    // Emit 'connected' when ready
    // If transport closes unexpectedly, schedule reconnect and emit 'disconnected'
  }

  disconnect(): void {
    // Close connection gracefully
    // Cancel any pending reconnect timers
  }

  isConnected(): boolean {
    return this.connected;
  }

  handleOSC(address: string, args: any[]): void {
    // Parse the address (e.g. "/source/1" or "/scene/recall")
    // Translate to device protocol
    // Send to device via transport
    // If a direct set comes in, call hubContext.setCurrentValue(key, value)
    //   so the fade engine knows the current position
  }

  handleFadeTick(key: string, value: number): void {
    // Called at ~50Hz during active fades with interpolated value
    // Send the value to the device
    // Only needed if your device supports continuous parameter updates
  }

  private emitFeedback(address: string, args: OscArg[]): void {
    // Helper to emit a feedback event
    this.emit('feedback', { address, args });
  }
}
```

### Step 2: Register in the Driver Factory

Edit `src/index.ts` and add to the `createDriver()` function:

```typescript
function createDriver(
  deviceConfig: DeviceConfig,
  hubContext: HubContext,
  verbose: boolean
): DeviceDriver {
  switch (deviceConfig.type) {
    case 'avantis':
      return new AvantisDriver(deviceConfig as any, hubContext, verbose);
    case 'chamsys':
      return new ChamSysDriver(deviceConfig as any, hubContext, verbose);
    case 'obs':
      return new OBSDriver(deviceConfig as any, hubContext, verbose);
    case 'visca':
      return new VISCADriver(deviceConfig as any, hubContext, verbose);
    case 'mydevice':
      return new MyDeviceDriver(deviceConfig as any, hubContext, verbose);
    default:
      throw new Error(`Unknown device type: ${deviceConfig.type}`);
  }
}
```

And add the import:

```typescript
import { MyDeviceDriver } from './drivers/mydevice-driver';
```

### Step 3: Add to YAML Configuration

In `config.yml`:

```yaml
osc:
  listenAddress: 0.0.0.0
  listenPort: 9000

devices:
  - type: mydevice
    prefix: /mydevice
    host: "192.168.1.90"
    port: 1234
    # Add device-specific options:
    # password: "secret"
    # bandwidth: 1000

logging:
  verbose: false
```

### Step 4: Export from Barrel

Edit `src/drivers/index.ts`:

```typescript
export { MyDeviceDriver, type MyDeviceConfig } from './mydevice-driver';
```

### Step 5: Write Tests

Create `src/__tests__/mydevice-driver.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert';
import { MyDeviceDriver } from '../drivers/mydevice-driver';

test('MyDevice driver construction', () => {
  const config = {
    type: 'mydevice' as const,
    prefix: '/mydevice',
    host: '127.0.0.1',
    port: 9999,
  };

  const hubContext = {
    startFade: () => {},
    cancelFade: () => {},
    cancelAllFades: () => {},
    setCurrentValue: () => {},
    getCurrentValue: () => undefined,
  };

  const driver = new MyDeviceDriver(config, hubContext, false);
  assert.strictEqual(driver.name, 'mydevice');
  assert.strictEqual(driver.prefix, '/mydevice');
});

test('MyDevice isConnected false before connect', () => {
  const config = {
    type: 'mydevice' as const,
    prefix: '/mydevice',
    host: '127.0.0.1',
    port: 9999,
  };

  const hubContext = {
    startFade: () => {},
    cancelFade: () => {},
    cancelAllFades: () => {},
    setCurrentValue: () => {},
    getCurrentValue: () => undefined,
  };

  const driver = new MyDeviceDriver(config, hubContext, false);
  assert.strictEqual(driver.isConnected(), false);
});

test('MyDevice handleOSC with invalid transport', () => {
  const config = {
    type: 'mydevice' as const,
    prefix: '/mydevice',
    host: '127.0.0.1',
    port: 9999,
  };

  const hubContext = {
    startFade: () => {},
    cancelFade: () => {},
    cancelAllFades: () => {},
    setCurrentValue: () => {},
    getCurrentValue: () => undefined,
  };

  const driver = new MyDeviceDriver(config, hubContext, false);

  // Should not throw when disconnected
  assert.doesNotThrow(() => {
    driver.handleOSC('/source/1', [{ type: 'i', value: 1 }]);
  });
});
```

### Step 6: Add Test Script

Edit `package.json` and add to the `test` script:

```json
"test": "ts-node --files src/__tests__/... && ts-node --files src/__tests__/mydevice-driver.test.ts"
```

Also add a convenience script:

```json
"test:mydevice": "ts-node --files src/__tests__/mydevice-driver.test.ts"
```

## 4. Fade Engine Integration

The shared `FadeEngine` is accessed via the `HubContext` callback interface. This allows drivers to schedule timed parameter interpolation without implementing fading themselves.

### Key Concepts

**Fade Keys**: Opaque strings used to identify a fading parameter. By convention, drivers use keys like `"input/1/fader"` or `"scene/1/pan"`. The hub routes fade ticks by driver name; it prepends the driver name for storage (e.g. `"avantis:input/1/fader"`), then strips it when calling `driver.handleFadeTick()`.

**Start Value Tracking**: When a fade is requested, the fade engine uses the last known value for that key as the start value. If the key has never been seen, it falls back to the `startValue` in the fade request. This allows seamless chaining of fades and ensures accuracy even if multiple clients issue commands.

**Updating Current Value**: Whenever a driver receives a direct set command (not a fade), it should call `hubContext.setCurrentValue(key, value)` to update the fade engine's tracking. This is critical for fade continuity.

### Example: Handling a Fade Request

In your driver's `handleOSC()`:

```typescript
handleOSC(address: string, args: any[]): void {
  if (address === '/input/1/fade') {
    // Parse: target, duration (seconds), [easing]
    const target = this.getFloat(args, 0);           // 0.0-1.0
    const durationSecs = this.getFloat(args, 1);     // 2.5
    const easingStr = this.getString(args, 2) ?? 'scurve';

    const easing = ['linear', 'scurve', 'easein', 'easeout'].includes(easingStr)
      ? easingStr as any
      : 'scurve';

    this.hubContext.startFade({
      key: 'input/1/fader',
      startValue: 0,  // fallback (engine will use tracked value if available)
      endValue: target,
      durationMs: durationSecs * 1000,
      easing,
    });
  }
}

handleFadeTick(key: string, value: number): void {
  if (key === 'input/1/fader') {
    // Send the current interpolated value to the device
    this.sendFaderToDevice(1, value);
  }
}
```

### Example: Direct Set (Not a Fade)

```typescript
handleOSC(address: string, args: any[]): void {
  if (address === '/input/1/fader') {
    const value = this.getFloat(args, 0);
    // Set directly without fading
    this.sendFaderToDevice(1, value);
    // Update fade engine's tracking
    this.hubContext.setCurrentValue('input/1/fader', value);
  }
}
```

## 5. Echo Suppression Pattern

Bidirectional devices (like the Avantis mixing console) echo back commands they receive. Without suppression, the echo creates an OSC feedback loop: OSC → MIDI → echo MIDI → OSC → MIDI ...

The AvantisDriver implements **echo suppression** to break this cycle:

1. When sending a command to the device, stamp the timestamp for that strip/parameter combination.
2. When the device echoes back the same value via MIDI, check if it's within the suppression window (default 100ms).
3. If suppressed, update the tracked current value (for fade accuracy) but don't emit the feedback event.
4. If outside the window (user made a manual change on the desk), emit feedback normally.

### Implementing Echo Suppression

```typescript
private lastSentTimestamps: Map<string, number> = new Map();
private echoSuppressionMs = 100;

private stampSent(key: string): void {
  this.lastSentTimestamps.set(key, Date.now());
}

private isSuppressed(key: string): boolean {
  const lastTime = this.lastSentTimestamps.get(key);
  if (lastTime === undefined) return false;
  const elapsed = Date.now() - lastTime;
  return elapsed < this.echoSuppressionMs;
}

// When sending a command:
handleOSC(address: string, args: any[]): void {
  if (address === '/ch/1/mix/fader') {
    const value = this.getFloat(args, 0);
    this.sendFaderToDevice(1, value);
    this.stampSent('ch/1/fader');
  }
}

// When receiving echo:
handleMIDIFeedback(event: MIDIEvent): void {
  if (event.type === 'fader' && event.strip.type === StripType.Input && event.strip.number === 1) {
    const key = `ch/${event.strip.number}/fader`;
    const isSuppressed = this.isSuppressed(key);

    // Always update tracking for fade continuity
    this.hubContext.setCurrentValue(key, event.value);

    // Only emit feedback if not suppressed
    if (!isSuppressed) {
      this.emitFeedback(`/ch/${event.strip.number}/mix/fader`, [
        { type: 'f', value: event.value }
      ]);
    }

    // Clear the timestamp after use
    this.lastSentTimestamps.delete(key);
  }
}
```

This pattern is useful for any bidirectional device that echoes commands.

## 6. Project Structure

```
src/
  index.ts                    Entry point, CLI args, driver factory
  config.ts                   YAML config loader (legacy + hub format)
  hub.ts                      ProductionHub — OSC router + fade engine
  osc-server.ts               UDP OSC server with client tracking
  fade-engine.ts              Device-agnostic 50Hz interpolation
  bridge.ts                   Legacy single-device bridge (deprecated)
  midi-protocol.ts            Avantis MIDI message builders + strip mapping
  midi-parser.ts              Streaming MIDI byte parser with NRPN accumulation
  types/
    osc.d.ts                  Type declarations for the osc npm package
  drivers/
    device-driver.ts          DeviceDriver interface + shared types
    avantis-driver.ts         Allen & Heath Avantis (MIDI TCP)
    chamsys-driver.ts         ChamSys QuickQ 20 (OSC relay)
    obs-driver.ts             OBS Studio (WebSocket v5)
    visca-driver.ts           PTZ cameras (VISCA over IP)
    touchdesigner-driver.ts   TouchDesigner (OSC relay to CHOP)
    index.ts                  Barrel exports + type re-exports
  __tests__/
    midi-protocol.test.ts     146 tests — MIDI message builders
    midi-parser.test.ts       19 tests — MIDI parser state machine
    fade-engine.test.ts       23 tests — Fade engine and easing
    hub.test.ts               25 tests — Prefix routing, fade routing
    chamsys-driver.test.ts    6 tests — OSC relay construction
    visca-driver.test.ts      7 tests — VISCA driver construction
    touchdesigner-driver.test.ts  7 tests — TD relay construction

docs/
  developer-guide.md          This file
```

## 7. Testing

### Running Tests

The project uses Node's built-in `node:test` module. No external test framework is required.

```bash
npm test                    # Run all 233 tests
npm run test:protocol       # MIDI protocol tests only
npm run test:parser         # MIDI parser tests only
npm run test:fade           # Fade engine tests only
npm run test:hub            # Hub routing tests only
npm run test:chamsys        # ChamSys driver tests only
npm run test:visca          # VISCA driver tests only
```

### Test Patterns

**Hub Tests** (`hub.test.ts`): Use mock drivers to verify prefix routing without needing real hardware. Example:

```typescript
test('Hub routes by longest prefix match', () => {
  const hub = new ProductionHub({ osc: { listenAddress: '127.0.0.1', listenPort: 0 } });

  const driver1 = new MockDriver('driver1', '/prefix');
  const driver2 = new MockDriver('driver2', '/prefix/sub');

  hub.addDriver(driver1);
  hub.addDriver(driver2);

  // Message to /prefix/sub/foo should route to driver2, not driver1
  hub.routeOSC('/prefix/sub/foo', []);

  assert(driver2.lastMessage !== undefined);
  assert.strictEqual(driver2.lastMessage.address, '/foo');
});
```

**Driver Tests**: Verify construction, connection state, and graceful handling of OSC commands when disconnected. Example:

```typescript
test('MyDevice handleOSC with invalid transport', () => {
  const driver = new MyDeviceDriver(config, hubContext, false);

  // Should not throw when disconnected
  assert.doesNotThrow(() => {
    driver.handleOSC('/source/1', [{ type: 'i', value: 1 }]);
  });
});
```

### Guidelines

- Write tests for new drivers.
- Test construction, connection state, OSC parsing, and error handling.
- Use mock transports or stubs to avoid depending on live hardware.
- Add tests to the `test` script in `package.json`.

## 8. Transport Patterns

Drivers use different transport protocols depending on the device. Here are the common patterns:

### TCP with Auto-Reconnect (Avantis, VISCA)

Connect via `net.Socket`. On unexpected disconnect, schedule reconnect after 3-5 seconds.

```typescript
import * as net from 'net';

private socket: net.Socket | null = null;
private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

connect(): void {
  this.socket = net.createConnection({ host: this.host, port: this.port });

  this.socket.on('connect', () => {
    this.connected = true;
    this.emit('connected');
  });

  this.socket.on('data', (data: Buffer) => {
    // Parse and handle device response
  });

  this.socket.on('close', () => {
    this.connected = false;
    this.emit('disconnected');
    // Schedule reconnect
    this.reconnectTimer = setTimeout(() => {
      if (this.verbose) console.log('Reconnecting...');
      this.connect();
    }, 3000);
  });

  this.socket.on('error', (err) => {
    this.emit('error', err);
    // Close will be emitted after error, triggering reconnect
  });
}

disconnect(): void {
  if (this.reconnectTimer) {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
  if (this.socket) {
    this.socket.destroy();
    this.socket = null;
  }
  this.connected = false;
}

// send() silently drops messages when disconnected
private send(data: Buffer): void {
  if (this.socket && this.socket.writable) {
    this.socket.write(data);
  }
}
```

### UDP Fire-and-Forget (ChamSys)

Bind to any local port and send datagrams. No connection state to manage (UDP is connectionless).

```typescript
import * as dgram from 'dgram';

private socket: dgram.Socket | null = null;

connect(): void {
  this.socket = dgram.createSocket('udp4');

  this.socket.on('error', (err) => {
    this.emit('error', err);
  });

  this.socket.on('listening', () => {
    this.connected = true;
    this.emit('connected');
  });

  // Bind to any available port for sending
  this.socket.bind(0);
}

disconnect(): void {
  if (this.socket) {
    this.socket.close();
    this.socket = null;
  }
  this.connected = false;
}

isConnected(): boolean {
  // For UDP, we consider "connected" once the socket is ready
  return this.connected;
}

private send(buffer: Buffer): void {
  if (this.socket) {
    this.socket.send(buffer, 0, buffer.length, this.port, this.host, (err) => {
      if (err && this.verbose) console.error(`Send error: ${err.message}`);
    });
  }
}
```

### WebSocket with Auth (OBS)

Connect via the `ws` package. Handle Hello → Identify handshake with optional SHA256 auth. Reconnect on close after 5 seconds.

```typescript
import WebSocket from 'ws';
import * as crypto from 'crypto';

private ws: WebSocket | null = null;
private identified = false;
private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

connect(): void {
  this.ws = new WebSocket(`ws://${this.host}:${this.port}`);

  this.ws.on('open', () => {
    if (this.verbose) console.log('WebSocket connected');
  });

  this.ws.on('message', (data: WebSocket.Data) => {
    const msg = JSON.parse(data.toString());
    this.handleWebSocketMessage(msg);
  });

  this.ws.on('close', () => {
    this.identified = false;
    this.emit('disconnected');
    // Schedule reconnect
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, 5000);
  });

  this.ws.on('error', (err) => {
    this.emit('error', err);
  });
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
  this.identified = false;
}

isConnected(): boolean {
  // For stateful protocols, check both transport and application state
  return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.identified;
}

private handleWebSocketMessage(msg: any): void {
  if (msg.op === 0) {
    // Hello — server sends auth challenge
    const auth = this.computeAuth(msg.d.authentication, msg.d.salt);
    this.ws!.send(JSON.stringify({
      op: 1,  // Identify
      d: {
        rpcVersion: 1,
        authentication: auth,
        eventSubscriptions: 0,
      },
    }));
  } else if (msg.op === 2) {
    // Identified
    this.identified = true;
    this.emit('connected');
  }
}

private computeAuth(challenge: string, salt: string): string {
  // SHA256(password + salt) then SHA256(result + challenge)
  const hash1 = crypto.createHash('sha256').update(this.password + salt).digest('base64');
  const hash2 = crypto.createHash('sha256').update(hash1 + challenge).digest('base64');
  return hash2;
}
```

## 9. Common Patterns and Best Practices

### Extracting Values from OSC Args

OSC arguments may arrive as raw values or wrapped in objects with `{ type, value }`. Provide helpers:

```typescript
private getFloat(args: any[], index: number = 0): number {
  if (!args || args.length <= index) return 0;
  const arg = args[index];
  const val = typeof arg === 'object' && arg.value !== undefined ? arg.value : arg;
  return typeof val === 'number' ? val : parseFloat(val) || 0;
}

private getInt(args: any[], index: number = 0): number {
  const val = this.getFloat(args, index);
  return Math.round(val);
}

private getString(args: any[], index: number = 0): string {
  if (!args || args.length <= index) return '';
  const arg = args[index];
  const val = typeof arg === 'object' && arg.value !== undefined ? arg.value : arg;
  return String(val);
}
```

### Building Feedback Events

Construct feedback events consistently:

```typescript
private emitFeedback(address: string, args: OscArg[]): void {
  this.emit('feedback', { address, args });
}

// Usage:
this.emitFeedback('/ch/1/mix/fader', [
  { type: 'f', value: 0.75 }
]);

// Or with multiple args:
this.emitFeedback('/scene/name', [
  { type: 'i', value: 42 },
  { type: 's', value: 'Verse 1' }
]);
```

### Handling Disconnection Gracefully

Drivers should handle disconnection gracefully and not throw when calls are made while disconnected:

```typescript
handleOSC(address: string, args: any[]): void {
  if (!this.isConnected()) {
    if (this.verbose) {
      console.log(`[MyDevice] Ignored OSC while disconnected: ${address}`);
    }
    return;
  }

  // Process the command
}
```

### Verbose Logging

Use a `verbose` flag for diagnostic output:

```typescript
private verbose: boolean;

constructor(config: MyDeviceConfig, hubContext: HubContext, verbose = false) {
  this.verbose = verbose;
}

connect(): void {
  if (this.verbose) {
    console.log(`[MyDevice] Connecting to ${this.host}:${this.port}`);
  }
  // ...
}
```

## 10. Debugging Tips

### Enable Verbose Logging

```bash
npm run dev -- --verbose
```

This enables logging from the hub and all drivers. Watch the console to see:
- OSC message routing
- Driver connection/disconnection
- Fade engine ticks
- Echo suppression decisions (Avantis)

### Check Configuration

Verify `config.yml` is being parsed correctly:

```typescript
import { loadConfig } from './config';
const cfg = loadConfig();
console.log(JSON.stringify(cfg, null, 2));
```

### Test with OSC Utilities

Send test messages using `oscsend` (from liblo) or a simple Node script:

```bash
oscsend osc.udp://127.0.0.1:9000 /avantis/ch/1/mix/fader f 0.75
```

Or with Python:

```python
import socket
msg = b'/avantis/ch/1/mix/fader\x00\x00\x00\x00,f\x00\x00?\,\x00\x00'
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.sendto(msg, ('127.0.0.1', 9000))
```

### Monitor Feedback

Listen on the OSC server port to verify feedback is being sent:

```bash
oscdump osc.udp://127.0.0.1:9000
```

### Run Tests in Watch Mode

Tests are one-shot by default. Rerun them after code changes:

```bash
npm test
npm run test:mydevice
```

## 11. Performance Considerations

### Fade Engine Tick Rate

The fade engine ticks at 50Hz (20ms intervals). This provides smooth 24-bit interpolation without overwhelming the network. For most devices, this is plenty.

If you need higher resolution, you can:
1. Adjust `TICK_INTERVAL_MS` in `fade-engine.ts` (not recommended; 20ms is a good balance)
2. Implement sub-ticking in your driver (e.g., interpolate locally between hub ticks)

### OSC Client Tracking

The OSC server tracks clients by IP:port and times them out after 60 seconds of silence. This prevents stale entries and unbounded memory growth. If a client goes away but comes back, it's automatically re-registered.

### Concurrent Fades

The fade engine supports unlimited concurrent fades on different keys. Each tick iterates through all active fades, so performance is O(n) where n is the number of concurrent fades. In typical use (5-10 fades), this is negligible.

### Memory

Each active fade holds references to the key, start/end values, start time, and duration. Once a fade completes, it's removed. No memory leaks.

## 12. Troubleshooting Common Issues

### Driver Not Registering

- Check `src/index.ts`: Is the driver type added to the `createDriver()` switch statement?
- Check `config.yml`: Does the device have the correct `type` and `prefix`?
- Enable verbose logging: `npm run dev -- --verbose`

### OSC Messages Not Reaching Driver

- Check the prefix in `config.yml`. The hub matches by longest prefix.
- Send a test message: `oscsend osc.udp://127.0.0.1:9000 /mydevice/test i 1`
- Watch the console for routing logs when verbose is enabled.

### Feedback Not Reaching OSC Client

- Verify the driver is emitting `'feedback'` events with the correct address and args.
- Check that OSC clients are sending something first (so the hub tracks them).
- Verify `oscServer.sendToClients()` is being called (add logging).

### Fades Not Completing

- Check that `handleFadeTick()` is implemented in your driver.
- Verify the fade key being passed to `startFade()` matches what `handleFadeTick()` expects.
- Check the console for "Fade complete" events when verbose is enabled.

### Echo Suppression Creating Feedback Loops

- Increase `echoSuppressionMs` in the config (default 100ms).
- For devices that echo slowly, 100ms may be too short.
- Monitor with verbose logging and adjust based on RTT.

---

For questions or contributions, see the main README.
