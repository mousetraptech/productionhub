#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
#  Production Hub — Install as macOS Login Service
#
#  What this does:
#    1. Builds the TypeScript project
#    2. Creates the logs directory
#    3. Templates the launchd plist with your actual paths
#    4. Installs it to ~/Library/LaunchAgents
#    5. Loads it (starts the watchdog immediately)
#
#  The watchdog starts the hub, health-checks it at /ping
#  every 10 seconds, and restarts it if it becomes unresponsive.
#
#  Usage:
#    cd /path/to/avantis-osc
#    ./service/install.sh
# ──────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HUB_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLIST_SRC="${SCRIPT_DIR}/com.productionhub.watchdog.plist"
PLIST_NAME="com.productionhub.watchdog.plist"
PLIST_DEST="${HOME}/Library/LaunchAgents/${PLIST_NAME}"

echo ""
echo "  Production Hub — Service Installer"
echo "  ─────────────────────────────────────────"
echo "  Hub directory: ${HUB_DIR}"
echo ""

# ── 1. Find Node.js ───────────────────────────────────────────

NODE_BIN="$(which node 2>/dev/null || true)"
if [[ -z "${NODE_BIN}" ]]; then
  echo "ERROR: node not found in PATH."
  echo "Install Node.js first (https://nodejs.org or nvm)."
  exit 1
fi
NODE_DIR="$(dirname "${NODE_BIN}")"
echo "  Node.js: ${NODE_BIN} ($(node --version))"

# ── 2. Build ──────────────────────────────────────────────────

echo ""
echo "  Building TypeScript..."
cd "${HUB_DIR}"
npm run build
echo "  Build complete."

# ── 3. Create logs directory ──────────────────────────────────

mkdir -p "${HUB_DIR}/logs"
echo "  Logs directory: ${HUB_DIR}/logs/"

# ── 4. Unload existing service if present ─────────────────────

if launchctl list 2>/dev/null | grep -q "com.productionhub.watchdog"; then
  echo ""
  echo "  Unloading existing service..."
  launchctl unload "${PLIST_DEST}" 2>/dev/null || true
fi

# ── 5. Template and install the plist ─────────────────────────

echo ""
echo "  Installing launchd agent..."

sed \
  -e "s|__HUB_DIR__|${HUB_DIR}|g" \
  -e "s|__NODE_BIN__|${NODE_BIN}|g" \
  -e "s|__NODE_DIR__|${NODE_DIR}|g" \
  "${PLIST_SRC}" > "${PLIST_DEST}"

echo "  Installed: ${PLIST_DEST}"

# ── 6. Load the service ──────────────────────────────────────

launchctl load "${PLIST_DEST}"
echo "  Service loaded and started."

# ── 7. Verify ─────────────────────────────────────────────────

sleep 2
echo ""
if launchctl list 2>/dev/null | grep -q "com.productionhub.watchdog"; then
  echo "  ✓ Service is running"
else
  echo "  ⚠ Service may not have started — check logs:"
  echo "    tail -f ${HUB_DIR}/logs/watchdog.log"
fi

echo ""
echo "  ─────────────────────────────────────────"
echo "  Commands:"
echo "    Status:    launchctl list | grep productionhub"
echo "    Logs:      tail -f ${HUB_DIR}/logs/watchdog.log"
echo "    Hub logs:  tail -f ${HUB_DIR}/logs/hub.log"
echo "    Health:    curl http://127.0.0.1:8080/health"
echo "    Stop:      launchctl unload ${PLIST_DEST}"
echo "    Start:     launchctl load ${PLIST_DEST}"
echo "    Uninstall: ./service/uninstall.sh"
echo ""
