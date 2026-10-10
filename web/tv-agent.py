#!/usr/bin/env python3
"""Atlántico on the household TV, without getting in the way.

A Raspberry Pi on one of the TV's HDMI inputs shows the wall in Chromium (kiosk.sh shared). This
agent runs beside it, talks to the TV over HDMI-CEC and drives the lamps beside it:

  The TV
  · Any remote button that reaches Atlántico hands the screen straight back to the TV (its home,
    apps, guide or channels). Home, Input and app buttons don't reach it: the TV takes those.
  · Finished watching (switched off from a programme, by hand or by the TV's own no-button timer):
    Atlántico comes back instead of a black screen, if someone is staying and it isn't night.
    Switched off while Atlántico is showing, the TV stays off.
  · A guest walks in: if the TV is off it wakes for the welcome; if it's on, nothing changes.
  · "Show it on the TV" (guest page or Control) wakes it onto Atlántico, whatever the hour.
  · Nobody staying for 20 minutes, or 00:30–08:00: the Pi's picture goes off, so a TV left on
    Atlántico sees no signal and sleeps by itself. A TV showing anything else is never touched.
  · The wall keeps following arrivals and departures while the TV shows something else. The agent
    presses F13 on it when it's back on screen and F14 when it leaves, and it replays what it missed.

  The lamps (Govee lights with LAN Control, placed left, right or behind the TV in Control)
  · Watching TV: they follow the picture, side by side, from a small camera facing the screen (the
    Pi can't see inside the TV's own apps any other way). A flash on the left lights the left lamp.
  · On Atlántico, from dusk: they follow the wall itself, softly, near the room's own brightness,
    and its surprises (fireworks on the left, the left lamp).
  · Everything else (the tour, the owner's scenes) still comes from the Worker: the agent lets go
    of the lamps while the tour lights the room, or when the owner picks a scene by hand.

The Pi can't see what the TV's own apps are playing (no TV says so over HDMI), so "idle" is the
TV's own: being switched off from a programme, by hand or by its timer.

Run: tv-agent.py              (kiosk.sh starts it at login, again if it stops)
     tv-agent.py calibrate    (with Atlántico on the TV: finds the screen in the camera's view)
Config: ~/.config/atlantico/tv.json  {"api": ..., "token": ..., "device": ...}  (kiosk.sh writes it)
"""
import colorsys
import glob
import json
import math
import os
import queue
import re
import shutil
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

try:
    import numpy as np
except ImportError:  # the lamps can't follow the picture without it; everything else still works
    np = None

MADRID = ZoneInfo('Europe/Madrid')
HOME = os.path.expanduser('~/.config/atlantico')
CEC_LOG = '/run/atlantico/cec.log'   # written by the atlantico-cec service (listening needs root)
POLL_S = 5            # asks the Worker this often
POWER_S = 15          # asks the TV whether it's on this often
REPORT_S = 60         # tells the Worker it's still driving the lamps this often
EMPTY_S = 20 * 60     # nobody staying for this long: let the TV sleep
BACK_S = 4            # after watching: a moment, then Atlántico
KEY_GAP_S = 3         # one hand-back per burst of button presses


def quiet_hours(ts):
    """00:30–08:00 in Cádiz: nothing comes on by itself."""
    d = datetime.fromtimestamp(ts, MADRID)
    hm = d.hour * 100 + d.minute
    return 30 <= hm < 800


def log(s):
    print(f'{time.strftime("%Y-%m-%d %H:%M:%S")} {s}', flush=True)


# ── Decisions ───────────────────────────────────────────────────────────────────────────────────

