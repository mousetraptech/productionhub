# Stream Deck XL Plugin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an Elgato Stream Deck XL plugin that connects to Production Hub's WebSocket endpoints, maps deck profiles to all 32 hardware keys, fires composite actions on key press, and shows live device state feedback via dynamic SVG button images.

**Architecture:** A Stream Deck SDK plugin (`@elgato/streamdeck`) with one `SingletonAction` class handling all 32 keys. A hub client manages two WebSocket connections (ModWS :3001 for commands, DashboardWS :8081 for state). An SVG renderer generates 96x96 button images. State matching logic is ported from the virtual deck frontend.

**Tech Stack:** TypeScript, `@elgato/streamdeck` SDK, rollup bundler, Node.js 20, WebSocket (built-in `ws` in Node)

---

### Task 1: Scaffold Plugin Project

**Files:**
- Create: `streamdeck-plugin/package.json`
- Create: `streamdeck-plugin/tsconfig.json`
- Create: `streamdeck-plugin/rollup.config.mjs`
- Create: `streamdeck-plugin/com.productionhub.deck.sdPlugin/manifest.json`
- Create: `streamdeck-plugin/com.productionhub.deck.sdPlugin/imgs/` (placeholder icons)
- Create: `streamdeck-plugin/src/plugin.ts` (minimal entry)

**Step 1: Create package.json**

```json
{
  "name": "com.productionhub.deck",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "rollup -c",
    "watch": "rollup -c -w"
  },
  "dependencies": {
    "@elgato/streamdeck": "^2.0.0"
  },
  "devDependencies": {
    "@rollup/plugin-node-resolve": "^16.0.0",
    "@rollup/plugin-typescript": "^12.0.0",
    "rollup": "^4.0.0",
    "tslib": "^2.8.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "com.productionhub.deck.sdPlugin/bin",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": true,
    "experimentalDecorators": true
  },
  "include": ["src/**/*.ts"]
}
```

**Step 3: Create rollup.config.mjs**

```javascript
import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";

export default {
  input: "src/plugin.ts",
  output: {
    file: "com.productionhub.deck.sdPlugin/bin/plugin.js",
    format: "esm",
    sourcemap: true,
  },
  plugins: [
    nodeResolve(),
    typescript(),
  ],
};
```

**Step 4: Create manifest.json**

Create `streamdeck-plugin/com.productionhub.deck.sdPlugin/manifest.json`:

```json
{
  "$schema": "https://schemas.elgato.com/streamdeck/plugins/manifest.json",
  "Actions": [
    {
      "Icon": "imgs/action-icon",
      "Name": "PH Button",
      "States": [{ "Image": "imgs/action-icon" }],
      "UUID": "com.productionhub.deck.button",
      "UserTitleEnabled": false
    }
  ],
  "Author": "Production Hub",
  "CodePath": "bin/plugin.js",
  "Description": "Live production control — house lights, stage, cameras, audio, OBS.",
  "Icon": "imgs/plugin-icon",
  "Name": "Production Hub",
  "Nodejs": { "Version": "20", "Debug": "enabled" },
  "OS": [
    { "Platform": "mac", "MinimumVersion": "13" },
    { "Platform": "windows", "MinimumVersion": "10" }
  ],
  "UUID": "com.productionhub.deck",
  "Version": "1.0.0.0",
  "SDKVersion": 2,
  "Software": { "MinimumVersion": "6.6" }
}
```

Note: We'll add the `Profiles` section in Task 7 after creating the pre-built profile.

**Step 5: Create placeholder icon files**

Create minimal SVG icons:
- `streamdeck-plugin/com.productionhub.deck.sdPlugin/imgs/plugin-icon.svg` — 256x256 "PH" text
- `streamdeck-plugin/com.productionhub.deck.sdPlugin/imgs/action-icon.svg` — 20x20 "PH" text

Note: Stream Deck SDK auto-resolves `plugin-icon` to `plugin-icon.svg` / `plugin-icon.png` / `plugin-icon@2x.png`.

**Step 6: Create minimal plugin entry**

Create `streamdeck-plugin/src/plugin.ts`:

```typescript
import streamDeck from "@elgato/streamdeck";

streamDeck.connect();
```

