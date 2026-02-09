#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
#  Production Hub Watchdog
#
#  Monitors the hub process via its /ping health endpoint.
#  If the hub fails to respond after FAIL_THRESHOLD consecutive
#  checks, the watchdog kills and restarts it.
#
#  Designed to be launched by launchd (macOS) at login.
#  launchd handles the initial start; this script handles
#  health-based restarts that launchd can't detect (process
#  alive but wedged / unresponsive).
#
#  Usage:
#    ./watchdog.sh                     # uses defaults
#    HEALTH_PORT=9090 ./watchdog.sh    # override port
# ──────────────────────────────────────────────────────────────

set -euo pipefail

# ── Configuration (override via env vars) ─────────────────────

HUB_DIR="${HUB_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
HEALTH_PORT="${HEALTH_PORT:-8080}"
HEALTH_URL="http://127.0.0.1:${HEALTH_PORT}/ping"
CHECK_INTERVAL="${CHECK_INTERVAL:-10}"       # seconds between health checks
FAIL_THRESHOLD="${FAIL_THRESHOLD:-3}"        # consecutive failures before restart
STARTUP_GRACE="${STARTUP_GRACE:-15}"         # seconds to wait after starting before first check
NODE_BIN="${NODE_BIN:-$(which node)}"
LOG_DIR="${LOG_DIR:-${HUB_DIR}/logs}"
CONFIG_PATH="${CONFIG_PATH:-${HUB_DIR}/config.yml}"

# ── State ─────────────────────────────────────────────────────

HUB_PID=""
FAIL_COUNT=0

# ── Functions ─────────────────────────────────────────────────

log() {
  echo "[watchdog $(date '+%Y-%m-%d %H:%M:%S')] $*"
}

ensure_log_dir() {
  mkdir -p "${LOG_DIR}"
}

start_hub() {
  log "Starting Production Hub..."
  log "  dir:    ${HUB_DIR}"
  log "  config: ${CONFIG_PATH}"
  log "  node:   ${NODE_BIN}"

  ensure_log_dir

  local LOG_FILE="${LOG_DIR}/hub.log"

  # Rotate log if > 10MB
  if [[ -f "${LOG_FILE}" ]] && (( $(stat -f%z "${LOG_FILE}" 2>/dev/null || echo 0) > 10485760 )); then
    mv "${LOG_FILE}" "${LOG_FILE}.$(date '+%Y%m%d-%H%M%S').bak"
    log "Rotated log file"
  fi

  cd "${HUB_DIR}"
  "${NODE_BIN}" dist/index.js --config "${CONFIG_PATH}" >> "${LOG_FILE}" 2>&1 &
  HUB_PID=$!
  FAIL_COUNT=0

  log "Hub started with PID ${HUB_PID}"
  log "Waiting ${STARTUP_GRACE}s for startup grace period..."
  sleep "${STARTUP_GRACE}"
}

stop_hub() {
  if [[ -n "${HUB_PID}" ]] && kill -0 "${HUB_PID}" 2>/dev/null; then
    log "Stopping hub (PID ${HUB_PID})..."
    kill -TERM "${HUB_PID}" 2>/dev/null || true
    # Wait up to 5 seconds for graceful shutdown
    local waited=0
    while kill -0 "${HUB_PID}" 2>/dev/null && (( waited < 5 )); do
      sleep 1
      (( waited++ ))
    done
    # Force kill if still alive
    if kill -0 "${HUB_PID}" 2>/dev/null; then
      log "Force killing hub (PID ${HUB_PID})..."
      kill -9 "${HUB_PID}" 2>/dev/null || true
    fi
  fi
  HUB_PID=""
}

check_health() {
  # Returns 0 if healthy, 1 if not
  local response
  response=$(curl -sf --max-time 5 "${HEALTH_URL}" 2>/dev/null) || return 1
  [[ "${response}" == "pong" ]] && return 0
  return 1
}

cleanup() {
  log "Watchdog shutting down..."
  stop_hub
  exit 0
}

# ── Main ──────────────────────────────────────────────────────

trap cleanup SIGINT SIGTERM

log "═══════════════════════════════════════════════"
log "  Production Hub Watchdog"
log "  Health endpoint: ${HEALTH_URL}"
log "  Check interval:  ${CHECK_INTERVAL}s"
log "  Fail threshold:  ${FAIL_THRESHOLD}"
log "═══════════════════════════════════════════════"

# Initial start
start_hub

# Health check loop
while true; do
  sleep "${CHECK_INTERVAL}"

  # Check if process is still alive
  if [[ -n "${HUB_PID}" ]] && ! kill -0 "${HUB_PID}" 2>/dev/null; then
    log "Hub process (PID ${HUB_PID}) is dead. Restarting..."
    start_hub
    continue
  fi

  # Check health endpoint
  if check_health; then
    if (( FAIL_COUNT > 0 )); then
      log "Hub recovered after ${FAIL_COUNT} failed check(s)"
    fi
    FAIL_COUNT=0
  else
    (( FAIL_COUNT++ ))
    log "Health check failed (${FAIL_COUNT}/${FAIL_THRESHOLD})"

    if (( FAIL_COUNT >= FAIL_THRESHOLD )); then
      log "Hub unresponsive after ${FAIL_THRESHOLD} checks. Restarting..."
      stop_hub
      sleep 2
      start_hub
    fi
  fi
done