class Agent:
    """What to do and when. Everything it does goes through `io`, so it can be tested without a TV."""

    def __init__(self, io):
        self.io = io
        self.screen = 'unknown'   # art: Atlántico is on screen · away: something else · off
        self.power = 'unknown'    # on · standby · unknown (the TV doesn't say)
        self.picture = True       # the Pi's own HDMI picture
        self.resting = False      # night, or nobody staying
        self.seen = None          # the last (show request, welcome) from the Worker
        self.here = 1
        self.worker = None        # the Worker's last answer (scene, hold, ambient, lamps)
        self.empty_since = None
        self.last_key = 0.0
        self.back_at = None

    # What's on the screen
    def set_screen(self, s, why):
        if s == self.screen:
            return
        prev, self.screen = self.screen, s
        self.io.log(f'{prev} -> {s} ({why})')
        if s == 'art':
            self.io.key('F13')             # the wall: you're on screen again
        elif s in ('away', 'off') and prev in ('art', 'unknown'):
            self.io.key('F14')             # the wall: from now on, remember what happens

    def to_art(self, why):
        self.set_picture(True)
        self.io.show()                     # wake the TV and switch it to this input
        self.back_at = None
        self.set_screen('art', why)

    def set_picture(self, on, why=''):
        if on != self.picture:
            self.picture = on
            self.io.picture(on)
            self.io.log(f'picture {"on" if on else "off"}{f" ({why})" if why else ""}')

    def may_return(self, now):
        return self.here > 0 and not quiet_hours(now)

    # Events
    def on_cec(self, kind, pa, now):
        if kind == 'key':
            # Only the input on screen gets the remote's buttons: a press here means Atlántico is
            # showing. Hand it back to the TV straight away.
            if now - self.last_key > KEY_GAP_S:
                self.io.hand_back()
                self.set_screen('away', 'remote button')
            self.last_key = now
        elif kind in ('active', 'route', 'path') and pa:
            if pa == self.io.pa:
                self.set_screen('art', 'TV switched to Atlántico')
            else:
                self.set_screen('away', f'TV switched to {pa}')
        elif kind == 'standby':
            self.on_power('standby', now)
        elif kind == 'request' and self.screen == 'art':
            self.io.claim()                # the TV asks who's showing: still Atlántico

    def on_power(self, p, now):
        if p not in ('on', 'standby') or p == self.power:
            return
        prev, self.power = self.power, p
        if p == 'standby':
            was = self.screen
            self.set_screen('off', 'TV off')
            # Off from a programme (by hand or its own timer): Atlántico instead of black, in a moment.
            if prev == 'on' and was in ('away', 'unknown') and self.may_return(now):
                self.back_at = now + BACK_S
        elif prev == 'standby':
            # Someone switched it on: whatever input it wakes on, Atlántico has a picture ready.
            self.set_picture(True)
            self.set_screen('unknown', 'TV on')

    def on_worker(self, w, now):
        self.worker = w
        self.here = w.get('here', 0)
        show, welcome = w.get('show', 0), w.get('welcome', 0)
        if self.seen is None:              # just started: nothing old is new
            self.seen = (show, welcome)
            return
        (show0, welcome0), self.seen = self.seen, (show, welcome)
        if show != show0:
            self.to_art('asked for')
        elif welcome and welcome != welcome0 and not quiet_hours(now) and self.power == 'standby':
            self.to_art('a guest walked in')

    def tick(self, now):
        if self.back_at and now >= self.back_at:
            self.back_at = None
            if self.power == 'standby' and self.may_return(now):
                self.to_art('finished watching')
        if self.here > 0:
            self.empty_since = None
        elif self.empty_since is None:
            self.empty_since = now
        quiet = quiet_hours(now)
        rest = quiet or (self.empty_since is not None and now - self.empty_since >= EMPTY_S)
        if rest != self.resting:           # only at the edges, so a request at night stays on
            self.resting = rest
            self.set_picture(not rest, 'night' if quiet else 'nobody staying' if rest else 'morning')

    def lamp_mode(self, now, camera):
        """How the lamps beside the TV should follow it now: 'tv', 'art' or None (the Worker's)."""
        w = self.worker
        if not w or not w.get('lamps') or w.get('scene') not in ('auto', 'hosting'):
            return None                    # no lamps placed, or the owner picked a scene by hand
        if w.get('hold', 0) > now * 1000 or self.power == 'standby':
            return None                    # the tour is lighting the room, or the TV is off
        if self.screen == 'art' and self.picture:
            return 'art' if w.get('ambient', {}).get('on') else None  # by day the room has the sun
        if self.screen in ('away', 'unknown') and self.power == 'on' and camera:
            return 'tv'
        return None


# ── The TV over HDMI-CEC, the Pi's picture, keys to the wall ────────────────────────────────────

