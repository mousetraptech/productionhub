#!/bin/bash
#
# Fix NDI 6 SDK API incompatibilities in the ffmpeg NDI source files, then build.
# Run this from MSYS2 MinGW64 after build-ffmpeg-ndi.sh has failed at the make step.
#
# Usage: cd /c/production-hub/ndi-record-agent && bash fix-ndi6-and-build.sh
#

set -euo pipefail

BUILD_DIR="$HOME/ffmpeg-ndi-build"
FFMPEG_DIR="$BUILD_DIR/FFmpeg"
NDI_INC="$HOME/ndi-sdk/Include"

if [ ! -d "$FFMPEG_DIR" ]; then
  echo "ERROR: $FFMPEG_DIR not found. Run build-ffmpeg-ndi.sh first."
  exit 1
fi

cd "$FFMPEG_DIR"

# --- Step 1: Show all compile errors so we know what to fix ---
echo "=== Collecting all build errors ==="
ERRORS=$(make -j1 2>&1 | grep "error:" || true)
echo "$ERRORS"
echo ""

# --- Step 2: Check NDI 6 SDK API signatures ---
echo "=== NDI 6 SDK function signatures ==="
echo "--- audio_to_interleaved_16s ---"
grep -n "NDIlib_util_audio_to_interleaved_16s" "$NDI_INC"/*.h 2>/dev/null || echo "(not found in headers)"
echo ""
echo "--- audio_to_interleaved_32f ---"
grep -n "NDIlib_util_audio_to_interleaved_32f" "$NDI_INC"/*.h 2>/dev/null || echo "(not found in headers)"
echo ""
echo "--- audio_from_interleaved ---"
grep -n "NDIlib_util_audio_from_interleaved" "$NDI_INC"/*.h 2>/dev/null || echo "(not found in headers)"
echo ""
echo "--- recv_create ---"
grep -n "NDIlib_recv_create" "$NDI_INC"/*.h 2>/dev/null | head -5 || echo "(not found)"
echo ""
echo "--- send_create ---"
grep -n "NDIlib_send_create" "$NDI_INC"/*.h 2>/dev/null | head -5 || echo "(not found)"
echo ""
echo "--- v2_t vs v3_t types ---"
grep -n "NDIlib_recv_create_v3_t\|NDIlib_video_frame_v2_t\|NDIlib_audio_frame_v2_t\|NDIlib_audio_frame_v3_t" "$NDI_INC"/*.h 2>/dev/null | head -20 || echo "(not found)"
echo ""

# --- Step 3: Dump the problematic source lines ---
echo "=== Current NDI source files (key lines) ==="
echo "--- dec.c audio conversion call ---"
grep -n "NDIlib_util_audio" libavdevice/libndi_newtek_dec.c 2>/dev/null || true
echo ""
echo "--- enc.c audio conversion call ---"
grep -n "NDIlib_util_audio" libavdevice/libndi_newtek_enc.c 2>/dev/null || true
echo ""
echo "--- dec.c recv_create usage ---"
grep -n "recv_create" libavdevice/libndi_newtek_dec.c 2>/dev/null || true
echo ""
echo "--- dec.c struct types ---"
grep -n "NDIlib_recv_create_v3_t\|NDIlib_video_frame_v2_t\|NDIlib_audio_frame_v2_t" libavdevice/libndi_newtek_dec.c 2>/dev/null || true
echo ""
echo "--- enc.c struct types ---"
grep -n "NDIlib_recv_create_v3_t\|NDIlib_video_frame_v2_t\|NDIlib_audio_frame_v2_t" libavdevice/libndi_newtek_enc.c 2>/dev/null || true
echo ""

echo "=== Full error list ==="
make -j1 2>&1 | grep -E "error:|warning:.*incompatible|undefined reference" | sort -u
echo ""
echo "=== DONE — paste everything above back to Claude ==="