**Step 7: Install dependencies and verify build**

```bash
cd streamdeck-plugin && npm install && npm run build
```

Expected: `com.productionhub.deck.sdPlugin/bin/plugin.js` exists.

**Step 8: Commit**

```
feat(streamdeck): scaffold plugin project with manifest and rollup build
```

---

### Task 2: State Matcher (port from virtual deck)

**Files:**
- Create: `streamdeck-plugin/src/lib/state-matcher.ts`

**Context:** Port `ui/src/components/deck/useDeckButtonState.ts` to plain TypeScript with no React imports. Same logic, same interfaces.

**Step 1: Create state-matcher.ts**

```typescript
export interface ActionCommandRef {
  device: string;
  prefix?: string;
  address: string;
}

export interface ButtonState {
  level: number | null;
  active: boolean;
  live: boolean;
}

interface DeviceStates {
  avantis: any;
  obs: any;
  chamsys: any;
  visca: any;
  touchdesigner: any;
}

interface DeckAction {
  actionId: string;
  osc?: { address: string; args: any[]; label: string };
}

interface DeckButton {
  id: string;
  label: string;
  icon: string;
  color: string;
  actions: DeckAction[];
  mode: 'parallel' | 'series';
  seriesGap: number;
}

export function getDeckButtonState(
  button: DeckButton,
  deviceStates: DeviceStates,
  actionCommands?: Map<string, ActionCommandRef[]>,
): ButtonState {
  // Exact copy of the logic from ui/src/components/deck/useDeckButtonState.ts
  // (the full getDeckButtonState function body — ~120 lines)
  // Copy it verbatim, removing only the React import.
}
```

Copy the COMPLETE function body from `ui/src/components/deck/useDeckButtonState.ts:23-149`.

**Step 2: Verify build**

```bash
cd streamdeck-plugin && npm run build
```

Expected: Builds without errors.

**Step 3: Commit**

```
feat(streamdeck): add state matcher (ported from virtual deck)
```

---

### Task 3: Button Renderer (SVG)

**Files:**
- Create: `streamdeck-plugin/src/lib/button-renderer.ts`

**Step 1: Create button-renderer.ts**

```typescript
import { ButtonState } from './state-matcher';

interface DeckButton {
  id: string;
  label: string;
  icon: string;
  color: string;
  actions: DeckAction[];
  mode: 'parallel' | 'series';
  seriesGap: number;
}

interface DeckAction {
  actionId: string;
  osc?: { address: string; args: any[]; label: string };
}

const SIZE = 96;

/** Render a deck button as a 96x96 SVG string for Stream Deck setImage() */
export function renderButton(
  button: DeckButton | null,
  state: ButtonState,
  firing: boolean,
): string {
  if (!button) return renderEmpty();

  const bg = hexToRgb(button.color);
  const bgOpacity = firing ? 0.5 : 0.15;
  const borderColor = state.live
    ? '#EF4444'
    : state.active
      ? '#10B981'
      : hexWithAlpha(button.color, 0.3);
  const fillHeight = state.level !== null ? Math.round(state.level * SIZE) : 0;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect x="1" y="1" width="${SIZE - 2}" height="${SIZE - 2}" rx="8"
    fill="rgba(${bg.r},${bg.g},${bg.b},${bgOpacity})"
    stroke="${borderColor}" stroke-width="2"/>
  ${fillHeight > 0 ? `<rect x="2" y="${SIZE - fillHeight}" width="${SIZE - 4}" height="${fillHeight - 2}"
    rx="6" fill="rgba(${bg.r},${bg.g},${bg.b},0.6)"/>` : ''}
  <text x="${SIZE / 2}" y="42" text-anchor="middle" font-size="28"
    font-family="sans-serif">${escapeXml(button.icon)}</text>
  <text x="${SIZE / 2}" y="70" text-anchor="middle" font-size="11"
    font-family="sans-serif" fill="#E2E8F0">${escapeXml(truncate(button.label, 12))}</text>
  ${state.live ? `<circle cx="10" cy="10" r="4" fill="#EF4444"/>
  <text x="18" y="13" font-size="7" font-family="sans-serif" fill="#EF4444" font-weight="700">LIVE</text>` : ''}
  ${button.actions.length > 1 ? `<text x="${SIZE - 8}" y="${SIZE - 6}" text-anchor="end" font-size="9"
    font-family="sans-serif" fill="#94A3B8" font-weight="700">${button.actions.length}</text>` : ''}
</svg>`;
}

