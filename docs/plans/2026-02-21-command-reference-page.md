# Command Reference Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Serve a self-contained HTML command reference page at `GET /docs` with context-aware device filtering.

**Architecture:** Static HTML file with inline CSS/JS, served by the existing HTTP server. A new `/api/devices` endpoint provides configured device info so the page can toggle between "My Devices" and "All Commands" views.

**Tech Stack:** HTML, CSS, vanilla JS. No build step, no dependencies.

---

### Task 1: Add `/api/devices` endpoint

**Files:**
- Modify: `src/hub/http-server.ts` (add route + update HttpServerDeps)
- Modify: `src/hub.ts` (pass device list to HTTP server deps)

**Step 1: Add `getDevices` to HttpServerDeps interface**

In `src/hub/http-server.ts`, add to the `HttpServerDeps` interface:

```typescript
getDevices: () => Array<{ type: string; prefix: string }>;
```

**Step 2: Add the route handler**

In `src/hub/http-server.ts`, in `handleRequest()`, add before the dashboard route (`GET /dashboard`):

```typescript
if (method === 'GET' && url === '/api/devices') {
  const devices = this.deps.getDevices();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(devices));
  return;
}
```

**Step 3: Wire up getDevices in hub.ts**

In `src/hub.ts`, in the constructor where `HubHttpServer` deps are built (around line 220), add:

```typescript
getDevices: () => this.config.devices.map(d => ({ type: d.type, prefix: d.prefix })),
```

The config type already has `devices` with `type` and `prefix` fields.

**Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/hub/http-server.ts src/hub.ts
git commit -m "feat: add GET /api/devices endpoint for command reference page"
```

---

### Task 2: Add `/docs` route to serve HTML file

**Files:**
- Modify: `src/hub/http-server.ts` (add route)

**Step 1: Add the `/docs` route**

In `src/hub/http-server.ts`, add after the `/api/devices` route:

```typescript
if (method === 'GET' && url === '/docs') {
  const docsPath = path.join(__dirname, '..', '..', 'docs', 'command-reference.html');
  if (fs.existsSync(docsPath)) {
    fs.readFile(docsPath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Command reference not found. Expected: docs/command-reference.html');
  }
  return;
}
```

Note: `path` and `fs` are already imported from Task 1 (static file serving).

**Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/hub/http-server.ts
git commit -m "feat: add GET /docs route for command reference page"
```

---

### Task 3: Create the command reference HTML page

**Files:**
- Create: `docs/command-reference.html`

This is the main deliverable. Self-contained HTML with inline CSS and JS.

**Step 1: Create the HTML file**

Create `docs/command-reference.html` with the following structure:

**Head:**
- Title: "Production Hub — Command Reference"
- Viewport meta for mobile
- Google Fonts: DM Sans + JetBrains Mono (same as MOD UI)
- Inline CSS (dark theme)

**CSS (inline `<style>`):**
- Body: `background: #0F172A; color: #E2E8F0; font-family: 'DM Sans', sans-serif`
- Top bar: `background: #1E293B; height: 56px; display: flex; align-items: center`
- Toggle switch: styled checkbox, "My Devices" / "All Commands" labels
- Sidebar: `width: 220px; background: #1E293B; position: fixed; left: 0; top: 56px; bottom: 0; overflow-y: auto`
- Sidebar links: `color: #94A3B8; padding: 10px 16px; display: block; text-decoration: none`
- Sidebar active/hover: `color: #E2E8F0; background: #334155`
- Main content: `margin-left: 220px; padding: 24px 32px; max-width: 900px`
- Section headers: `color: #F8FAFC; font-size: 24px; margin-top: 48px; border-bottom: 1px solid #334155; padding-bottom: 8px`
- Tables: `width: 100%; border-collapse: collapse; font-size: 14px; margin: 16px 0`
- Table headers: `background: #1E293B; color: #94A3B8; text-align: left; padding: 8px 12px; font-weight: 500`
- Table cells: `padding: 8px 12px; border-bottom: 1px solid #1E293B`
- Address cells: `font-family: 'JetBrains Mono', monospace; color: #38BDF8` (sky blue)
- Args cells: `font-family: 'JetBrains Mono', monospace; color: #A78BFA` (purple)
- Copy button: `background: transparent; border: 1px solid #334155; color: #64748B; border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 12px`
- Copy button hover: `border-color: #38BDF8; color: #38BDF8`
- Copy button copied state: `color: #4ADE80; border-color: #4ADE80` (green flash)
- Example blocks: `background: #1E293B; border-radius: 8px; padding: 16px; margin: 8px 0; font-family: monospace; font-size: 13px`
- Hidden sections (toggle): `display: none` with `.device-section.hidden` class
- Dimmed sections: `.device-section.dimmed { opacity: 0.3 }` for unconfigured in "My Devices" mode
- Mobile (`@media max-width: 768px`): sidebar hidden, hamburger menu, tables `overflow-x: auto`

**Body structure:**

```html
<!-- Top bar -->
<header>
  <h1>Production Hub — Command Reference</h1>
  <div class="toggle">
    <label>My Devices</label>
    <input type="checkbox" id="showAll">
    <label>All Commands</label>
  </div>
</header>

<!-- Sidebar -->
<nav id="sidebar">
  <a href="#audio" data-type="avantis">Audio (Avantis)</a>
  <a href="#lights" data-type="chamsys">Lights (ChamSys)</a>
  <a href="#cameras" data-type="visca">Cameras (VISCA)</a>
  <a href="#obs" data-type="obs">OBS Studio</a>
  <a href="#td" data-type="touchdesigner">TouchDesigner</a>
  <a href="#global">Global / Hub</a>
</nav>

<!-- Main content -->
<main>
  <!-- Each device section has data-type attribute for filtering -->

  <section id="audio" class="device-section" data-type="avantis">
    <h2>Audio — Avantis</h2>
    <p>Prefix: <code>/avantis</code></p>

    <h3>Faders</h3>
    <table><!-- ch, dca, grp, mix, fxsend, fxrtn, mtx, main faders --></table>

    <h3>Mutes</h3>
    <table><!-- ch, dca, main mutes --></table>

    <h3>Pan</h3>
    <table><!-- ch pan --></table>

    <h3>Timed Fades</h3>
    <table><!-- fade addresses with easing --></table>
    <div class="note">Easing: linear, scurve (default), easein, easeout. Interpolated at 50Hz.</div>

    <h3>Scene Recall</h3>
    <table><!-- scene/recall --></table>

    <h3>Fader Value Reference</h3>
    <table><!-- 0.0=silence, 0.75=-6dB, 1.0=unity --></table>

    <h3>Examples</h3>
    <div class="example">Fade DCA 1 to silence over 3 seconds:<br><code>/avantis/dca/1/fade 0.0 3.0 scurve</code></div>
    <div class="example">Mute channel 5:<br><code>/avantis/ch/5/mix/mute 1</code></div>
    <div class="example">Recall scene 3:<br><code>/avantis/scene/recall 3</code></div>
  </section>

  <section id="lights" class="device-section" data-type="chamsys">
    <h2>Lights — ChamSys QuickQ</h2>
    <p>Prefix: <code>/lights</code></p>
    <table><!-- pb go, fader, flash, pause, release --></table>
    <div class="warning">Use /pb/{N}/go 1 to advance. Do NOT use /pb/{N}/1 — that jumps to cue 1.</div>
    <h3>Examples</h3>
    <div class="example">Advance playback 1:<br><code>/lights/pb/1/go 1</code></div>
    <div class="example">Set playback 2 to 50%:<br><code>/lights/pb/2 0.5</code></div>
  </section>

  <section id="cameras" class="device-section" data-type="visca">
    <h2>Cameras — VISCA PTZ</h2>
    <p>Prefixes: <code>/cam1</code>, <code>/cam2</code>, <code>/cam3</code></p>
    <table><!-- preset recall/store, home, pantilt, zoom, focus, power --></table>
    <h3>Examples</h3>
    <div class="example">Recall preset 2 on camera 1:<br><code>/cam1/preset/recall/2</code></div>
    <div class="example">Zoom camera 2 in at half speed:<br><code>/cam2/zoom/speed 0.5</code></div>
  </section>

  <section id="obs" class="device-section" data-type="obs">
    <h2>OBS Studio</h2>
    <p>Prefix: <code>/obs</code></p>
    <table><!-- scene, preview, stream, record, transition, virtualcam, source --></table>
    <h3>Examples</h3>
    <div class="example">Switch to Live scene:<br><code>/obs/scene/Live</code></div>
    <div class="example">Start streaming:<br><code>/obs/stream/start</code></div>
  </section>

  <section id="td" class="device-section" data-type="touchdesigner">
    <h2>TouchDesigner</h2>
    <p>Prefix: <code>/td</code></p>
    <p>Transparent OSC relay. Addresses forwarded as-is (minus prefix).</p>
    <table><!-- example addresses --></table>
  </section>

  <section id="global" class="device-section">
    <h2>Global / Hub Commands</h2>
    <table><!-- fade/stop, hub/go, hub/stop, hub/back, hub/panic, hub/status --></table>
    <h3>Examples</h3>
    <div class="example">Stop all fades:<br><code>/fade/stop</code></div>
    <div class="example">Fire next cue:<br><code>/hub/go</code></div>
  </section>
</main>
```

**JavaScript (inline `<script>`):**

```javascript
// 1. Fetch /api/devices on load
// 2. Build set of configured device types
// 3. Apply "My Devices" filter by default
// 4. Toggle handler flips between modes
// 5. Copy button: navigator.clipboard.writeText(), flash green
// 6. Sidebar: scroll-spy highlights current section
// 7. Mobile: hamburger toggle for sidebar
```

The full command data is hardcoded in the HTML tables (not fetched). Only the device filter comes from the API.

**Step 2: Verify the page loads**

Run PH: `npm run dev`
Open: `http://localhost:8081/docs`
Expected: Dark-themed page with all command tables, toggle switch, copy buttons work.

**Step 3: Commit**

```bash
git add docs/command-reference.html
git commit -m "feat: add command reference page at /docs"
```

---

### Task 4: Also commit pending changes

There are uncommitted changes from earlier in this session (OSC logging in hub.ts, static file serving in http-server.ts, build script update in package.json). These should be committed before or alongside the new work.

**Step 1: Check status and commit pending changes**

```bash
git status
git add src/hub/http-server.ts src/hub.ts package.json
git commit -m "feat: serve MOD UI from HTTP server + add OSC ingress logging

Serve ui/dist/ as static files from the :8081 HTTP server so npm start
provides the full MOD UI without a separate Vite dev server. Dashboard
moved from / to /dashboard. Build script now runs tsc + ui build.

Add debug-level OSC ingress logging (visible with --verbose / -v)."
```

**Step 2: Push**

```bash
git push
```

---

### Task 5: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add /docs to the HTTP server section**

Add to the hub description near the top:

```
The hub listens on UDP 9000 for OSC, WebSocket 3001 for the MOD UI, and HTTP 8081 for health/dashboard/docs.
```

Add to Key Files or a new section:

```
| `docs/command-reference.html` | OSC command reference served at GET /docs |
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add command reference page to CLAUDE.md"
```
