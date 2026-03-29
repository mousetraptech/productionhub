#!/bin/bash
#
# Build ffmpeg with NDI support on Windows (MSYS2 MinGW64)
#
# Prerequisites:
#   1. Install MSYS2 from https://www.msys2.org/
#   2. Download NDI SDK from https://ndi.video/for-developers/ndi-sdk/
#      - Run the installer, default path: C:\Program Files\NDI\NDI 6 SDK
#   3. Open "MSYS2 MinGW 64-bit" terminal (NOT the plain MSYS2 one)
#   4. Run this script: bash build-ffmpeg-ndi.sh
#
# Output: ~/ffmpeg-ndi/ffmpeg.exe (copy to your PATH or set in config.json)
#

set -euo pipefail

# --- Configuration ---
NDI_SDK_DIR="/c/Program Files/NDI/NDI 6 SDK"
BUILD_DIR="$HOME/ffmpeg-ndi-build"
OUTPUT_DIR="$HOME/ffmpeg-ndi"
FFMPEG_VERSION="7.1"

# --- Check NDI SDK ---
if [ ! -d "$NDI_SDK_DIR" ]; then
  echo "ERROR: NDI SDK not found at: $NDI_SDK_DIR"
  echo ""
  echo "Download from: https://ndi.video/for-developers/ndi-sdk/"
  echo "Install it, then update NDI_SDK_DIR in this script if the path differs."
  echo ""
  echo "Common paths:"
  echo '  "C:\Program Files\NDI\NDI 6 SDK"'
  echo '  "C:\Program Files\NDI\NDI 5 SDK"'
  echo ""
  # Try to find it
  for d in /c/Program\ Files/NDI/NDI*/; do
    if [ -d "$d" ]; then
      echo "Found: $d"
    fi
  done
  exit 1
fi

echo "NDI SDK: $NDI_SDK_DIR"

# Verify SDK has what we need
if [ ! -f "$NDI_SDK_DIR/Include/Processing.NDI.Lib.h" ]; then
  echo "ERROR: NDI SDK headers not found. Expected: $NDI_SDK_DIR/Include/Processing.NDI.Lib.h"
  exit 1
fi

# --- Install MSYS2 dependencies ---
echo ""
echo "=== Installing build dependencies ==="
pacman -S --needed --noconfirm \
  mingw-w64-x86_64-toolchain \
  mingw-w64-x86_64-nasm \
  mingw-w64-x86_64-yasm \
  mingw-w64-x86_64-pkg-config \
  mingw-w64-x86_64-x264 \
  mingw-w64-x86_64-x265 \
  mingw-w64-x86_64-SDL2 \
  make \
  git \
  diffutils

# --- Download ffmpeg source ---
echo ""
echo "=== Getting ffmpeg source ==="
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

if [ ! -d "ffmpeg-$FFMPEG_VERSION" ]; then
  if [ ! -f "ffmpeg-$FFMPEG_VERSION.tar.xz" ]; then
    echo "Downloading ffmpeg $FFMPEG_VERSION..."
    curl -LO "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz"
  fi
  tar xf "ffmpeg-$FFMPEG_VERSION.tar.xz"
fi

cd "ffmpeg-$FFMPEG_VERSION"

# --- Create pkg-config file for NDI ---
# ffmpeg's configure uses pkg-config to find libndi_newtek
echo ""
echo "=== Creating NDI pkg-config file ==="

NDI_LIB_DIR="$NDI_SDK_DIR/Lib/x64"
NDI_INC_DIR="$NDI_SDK_DIR/Include"

# Find the actual .lib or .dll.a file
NDI_LIB=""
for f in "$NDI_LIB_DIR"/Processing.NDI.Lib.x64.lib "$NDI_LIB_DIR"/Processing.NDI.Lib.x64.dll.a; do
  if [ -f "$f" ]; then
    NDI_LIB="$f"
    break
  fi
done

