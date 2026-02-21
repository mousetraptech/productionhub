# Emulator Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add PH cue list panel to the emulator UI, tiled view for all panels, and `--emulate-all` CLI flag that auto-launches the emulator.

**Architecture:** The PH panel connects to the hub's existing DashboardWebSocket (port 8081) to receive cue sequencer state. The tiled view is a CSS grid layout toggled via `?view=tiled` query param on the existing emulator page. The `--emulate-all` flag in the hub spawns the production-emulator as a child process before creating drivers.

**Tech Stack:** Vanilla JS (production-emulator has zero dependencies), Node.js child_process, CSS Grid.

**Repos:**
- Production emulator: `/Users/dave/projects/production-emulator`
- Production hub: `/Users/dave/projects/productionhub`

---

## Task 1: PH Panel — HTML Template + Tab

Add the Production Hub tab button and panel section to the emulator's index.html.

**Files:**
- Modify: `/Users/dave/projects/production-emulator/public/index.html`

**Step 1: Add QLab + PH status cards to the header**

In `index.html`, after the VISCA status card (line 37), add:

```html
          <article class="status-card">
            <span>QLab SFX UDP</span>
            <strong id="qlab-sfx-port">53100</strong>
          </article>
          <article class="status-card">
            <span>QLab Show UDP</span>
            <strong id="qlab-show-port">53101</strong>
          </article>
```

Also update the subtitle (line 15) to:
```html
          <p>Avantis MIDI + QuickQ OSC + OBS WS + VISCA + QLab OSC + PH Cue List</p>
```

**Step 2: Add tab buttons for QLab and PH**

After the Protocol Log tab button (line 46), add:

```html
        <button id="tab-qlab" class="tab" type="button" data-target="qlab-panel">QLab</button>
        <button id="tab-ph" class="tab" type="button" data-target="ph-panel">Production Hub</button>
```

**Step 3: Add QLab panel section**

After the logs-panel section (before `</main>`), add:

```html
      <section id="qlab-panel" class="panel">
        <header class="panel-head">
          <h2>QLab Workspaces</h2>
          <p>OSC on ports <code>53100</code> (SFX) / <code>53101</code> (Show)</p>
        </header>
        <div class="qlab-workspaces">
          <div class="qlab-workspace" id="qlab-sfx-workspace">
            <h3>SFX (Utility)</h3>
            <div class="qlab-playhead">Playhead: <strong class="qlab-playhead-name">—</strong></div>
            <div class="qlab-running">Running: <span class="qlab-running-list">none</span></div>
            <div class="qlab-cue-list"></div>
          </div>
          <div class="qlab-workspace" id="qlab-show-workspace">
            <h3>Show (Sunday Service)</h3>
            <div class="qlab-playhead">Playhead: <strong class="qlab-playhead-name">—</strong></div>
            <div class="qlab-running">Running: <span class="qlab-running-list">none</span></div>
            <div class="qlab-cue-list"></div>
          </div>
        </div>
      </section>
```

**Step 4: Add PH panel section**

After the QLab panel:

```html
      <section id="ph-panel" class="panel">
        <header class="panel-head">
          <h2>Production Hub</h2>
          <p>Cue Sequencer — connects to hub DashboardWS on <code>:8081</code></p>
          <div class="panel-meta">
            <span class="ph-connection-status" id="ph-connection-status">Disconnected</span>
          </div>
        </header>
        <div class="ph-transport">
          <button id="ph-go-btn" class="ph-go-btn" type="button" disabled>GO</button>
          <div class="ph-show-info">
            <div>Show: <strong id="ph-cuelist-name">—</strong></div>
            <div>Cues: <strong id="ph-cue-count">0</strong></div>
            <div id="ph-running-indicator" class="ph-running-indicator"></div>
          </div>
        </div>
        <div id="ph-cue-table" class="ph-cue-table">
          <div class="ph-placeholder">Start the hub to see cue state</div>
        </div>
      </section>
```

**Step 5: Verify page loads**

Run the emulator: `cd /Users/dave/projects/production-emulator && node server.js`
Open: `http://localhost:8080`
Expected: New QLab and Production Hub tabs appear, clicking them shows the empty panels.