class TV:
    def __init__(self):
        self.dev = None
        self.pa = None

    def cec(self, *args, timeout=10):
        try:
            return subprocess.run(['cec-ctl', '-d', self.dev, '-s', *args], capture_output=True, text=True, timeout=timeout).stdout
        except Exception as e:  # noqa: BLE001 — a missing reply is not a reason to stop
            log(f'cec-ctl {" ".join(args)}: {e}')
            return ''

    def find(self):
        """The CEC adapter with a TV on it (a Pi 5 has two HDMI ports)."""
        for dev in sorted(glob.glob('/dev/cec*')):
            self.dev = dev
            subprocess.run(['cec-ctl', '-d', dev, '--playback', '--osd-name', 'Atlantico'], capture_output=True, timeout=15)
            out = subprocess.run(['cec-ctl', '-d', dev], capture_output=True, text=True, timeout=10).stdout
            m = re.search(r'Physical Address\s*:\s*([0-9a-f]\.[0-9a-f]\.[0-9a-f]\.[0-9a-f])', out)
            if m and m.group(1) != 'f.f.f.f':
                self.pa = m.group(1)
                log(f'TV on {dev}; Atlántico is its input {self.pa}')
                return True
        return False

    def show(self):
        self.cec('--to', '0', '--image-view-on')
        time.sleep(1.5)
        self.claim()

    def claim(self):
        self.cec('--to', '15', '--active-source', f'phys-addr={self.pa}')

    def hand_back(self):
        self.cec('--to', '0', '--inactive-source', f'phys-addr={self.pa}')

    def power_state(self):
        m = re.search(r'pwr-state:\s*(\w+)', self.cec('--to', '0', '--give-device-power-status'))
        return m.group(1) if m and m.group(1) in ('on', 'standby') else 'unknown'

    @staticmethod
    def picture(on):
        if os.environ.get('WAYLAND_DISPLAY') and shutil.which('wlr-randr'):
            out = subprocess.run(['wlr-randr'], capture_output=True, text=True).stdout
            name = next((ln.split()[0] for ln in out.splitlines() if ln and not ln[0].isspace()), None)
            if name:
                subprocess.run(['wlr-randr', '--output', name, '--on' if on else '--off'], capture_output=True)
        elif os.environ.get('DISPLAY') and shutil.which('xrandr'):
            out = subprocess.run(['xrandr'], capture_output=True, text=True).stdout
            name = next((ln.split()[0] for ln in out.splitlines() if ' connected' in ln), None)
            if name:
                subprocess.run(['xrandr', '--output', name, '--auto' if on else '--off'], capture_output=True)

    @staticmethod
    def key(k):
        if os.environ.get('WAYLAND_DISPLAY') and shutil.which('wtype'):
            subprocess.run(['wtype', '-k', k], capture_output=True)
        elif shutil.which('xdotool'):
            subprocess.run(['xdotool', 'key', k], capture_output=True)

    log = staticmethod(log)

    def listen(self, events):
        """What the TV says on the bus, from the atlantico-cec service's log (monitoring needs root)."""
        def run():
            f, inode = None, None
            while True:
                try:
                    st = os.stat(CEC_LOG)
                    if f is None or st.st_ino != inode or st.st_size < f.tell():
                        if f:
                            f.close()
                        f, inode = open(CEC_LOG, errors='replace'), st.st_ino
                        f.seek(0, os.SEEK_END)
                    lines = f.readlines()
                    for kind, pa in parse(lines, self):
                        events.put((kind, pa))
                except OSError:
                    f = None
                time.sleep(0.2)
        threading.Thread(target=run, daemon=True).start()

    def remote_keys(self, events):
        """The remote's buttons as the kernel passes them on (the CEC adapter's input device)."""
        def run(path):
            fmt = 'llHHi'
            size = struct.calcsize(fmt)
            while True:
                try:
                    with open(path, 'rb') as f:
                        while True:
                            data = f.read(size)
                            if len(data) < size:
                                break
                            _, _, typ, _, value = struct.unpack(fmt, data)
                            if typ == 1 and value == 1:  # EV_KEY, pressed
                                events.put(('key', None))
                except OSError:
                    pass
                time.sleep(5)
        for name_file in glob.glob('/sys/class/input/event*/device/name'):
            try:
                with open(name_file) as f:
                    name = f.read().strip()
            except OSError:
                continue
            if re.search(r'cec|hdmi', name, re.I):
                path = '/dev/input/' + name_file.split('/')[4]
                threading.Thread(target=run, args=(path,), daemon=True).start()
                log(f'remote buttons from {name} ({path})')


