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
# Over-the-air images (the app alone) and the manifest devices check once a day.
BUILD="${FW_BUILD:-0}"
for env in panel-xiao75 panel-spectra6 plant-c3; do
  cp "$DIR/.pio/build/$env/firmware.bin" "$OUT/$env.ota.bin"
done
python3 - "$OUT" "$BUILD" <<'PY'
import hashlib, json, os, sys
out, build = sys.argv[1], int(sys.argv[2])
files = {}
for env in ('panel-xiao75', 'panel-spectra6', 'plant-c3'):
    data = open(os.path.join(out, f'{env}.ota.bin'), 'rb').read()
    files[env] = {'path': f'{env}.ota.bin', 'size': len(data), 'md5': hashlib.md5(data).hexdigest()}
json.dump({'build': build, 'files': files}, open(os.path.join(out, 'ota.json'), 'w'), indent=2)
PY
ls -la "$OUT"