if [ -z "$NDI_LIB" ]; then
  echo "ERROR: NDI library not found in $NDI_LIB_DIR"
  echo "Contents:"
  ls -la "$NDI_LIB_DIR"/ 2>/dev/null || echo "  (directory not found)"
  exit 1
fi

echo "NDI lib: $NDI_LIB"
echo "NDI inc: $NDI_INC_DIR"

# Create a .pc file so configure can find NDI
PKG_DIR="$BUILD_DIR/pkgconfig"
mkdir -p "$PKG_DIR"

# Convert Windows paths to what the linker expects
NDI_LIB_WIN=$(cygpath -w "$NDI_LIB_DIR")
NDI_INC_WIN=$(cygpath -w "$NDI_INC_DIR")

cat > "$PKG_DIR/libndi_newtek.pc" << PCEOF
prefix=$NDI_SDK_DIR
libdir=$NDI_LIB_DIR
includedir=$NDI_INC_DIR

Name: libndi_newtek
Description: NDI SDK
Version: 6.0
Cflags: -I"\${includedir}"
Libs: -L"\${libdir}" -lProcessing.NDI.Lib.x64
PCEOF

export PKG_CONFIG_PATH="$PKG_DIR:${PKG_CONFIG_PATH:-}"

echo "pkg-config test:"
pkg-config --cflags --libs libndi_newtek || {
  echo "WARNING: pkg-config couldn't read the NDI .pc file. Trying manual flags..."
}

# --- Configure ffmpeg ---
echo ""
echo "=== Configuring ffmpeg ==="

./configure \
  --prefix="$OUTPUT_DIR" \
  --enable-gpl \
  --enable-nonfree \
  --enable-libndi_newtek \
  --enable-libx264 \
  --enable-libx265 \
  --extra-cflags="-I$NDI_INC_DIR" \
  --extra-ldflags="-L$NDI_LIB_DIR" \
  --extra-libs="-lProcessing.NDI.Lib.x64" \
  --disable-doc \
  --disable-debug \
  --enable-optimizations

# --- Build ---
echo ""
echo "=== Building ffmpeg (this takes a while) ==="
NPROC=$(nproc 2>/dev/null || echo 4)
make -j"$NPROC"

# --- Install to output dir ---
echo ""
echo "=== Installing to $OUTPUT_DIR ==="
make install

# --- Copy NDI runtime DLL ---
NDI_RUNTIME_DIR="/c/Program Files/NDI/NDI 6 Runtime"
if [ -d "$NDI_RUNTIME_DIR" ]; then
  cp "$NDI_RUNTIME_DIR/Processing.NDI.Lib.x64.dll" "$OUTPUT_DIR/bin/" 2>/dev/null || true
  echo "Copied NDI runtime DLL"
else
  echo "WARNING: NDI Runtime not found at $NDI_RUNTIME_DIR"
  echo "Make sure NDI Runtime is installed and Processing.NDI.Lib.x64.dll is in PATH"
fi

# --- Done ---
echo ""
echo "=========================================="
echo " BUILD COMPLETE"
echo "=========================================="
echo ""
echo "ffmpeg binary:  $OUTPUT_DIR/bin/ffmpeg.exe"
echo "ffprobe binary: $OUTPUT_DIR/bin/ffprobe.exe"
echo ""
echo "Test NDI input:"
echo "  $OUTPUT_DIR/bin/ffmpeg.exe -f libndi_newtek -find_sources 1 -i dummy"
echo ""
echo "Test recording (10 seconds):"
echo "  $OUTPUT_DIR/bin/ffmpeg.exe -f libndi_newtek -i \"SOURCE_NAME\" -t 10 -c:v libx264 -preset fast -crf 18 -vf scale=1920:1080 test.mov"
echo ""
echo "Update config.json ffmpegPath to:"
echo "  $(cygpath -w "$OUTPUT_DIR/bin/ffmpeg.exe")"
echo ""