HEAD = re.compile(r'^\s*Received from .*?\((\d+) to (\d+)\):\s*([A-Z_]+)')
PARAM = re.compile(r'^\s+([a-z-]+):\s*([0-9a-f]\.[0-9a-f]\.[0-9a-f]\.[0-9a-f])')
SIMPLE = {'USER_CONTROL_PRESSED': 'key', 'STANDBY': 'standby', 'REQUEST_ACTIVE_SOURCE': 'request'}
WITH_PA = {'ACTIVE_SOURCE': ('active', 'phys-addr'), 'SET_STREAM_PATH': ('path', 'phys-addr'),
           'ROUTING_CHANGE': ('route', 'new-phys-addr'), 'ROUTING_INFORMATION': ('route', 'phys-addr')}


def parse(lines, tv=None):
    """cec-ctl's printout → (kind, phys-addr) events."""
    pending = None
    for line in lines:
        m = HEAD.match(line)
        if m:
            msg = m.group(3)
            pending = WITH_PA.get(msg)
            if msg in SIMPLE:
                yield SIMPLE[msg], None
            continue
        if not line[:1].isspace():
            pending = None                 # a transmit or an event: not something the TV said
        pa_change = re.search(r'State Change: PA ([0-9a-f]\.[0-9a-f]\.[0-9a-f]\.[0-9a-f])', line)
        if pa_change and tv and pa_change.group(1) != 'f.f.f.f':
            tv.pa = pa_change.group(1)
        p = PARAM.match(line)
        if p and pending and p.group(1) == pending[1]:
            yield pending[0], p.group(2)
            pending = None


# ── The lamps: the picture, side by side, over the local network ────────────────────────────────

SIDES = {'left': (0.0, 0.3), 'right': (0.7, 1.0), 'behind': (0.2, 0.8), 'room': (0.0, 1.0)}


def zones(img):
    """Screen-space picture (H×W×3, 0..1) → one colour per side. Bright, colourful parts count more
    (like the glow a screen throws on a wall), so a small explosion still colours its side."""
    w = img.shape[1]
    v = img.max(axis=2)
    weight = 0.08 + v * v
    out = {}
    for side, (a, b) in SIDES.items():
        x0, x1 = int(a * w), max(int(a * w) + 1, int(round(b * w)))
        wt = weight[:, x0:x1, None]
        out[side] = tuple((img[:, x0:x1] * wt).sum(axis=(0, 1)) / wt.sum())
    return out


class Look:
    """One lamp's colour and brightness, chasing the picture: quick up (a flash), slower down."""

    def __init__(self):
        self.rgb = [1.0, 0.75, 0.5]
        self.bri = 0.0
        self.sent_rgb = None
        self.sent_bri = None
        self.sent_at = 0.0

    def target(self, rgb, mode, ambient):
        r, g, b = (min(1.0, max(0.0, c)) for c in rgb)
        h, s, v = colorsys.rgb_to_hsv(r, g, b)
        if s < 0.12:
            # Greys and whites: a warm white, not a cold blue-white wash on the walls.
            col = (1.0, 0.82, 0.62)
        else:
            col = colorsys.hsv_to_rgb(h, min(1.0, s * (1.5 if mode == 'tv' else 1.25)), 1.0)
        if mode == 'tv':
            bri = max(0.02, min(1.0, v ** 0.8))
        else:
            # Atlántico: near the room's own level; its surprises may lift it a little above.
            base = max(0.12, ambient.get('brightness', 30) / 100)
            bri = max(0.05, min(1.0, base * (0.55 + 0.9 * v)))
        return col, bri

    def step(self, col, bri, dt, mode):
        up, down = (0.06, 0.45) if mode == 'tv' else (0.5, 2.2)
        jump = bri - self.bri
        if mode == 'art' and jump > 0.25:
            up = 0.12                       # fireworks: let them flash
        k_b = 1 - math.exp(-dt / (up if jump > 0 else down))
        self.bri += jump * k_b
        k_c = 1 - math.exp(-dt / (up * 1.5 if jump > 0 else down * 0.8))
        self.rgb = [c + (t - c) * k_c for c, t in zip(self.rgb, col)]

    def due(self, now):
        """What to send now (if anything): colour and brightness, only when they visibly changed."""
        if now - self.sent_at < 0.1:       # no lamp needs more than ten changes a second
            return None, None
        rgb = tuple(int(round(c * 255)) for c in self.rgb)
        bri = max(1, min(100, int(round(self.bri * 100))))
        send_rgb = self.sent_rgb is None or max(abs(a - b) for a, b in zip(rgb, self.sent_rgb)) > 6
        send_bri = self.sent_bri is None or abs(bri - self.sent_bri) >= 2
        if send_rgb or send_bri:
            self.sent_at = now
        if send_rgb:
            self.sent_rgb = rgb
        if send_bri:
            self.sent_bri = bri
        return (rgb if send_rgb else None), (bri if send_bri else None)