function renderEmpty(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect x="1" y="1" width="${SIZE - 2}" height="${SIZE - 2}" rx="8"
    fill="#1E293B" stroke="#334155" stroke-width="1"/>
</svg>`;
}

/** Render a "disconnected" state button */
export function renderDisconnected(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect x="1" y="1" width="${SIZE - 2}" height="${SIZE - 2}" rx="8"
    fill="#0F172A" stroke="#334155" stroke-width="1"/>
  <text x="${SIZE / 2}" y="40" text-anchor="middle" font-size="20"
    font-family="sans-serif" fill="#475569" font-weight="700">PH</text>
  <text x="${SIZE / 2}" y="60" text-anchor="middle" font-size="8"
    font-family="sans-serif" fill="#475569">offline</text>
</svg>`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function hexWithAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}
```

**Step 2: Verify build**

```bash
cd streamdeck-plugin && npm run build
```

**Step 3: Commit**

```
feat(streamdeck): add SVG button renderer (96x96, fill bars, LIVE dots)
```

---

### Task 4: Hub Client (WebSocket Connection Manager)

**Files:**
- Create: `streamdeck-plugin/src/lib/hub-client.ts`

**Context:** Manages two WebSocket connections. Uses Node.js built-in WebSocket (available in Node 20). Emits events via a simple EventEmitter pattern.

**Step 1: Create hub-client.ts**

```typescript
import { EventEmitter } from 'events';

interface GridSlot {
  row: number;
  col: number;
  button: {
    id: string;
    label: string;
    icon: string;
    color: string;
    actions: Array<{ actionId: string; osc?: { address: string; args: any[]; label: string } }>;
    mode: 'parallel' | 'series';
    seriesGap: number;
  };
}

interface ActionCategory {
  name: string;
  items: Array<{
    id: string;
    label: string;
    desc: string;
    commands: Array<{ device: string; prefix?: string; address: string }>;
  }>;
}

export interface HubClientConfig {
  hubHost: string;
  modWsPort: number;
  dashboardPort: number;
  profileName: string;
}

const RECONNECT_DELAY = 2000;

/**
 * Manages WebSocket connections to the Production Hub.
 *
 * Events:
 *   profile-loaded(grid: GridSlot[])
 *   actions-loaded(categories: ActionCategory[])
 *   device-state(deviceType: string, state: any)
 *   connected()
 *   disconnected()
 *   fired(buttonId: string)
 */
export class HubClient extends EventEmitter {
  private config: HubClientConfig;
  private modWs: WebSocket | null = null;
  private dashWs: WebSocket | null = null;
  private modReconnect: ReturnType<typeof setTimeout> | null = null;
  private dashReconnect: ReturnType<typeof setTimeout> | null = null;
  private _modConnected = false;
  private _dashConnected = false;

  grid: GridSlot[] = [];
  categories: ActionCategory[] = [];
  deviceStates: Record<string, any> = {};

  constructor(config: HubClientConfig) {
    super();
    this.config = config;
  }

  get connected(): boolean {
    return this._modConnected;
  }

  start(): void {
    this.connectMod();
    this.connectDash();
  }

  stop(): void {
    if (this.modReconnect) clearTimeout(this.modReconnect);
    if (this.dashReconnect) clearTimeout(this.dashReconnect);
    this.modWs?.close();
    this.dashWs?.close();
  }

  fire(button: GridSlot['button']): void {
    this.sendMod({
      type: 'deck-fire',
      buttonId: button.id,
      actions: button.actions,
      mode: button.mode,
      seriesGap: button.seriesGap,
    });
  }

