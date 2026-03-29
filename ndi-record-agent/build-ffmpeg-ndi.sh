#!/bin/bash
#
# Build ffmpeg 5.1 with NDI support on Windows (MSYS2 MinGW64)
#
# NDI was removed from mainline ffmpeg in 2019. This script uses the
# community patch from lplassman/FFMPEG-NDI to re-add it to ffmpeg 5.1.
#
# Prerequisites:
#   1. Install MSYS2 from https://www.msys2.org/
#   2. Download NDI SDK from https://ndi.video/for-developers/ndi-sdk/
#      - Run the installer, default path: C:\Program Files\NDI\NDI 6 SDK
#   3. Open "MSYS2 MinGW 64-bit" terminal (NOT the plain MSYS2 one)
#   4. Run this script: bash build-ffmpeg-ndi.sh
#
# Output: ~/ffmpeg-ndi/bin/ffmpeg.exe
#

set -euo pipefail

# --- Configuration ---
NDI_SDK_DIR="/c/Program Files/NDI/NDI 6 SDK"
BUILD_DIR="$HOME/ffmpeg-ndi-build"
OUTPUT_DIR="$HOME/ffmpeg-ndi"
FFMPEG_VERSION="5.1"

# --- Check NDI SDK ---
if [ ! -d "$NDI_SDK_DIR" ]; then
  echo "ERROR: NDI SDK not found at: $NDI_SDK_DIR"
  echo ""
  echo "Download from: https://ndi.video/for-developers/ndi-sdk/"
  echo "Install it, then update NDI_SDK_DIR at the top of this script."
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

if [ ! -f "$NDI_SDK_DIR/Include/Processing.NDI.Lib.h" ]; then
  echo "ERROR: NDI SDK headers not found at: $NDI_SDK_DIR/Include/Processing.NDI.Lib.h"
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
  diffutils \
  patch

# --- Clone NDI patch repo ---
echo ""
echo "=== Getting NDI patch ==="
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

if [ ! -d "FFMPEG-NDI" ]; then
  git clone https://github.com/lplassman/FFMPEG-NDI.git
else
  echo "NDI patch repo already cloned"
fi

# --- Get ffmpeg 5.1 source ---
echo ""
echo "=== Getting ffmpeg $FFMPEG_VERSION source ==="

if [ ! -d "FFmpeg" ]; then
  git clone --branch "n$FFMPEG_VERSION" --depth 1 https://github.com/FFmpeg/FFmpeg.git
else
  echo "ffmpeg source already cloned"
fi

cd FFmpeg

# Clean any previous build attempt
if [ -f config.mak ]; then
  echo "Cleaning previous build..."
  make distclean 2>/dev/null || true
fi

# --- Apply NDI patch ---
echo ""
echo "=== Applying NDI patch ==="

# Check if patch already applied (look for the NDI source files)
if [ ! -f libavdevice/libndi_newtek_dec.c ]; then
  # Apply the patch that re-adds NDI configure/Makefile entries
  git apply "$BUILD_DIR/FFMPEG-NDI/libndi.patch" || {
    echo "git apply failed, trying patch command..."
    patch -p1 < "$BUILD_DIR/FFMPEG-NDI/libndi.patch"
  }

  # Copy the NDI source files into libavdevice/
  cp "$BUILD_DIR/FFMPEG-NDI/libavdevice/libndi_newtek_common.h" libavdevice/
  cp "$BUILD_DIR/FFMPEG-NDI/libavdevice/libndi_newtek_dec.c" libavdevice/
  cp "$BUILD_DIR/FFMPEG-NDI/libavdevice/libndi_newtek_enc.c" libavdevice/

  echo "NDI patch applied and source files copied"
else
  echo "NDI patch already applied"
fi

# Verify the files are in place
for f in libavdevice/libndi_newtek_common.h libavdevice/libndi_newtek_dec.c libavdevice/libndi_newtek_enc.c; do
  if [ ! -f "$f" ]; then
    echo "ERROR: Missing file after patch: $f"
    exit 1
  fi
