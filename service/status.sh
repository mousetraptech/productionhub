#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
#  Production Hub — Status Check
#
#  Quick status overview: launchd state, process health,
#  health endpoint response, and recent log lines.
#
#  Usage:
#    ./service/status.sh
# ──────────────────────────────────────────────────────────────

set -euo pipefail

HUB_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HEALTH_PORT="${HEALTH_PORT:-8080}"

echo ""
echo "  Production Hub — Status"
echo "  ─────────────────────────────────────────"

# ── launchd ───────────────────────────────────────────────────

echo ""
echo "  launchd agent:"
if launchctl list 2>/dev/null | grep -q "com.productionhub.watchdog"; then
  echo "    ✓ Loaded"
  launchctl list 2>/dev/null | grep "com.productionhub.watchdog" | awk '{printf "    PID: %s  Status: %s  Label: %s\n", $1, $2, $3}'
else
  echo "    ✗ Not loaded"
fi

# ── Processes ─────────────────────────────────────────────────

echo ""
echo "  Processes:"
WATCHDOG_PIDS=$(pgrep -f "watchdog.sh" 2>/dev/null || true)
HUB_PIDS=$(pgrep -f "dist/index.js" 2>/dev/null || true)

if [[ -n "${WATCHDOG_PIDS}" ]]; then
  echo "    Watchdog: PID ${WATCHDOG_PIDS}"
else
  echo "    Watchdog: not running"
fi

if [[ -n "${HUB_PIDS}" ]]; then
  echo "    Hub:      PID ${HUB_PIDS}"
else
  echo "    Hub:      not running"
fi

# ── Health endpoint ───────────────────────────────────────────

echo ""
echo "  Health (http://127.0.0.1:${HEALTH_PORT}/health):"
HEALTH_RESPONSE=$(curl -sf --max-time 3 "http://127.0.0.1:${HEALTH_PORT}/health" 2>/dev/null || echo "UNREACHABLE")

if [[ "${HEALTH_RESPONSE}" == "UNREACHABLE" ]]; then
  echo "    ✗ Health endpoint unreachable"
else
  echo "    ✓ Responding"
  # Parse JSON with node if available, otherwise just print raw
  if command -v node >/dev/null 2>&1; then
    echo "${HEALTH_RESPONSE}" | node -e "
      const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      console.log('    Status:     ' + d.status);
      console.log('    Uptime:     ' + d.uptimeHuman);
      console.log('    OSC port:   ' + d.oscPort);
      console.log('    OSC clients:' + d.oscClients);
      console.log('    Memory:     ' + Math.round(d.memory.rss/1024/1024) + ' MB RSS');
      console.log('    PID:        ' + d.pid);
      console.log('    Drivers:');
      for (const dr of d.drivers) {
        const icon = dr.connected ? '✓' : '✗';
        console.log('      ' + icon + ' ' + dr.name + ' (' + dr.prefix + ')' + (dr.connected ? '' : '  DISCONNECTED'));
      }
    " 2>/dev/null || echo "    ${HEALTH_RESPONSE}"
  else
    echo "    ${HEALTH_RESPONSE}"
  fi
fi

# ── Recent logs ───────────────────────────────────────────────

echo ""
echo "  Recent watchdog log:"
if [[ -f "${HUB_DIR}/logs/watchdog.log" ]]; then
  tail -5 "${HUB_DIR}/logs/watchdog.log" | sed 's/^/    /'
else
  echo "    (no log file)"
fi

echo ""
echo "  Recent hub log:"
if [[ -f "${HUB_DIR}/logs/hub.log" ]]; then
  tail -5 "${HUB_DIR}/logs/hub.log" | sed 's/^/    /'
else
  echo "    (no log file)"
fi

echo ""