class Govee:
    """Govee's LAN API: find the lamps (multicast), then plain UDP JSON to each."""
    GROUP, SCAN, REPLY, CONTROL = '239.255.255.250', 4001, 4002, 4003

    def __init__(self):
        self.ips = {}                      # device id (upper case) → ip
        self.tx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def discover(self, seconds=2.5):
        rx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        rx.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            rx.bind(('', self.REPLY))
            rx.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, socket.inet_aton(self.GROUP) + socket.inet_aton('0.0.0.0'))
            self.tx.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
            self.tx.sendto(json.dumps({'msg': {'cmd': 'scan', 'data': {'account_topic': 'reserve'}}}).encode(), (self.GROUP, self.SCAN))
            rx.settimeout(0.3)
            end = time.time() + seconds
            while time.time() < end:
                try:
                    data, _ = rx.recvfrom(4096)
                    d = json.loads(data).get('msg', {}).get('data', {})
                    if d.get('device') and d.get('ip'):
                        self.ips[d['device'].upper()] = d['ip']
                except (socket.timeout, ValueError):
                    pass
        except OSError as e:
            log(f'finding lamps: {e}')
        finally:
            rx.close()
        return self.ips

    def send(self, ip, cmd, data):
        try:
            self.tx.sendto(json.dumps({'msg': {'cmd': cmd, 'data': data}}).encode(), (ip, self.CONTROL))
        except OSError:
            pass

    def color(self, ip, rgb):
        self.send(ip, 'colorwc', {'color': {'r': rgb[0], 'g': rgb[1], 'b': rgb[2]}, 'colorTemInKelvin': 0})

    def brightness(self, ip, b):
        self.send(ip, 'brightness', {'value': b})

    def on(self, ip):
        self.send(ip, 'turn', {'value': 1})


class Screen:
    """Atlántico's own picture, straight from the Pi's display (no camera needed)."""

    def grab(self):
        if not shutil.which('grim'):
            return None
        try:
            out = subprocess.run(['grim', '-s', '0.05', '-t', 'ppm', '-'], capture_output=True, timeout=3).stdout
            return ppm(out)
        except Exception:  # noqa: BLE001
            return None


def ppm(data):
    """A binary PPM (P6) → H×W×3 floats 0..1."""
    m = re.match(rb'P6\s+(\d+)\s+(\d+)\s+(\d+)\s', data)
    if not m:
        return None
    w, h, mx = (int(x) for x in m.groups())
    px = np.frombuffer(data, dtype=np.uint8, count=w * h * 3, offset=m.end())
    return px.reshape(h, w, 3).astype(np.float32) / mx


def homography(src, dst):
    """3×3 matrix taking the four `src` points to the four `dst` points."""
    a = []
    for (x, y), (u, v) in zip(src, dst):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    h = np.linalg.solve(np.array(a, dtype=np.float64), np.array([c for p in dst for c in p], dtype=np.float64))
    return np.append(h, 1).reshape(3, 3)


MARKS = [(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)]  # where the wall draws its four squares (F15)


def find_marks(marks, black):
    """The four white squares in the camera's view: their centres, top-left first, clockwise."""
    diff = marks.astype(np.float32).mean(axis=2) - black.astype(np.float32).mean(axis=2)
    if diff.max() < 25:
        return None
    ys, xs = np.nonzero(diff > diff.max() * 0.5)
    cx, cy = xs.mean(), ys.mean()
    out = []
    for qx, qy in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
        sel = ((xs - cx) * qx > 0) & ((ys - cy) * qy > 0)
        if sel.sum() < 3:
            return None
        out.append((float(xs[sel].mean()), float(ys[sel].mean())))
    return out


