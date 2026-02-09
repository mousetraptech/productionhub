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
      </tr>
    </thead>
    <tbody id="driversBody">
      <tr><td colspan="7" style="color:var(--text-dimmer)">Loading...</td></tr>
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
    return '<tr>' +
      '<td><span class="status-dot ' + dotClass + '"></span></td>' +
      '<td><span class="driver-name">' + dr.name + '</span></td>' +
      '<td><span class="transport-chip">' + (dr.transportType || '--') + '</span></td>' +
      '<td>' + hostStr + '</td>' +
      '<td style="color:' + statusColor + '">' + statusText + errorInfo + '</td>' +
      '<td>' + (dr.reconnectCount || 0) + '</td>' +
      '<td>' + lastMsg + '</td>' +
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

// Start polling
fetchHealth();
pollTimer = setInterval(fetchHealth, POLL_INTERVAL);
</script>

</body>
</html>`;
}