done
echo "NDI source files verified"

# --- Set up NDI SDK paths ---
NDI_LIB_DIR="$NDI_SDK_DIR/Lib/x64"
NDI_INC_DIR="$NDI_SDK_DIR/Include"

# Find the library file
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
echo "NDI headers: $NDI_INC_DIR"

# --- Create pkg-config file for NDI ---
PKG_DIR="$BUILD_DIR/pkgconfig"
mkdir -p "$PKG_DIR"

cat > "$PKG_DIR/libndi_newtek.pc" << PCEOF
prefix=$NDI_SDK_DIR
libdir=$NDI_LIB_DIR
includedir=$NDI_INC_DIR

Name: libndi_newtek
Description: NDI SDK
Version: 6.0
Cflags: -I\${includedir}
Libs: -L\${libdir} -lProcessing.NDI.Lib.x64
PCEOF

export PKG_CONFIG_PATH="$PKG_DIR:${PKG_CONFIG_PATH:-}"

echo "pkg-config check:"
pkg-config --cflags --libs libndi_newtek && echo "  OK" || echo "  WARNING: pkg-config failed (will use manual flags)"

# --- Configure ---
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

# Verify NDI made it into the build
if grep -q "CONFIG_LIBNDI_NEWTEK=yes" ffbuild/config.mak 2>/dev/null || grep -q "CONFIG_LIBNDI_NEWTEK=yes" config.mak 2>/dev/null; then
  echo "NDI support: ENABLED"
else
  echo "WARNING: NDI may not be enabled in the build config"
  echo "Check configure output above for errors"
fi

# --- Build ---
echo ""
echo "=== Building ffmpeg (this takes a while) ==="
NPROC=$(nproc 2>/dev/null || echo 4)
make -j"$NPROC"

# --- Install ---
echo ""
echo "=== Installing to $OUTPUT_DIR ==="
mkdir -p "$OUTPUT_DIR"
make install

# --- Copy NDI runtime DLL ---
echo ""
echo "=== Copying NDI runtime DLL ==="
NDI_RUNTIME_DIRS=(
  "/c/Program Files/NDI/NDI 6 Runtime"
  "/c/Program Files/NDI/NDI 5 Runtime"
)
NDI_DLL_COPIED=false

for rtdir in "${NDI_RUNTIME_DIRS[@]}"; do
  if [ -f "$rtdir/Processing.NDI.Lib.x64.dll" ]; then
    cp "$rtdir/Processing.NDI.Lib.x64.dll" "$OUTPUT_DIR/bin/"
    echo "Copied NDI runtime DLL from $rtdir"
    NDI_DLL_COPIED=true
    break
  fi
done

if [ "$NDI_DLL_COPIED" = false ]; then
  echo "WARNING: NDI runtime DLL not found — make sure NDI Runtime is installed"
  echo "ffmpeg will still work if Processing.NDI.Lib.x64.dll is in your system PATH"
fi

# --- Done ---
echo ""
echo "=========================================="
echo " BUILD COMPLETE"
echo "=========================================="
echo ""
echo "ffmpeg:   $OUTPUT_DIR/bin/ffmpeg.exe"
echo "ffprobe:  $OUTPUT_DIR/bin/ffprobe.exe"
echo ""
echo "Test NDI source discovery:"
echo "  \"$OUTPUT_DIR/bin/ffmpeg.exe\" -f libndi_newtek -find_sources 1 -i dummy"
echo ""
echo "Test 10-second recording:"
echo "  \"$OUTPUT_DIR/bin/ffmpeg.exe\" -f libndi_newtek -i \"SOURCE_NAME\" -t 10 -c:v libx264 -preset fast -crf 18 -vf scale=1920:1080 test.mov"
echo ""
echo "Set in config.json:"
echo "  \"ffmpegPath\": \"$(cygpath -w "$OUTPUT_DIR/bin/ffmpeg.exe")\""
echo ""