**Step 6: Commit**

```bash
cd /Users/dave/projects/production-emulator
git add public/index.html
git commit -m "feat: add QLab and PH panel HTML templates"
```

---

## Task 2: PH Panel — CSS Styles

**Files:**
- Modify: `/Users/dave/projects/production-emulator/public/styles.css`

**Step 1: Add PH panel styles**

Append to `styles.css`:

```css
/* ─── QLab Panel ─── */

.qlab-workspaces {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding: 16px 0;
}

.qlab-workspace {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 16px;
}

.qlab-workspace h3 {
  margin: 0 0 12px;
  font-size: 14px;
  color: #94a3b8;
}

.qlab-playhead,
.qlab-running {
  font-size: 13px;
  color: #64748b;
  margin-bottom: 8px;
}

.qlab-playhead strong {
  color: #22c55e;
}

.qlab-cue-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 300px;
  overflow-y: auto;
}

.qlab-cue-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
  color: #94a3b8;
}

.qlab-cue-row.is-playhead {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.qlab-cue-row.is-running {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}

.qlab-cue-number {
  min-width: 40px;
  color: #475569;
}

.qlab-cue-name {
  flex: 1;
}

.qlab-cue-type {
  color: #475569;
  font-size: 11px;
}

/* ─── PH Panel ─── */

.ph-transport {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 16px 0;
}

.ph-go-btn {
  background: #16a34a;
  color: white;
  border: none;
  border-radius: 8px;
  padding: 16px 40px;
  font-size: 20px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
  text-transform: uppercase;
  letter-spacing: 2px;
}

.ph-go-btn:hover:not(:disabled) {
  background: #22c55e;
  transform: scale(1.02);
}

.ph-go-btn:disabled {
  background: #1e293b;
  color: #475569;
  cursor: not-allowed;
}

.ph-show-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: #64748b;
}

.ph-show-info strong {
  color: #e2e8f0;
}

.ph-running-indicator {
  display: none;
  color: #22c55e;
  font-weight: 600;
  font-size: 12px;
}

.ph-running-indicator.is-running {
  display: block;
}

.ph-running-indicator.is-running::before {
  content: '▶ RUNNING';
}

.ph-connection-status {
  color: #ef4444;
  font-size: 12px;
  font-weight: 600;
}

.ph-connection-status.is-connected {
  color: #22c55e;
}

.ph-cue-table {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 500px;
  overflow-y: auto;
}

.ph-placeholder {
  color: #475569;
  font-size: 14px;
  text-align: center;
  padding: 40px 0;
}

.ph-cue-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
  color: #94a3b8;
  transition: background 0.15s;
}

.ph-cue-row.is-playhead {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
  font-weight: 600;
}

.ph-cue-row.is-playhead::before {
  content: '▶';
  margin-right: 4px;
}

.ph-cue-row.is-fired {
  background: rgba(34, 197, 94, 0.08);
  color: #22c55e;
}

@keyframes cue-flash {
  0% { background: rgba(34, 197, 94, 0.4); }
  100% { background: rgba(34, 197, 94, 0.15); }
}

.ph-cue-row.is-firing {
  animation: cue-flash 0.5s ease-out;
}

.ph-cue-id {
  min-width: 80px;
  color: #475569;
}

.ph-cue-name {
  flex: 1;
}

.ph-cue-actions {
  color: #475569;
  font-size: 11px;
}

.ph-cue-auto {
  color: #f59e0b;
  font-size: 10px;
}
```

**Step 2: Verify styles render**

Restart emulator, open browser, click PH tab.
Expected: GO button is styled green (disabled), placeholder text centered.

**Step 3: Commit**

```bash
cd /Users/dave/projects/production-emulator
git add public/styles.css
git commit -m "feat: add QLab and PH panel styles"
```

---

## Task 3: QLab Panel — JavaScript Rendering

Wire the QLab panel to receive SSE events and render workspace state.

**Files:**
- Modify: `/Users/dave/projects/production-emulator/public/app.js`
- Modify: `/Users/dave/projects/production-emulator/server.js` (add SSE events for QLab state)

