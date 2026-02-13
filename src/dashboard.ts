/**
 * Dashboard HTML
 *
 * Single-page status dashboard served at GET /
 * Dark theme matching DMMS booth architecture doc aesthetic.
 * Polls /health every 3s, has a "Run Systems Check" button.
 */

export function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Production Hub</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0c0e14;
    --surface: rgba(255,255,255,0.03);
    --border: rgba(255,255,255,0.06);
    --border-2: rgba(255,255,255,0.10);
    --text: #e2e8f0;
    --text-dim: rgba(255,255,255,0.4);
    --text-dimmer: rgba(255,255,255,0.25);
    --green: #00e5a0;
    --red: #ff6b6b;
    --yellow: #ffc23a;
    --blue: #58a6ff;
    --purple: #a78bfa;
    --mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
    --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--mono);
    padding: 32px;
    min-height: 100vh;
  }

  .header {
    margin-bottom: 24px;
    display: flex;
    align-items: baseline;
    gap: 16px;
    flex-wrap: wrap;
  }
  .header h1 {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.02em;
    background: linear-gradient(135deg, #e2e8f0, #94a3b8);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .header .status-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .status-badge.ok {
    background: rgba(0,229,160,0.12);
    color: var(--green);
    border: 1px solid rgba(0,229,160,0.3);
  }
  .status-badge.degraded {
    background: rgba(255,107,107,0.12);
    color: var(--red);
    border: 1px solid rgba(255,107,107,0.3);
  }
  .header .meta {
    font-size: 11px;
    color: var(--text-dimmer);
  }

  .poll-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--green);
    margin-left: 8px;
    opacity: 0.4;
    transition: opacity 0.15s;
  }
  .poll-dot.active { opacity: 1; }

  .card {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    padding: 16px 20px;
    margin-bottom: 16px;
  }
  .card-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--text-dimmer);
    margin-bottom: 12px;
  }

  /* OSC section */
  .osc-info {
    display: flex;
    gap: 24px;
    flex-wrap: wrap;
    font-size: 12px;
    color: var(--text-dim);
  }
  .osc-info .val { color: var(--text); font-weight: 500; }

  /* Drivers table */
  .drivers-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .drivers-table th {
    text-align: left;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-dimmer);
    padding: 0 8px 8px 0;
    border-bottom: 1px solid var(--border);
  }
  .drivers-table td {
    padding: 8px 8px 8px 0;
    border-bottom: 1px solid var(--border);
    color: var(--text-dim);
    vertical-align: top;
  }
  .drivers-table tr:last-child td { border-bottom: none; }

  .driver-name { color: var(--text); font-weight: 600; }
  .transport-chip {
    display: inline-block;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(255,255,255,0.05);
    color: var(--text-dimmer);
  }
  .status-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 4px;
  }
  .status-dot.up { background: var(--green); box-shadow: 0 0 6px rgba(0,229,160,0.4); }
  .status-dot.down { background: var(--red); box-shadow: 0 0 6px rgba(255,107,107,0.4); }

  .detail-sub {
    font-size: 10px;
    color: var(--text-dimmer);
    margin-top: 2px;
  }
  .error-text { color: var(--red); }

  /* Smoke test */
  .smoke-btn {
    background: rgba(88,166,255,0.08);
    color: var(--blue);
    border: 1px solid rgba(88,166,255,0.25);
    padding: 3px 10px;
    border-radius: 4px;
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .smoke-btn:hover { background: rgba(88,166,255,0.15); border-color: rgba(88,166,255,0.4); }
  .smoke-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .smoke-btn.sent {
    background: rgba(0,229,160,0.08);
    color: var(--green);
    border-color: rgba(0,229,160,0.25);
  }
  .smoke-btn.fail {
    background: rgba(255,107,107,0.08);
    color: var(--red);
    border-color: rgba(255,107,107,0.25);
  }
  .smoke-detail {
    font-size: 10px;
    color: var(--text-dimmer);
    margin-top: 3px;
  }

  /* Systems check */
  .check-section { margin-top: 4px; }
  .check-btn {
    background: rgba(0,229,160,0.08);
    color: var(--green);
    border: 1px solid rgba(0,229,160,0.25);
    padding: 8px 20px;
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .check-btn:hover { background: rgba(0,229,160,0.15); border-color: rgba(0,229,160,0.4); }
  .check-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .check-results {
    margin-top: 16px;
  }
  .check-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 0;
    font-size: 12px;
    color: var(--text-dim);
  }
  .check-icon {
    width: 16px;
    text-align: center;
    font-weight: 700;
    flex-shrink: 0;
  }
  .check-icon.pass { color: var(--green); }
  .check-icon.fail { color: var(--red); }
  .check-icon.warn { color: var(--yellow); }
  .check-name { width: 200px; flex-shrink: 0; color: var(--text); }
  .check-detail { flex: 1; }
  .check-latency { width: 60px; text-align: right; color: var(--text-dimmer); font-size: 11px; }

  .check-summary {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    font-size: 12px;
    display: flex;
    gap: 16px;
    align-items: center;
  }
  .check-summary .overall {
    font-weight: 700;
    text-transform: uppercase;
  }
  .check-summary .overall.pass { color: var(--green); }
  .check-summary .overall.fail { color: var(--red); }

  /* Memory */
  .mem-bar {
    height: 3px;
    border-radius: 2px;
    background: rgba(255,255,255,0.05);
    margin-top: 6px;
    overflow: hidden;
  }
  .mem-bar-fill {
    height: 100%;
    border-radius: 2px;
    background: var(--blue);
    transition: width 0.3s;
  }

  /* Checklist */
  .checklist-items {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .checklist-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .checklist-item:hover {
    background: rgba(255,255,255,0.03);
  }
  .checklist-item input[type="checkbox"] {
    accent-color: var(--green);
    width: 16px;
    height: 16px;
    cursor: pointer;
    pointer-events: none;
  }
  .checklist-item.checked .checklist-label {
    color: var(--text-dimmer);
    text-decoration: line-through;
  }
  .checklist-item .checklist-label {
    color: var(--text);
    user-select: none;
  }
  .checklist-progress {
    float: right;
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
  }
  .checklist-actions {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .checklist-reset-btn {
    background: rgba(255,107,107,0.08);
    color: var(--red);
    border-color: rgba(255,107,107,0.25);
  }
  .checklist-reset-btn:hover {
    background: rgba(255,107,107,0.15);
    border-color: rgba(255,107,107,0.4);
  }
  .checklist-status {
    font-size: 11px;
    font-weight: 600;
  }
  .checklist-status.done { color: var(--green); }
  .checklist-status.pending { color: var(--text-dimmer); }

  /* Cue list panel */
  .cue-controls {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
    flex-wrap: wrap;
    align-items: center;
  }
  .cue-btn {
    background: rgba(0,229,160,0.08);
    color: var(--green);
    border: 1px solid rgba(0,229,160,0.25);
    padding: 6px 16px;
    border-radius: 4px;
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .cue-btn:hover { background: rgba(0,229,160,0.15); border-color: rgba(0,229,160,0.4); }
  .cue-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .cue-btn.stop-btn {
    background: rgba(255,107,107,0.08);
    color: var(--red);
    border-color: rgba(255,107,107,0.25);
  }
  .cue-btn.stop-btn:hover { background: rgba(255,107,107,0.15); border-color: rgba(255,107,107,0.4); }
  .cue-btn.back-btn {
    background: rgba(255,194,58,0.08);
    color: var(--yellow);
    border-color: rgba(255,194,58,0.25);
  }
  .cue-btn.back-btn:hover { background: rgba(255,194,58,0.15); border-color: rgba(255,194,58,0.4); }
  .cue-status-text {
    font-size: 11px;
    color: var(--text-dimmer);
    margin-left: auto;
  }
  .cue-list-items {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .cue-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 12px;
    transition: background 0.15s;
    cursor: pointer;
  }
  .cue-item:hover { background: rgba(255,255,255,0.03); }
  .cue-item.active {
    background: rgba(0,229,160,0.06);
    border-left: 2px solid var(--green);
  }
  .cue-item.past { opacity: 0.5; }
  .cue-item .cue-id {
    width: 80px;
    flex-shrink: 0;
    color: var(--text-dimmer);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }
  .cue-item .cue-name { color: var(--text); flex: 1; }
  .cue-item .cue-actions-count {
    font-size: 10px;
    color: var(--text-dimmer);
  }
  .cue-item .cue-auto {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(167,139,250,0.12);
    color: var(--purple);
  }
  .cue-empty {
    font-size: 12px;
    color: var(--text-dimmer);
    padding: 8px 0;
  }

  /* OSC Monitor */
  .osc-monitor {
    max-height: 200px;
    overflow-y: auto;
    font-size: 11px;
    font-family: var(--mono);
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.1) transparent;
  }
  .osc-monitor::-webkit-scrollbar { width: 4px; }
  .osc-monitor::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
  .osc-entry {
    display: flex;
    gap: 8px;
    padding: 2px 0;
    border-bottom: 1px solid rgba(255,255,255,0.02);
  }
  .osc-entry .osc-time { color: var(--text-dimmer); width: 60px; flex-shrink: 0; }
  .osc-entry .osc-dir { width: 20px; flex-shrink: 0; font-weight: 600; }
  .osc-entry .osc-dir.in { color: var(--blue); }
  .osc-entry .osc-dir.out { color: var(--purple); }
  .osc-entry .osc-addr { color: var(--text); flex: 1; }
  .osc-entry .osc-args { color: var(--text-dimmer); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .osc-monitor-controls {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }
  .osc-toggle {
    font-size: 10px;
    color: var(--text-dimmer);
    cursor: pointer;
    user-select: none;
  }
  .osc-toggle input { accent-color: var(--green); margin-right: 4px; }

  /* WebSocket indicator */
  .ws-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--red);
    margin-left: 8px;
    vertical-align: middle;
  }
  .ws-dot.connected { background: var(--green); }

  .footer {
    margin-top: 24px;
    font-size: 10px;
    color: var(--text-dimmer);
  }

  @media (max-width: 600px) {
    body { padding: 16px; }
    .osc-info { flex-direction: column; gap: 6px; }
    .check-name { width: 120px; }
  }
</style>
</head>
<body>

<div class="header">
  <h1>Production Hub</h1>
  <span class="status-badge ok" id="statusBadge">--</span>
  <span class="meta" id="uptimeMeta"></span>
  <span class="poll-dot" id="pollDot"></span>
</div>

<div class="card">
  <div class="card-title">OSC Server</div>
  <div class="osc-info">
    <span>Port <span class="val" id="oscPort">--</span></span>
    <span>Clients <span class="val" id="oscClients">--</span></span>
    <span>Active fades <span class="val" id="activeFades">--</span></span>
  </div>
</div>

<div class="card">
  <div class="card-title">Drivers</div>
  <table class="drivers-table">
    <thead>
      <tr>
        <th></th>
        <th>Name</th>
        <th>Transport</th>
        <th>Host</th>
        <th>Status</th>
        <th>Reconnects</th>
        <th>Last Message</th>
        <th></th>
      </tr>
    </thead>
    <tbody id="driversBody">
      <tr><td colspan="8" style="color:var(--text-dimmer)">Loading...</td></tr>
    </tbody>
  </table>
</div>

<div class="card">
  <div class="card-title">Systems Check</div>
  <div class="check-section">
    <button class="check-btn" id="checkBtn" onclick="runCheck()">Run Systems Check</button>
    <div class="check-results" id="checkResults"></div>
  </div>
</div>

<div class="card" id="checklistCard" style="display:none">
  <div class="card-title">Pre-Show Checklist <span class="checklist-progress" id="checklistProgress"></span></div>
  <div class="checklist-items" id="checklistItems"></div>
  <div class="checklist-actions">
    <button class="check-btn checklist-reset-btn" id="checklistResetBtn" onclick="resetChecklist()">Reset Checklist</button>
    <span class="checklist-status" id="checklistStatus"></span>
  </div>
</div>

<div class="card" id="cueCard">
  <div class="card-title">Cue List <span class="checklist-progress" id="cueListName">--</span></div>
  <div class="cue-controls">
    <button class="cue-btn back-btn" onclick="cueBack()">BACK</button>
    <button class="cue-btn" onclick="cueGo()">GO</button>
    <button class="cue-btn stop-btn" onclick="cueStop()">STOP</button>
    <span class="cue-status-text" id="cueStatusText">No cue list loaded</span>
  </div>
  <div class="cue-list-items" id="cueListItems">
    <div class="cue-empty">No cue list loaded</div>
  </div>
</div>

<div class="card">
  <div class="card-title">OSC Monitor <span class="ws-dot" id="wsDot"></span></div>
  <div class="osc-monitor-controls">
    <label class="osc-toggle"><input type="checkbox" id="oscMonitorToggle" checked onchange="toggleOscMonitor(this.checked)"> Live</label>
    <button class="smoke-btn" onclick="clearOscLog()">Clear</button>
  </div>
  <div class="osc-monitor" id="oscMonitor"></div>
</div>

<div class="card">
  <div class="card-title">Memory</div>
  <div class="osc-info">
    <span>RSS <span class="val" id="memRss">--</span></span>
    <span>Heap <span class="val" id="memHeap">--</span></span>
  </div>
  <div class="mem-bar"><div class="mem-bar-fill" id="memBar" style="width:0%"></div></div>
</div>

<div class="footer">
  <span id="pidInfo"></span>
</div>

<script>
const POLL_INTERVAL = 3000;
let pollTimer;

function fmt(bytes) {
  if (bytes < 1024*1024) return (bytes/1024).toFixed(0) + ' KB';
  return (bytes/(1024*1024)).toFixed(1) + ' MB';
}

function ago(ts) {
  if (!ts) return '--';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 2) return 'just now';
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  return Math.floor(s/3600) + 'h ago';
}

function flashDot() {
  const dot = document.getElementById('pollDot');
  dot.classList.add('active');
  setTimeout(() => dot.classList.remove('active'), 300);
}

async function fetchHealth() {
  try {
    flashDot();
    const res = await fetch('/health');
    const d = await res.json();
    renderHealth(d);
  } catch(e) {
    document.getElementById('statusBadge').textContent = 'ERROR';
    document.getElementById('statusBadge').className = 'status-badge degraded';
  }
}

function renderHealth(d) {
  // Status badge
  const badge = document.getElementById('statusBadge');
  badge.textContent = d.status.toUpperCase();
  badge.className = 'status-badge ' + d.status;

  // Meta
  document.getElementById('uptimeMeta').textContent =
    'Uptime ' + d.uptimeHuman + ' · PID ' + d.pid;

  // OSC
  document.getElementById('oscPort').textContent = ':' + d.oscPort;
  document.getElementById('oscClients').textContent = d.oscClients;
  document.getElementById('activeFades').textContent = d.fades ? d.fades.activeCount : 0;

  // Drivers
  const tbody = document.getElementById('driversBody');
  tbody.innerHTML = d.drivers.map(function(dr) {
    const dotClass = dr.connected ? 'up' : 'down';
    const statusText = dr.connected ? 'Connected' : 'Disconnected';
    const statusColor = dr.connected ? 'var(--green)' : 'var(--red)';
    const hostStr = dr.host && dr.port ? dr.host + ':' + dr.port : '--';
    const lastMsg = ago(dr.lastMessageReceivedAt);
    let errorInfo = '';
    if (dr.lastError) {
      errorInfo = '<div class="detail-sub error-text">' + dr.lastError + ' (' + ago(dr.lastErrorAt) + ')</div>';
    }
    var safePrefix = dr.prefix.replace(/^\\//, '');
    return '<tr>' +
      '<td><span class="status-dot ' + dotClass + '"></span></td>' +
      '<td><span class="driver-name">' + dr.name + '</span></td>' +
      '<td><span class="transport-chip">' + (dr.transportType || '--') + '</span></td>' +
      '<td>' + hostStr + '</td>' +
      '<td style="color:' + statusColor + '">' + statusText + errorInfo + '</td>' +
      '<td>' + (dr.reconnectCount || 0) + '</td>' +
      '<td>' + lastMsg + '</td>' +
      '<td><button class="smoke-btn" id="smoke-' + safePrefix + '" data-prefix="' + safePrefix + '">Test</button>' +
        '<div class="smoke-detail" id="smoke-detail-' + safePrefix + '"></div></td>' +
    '</tr>';
  }).join('');

  // Memory
  document.getElementById('memRss').textContent = fmt(d.memory.rss);
  document.getElementById('memHeap').textContent = fmt(d.memory.heapUsed) + ' / ' + fmt(d.memory.heapTotal);
  const pct = Math.round(d.memory.heapUsed / d.memory.heapTotal * 100);
  document.getElementById('memBar').style.width = pct + '%';

  // Footer
  document.getElementById('pidInfo').textContent = 'PID ' + d.pid + ' · Polled ' + new Date().toLocaleTimeString();
}

async function runCheck() {
  const btn = document.getElementById('checkBtn');
  const results = document.getElementById('checkResults');
  btn.disabled = true;
  btn.textContent = 'Checking...';
  results.innerHTML = '<div style="color:var(--text-dimmer);font-size:12px;padding:8px 0">Probing devices...</div>';

  try {
    const res = await fetch('/system/check');
    const report = await res.json();
    renderCheck(report);
  } catch(e) {
    results.innerHTML = '<div style="color:var(--red);font-size:12px;padding:8px 0">Check failed: ' + e.message + '</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Systems Check';
  }
}

function renderCheck(report) {
  const results = document.getElementById('checkResults');
  const icons = { pass: '\\u2713', fail: '\\u2717', warn: '!' };

  let html = report.results.map(function(r) {
    const latency = r.latencyMs != null ? r.latencyMs + 'ms' : '';
    return '<div class="check-row">' +
      '<span class="check-icon ' + r.status + '">' + icons[r.status] + '</span>' +
      '<span class="check-name">' + r.name + '</span>' +
      '<span class="check-detail">' + r.detail + '</span>' +
      '<span class="check-latency">' + latency + '</span>' +
    '</div>';
  }).join('');

  html += '<div class="check-summary">' +
    '<span class="overall ' + report.overall + '">' + report.overall + '</span>' +
    '<span style="color:var(--text-dim)">' +
      report.summary.pass + ' pass, ' +
      report.summary.fail + ' fail, ' +
      report.summary.warn + ' warn' +
    '</span>' +
    '<span style="color:var(--text-dimmer)">' + report.durationMs + 'ms</span>' +
  '</div>';

  results.innerHTML = html;
}

// --- Smoke Test ---

async function smokeTest(prefix) {
  var btn = document.getElementById('smoke-' + prefix);
  var detail = document.getElementById('smoke-detail-' + prefix);
  btn.disabled = true;
  btn.textContent = '...';
  btn.className = 'smoke-btn';
  detail.textContent = '';

  try {
    var res = await fetch('/smoke/' + prefix, { method: 'POST' });
    var result = await res.json();

    if (result.error) {
      btn.textContent = 'Fail';
      btn.className = 'smoke-btn fail';
      detail.textContent = result.error;
      detail.style.color = 'var(--red)';
    } else if (!result.connected) {
      btn.textContent = 'Queued';
      btn.className = 'smoke-btn fail';
      detail.textContent = result.label + ' (not connected)';
      detail.style.color = 'var(--yellow)';
    } else {
      btn.textContent = 'Sent';
      btn.className = 'smoke-btn sent';
      detail.textContent = result.label;
      detail.style.color = 'var(--text-dimmer)';
    }
  } catch(e) {
    btn.textContent = 'Fail';
    btn.className = 'smoke-btn fail';
    detail.textContent = e.message;
    detail.style.color = 'var(--red)';
  }

  setTimeout(function() {
    btn.disabled = false;
    btn.textContent = 'Test';
    btn.className = 'smoke-btn';
  }, 3000);
}

// --- Checklist ---

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function fetchChecklist() {
  try {
    var res = await fetch('/checklist');
    var state = await res.json();
    renderChecklist(state);
  } catch(e) {
    document.getElementById('checklistCard').style.display = 'none';
  }
}

function renderChecklist(state) {
  var card = document.getElementById('checklistCard');
  if (!state.items || state.items.length === 0) {
    card.style.display = 'none';
    return;
  }
  card.style.display = '';

  var progress = document.getElementById('checklistProgress');
  progress.textContent = state.checked + ' / ' + state.total;
  progress.style.color = state.allDone ? 'var(--green)' : 'var(--text-dimmer)';

  var container = document.getElementById('checklistItems');
  container.innerHTML = state.items.map(function(item) {
    var checkedClass = item.checked ? 'checked' : '';
    var checkedAttr = item.checked ? 'checked' : '';
    return '<div class="checklist-item ' + checkedClass + '" onclick="toggleChecklistItem(' + item.id + ')">' +
      '<input type="checkbox" ' + checkedAttr + ' tabindex="-1">' +
      '<span class="checklist-label">' + escapeHtml(item.label) + '</span>' +
    '</div>';
  }).join('');

  var status = document.getElementById('checklistStatus');
  if (state.allDone) {
    status.textContent = 'ALL CLEAR';
    status.className = 'checklist-status done';
  } else {
    status.textContent = state.checked + ' of ' + state.total + ' complete';
    status.className = 'checklist-status pending';
  }
}

async function toggleChecklistItem(id) {
  try {
    var res = await fetch('/checklist/toggle/' + id, { method: 'POST' });
    var state = await res.json();
    renderChecklist(state);
  } catch(e) {
    console.error('Toggle failed:', e);
  }
}

async function resetChecklist() {
  if (!confirm('Reset all checklist items?')) return;
  try {
    var res = await fetch('/checklist/reset', { method: 'POST' });
    var state = await res.json();
    renderChecklist(state);
  } catch(e) {
    console.error('Reset failed:', e);
  }
}

// Delegated click handler for smoke test buttons (avoids quote escaping in onclick)
document.addEventListener('click', function(e) {
  var btn = e.target.closest('.smoke-btn');
  if (btn && btn.dataset.prefix) {
    smokeTest(btn.dataset.prefix);
  }
});

// --- Cue List ---

var cueState = null;
var cueList = null;

async function fetchCues() {
  try {
    var res = await fetch('/api/cues');
    var data = await res.json();
    cueState = data.state;
    cueList = data.cueList;
    renderCueList();
  } catch(e) {}
}

function renderCueList() {
  var nameEl = document.getElementById('cueListName');
  var statusEl = document.getElementById('cueStatusText');
  var itemsEl = document.getElementById('cueListItems');

  if (!cueState || !cueState.loaded) {
    nameEl.textContent = '--';
    statusEl.textContent = 'No cue list loaded';
    itemsEl.innerHTML = '<div class="cue-empty">No cue list loaded</div>';
    return;
  }

  nameEl.textContent = cueState.cueListName;
  var runText = cueState.isRunning ? ' (running)' : '';
  statusEl.textContent = 'Cue ' + (cueState.playheadIndex + 1) + ' of ' + cueState.cueCount + runText;

  if (!cueList || !cueList.cues) {
    itemsEl.innerHTML = '<div class="cue-empty">No cues</div>';
    return;
  }

  itemsEl.innerHTML = cueList.cues.map(function(cue, i) {
    var cls = 'cue-item';
    if (i === cueState.playheadIndex) cls += ' active';
    else if (i < cueState.playheadIndex) cls += ' past';
    var autoTag = cue.autoFollow ? '<span class="cue-auto">auto</span>' : '';
    return '<div class="' + cls + '" onclick="cueGoId(\\'' + cue.id + '\\')">' +
      '<span class="cue-id">' + cue.id + '</span>' +
      '<span class="cue-name">' + escapeHtml(cue.name) + '</span>' +
      '<span class="cue-actions-count">' + cue.actions.length + ' actions</span>' +
      autoTag +
    '</div>';
  }).join('');
}

async function cueGo() {
  await fetch('/api/cues/go', { method: 'POST' });
  fetchCues();
}

async function cueGoId(id) {
  await fetch('/api/cues/go/' + id, { method: 'POST' });
  fetchCues();
}

async function cueStop() {
  await fetch('/api/cues/stop', { method: 'POST' });
  fetchCues();
}

async function cueBack() {
  await fetch('/api/cues/back', { method: 'POST' });
  fetchCues();
}

// --- OSC Monitor ---

var oscLog = [];
var MAX_OSC_LOG = 100;
var oscMonitorEnabled = true;

function addOscEntry(entry) {
  if (!oscMonitorEnabled) return;
  oscLog.push(entry);
  if (oscLog.length > MAX_OSC_LOG) oscLog.shift();
  renderOscLog();
}

function renderOscLog() {
  var el = document.getElementById('oscMonitor');
  el.innerHTML = oscLog.map(function(e) {
    var t = new Date(e.timestamp);
    var time = t.toLocaleTimeString([], { hour12: false }) + '.' + String(t.getMilliseconds()).padStart(3, '0');
    var dir = e.direction === 'in' ? 'in' : 'out';
    var argsStr = (e.args || []).map(function(a) { return String(a); }).join(', ');
    return '<div class="osc-entry">' +
      '<span class="osc-time">' + time.slice(-12) + '</span>' +
      '<span class="osc-dir ' + dir + '">' + (dir === 'in' ? '>' : '<') + '</span>' +
      '<span class="osc-addr">' + escapeHtml(e.address) + '</span>' +
      '<span class="osc-args">' + escapeHtml(argsStr) + '</span>' +
    '</div>';
  }).join('');
  el.scrollTop = el.scrollHeight;
}

function clearOscLog() {
  oscLog = [];
  renderOscLog();
}

function toggleOscMonitor(enabled) {
  oscMonitorEnabled = enabled;
  if (dashWs && dashWs.readyState === 1) {
    dashWs.send(JSON.stringify({ type: 'osc-monitor', enabled: enabled }));
  }
}

// --- Dashboard WebSocket ---

var dashWs = null;
var wsReconnectTimer = null;

function connectDashWs() {
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  dashWs = new WebSocket(proto + '//' + location.host);
  var dot = document.getElementById('wsDot');

  dashWs.onopen = function() {
    dot.classList.add('connected');
    // Send OSC monitor preference
    dashWs.send(JSON.stringify({ type: 'osc-monitor', enabled: oscMonitorEnabled }));
  };

  dashWs.onclose = function() {
    dot.classList.remove('connected');
    // Reconnect after 3 seconds
    wsReconnectTimer = setTimeout(connectDashWs, 3000);
  };

  dashWs.onerror = function() {
    dot.classList.remove('connected');
  };

  dashWs.onmessage = function(event) {
    try {
      var msg = JSON.parse(event.data);
      handleWsMessage(msg);
    } catch(e) {}
  };
}

function handleWsMessage(msg) {
  switch(msg.type) {
    case 'osc':
      addOscEntry(msg);
      break;

    case 'driver-state':
      // Immediate refresh of health data
      fetchHealth();
      break;

    case 'cue-event':
      if (msg.state) {
        cueState = msg.state;
        renderCueList();
      } else {
        // Refresh cue data on other events
        fetchCues();
      }
      break;
  }
}

// Start polling and WebSocket
fetchHealth();
fetchChecklist();
fetchCues();
pollTimer = setInterval(function() {
  fetchHealth();
  fetchCues();
}, POLL_INTERVAL);
connectDashWs();
</script>

</body>
</html>`;
}