  private connectMod(): void {
    const url = `ws://${this.config.hubHost}:${this.config.modWsPort}`;
    const ws = new WebSocket(url);
    this.modWs = ws;

    ws.addEventListener('open', () => {
      this._modConnected = true;
      this.emit('connected');
      this.sendMod({ type: 'deck-load', name: this.config.profileName });
      this.sendMod({ type: 'get-actions' });
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        switch (msg.type) {
          case 'deck-state':
            this.grid = msg.grid ?? [];
            this.emit('profile-loaded', this.grid);
            break;
          case 'actions':
            this.categories = msg.categories ?? [];
            this.emit('actions-loaded', this.categories);
            break;
          case 'deck-fired':
            this.emit('fired', msg.buttonId);
            break;
        }
      } catch { /* ignore */ }
    });

    ws.addEventListener('close', () => {
      if (this.modWs === ws) {
        this._modConnected = false;
        this.modWs = null;
        this.emit('disconnected');
        this.modReconnect = setTimeout(() => this.connectMod(), RECONNECT_DELAY);
      }
    });

    ws.addEventListener('error', () => ws.close());
  }

  private connectDash(): void {
    const url = `ws://${this.config.hubHost}:${this.config.dashboardPort}`;
    const ws = new WebSocket(url);
    this.dashWs = ws;

    ws.addEventListener('open', () => {
      this._dashConnected = true;
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.type === 'device-state') {
          this.deviceStates[msg.deviceType] = msg.state;
          this.emit('device-state', msg.deviceType, msg.state);
        }
      } catch { /* ignore */ }
    });

    ws.addEventListener('close', () => {
      if (this.dashWs === ws) {
        this._dashConnected = false;
        this.dashWs = null;
        this.dashReconnect = setTimeout(() => this.connectDash(), RECONNECT_DELAY);
      }
    });

    ws.addEventListener('error', () => ws.close());
  }

  private sendMod(msg: Record<string, any>): void {
    if (this.modWs?.readyState === WebSocket.OPEN) {
      this.modWs.send(JSON.stringify(msg));
    }
  }
}
```

**Step 2: Verify build**

```bash
cd streamdeck-plugin && npm run build
```

Note: Node.js 20 has a built-in global `WebSocket`. If the build complains about WebSocket not being defined, add `import { WebSocket } from 'ws'` — but try without first since the SD plugin runtime provides it.

**Step 3: Commit**

```
feat(streamdeck): add hub client (ModWS + DashboardWS connection manager)
```

---

### Task 5: Action Class (PHButton)

**Files:**
- Create: `streamdeck-plugin/src/actions/ph-button.ts`
- Modify: `streamdeck-plugin/src/plugin.ts`

**Context:** This is the core action class. One `SingletonAction` handles all 32 keys. It wires up the hub client, state matcher, and SVG renderer.

**Step 1: Create ph-button.ts**

```typescript
import streamDeck, {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
  type Action,
} from "@elgato/streamdeck";
import { HubClient, HubClientConfig } from '../lib/hub-client';
import { getDeckButtonState, ActionCommandRef, ButtonState } from '../lib/state-matcher';
import { renderButton, renderDisconnected } from '../lib/button-renderer';

interface GridSlot {
  row: number;
  col: number;
  button: {
    id: string;
    label: string;
    icon: string;
    color: string;
    actions: Array<{ actionId: string; osc?: { address: string; args: any[]; label: string } }>;
    mode: 'parallel' | 'series';
    seriesGap: number;
  };
}

function coordKey(row: number, col: number): string {
  return `${row}:${col}`;
}

@action({ UUID: "com.productionhub.deck.button" })
export class PHButton extends SingletonAction {
  private hub: HubClient;
  private actionMap = new Map<string, Action>();
  private actionCommands = new Map<string, ActionCommandRef[]>();
  private lastRendered = new Map<string, string>();

  constructor() {
    super();

    const config: HubClientConfig = {
      hubHost: 'localhost',
      modWsPort: 3001,
      dashboardPort: 8081,
      profileName: 'main',
    };

    this.hub = new HubClient(config);

    this.hub.on('profile-loaded', () => this.renderAll());
    this.hub.on('actions-loaded', () => {
      this.buildCommandLookup();
      this.renderAll();
    });
    this.hub.on('device-state', () => this.renderAll());
    this.hub.on('connected', () => this.renderAll());
    this.hub.on('disconnected', () => this.renderAllDisconnected());

    this.hub.start();
  }

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const coords = (ev.payload as any).coordinates;
    if (!coords) return;
    const key = coordKey(coords.row, coords.column);
    this.actionMap.set(key, ev.action);
    this.renderKey(key, ev.action);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    const coords = (ev.payload as any).coordinates;
    if (!coords) return;
    const key = coordKey(coords.row, coords.column);
    this.actionMap.delete(key);
    this.lastRendered.delete(key);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const coords = (ev.payload as any).coordinates;
    if (!coords) return;