**Step 1: Add QLab SSE events to server.js**

The server already has QLab workspaces in state but doesn't broadcast SSE events for them. In the QLab OSC handler section (where `/go`, `/stop` etc are processed), after updating workspace state, add:

```javascript
broadcastSSE('qlab-workspace', { workspace: { name: ws.name, port: portNum, playheadIndex: ws.playheadIndex, cues: ws.cues, runningCues: ws.runningCues, paused: ws.paused } });
```

Also include QLab state in the initial `/api/state` response.

**Step 2: Add QLab rendering to app.js**

At the top of app.js, add DOM refs:

```javascript
const qlabSfxWorkspace = document.getElementById('qlab-sfx-workspace');
const qlabShowWorkspace = document.getElementById('qlab-show-workspace');
const qlabSfxPort = document.getElementById('qlab-sfx-port');
const qlabShowPort = document.getElementById('qlab-show-port');
```

Add render function:

```javascript
function renderQlabWorkspace(data) {
  const container = data.port === 53100 ? qlabSfxWorkspace : qlabShowWorkspace;
  if (!container) return;

  container.querySelector('.qlab-playhead-name').textContent =
    data.playheadIndex >= 0 && data.cues[data.playheadIndex]
      ? data.cues[data.playheadIndex].name
      : '—';

  container.querySelector('.qlab-running-list').textContent =
    data.runningCues.length > 0 ? data.runningCues.join(', ') : 'none';

  const listEl = container.querySelector('.qlab-cue-list');
  listEl.innerHTML = '';
  for (let i = 0; i < data.cues.length; i++) {
    const cue = data.cues[i];
    const row = document.createElement('div');
    row.className = 'qlab-cue-row';
    if (i === data.playheadIndex) row.classList.add('is-playhead');
    if (data.runningCues.includes(cue.name)) row.classList.add('is-running');
    row.innerHTML = `<span class="qlab-cue-number">${cue.number}</span><span class="qlab-cue-name">${cue.name}</span><span class="qlab-cue-type">${cue.type}</span>`;
    listEl.appendChild(row);
  }
}
```

In `connectEvents()`, add:

```javascript
events.addEventListener('qlab-workspace', (event) => {
  const payload = JSON.parse(event.data);
  renderQlabWorkspace(payload.workspace);
});
```

In `init()`, add QLab state rendering from initial state fetch.

**Step 3: Test QLab panel**

Start emulator and hub (with emulate mode for QLab). Send `/sfx/go` OSC.
Expected: QLab panel shows cue list, playhead advances.

**Step 4: Commit**

```bash
cd /Users/dave/projects/production-emulator
git add public/app.js server.js
git commit -m "feat: add QLab panel rendering with SSE events"
```

---

## Task 4: PH Panel — Hub WebSocket Connection + Rendering

Wire the PH panel to connect to the hub's DashboardWebSocket and render cue state.

**Files:**
- Modify: `/Users/dave/projects/production-emulator/public/app.js`

**Step 1: Add PH DOM refs**

```javascript
const phConnectionStatus = document.getElementById('ph-connection-status');
const phGoBtn = document.getElementById('ph-go-btn');
const phCuelistName = document.getElementById('ph-cuelist-name');
const phCueCount = document.getElementById('ph-cue-count');
const phRunningIndicator = document.getElementById('ph-running-indicator');
const phCueTable = document.getElementById('ph-cue-table');
```

**Step 2: Add hub WebSocket connection**

```javascript
let hubWs = null;

function connectToHub() {
  try {
    hubWs = new WebSocket('ws://localhost:8081');
  } catch (_) {
    return;
  }

  hubWs.onopen = () => {
    phConnectionStatus.textContent = 'Connected';
    phConnectionStatus.classList.add('is-connected');
    phGoBtn.disabled = false;
  };

  hubWs.onclose = () => {
    phConnectionStatus.textContent = 'Disconnected';
    phConnectionStatus.classList.remove('is-connected');
    phGoBtn.disabled = true;
    // Reconnect after 3s
    setTimeout(connectToHub, 3000);
  };

  hubWs.onerror = () => {
    hubWs.close();
  };

  hubWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'cue-event') {
        handleHubCueEvent(msg);
      }
    } catch (_) {}
  };
}
```

