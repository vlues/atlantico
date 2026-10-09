#!/usr/bin/env bash
# Merge bootloader + partitions + app into one image per build, flashed at offset 0
# by ESP Web Tools. Usage: firmware/merge.sh <out-dir>
set -euo pipefail
OUT="${1:-firmware/out}"
DIR="$(cd "$(dirname "$0")" && pwd)"
PIO="${PLATFORMIO_CORE_DIR:-$HOME/.platformio}"
BOOT_APP0="$(ls "$PIO"/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin)"
# Needs esptool on the PATH (pip install esptool==5.5.0).
mkdir -p "$OUT"
for env in panel-xiao75 panel-spectra6 plant-c3; do
  B="$DIR/.pio/build/$env"
  case $env in panel-spectra6) chip=esp32s3 ;; *) chip=esp32c3 ;; esac
  python3 -m esptool --chip "$chip" merge-bin -o "$OUT/$env.bin" \
    0x0 "$B/bootloader.bin" 0x8000 "$B/partitions.bin" 0xe000 "$BOOT_APP0" 0x10000 "$B/firmware.bin"
done
ls -la "$OUT"