    const button = this.getButton(coords.row, coords.column);
    if (!button) return;

    // Fire
    this.hub.fire(button);

    // Flash animation
    const key = coordKey(coords.row, coords.column);
    const state = this.getButtonState(button);
    const flashSvg = this.toDataUrl(renderButton(button, state, true));
    await ev.action.setImage(flashSvg);

    setTimeout(() => {
      const action = this.actionMap.get(key);
      if (action) this.renderKey(key, action);
    }, 200);
  }

  private getButton(row: number, col: number): GridSlot['button'] | null {
    const slot = this.hub.grid.find(s => s.row === row && s.col === col);
    return slot?.button ?? null;
  }

  private getButtonState(button: GridSlot['button']): ButtonState {
    return getDeckButtonState(
      button as any,
      this.hub.deviceStates as any,
      this.actionCommands,
    );
  }

  private buildCommandLookup(): void {
    this.actionCommands.clear();
    for (const cat of this.hub.categories) {
      for (const item of cat.items) {
        if (item.commands?.length) {
          this.actionCommands.set(item.id, item.commands);
        }
      }
    }
  }

  private renderAll(): void {
    for (const [key, action] of this.actionMap) {
      this.renderKey(key, action);
    }
  }

  private renderAllDisconnected(): void {
    const svg = this.toDataUrl(renderDisconnected());
    for (const [key, action] of this.actionMap) {
      action.setImage(svg);
      this.lastRendered.set(key, svg);
    }
  }

  private renderKey(key: string, action: Action): void {
    if (!this.hub.connected) {
      const svg = this.toDataUrl(renderDisconnected());
      action.setImage(svg);
      this.lastRendered.set(key, svg);
      return;
    }

    const [row, col] = key.split(':').map(Number);
    const button = this.getButton(row, col);
    const state = button
      ? this.getButtonState(button)
      : { level: null, active: false, live: false };
    const svg = this.toDataUrl(renderButton(button, state, false));

    // Skip if unchanged
    if (this.lastRendered.get(key) === svg) return;
    this.lastRendered.set(key, svg);

    action.setImage(svg);
  }

  private toDataUrl(svg: string): string {
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
}
```

**Step 2: Update plugin.ts**

```typescript
import streamDeck from "@elgato/streamdeck";
import { PHButton } from "./actions/ph-button";

streamDeck.actions.registerAction(new PHButton());
streamDeck.connect();
```

**Step 3: Verify build**

```bash
cd streamdeck-plugin && npm run build
```

**Step 4: Commit**

```
feat(streamdeck): add PHButton action class with hub integration
```

---

### Task 6: Shared Types (DRY)

**Context:** The hub client, state matcher, and action class all define their own `DeckButton`, `GridSlot`, etc. types inline. Extract shared types to a single file.

**Files:**
- Create: `streamdeck-plugin/src/lib/types.ts`
- Modify: `streamdeck-plugin/src/lib/state-matcher.ts` — import from types
- Modify: `streamdeck-plugin/src/lib/button-renderer.ts` — import from types
- Modify: `streamdeck-plugin/src/lib/hub-client.ts` — import from types
- Modify: `streamdeck-plugin/src/actions/ph-button.ts` — import from types

**Step 1: Create types.ts**

```typescript
export interface DeckAction {
  actionId: string;
  osc?: { address: string; args: any[]; label: string };
}

export interface DeckButton {
  id: string;
  label: string;
  icon: string;
  color: string;
  actions: DeckAction[];
  mode: 'parallel' | 'series';
  seriesGap: number;
}

export interface GridSlot {
  row: number;
  col: number;
  button: DeckButton;
}