class Camera:
    """A Pi camera facing the TV: the picture whatever the TV is showing, mapped to the screen."""
    GRID = (27, 48)                        # samples across the screen (rows, columns)

    def __init__(self):
        from picamera2 import Picamera2  # noqa: PLC0415 — only on a Pi with a camera
        self.cam = Picamera2()
        self.cam.configure(self.cam.create_video_configuration(main={'size': (320, 240), 'format': 'RGB888'}, controls={'FrameRate': 20}))
        self.cam.start()
        self.map = None
        self.black, self.white = 0.0, 255.0
        self.load()

    @staticmethod
    def open():
        try:
            return Camera()
        except Exception:  # noqa: BLE001 — no camera (yet): the lamps follow Atlántico only
            return None

    def frame(self):
        return self.cam.capture_array('main')[..., ::-1]  # Picamera2's RGB888 is B, G, R in memory

    def load(self):
        try:
            with open(os.path.join(HOME, 'camera.json')) as f:
                c = json.load(f)
            self.set_map(c['corners'])
            self.black, self.white = c['black'], c['white']
            if c.get('controls'):
                self.cam.set_controls({k: tuple(v) if isinstance(v, list) else v for k, v in c['controls'].items()})
        except (OSError, ValueError, KeyError):
            self.set_map(None)

    def set_map(self, corners):
        """Where each sample point of the screen lands in the camera's picture."""
        rows, cols = self.GRID
        if corners:
            h = homography(MARKS, corners)
        else:  # not calibrated yet: assume the screen fills the middle of the view
            h = homography([(0, 0), (1, 0), (1, 1), (0, 1)], [(32, 24), (288, 24), (288, 216), (32, 216)])
        u, v = np.meshgrid((np.arange(cols) + 0.5) / cols, (np.arange(rows) + 0.5) / rows)
        p = h @ np.stack([u.ravel(), v.ravel(), np.ones(u.size)])
        xs = np.clip(np.round(p[0] / p[2]).astype(int), 0, 319)
        ys = np.clip(np.round(p[1] / p[2]).astype(int), 0, 239)
        self.map = (ys, xs)

    def grab(self):
        f = self.frame().astype(np.float32)
        px = f[self.map].reshape(*self.GRID, 3)
        return np.clip((px - self.black) / max(1.0, self.white - self.black), 0, 1)

    def calibrate(self, key):
        """Asks the wall for its marks (F15) and finds the screen; locks exposure and white balance."""
        self.cam.set_controls({'AeEnable': True, 'AwbEnable': True})
        time.sleep(1.5)
        key('F15')
        t0 = time.time()
        at = lambda s: time.sleep(max(0, t0 + s - time.time()))  # noqa: E731
        at(1.9); marks = self.frame()
        at(3.9); black = self.frame()
        at(5.6); md = self.cam.capture_metadata(); white = self.frame()
        corners = find_marks(marks, black)
        if not corners:
            log('calibrate: no marks found. Is Atlántico on the TV, and the camera facing it?')
            return False
        self.set_map(corners)
        b = float(black.astype(np.float32)[self.map].mean())
        w = float(white.astype(np.float32)[self.map].mean())
        controls = {'AeEnable': False, 'AwbEnable': False, 'ExposureTime': md.get('ExposureTime'),
                    'AnalogueGain': md.get('AnalogueGain'), 'ColourGains': list(md.get('ColourGains', (1.5, 1.5)))}
        self.cam.set_controls({k: tuple(v) if isinstance(v, list) else v for k, v in controls.items()})
        self.black, self.white = b, w
        os.makedirs(HOME, exist_ok=True)
        with open(os.path.join(HOME, 'camera.json'), 'w') as f:
            json.dump({'corners': corners, 'black': b, 'white': w, 'controls': controls}, f)
        log(f'calibrated: screen corners {[(round(x), round(y)) for x, y in corners]}, black {b:.0f}, white {w:.0f}')
        return True