**Step 3: Add cue state rendering**

```javascript
let phState = { cues: [], playheadIndex: -1, isRunning: false, cueListName: '', cueCount: 0 };

function handleHubCueEvent(msg) {
  if (msg.event === 'state' && msg.data?.state) {
    const s = msg.data.state;
    phState.cueListName = s.cueListName || '—';
    phState.cueCount = s.cueCount || 0;
    phState.playheadIndex = s.playheadIndex ?? -1;
    phState.isRunning = s.isRunning || false;
    // Cues come with the full state only on initial load
    if (s.cues) phState.cues = s.cues;
    renderPhPanel();
  } else if (msg.event === 'cue-fired' && msg.data) {
    phState.playheadIndex = msg.data.index;
    phState.isRunning = true;
    renderPhPanel();
    // Flash the fired cue row
    const rows = phCueTable.querySelectorAll('.ph-cue-row');
    if (rows[msg.data.index]) {
      rows[msg.data.index].classList.add('is-firing');
      setTimeout(() => rows[msg.data.index]?.classList.remove('is-firing'), 500);
    }
  } else if (msg.event === 'cue-complete') {
    phState.isRunning = false;
    renderPhPanel();
  }
}

function renderPhPanel() {
  phCuelistName.textContent = phState.cueListName || '—';
  phCueCount.textContent = String(phState.cueCount);
  phRunningIndicator.classList.toggle('is-running', phState.isRunning);

  if (phState.cues.length === 0) {
    phCueTable.innerHTML = '<div class="ph-placeholder">No cue list loaded</div>';
    return;
  }

  phCueTable.innerHTML = '';
  for (let i = 0; i < phState.cues.length; i++) {
    const cue = phState.cues[i];
    const row = document.createElement('div');
    row.className = 'ph-cue-row';
    if (i === phState.playheadIndex) row.classList.add('is-playhead');
    row.innerHTML = [
      `<span class="ph-cue-id">${cue.id}</span>`,
      `<span class="ph-cue-name">${cue.name}</span>`,
      `<span class="ph-cue-actions">${cue.actions?.length || 0} actions</span>`,
      cue.autoFollow ? '<span class="ph-cue-auto">AUTO</span>' : '',
    ].join('');
    phCueTable.appendChild(row);
  }
}
```

**Step 4: Add GO button OSC send**

The GO button sends `/hub/go` to the hub's OSC port (9000) via UDP. Since the browser can't send UDP directly, route through the emulator's REST API:

In `app.js`:
```javascript
phGoBtn.addEventListener('click', async () => {
  await api('/api/hub/go', { method: 'POST', body: '{}' });
});
```

In `server.js`, add a new API endpoint that sends OSC `/hub/go` to the hub:

```javascript
// POST /api/hub/go — send /hub/go OSC to the hub
if (method === 'POST' && url === '/api/hub/go') {
  const msg = buildOscMessage('/hub/go', [{ type: 'i', value: 1 }]);
  oscSocket.send(msg, 0, msg.length, 9000, '127.0.0.1');
  return jsonResponse(res, { sent: true });
}
```

**Step 5: Initialize hub connection in init()**

At the end of the `init()` function:
```javascript
connectToHub();
```

**Step 6: Test PH panel end-to-end**

1. Start emulator: `cd /Users/dave/projects/production-emulator && node server.js`
2. Start hub: `cd /Users/dave/projects/productionhub && npm run dev -- --emulate-all` (or manually with emulate flags)
3. Load a cue list in the hub
4. Open emulator UI, click PH tab
5. Expected: Cue list renders, playhead at -1, GO button enabled
6. Click GO
7. Expected: Playhead advances, row flashes green

**Step 7: Commit**

```bash
cd /Users/dave/projects/production-emulator
git add public/app.js server.js
git commit -m "feat: add PH cue list panel with hub WS connection and GO button"
```

---

## Task 5: Tiled View

Add `?view=tiled` support that shows all panels in a CSS grid.