export interface ActionCategory {
  name: string;
  items: Array<{
    id: string;
    label: string;
    desc: string;
    commands: Array<{ device: string; prefix?: string; address: string }>;
  }>;
}

export interface DeviceStates {
  avantis: any;
  obs: any;
  chamsys: any;
  visca: any;
  touchdesigner: any;
}
```

**Step 2: Update all imports in state-matcher.ts, button-renderer.ts, hub-client.ts, ph-button.ts**

Remove inline type definitions and import from `./types` or `../lib/types`.

**Step 3: Verify build**

```bash
cd streamdeck-plugin && npm run build
```

**Step 4: Commit**

```
refactor(streamdeck): extract shared types to lib/types.ts
```

---

### Task 7: Pre-built Stream Deck XL Profile

**Context:** Create the `.streamDeckProfile` directory that auto-installs 32 PH Button actions on all keys. The profile is a directory containing a `manifest.json` with actions keyed by `"col,row"` coordinates.

Rather than reverse-engineering the profile format, we'll create the profile by:
1. Build and link the plugin into Stream Deck app
2. Manually place 32 PH Button actions on an XL layout
3. Export the profile
4. Bundle the exported profile in the plugin

However, if the Stream Deck app is not available during development, we can skip the pre-built profile for now and add instructions for manual setup.

**Files:**
- Modify: `streamdeck-plugin/com.productionhub.deck.sdPlugin/manifest.json` — add Profiles array (when profile is available)
- Create: `streamdeck-plugin/README.md` — setup instructions

**Step 1: Create README.md**

```markdown
# Production Hub — Stream Deck XL Plugin

## Development Setup

1. Install the Stream Deck CLI:
   ```bash
   npm install -g @elgato/cli
   ```

2. Build the plugin:
   ```bash
   cd streamdeck-plugin
   npm install
   npm run build
   ```

3. Link into Stream Deck app:
   ```bash
   streamdeck link com.productionhub.deck.sdPlugin
   ```

4. Restart the Stream Deck app.

5. In the Stream Deck app, drag 32 "PH Button" actions onto all keys of your XL layout.

## Configuration

The plugin connects to Production Hub at localhost:3001 (ModWS) and localhost:8081 (DashboardWS).
It loads the "main" deck profile by default.

## Pre-built Profile

To create a bundled profile that auto-installs:
1. Set up the 32-key layout in Stream Deck app
2. Export the profile (Preferences → Profiles → right-click → Export)
3. Place the `.streamDeckProfile` file in the `com.productionhub.deck.sdPlugin/` directory
4. Add to manifest.json Profiles array
```

**Step 2: Commit**

```
docs(streamdeck): add README with setup instructions
```

---

### Task 8: End-to-End Verification

**Step 1: Build the plugin**

```bash
cd streamdeck-plugin && npm run build
```

Expected: `com.productionhub.deck.sdPlugin/bin/plugin.js` produced with no errors.

**Step 2: Verify the output bundle**

Check that the bundle contains all modules:
```bash
grep -c "renderButton\|HubClient\|getDeckButtonState\|PHButton" com.productionhub.deck.sdPlugin/bin/plugin.js
```

Expected: All 4 identifiers present.

**Step 3: Link into Stream Deck (if available)**

```bash
streamdeck link com.productionhub.deck.sdPlugin
```

Restart Stream Deck app. Verify:
- Plugin appears in the action list
- "PH Button" action can be dragged onto keys
- Keys show "PH / offline" when hub is not running
- Keys show button images when hub is running with a loaded profile

**Step 4: Test with hub running**

1. Start hub: `npm run dev` (in project root)
2. Ensure a deck profile exists: check `decks/main.json` (or whatever profile name)
3. Place PH Button on a key, press it
4. Verify: hub logs show `deck-fire` received

**Step 5: Commit**

```
chore(streamdeck): verify end-to-end build and plugin loading
```

---

## Execution Notes

- Tasks 1-4 are independent and can be parallelized
- Task 5 depends on 1-4 (wires everything together)
- Task 6 is a cleanup pass (depends on 5)
- Task 7 is documentation (independent)
- Task 8 is final verification (depends on all)

Total new files: ~7 source files + manifest + README
Estimated implementation: ~400 lines of TypeScript
