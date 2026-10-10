#!/usr/bin/env bash
# Atlántico on a TV, from a Raspberry Pi (Raspberry Pi OS with desktop) on one of its HDMI inputs.
# Run on the Pi, in its own Terminal:
#   curl -fsSL https://<you>.github.io/atlantico/kiosk.sh | bash -s -- shared   # the TV you also watch
#   curl -fsSL https://<you>.github.io/atlantico/kiosk.sh | bash -s -- art      # a TV only for Atlántico
# (With neither, it asks.) Both start the wall full screen at login (again if it ever closes), stop
# the screen blanking and log in automatically.
# shared — the household TV, with tv-agent.py beside the wall: any remote button goes back to TV and
#   apps, Atlántico returns after watching, arrivals wake a TV that's off (never one in use), the TV
#   sleeps when nobody is staying, and lamps placed by the TV follow the picture. Added with one
#   4-digit code shown here in the terminal.
# art — a TV that only shows Atlántico: (optional) off at night and on in the morning over HDMI-CEC.
# Undo: sed -i /atlantico/d ~/.config/labwc/autostart; rm ~/.config/autostart/atlantico.desktop;
#   crontab -r; sudo systemctl disable --now atlantico-cec
set -euo pipefail

SITE="${ATLANTICO_SITE:-https://vlues.github.io/atlantico}"
MODE="${1:-${ATLANTICO_TV:-}}"
CFG="$HOME/.config/atlantico"
say() { printf '\n— %s\n' "$*"; }
if [ "$(id -u)" = 0 ]; then echo "Run this as your normal user (not with sudo)."; exit 1; fi

if [ "$MODE" != shared ] && [ "$MODE" != art ]; then
  read -r -p "Is this the TV you also watch films and series on? [Y/n] " ans </dev/tty || ans=y
  if [[ "${ans:-y}" =~ ^[Nn] ]]; then MODE=art; else MODE=shared; fi
fi
URL="$SITE/wall?kiosk&sound"
say "Atlántico kiosk ($MODE TV)"

say "Browser"
BROWSER="$(command -v chromium || command -v chromium-browser || true)"
if [ -z "$BROWSER" ]; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq chromium || sudo apt-get install -y -qq chromium-browser
  BROWSER="$(command -v chromium || command -v chromium-browser)"
fi
echo "  $BROWSER"
mkdir -p "$HOME/.local/bin" "$CFG" "$HOME/.cache" "$HOME/.config/labwc" "$HOME/.config/autostart"

if [ "$MODE" = shared ]; then
  say "Tools for talking to the TV, the picture and the lamps"
  sudo apt-get install -y -qq v4l-utils wlr-randr wtype grim python3-numpy qrencode >/dev/null || true
  sudo apt-get install -y -qq python3-picamera2 >/dev/null 2>&1 || true   # the camera, if you add one
  sudo usermod -aG video,input "$USER" || true                              # HDMI-CEC and the remote's buttons

  API="$(curl -fsSL "$SITE/config.js" | sed -n "s/.*api: *'\([^']*\)'.*/\1/p")"
  [ -n "$API" ] || { echo "  Couldn't read the Worker address from $SITE/config.js"; exit 1; }
  json() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }

  say "Add this TV to Atlántico"
  TOKEN=""
  if [ -f "$CFG/tv.json" ]; then
    TOKEN="$(json "['token']" < "$CFG/tv.json")"
    curl -fsS -o /dev/null -H "authorization: Bearer $TOKEN" "$API/api/tv" && echo "  Already added." || TOKEN=""
  fi
  if [ -z "$TOKEN" ]; then
    HI="$(curl -fsS -X POST -H 'content-type: application/json' -d '{"tv":true}' "$API/api/screen/hello")"
    CODE="$(echo "$HI" | json "['code']")"; CLAIM="$(echo "$HI" | json "['claim']")"
    echo "  On your phone, open Atlántico › Add device › Screen and type:   $CODE"
    echo "  (or scan this, signed in on your phone)"
    command -v qrencode >/dev/null && qrencode -t ANSIUTF8 "$SITE/add?screen=$CODE" || echo "  $SITE/add?screen=$CODE"
    while :; do
      sleep 3
      R="$(curl -fsS "$API/api/screen/hello?code=$CODE&claim=$CLAIM" || echo '{}')"
      if echo "$R" | grep -q '"token"'; then break; fi
      if echo "$R" | grep -q '"expired"'; then echo "  The code expired. Run this again."; exit 1; fi
    done
    echo "$R" | python3 -c "import json,sys; r=json.load(sys.stdin); json.dump({'api': '$API', 'token': r['token'], 'device': r['deviceId']}, open('$CFG/tv.json', 'w'))"
    chmod 600 "$CFG/tv.json"
    echo "  Added. ✓"
  fi
  TOKEN="$(json "['token']" < "$CFG/tv.json")"; DEVICE="$(json "['device']" < "$CFG/tv.json")"
  # The wall uses the same key as the agent (it never shows its own code on this TV).
  URL="$URL&tv#screen=$TOKEN&device=$DEVICE"

  say "The TV agent (tv-agent.py)"
  curl -fsSL "$SITE/tv-agent.py" -o "$HOME/.local/bin/atlantico-tv-agent.py"
  cat > "$HOME/.local/bin/atlantico-tv-agent" <<'EOF'
