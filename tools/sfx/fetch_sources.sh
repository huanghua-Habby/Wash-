#!/bin/sh
# Download the CC0 BigSoundBank recordings used by build.py and convert them to 48 kHz mono float WAV.
# Usage: tools/sfx/fetch_sources.sh [dir]   (default /tmp/sfxwork/src; pass the same dir as SFX_SRC to build.py)
set -e
DIR=${1:-/tmp/sfxwork/src}; RAW="$DIR/raw"; mkdir -p "$RAW"
for id in 0134 0171 0183 0257 0274 0326 0373 0648 0652 0663 0778 0950 0952 1023 1045 1074 1104 1252 1293 1336 1355 1473 1514 1553 1795 1796 1799 1801 1808 1825 1826 1865 1867 1869 1874 2006 2033 2280 2363 2453 2987; do
  if curl -sfL -A "Mozilla/5.0" -o "$RAW/$id.flac" "https://bigsoundbank.com/UPLOAD/flac/$id.flac"; then f="$RAW/$id.flac"
  else curl -sfL -A "Mozilla/5.0" -o "$RAW/$id.wav" "https://bigsoundbank.com/UPLOAD/bwf-en/$id.wav"; f="$RAW/$id.wav"; fi
  ffmpeg -v error -y -i "$f" -ac 1 -ar 48000 -c:a pcm_f32le "$DIR/$id.wav"
done
echo "sources ready in $DIR"