class Lamps:
    """Runs the lamps from the picture while `mode` is 'tv' or 'art'; idle otherwise."""

    def __init__(self, govee, screen, camera):
        self.govee, self.screen, self.camera = govee, screen, camera
        self.mode, self.lamps, self.ambient = None, [], {}
        self.looks = {}
        self.driving = []                  # lamp ids actually being driven (found on the network)
        self.lock = threading.Lock()
        self.found_at = 0.0

    def set(self, mode, lamps, ambient):
        with self.lock:
            if mode and lamps and time.time() - self.found_at > (60 if not self.govee.ips else 600):
                self.found_at = time.time()
                self.govee.discover()
            ids = self.govee.ips
            driving = [lamp for lamp in lamps if (lamp.get('device') or '').upper() in ids] if mode else []
            started = [lamp for lamp in driving if lamp['id'] not in self.driving]
            for lamp in started:
                self.govee.on(ids[lamp['device'].upper()])
                self.looks[lamp['id']] = Look()
            self.mode, self.lamps, self.ambient = mode, driving, ambient
            self.driving = [lamp['id'] for lamp in driving]

    def run(self):
        last = time.time()
        while True:
            with self.lock:
                mode, lamps, ambient = self.mode, list(self.lamps), dict(self.ambient)
            if not mode or not lamps or np is None:
                time.sleep(0.5)
                last = time.time()
                continue
            src = self.camera if mode == 'tv' else self.screen
            img = src.grab() if src else None
            now = time.time()
            dt, last = now - last, now
            if img is None:
                time.sleep(0.5)
                continue
            z = zones(img)
            for lamp in lamps:
                look = self.looks.setdefault(lamp['id'], Look())
                col, bri = look.target(z[lamp['side']], mode, ambient)
                look.step(col, bri, dt, mode)
                rgb, b = look.due(now)
                ip = self.govee.ips.get(lamp['device'].upper())
                if ip and rgb:
                    self.govee.color(ip, rgb)
                if ip and b:
                    self.govee.brightness(ip, b)
            time.sleep(max(0.0, (0.05 if mode == 'tv' else 0.2) - (time.time() - now)))


# ── The Worker ──────────────────────────────────────────────────────────────────────────────────

class Worker:
    def __init__(self, cfg):
        self.api, self.token = cfg['api'].rstrip('/'), cfg['token']

    def call(self, path, body=None):
        req = urllib.request.Request(f'{self.api}{path}', method='POST' if body is not None else 'GET',
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={'authorization': f'Bearer {self.token}', 'content-type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=8) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 401:
                log('This TV was removed in Atlántico. Run kiosk.sh again to add it back.')
                time.sleep(300)
            return None
        except Exception:  # noqa: BLE001 — offline for a moment: ask again shortly
            return None


def main():
    try:
        with open(os.path.join(HOME, 'tv.json')) as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        sys.exit(f'No {HOME}/tv.json: run kiosk.sh (shared) to add this TV first.')
    tv = TV()
    while not tv.find():
        log('No TV on HDMI-CEC yet (is CEC on in its settings?). Trying again in a minute.')
        time.sleep(60)
    camera = Camera.open() if np is not None else None
    if len(sys.argv) > 1 and sys.argv[1] == 'calibrate':
        sys.exit(0 if camera and camera.calibrate(tv.key) else 1)
    log(f'camera: {"yes" if camera else "none (lamps follow Atlántico only)"}')
    worker = Worker(cfg)
    events = queue.Queue()
    tv.listen(events)
    tv.remote_keys(events)
    agent = Agent(tv)
    lamps = Lamps(Govee(), Screen(), camera)
    threading.Thread(target=lamps.run, daemon=True).start()
    if camera and not os.path.exists(os.path.join(HOME, 'camera.json')):
        log('The camera is not calibrated yet: it calibrates the next time Atlántico is on screen.')
    next_poll = next_power = next_report = 0.0
    reported = None
    while True:
        try:
            kind, pa = events.get(timeout=0.5)
            agent.on_cec(kind, pa, time.time())
            continue
        except queue.Empty:
            pass
        now = time.time()
        if now >= next_poll:
            next_poll = now + POLL_S
            w = worker.call('/api/tv')
            if w:
                agent.on_worker(w, now)
        if now >= next_power:
            next_power = now + POWER_S
            agent.on_power(tv.power_state(), now)
        agent.tick(now)
        # The camera finds the screen the first time Atlántico is showing on it.
        if camera and agent.screen == 'art' and agent.power == 'on' and not os.path.exists(os.path.join(HOME, 'camera.json')):
            camera.calibrate(tv.key)
        mode = agent.lamp_mode(now, camera)
        lamps.set(mode, (agent.worker or {}).get('lamps', []), (agent.worker or {}).get('ambient', {}))
        state = (agent.screen, bool(lamps.driving), tuple(lamps.driving))
        if state != reported or now >= next_report:
            ok = worker.call('/api/tv/state', {'screen': agent.screen, 'sync': bool(lamps.driving), 'lamps': list(lamps.driving)}) is not None
            reported, next_report = (state, now + REPORT_S) if ok else (None, now + 15)


if __name__ == '__main__':
    main()