#!/usr/bin/env bash
# Keeps the TV agent running; its log stays small.
LOG="$HOME/.cache/atlantico-tv.log"
sleep 8
while true; do
  [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 2000000 ] && mv "$LOG" "$LOG.old"
  python3 "$HOME/.local/bin/atlantico-tv-agent.py" >> "$LOG" 2>&1
  sleep 10
done
EOF
  chmod +x "$HOME/.local/bin/atlantico-tv-agent"
  grep -qs atlantico-tv-agent "$HOME/.config/labwc/autostart" || echo "$HOME/.local/bin/atlantico-tv-agent &" >> "$HOME/.config/labwc/autostart"

  # Hearing what the TV says on HDMI-CEC (input changes, standby) needs root: a small service that
  # only listens and writes it to /run/atlantico/cec.log for the agent.
  sudo tee /etc/systemd/system/atlantico-cec.service >/dev/null <<'EOF'
[Unit]
Description=Atlántico: listen to the TV over HDMI-CEC
After=multi-user.target

[Service]
RuntimeDirectory=atlantico
RuntimeDirectoryMode=0755
ExecStart=/bin/sh -c 'exec >/run/atlantico/cec.log 2>&1; for d in /dev/cec*; do stdbuf -oL cec-ctl -d "$d" -s --monitor & done; wait'
Restart=always
RestartSec=5
RuntimeMaxSec=86400

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable --now atlantico-cec >/dev/null 2>&1 || true
  crontab -l 2>/dev/null | grep -v atlantico-tv | crontab - || true   # no fixed on/off times on a shared TV
fi

say "Start the wall at login (and again if it ever closes)"
cat > "$HOME/.local/bin/atlantico-wall" <<EOF
#!/usr/bin/env bash
# Keeps the wall on screen. Normal profile (not incognito), so the screen stays added.
sleep 4
while true; do
  "$BROWSER" --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble \\
    --autoplay-policy=no-user-gesture-required --check-for-update-interval=31536000 \\
    --password-store=basic '$URL'
  sleep 3
done
EOF
chmod 700 "$HOME/.local/bin/atlantico-wall"
grep -qs atlantico-wall "$HOME/.config/labwc/autostart" || echo "$HOME/.local/bin/atlantico-wall &" >> "$HOME/.config/labwc/autostart"
cat > "$HOME/.config/autostart/atlantico.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Atlántico
Exec=$HOME/.local/bin/atlantico-wall
X-GNOME-Autostart-enabled=true
EOF
# Only one of the two should start it: labwc reads its own file, so hide the desktop entry there.
if [ "${XDG_CURRENT_DESKTOP:-}" = "labwc" ] || pgrep -x labwc >/dev/null 2>&1; then
  echo "Hidden=true" >> "$HOME/.config/autostart/atlantico.desktop"
fi

say "Screen never blanks, logs in by itself"
if command -v raspi-config >/dev/null; then
  sudo raspi-config nonint do_blanking 1 || true
  sudo raspi-config nonint do_boot_behaviour B4 || true
fi

if [ "$MODE" = art ]; then
  say "TV off at night, on in the morning (HDMI-CEC)"
  read -r -p "  Switch the TV off 00:30–07:00? [Y/n] " ans </dev/tty || ans=y
  if [[ ! "${ans:-y}" =~ ^[Nn] ]]; then
    command -v cec-ctl >/dev/null || sudo apt-get install -y -qq v4l-utils
    cat > "$HOME/.local/bin/atlantico-tv" <<'EOF'
#!/usr/bin/env bash
# atlantico-tv on|off — wakes the TV or puts it in standby, on whichever HDMI port it is.
for dev in /dev/cec*; do
  [ -e "$dev" ] || continue
  cec-ctl -d "$dev" --playback -S >/dev/null 2>&1 || continue
  if [ "${1:-on}" = off ]; then cec-ctl -d "$dev" --to 0 --standby >/dev/null 2>&1 || true
  else cec-ctl -d "$dev" --to 0 --image-view-on >/dev/null 2>&1 || true; fi
done
EOF
    chmod +x "$HOME/.local/bin/atlantico-tv"
    ( crontab -l 2>/dev/null | grep -v atlantico-tv
      echo "30 0 * * * $HOME/.local/bin/atlantico-tv off"
      echo "0 7 * * * $HOME/.local/bin/atlantico-tv on" ) | crontab -
  fi
fi

say "Done."
echo "  On the TV, turn on HDMI-CEC (Samsung: Anynet+, LG: SimpLink, Sony: Bravia Sync,"
echo "  Hisense: CEC, TCL: T-Link, Philips: EasyLink)."
if [ "$MODE" = shared ]; then
  echo "  Also on the TV: 'No signal' power off on (so it sleeps when nobody is staying)."
  echo "  Lamps that follow the picture: Govee lights with LAN Control on (Govee Home app), then in"
  echo "  Atlántico › Control › Lamps, set each one's side of the TV."
  echo "  A camera facing the TV lets them follow what you watch too; it calibrates itself the"
  echo "  first time Atlántico is on screen (or run: python3 ~/.local/bin/atlantico-tv-agent.py calibrate)."
else
  echo "  The wall shows a 4-digit code after the reboot: type it in Atlántico › Add device › Screen."
fi
read -r -p "  Reboot now? [Y/n] " ans </dev/tty || ans=n
[[ "${ans:-y}" =~ ^[Nn] ]] || sudo reboot
