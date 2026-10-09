#!/usr/bin/env bash
# Atlántico on a TV: turns a Raspberry Pi (Raspberry Pi OS with desktop) into a box that only
# shows the wall. Run on the Pi:
#   curl -fsSL https://<you>.github.io/atlantico/kiosk.sh | bash
# What it does:
#   - starts the wall full screen at login, and starts it again if it ever closes
#   - stops the screen blanking
#   - logs in automatically
#   - (optional) switches the TV off at night and on in the morning over HDMI-CEC
# Undo: rm ~/.config/labwc/autostart.d/atlantico ~/.config/autostart/atlantico.desktop; crontab -r
set -euo pipefail

SITE="${ATLANTICO_SITE:-https://vlues.github.io/atlantico}"
URL="$SITE/wall?kiosk&sound"
say() { printf '\n— %s\n' "$*"; }

say "Atlántico kiosk · $URL"
if [ "$(id -u)" = 0 ]; then echo "Run this as your normal user (not with sudo)."; exit 1; fi

say "Browser"
BROWSER="$(command -v chromium || command -v chromium-browser || true)"
if [ -z "$BROWSER" ]; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq chromium || sudo apt-get install -y -qq chromium-browser
  BROWSER="$(command -v chromium || command -v chromium-browser)"
fi
echo "  $BROWSER"

say "Start the wall at login (and again if it ever closes)"
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/atlantico-wall" <<EOF
#!/usr/bin/env bash
# Keeps the wall on screen. Normal profile (not incognito), so the screen stays added.
sleep 4
while true; do
  "$BROWSER" --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble \\
    --autoplay-policy=no-user-gesture-required --check-for-update-interval=31536000 \\
    --password-store=basic "$URL"
  sleep 3
done
EOF
chmod +x "$HOME/.local/bin/atlantico-wall"
# labwc (Raspberry Pi OS since late 2024) and, for older desktops, the standard autostart folder.
mkdir -p "$HOME/.config/labwc" "$HOME/.config/autostart"
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
  echo "  Make sure HDMI-CEC is on in the TV's settings (Samsung: Anynet+, Hisense: CEC, TCL: T-Link)."
fi

say "Done. Reboot now; the wall starts by itself and shows a 4-digit code."
echo "  Scan that code with your phone to add the screen in Atlántico."
read -r -p "  Reboot now? [Y/n] " ans </dev/tty || ans=n
[[ "${ans:-y}" =~ ^[Nn] ]] || sudo reboot
