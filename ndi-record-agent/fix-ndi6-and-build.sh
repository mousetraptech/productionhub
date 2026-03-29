#!/bin/bash
#
# Fix NDI 6 SDK API incompatibilities in ffmpeg NDI source files, then build.
# Run from MSYS2 MinGW64:
#   cd /c/production-hub/ndi-record-agent && bash fix-ndi6-and-build.sh
#

set -euo pipefail

BUILD_DIR="$HOME/ffmpeg-ndi-build"
FFMPEG_DIR="$BUILD_DIR/FFmpeg"
DEC="$FFMPEG_DIR/libavdevice/libndi_newtek_dec.c"

if [ ! -f "$DEC" ]; then
  echo "ERROR: $DEC not found. Run build-ffmpeg-ndi.sh first."
  exit 1
fi

cd "$FFMPEG_DIR"

echo "=== Patching NDI 6 API incompatibilities ==="

# Fix 1: ctx->recv is typed as settings struct, should be instance handle
# NDIlib_recv_create_v3_t *recv;  -->  NDIlib_recv_instance_t recv;
sed -i 's/NDIlib_recv_create_v3_t \*recv;/NDIlib_recv_instance_t recv;/' "$DEC"
echo "  Fixed: ctx->recv type (NDIlib_recv_create_v3_t* -> NDIlib_recv_instance_t)"

# Fix 2: audio_to_interleaved_16s takes v1 frame type, need v2 for audio_frame_v2_t
sed -i 's/NDIlib_util_audio_to_interleaved_16s(a/NDIlib_util_audio_to_interleaved_16s_v2(a/' "$DEC"
echo "  Fixed: NDIlib_util_audio_to_interleaved_16s -> _v2"

# Fix 3: recv_free_audio takes v1 frame type, need v2 for audio_frame_v2_t
sed -i 's/NDIlib_recv_free_audio(ctx->recv, &a)/NDIlib_recv_free_audio_v2(ctx->recv, \&a)/' "$DEC"
echo "  Fixed: NDIlib_recv_free_audio -> _v2"

echo ""
echo "=== Verifying patches ==="
echo "ctx->recv type:"
grep "recv;" "$DEC" | head -1 | sed 's/^[[:space:]]*/  /'
echo "audio_to_interleaved call:"
grep "NDIlib_util_audio_to_interleaved" "$DEC" | sed 's/^[[:space:]]*/  /'
echo "recv_free_audio call:"
grep "NDIlib_recv_free_audio" "$DEC" | sed 's/^[[:space:]]*/  /'

echo ""
echo "=== Building ==="
make -j$(nproc) 2>&1 | tail -20

if [ $? -eq 0 ]; then
  echo ""
  echo "=== Installing ==="
  make install
  echo ""
  echo "=========================================="
  echo " BUILD COMPLETE"
  echo "=========================================="
  echo ""
  echo "ffmpeg:  $HOME/ffmpeg-ndi/bin/ffmpeg.exe"
  echo ""
  echo "Test:"
  echo "  ~/ffmpeg-ndi/bin/ffmpeg.exe -f libndi_newtek -find_sources 1 -i dummy"
fi
