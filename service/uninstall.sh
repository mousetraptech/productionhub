#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
#  Production Hub — Uninstall macOS Login Service
#
#  Stops the watchdog (which stops the hub), removes the
#  launchd agent. Leaves logs and config intact.
#
#  Usage:
#    ./service/uninstall.sh
# ──────────────────────────────────────────────────────────────

set -euo pipefail

PLIST_NAME="com.productionhub.watchdog.plist"
PLIST_DEST="${HOME}/Library/LaunchAgents/${PLIST_NAME}"

echo ""
echo "  Production Hub — Service Uninstaller"
echo "  ─────────────────────────────────────────"

if [[ -f "${PLIST_DEST}" ]]; then
  echo "  Unloading service..."
  launchctl unload "${PLIST_DEST}" 2>/dev/null || true
  rm -f "${PLIST_DEST}"
  echo "  ✓ Service removed: ${PLIST_DEST}"
else
  echo "  No service installed at ${PLIST_DEST}"
fi

# Kill any orphaned hub or watchdog processes
echo ""
KILLED=0
for pid in $(pgrep -f "watchdog.sh" 2>/dev/null || true); do
  echo "  Killing orphaned watchdog (PID ${pid})..."
  kill "${pid}" 2>/dev/null || true
  (( KILLED++ ))
done
for pid in $(pgrep -f "dist/index.js" 2>/dev/null || true); do
  echo "  Killing orphaned hub (PID ${pid})..."
  kill "${pid}" 2>/dev/null || true
  (( KILLED++ ))
done

if (( KILLED == 0 )); then
  echo "  No orphaned processes found."
fi

echo ""
echo "  ✓ Uninstall complete."
echo "  Logs and config have been preserved."
echo ""