**Files:**
- Modify: `/Users/dave/projects/production-emulator/public/index.html`
- Modify: `/Users/dave/projects/production-emulator/public/app.js`
- Modify: `/Users/dave/projects/production-emulator/public/styles.css`

**Step 1: Add tiled view CSS**

Append to `styles.css`:

```css
/* ─── Tiled View ─── */

body.view-tiled .mode-tabs {
  display: none;
}

body.view-tiled .panel {
  display: block !important;
}

body.view-tiled main {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

body.view-tiled .tiled-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(480px, 1fr));
  gap: 12px;
}

body.view-tiled .tiled-grid .panel {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.2);
  max-height: 600px;
  overflow-y: auto;
}

body.view-tiled #logs-panel {
  grid-column: 1 / -1;
}

.view-toggle {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #94a3b8;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.view-toggle:hover {
  color: #e2e8f0;
  border-color: rgba(255, 255, 255, 0.3);
}
```

**Step 2: Add view toggle button to header**

In `index.html`, inside the topbar `<header>` after the status-cards div:

```html
        <button id="view-toggle" class="view-toggle" type="button">Tiled View</button>
```

**Step 3: Add tiled grid wrapper**

In `index.html`, wrap all the `<section>` panels in a `<div id="tiled-grid">`:

```html
      <div id="tiled-grid">
        <section id="avantis-panel" ...>...</section>
        <section id="quickq-panel" ...>...</section>
        <section id="obs-panel" ...>...</section>
        <section id="visca-panel" ...>...</section>
        <section id="qlab-panel" ...>...</section>
        <section id="ph-panel" ...>...</section>
        <section id="logs-panel" ...>...</section>
      </div>
```

**Step 4: Add view toggle JS**

In `app.js`:

```javascript
const viewToggle = document.getElementById('view-toggle');
const tiledGrid = document.getElementById('tiled-grid');

function setViewMode(mode) {
  if (mode === 'tiled') {
    document.body.classList.add('view-tiled');
    tiledGrid.classList.add('tiled-grid');
    viewToggle.textContent = 'Tab View';
    history.replaceState(null, '', '?view=tiled');
  } else {
    document.body.classList.remove('view-tiled');
    tiledGrid.classList.remove('tiled-grid');
    viewToggle.textContent = 'Tiled View';
    history.replaceState(null, '', '?view=tabs');
    // Re-select active tab's panel
    const activeTab = document.querySelector('.tab.is-active');
    if (activeTab) selectPanel(activeTab.dataset.target);
  }
}

viewToggle.addEventListener('click', () => {
  const isTiled = document.body.classList.contains('view-tiled');
  setViewMode(isTiled ? 'tabs' : 'tiled');
});

// Initialize from URL
const urlView = new URLSearchParams(window.location.search).get('view');
if (urlView === 'tiled') {
  setViewMode('tiled');
}
```

**Step 5: Test tiled view**

Open `http://localhost:8080?view=tiled`
Expected: All panels visible in a responsive grid. Protocol log spans full width. Toggle button switches to "Tab View". Clicking it returns to tabbed mode.

**Step 6: Commit**

```bash
cd /Users/dave/projects/production-emulator
git add public/index.html public/app.js public/styles.css
git commit -m "feat: add tiled view with ?view=tiled query param"
```

---

## Task 6: `--emulate-all` CLI Flag

Add the flag to the hub that sets all devices to emulate and auto-launches the production-emulator.

**Files:**
- Modify: `/Users/dave/projects/productionhub/src/index.ts`
- Modify: `/Users/dave/projects/productionhub/package.json`

**Step 1: Add `--emulate-all` to parseArgs**

In `src/index.ts`, in the `parseArgs()` switch statement, add a case:

```typescript
      case '--emulate-all':
        overrides['emulateAll'] = true;
        break;
```

**Step 2: Add emulator launcher function**

After the `EMULATOR_DEFAULTS` constant:

```typescript
import { spawn, ChildProcess } from 'child_process';

let emulatorProcess: ChildProcess | null = null;

function findEmulatorPath(): string | null {
  const candidates = [
    process.env.EMULATOR_PATH,
    path.join(process.cwd(), '..', 'production-emulator'),
    path.join(__dirname, '..', '..', 'production-emulator'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'server.js'))) {
      return candidate;
    }
  }
  return null;
}

async function launchEmulator(): Promise<void> {
  const emulatorPath = findEmulatorPath();
  if (!emulatorPath) {
    console.error('[Emulator] Cannot find production-emulator. Set EMULATOR_PATH or place it at ../production-emulator');
    process.exit(1);
  }

  console.log(`[Emulator] Launching from ${emulatorPath}`);
  emulatorProcess = spawn('node', ['server.js'], {
    cwd: emulatorPath,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  emulatorProcess.stdout?.on('data', (data: Buffer) => {
    for (const line of data.toString().split('\n').filter(Boolean)) {
      console.log(`[emulator] ${line}`);
    }
  });

  emulatorProcess.stderr?.on('data', (data: Buffer) => {
    for (const line of data.toString().split('\n').filter(Boolean)) {
      console.error(`[emulator] ${line}`);
    }
  });

  emulatorProcess.on('exit', (code) => {
    console.log(`[Emulator] Process exited with code ${code}`);
    emulatorProcess = null;
  });

  // Wait for HTTP port to respond
  const maxWait = 5000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      await fetch('http://127.0.0.1:8080');
      console.log('[Emulator] Ready on http://127.0.0.1:8080');
      return;
    } catch (_) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  console.warn('[Emulator] Timeout waiting for emulator — continuing anyway');
}

function stopEmulator(): void {
  if (emulatorProcess) {
    emulatorProcess.kill();
    emulatorProcess = null;
  }
}
```

**Step 3: Wire into main()**

In `main()`, after config is loaded but before the driver creation loop, add:

```typescript
  const emulateAll = overrides['emulateAll'] === true;

  if (emulateAll) {
    for (const device of config.devices) {
      device.emulate = true;
    }
    await launchEmulator();
  }
```

This means `main()` needs to become `async`. Change `function main()` to `async function main()`.

**Step 4: Wire shutdown**

In the existing `process.on('SIGINT', ...)` and `process.on('SIGTERM', ...)` handlers, add `stopEmulator()` before the hub stop call.

**Step 5: Add npm script**

In `package.json`, add to scripts:

```json
"dev:emulate": "ts-node --files src/index.ts --emulate-all"
```

**Step 6: Test**

Run: `npm run dev:emulate`
Expected:
1. Emulator launches automatically, logs appear with `[emulator]` prefix
2. "Ready on http://127.0.0.1:8080" message
3. All drivers connect to localhost emulator ports
4. Ctrl+C kills both hub and emulator

**Step 7: Commit**

```bash
cd /Users/dave/projects/productionhub
git add src/index.ts package.json
git commit -m "feat: add --emulate-all flag with auto-launch of production-emulator"
```

---

## Task 7: Update Docs

**Files:**
- Modify: `/Users/dave/projects/productionhub/CLAUDE.md`
- Modify: `/Users/dave/projects/production-emulator/CLAUDE.md`

**Step 1: Update hub CLAUDE.md**

Add to Quick Start section:
```markdown
npm run dev:emulate  # Start with all devices in emulate mode + auto-launch emulator
```

Add to Configuration Notes:
```markdown
- `--emulate-all` CLI flag sets all devices to emulate mode and auto-launches the production-emulator process. Requires `../production-emulator` or `EMULATOR_PATH` env var.
```

**Step 2: Update emulator CLAUDE.md**

Add to the web UI section:
- QLab tab: shows workspace state for SFX and Show workspaces
- Production Hub tab: connects to hub DashboardWS (port 8081), shows cue sequencer state, GO button
- Tiled view: `?view=tiled` shows all panels in a CSS grid

**Step 3: Commit both**

```bash
cd /Users/dave/projects/productionhub
git add CLAUDE.md
git commit -m "docs: add --emulate-all and tiled view to CLAUDE.md"

cd /Users/dave/projects/production-emulator
git add CLAUDE.md
git commit -m "docs: add QLab panel, PH panel, and tiled view docs"
```
