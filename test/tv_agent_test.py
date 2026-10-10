"""The household TV agent (web/tv-agent.py), without a TV: python3 -m unittest test/tv_agent_test.py"""
import importlib.util
import json
import os
import socket
import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

spec = importlib.util.spec_from_file_location('tv_agent', os.path.join(os.path.dirname(__file__), '..', 'web', 'tv-agent.py'))
tv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tv)

MADRID = ZoneInfo('Europe/Madrid')
DAY = datetime(2026, 10, 9, 18, 0, tzinfo=MADRID).timestamp()
NIGHT = datetime(2026, 10, 10, 2, 0, tzinfo=MADRID).timestamp()


class FakeTV:
    pa = '2.0.0.0'

    def __init__(self):
        self.calls = []

    def __getattr__(self, name):
        if name in ('show', 'hand_back', 'claim', 'picture', 'key'):
            return lambda *a: self.calls.append((name, *a))
        raise AttributeError(name)

    def log(self, s):
        pass

    def did(self, name):
        return [c for c in self.calls if c[0] == name]


def worker(show=0, welcome=0, here=1, **extra):
    return {'show': show, 'welcome': welcome, 'here': here, 'scene': 'auto', 'hold': 0,
            'ambient': {'on': True, 'brightness': 40, 'kelvin': 2500},
            'lamps': [{'id': 'b1', 'device': 'AA:BB', 'side': 'left'}], **extra}


def started(now=DAY, power='on', screen='art'):
    io = FakeTV()
    a = tv.Agent(io)
    a.on_worker(worker(), now)
    a.on_power(power, now)
    a.screen = screen
    io.calls.clear()
    return a, io


class TheTV(unittest.TestCase):
    def test_any_remote_button_hands_the_screen_back(self):
        a, io = started()
        a.on_cec('key', None, DAY)
        a.on_cec('key', None, DAY + 0.4)   # the rest of the same burst
        self.assertEqual(len(io.did('hand_back')), 1)
        self.assertEqual(a.screen, 'away')
        self.assertIn(('key', 'F14'), io.calls)

    def test_switched_off_from_a_programme_brings_atlantico_back(self):
        a, io = started(screen='away')
        a.on_power('standby', DAY)
        a.tick(DAY + 2)
        self.assertFalse(io.did('show'), 'not straight away')
        a.tick(DAY + 5)
        self.assertEqual(len(io.did('show')), 1)
        self.assertEqual(a.screen, 'art')
        self.assertIn(('key', 'F13'), io.calls)

    def test_switched_off_from_atlantico_stays_off(self):
        a, io = started(screen='art')
        a.on_power('standby', DAY)
        a.tick(DAY + 10)
        self.assertFalse(io.did('show'))
        self.assertEqual(a.screen, 'off')

    def test_nobody_staying_or_night_and_it_stays_off_after_watching(self):
        a, io = started(screen='away')
        a.on_worker(worker(here=0), DAY)
        a.on_power('standby', DAY)
        a.tick(DAY + 10)
        self.assertFalse(io.did('show'))
        b, io2 = started(now=NIGHT, screen='away')
        b.on_power('standby', NIGHT)
        b.tick(NIGHT + 10)
        self.assertFalse(io2.did('show'))

    def test_an_arrival_wakes_a_tv_that_is_off_but_never_one_in_use(self):
        a, io = started(power='standby', screen='off')
        a.on_worker(worker(welcome=123), DAY)
        self.assertEqual(len(io.did('show')), 1)
        b, io2 = started(power='on', screen='away')
        b.on_worker(worker(welcome=123), DAY)
        self.assertFalse(io2.did('show'))

    def test_show_on_tv_works_even_at_night(self):
        a, io = started(now=NIGHT, power='standby', screen='off')
        a.tick(NIGHT)                      # night: the picture goes off
        self.assertIn(('picture', False), io.calls)
        a.on_worker(worker(show=999), NIGHT)
        self.assertIn(('picture', True), io.calls)
        self.assertEqual(len(io.did('show')), 1)
        a.tick(NIGHT + 60)                 # and it stays on for them
        self.assertEqual(io.calls.count(('picture', False)), 1)

    def test_nothing_old_happens_at_start(self):
        io = FakeTV()
        a = tv.Agent(io)
        a.on_worker(worker(show=5, welcome=7), DAY)
        a.on_power('standby', DAY)
        self.assertFalse(io.did('show'))

    def test_the_tv_sleeps_when_nobody_is_staying(self):
        a, io = started()
        a.on_worker(worker(here=0), DAY)
        a.tick(DAY)
        a.tick(DAY + 19 * 60)
        self.assertNotIn(('picture', False), io.calls)
        a.tick(DAY + 21 * 60)
        self.assertIn(('picture', False), io.calls)
        a.on_worker(worker(here=1), DAY + 30 * 60)
        a.tick(DAY + 30 * 60)
        self.assertIn(('picture', True), io.calls)

    def test_input_changes_from_the_tv(self):
        a, io = started(screen='art')
        a.on_cec('active', '1.0.0.0', DAY)
        self.assertEqual(a.screen, 'away')
        a.on_cec('path', '2.0.0.0', DAY)
        self.assertEqual(a.screen, 'art')
        self.assertFalse(io.did('show'), 'the TV switched by itself; nothing to send')

    def test_reading_the_bus(self):
        lines = [
            'Received from TV to all (0 to 15): ACTIVE_SOURCE (0x82):\n', '\tphys-addr: 0.0.0.0\n',
            'Transmitted by Playback Device 1 to TV (4 to 0): IMAGE_VIEW_ON (0x04)\n',
            'Received from TV to Playback Device 1 (0 to 4): USER_CONTROL_PRESSED (0x44):\n', '\tui-cmd: up (0x01)\n',
            'Received from TV to all (0 to 15): ROUTING_CHANGE (0x80):\n', '\torig-phys-addr: 2.0.0.0\n', '\tnew-phys-addr: 1.0.0.0\n',
            'Received from TV to all (0 to 15): STANDBY (0x36)\n',
        ]
        self.assertEqual(list(tv.parse(lines)), [('active', '0.0.0.0'), ('key', None), ('route', '1.0.0.0'), ('standby', None)])


class TheLamps(unittest.TestCase):
    def setUp(self):
        if tv.np is None:
            self.skipTest('numpy')
        self.np = tv.np

    def test_lamp_mode(self):
        a, _ = started(screen='away')
        self.assertIsNone(a.lamp_mode(DAY, camera=None), 'watching needs the camera')
        self.assertEqual(a.lamp_mode(DAY, camera=object()), 'tv')
        a.screen = 'art'
        self.assertEqual(a.lamp_mode(DAY, camera=None), 'art')
        a.on_worker(worker(scene='focus'), DAY)
        self.assertIsNone(a.lamp_mode(DAY, camera=None), "the owner's scene wins")
        a.on_worker(worker(hold=(DAY + 20) * 1000), DAY)
        self.assertIsNone(a.lamp_mode(DAY, camera=None), 'the tour has the lamps')

    def test_each_side_follows_its_side_of_the_picture(self):
        img = self.np.zeros((27, 48, 3), dtype=self.np.float32)
        img[:, :12] = (1.0, 0.1, 0.0)       # an explosion on the left
        img[:, 36:] = (0.0, 0.2, 1.0)       # blue sky on the right
        z = tv.zones(img)
        self.assertGreater(z['left'][0], 0.8)
        self.assertLess(z['left'][2], 0.1)
        self.assertGreater(z['right'][2], 0.8)
        self.assertLess(z['right'][0], 0.1)

    def test_a_flash_comes_through_at_once_and_fades_slowly(self):
        look = tv.Look()
        col, bri = look.target((1.0, 0.5, 0.1), 'tv', {})
        look.step(col, bri, 0.1, 'tv')
        self.assertGreater(look.bri, 0.7, 'up in a tenth of a second')
        dark_col, dark = look.target((0.0, 0.0, 0.0), 'tv', {})
        look.step(dark_col, dark, 0.1, 'tv')
        self.assertGreater(look.bri, 0.5, 'and down more gently')

    def test_atlantico_stays_near_the_rooms_own_light(self):
        look = tv.Look()
        _, bri = look.target((1.0, 1.0, 1.0), 'art', {'brightness': 30})
        self.assertLess(bri, 0.5)
        col, _ = look.target((0.8, 0.8, 0.8), 'art', {'brightness': 30})
        self.assertGreater(col[0], col[2], 'whites are warm on the walls')

    def test_sends_only_visible_changes_and_at_most_ten_a_second(self):
        look = tv.Look()
        look.rgb, look.bri = [1, 0, 0], 0.5
        self.assertEqual(look.due(10.0), ((255, 0, 0), 50))
        look.rgb = [0.99, 0, 0]
        self.assertEqual(look.due(10.5), (None, None), 'too small to see')
        look.rgb, look.bri = [0, 0, 1], 0.9
        self.assertEqual(look.due(10.6), ((0, 0, 255), 90))
        look.rgb = [0, 1, 0]
        self.assertEqual(look.due(10.65), (None, None), 'too soon after the last')
        self.assertEqual(look.due(10.75), ((0, 255, 0), None))

    def test_finding_the_screen_in_the_cameras_view(self):
        np = self.np
        # The camera sees the screen at an angle: a quadrilateral, not a rectangle.
        corners = [(60.0, 40.0), (270.0, 55.0), (255.0, 200.0), (70.0, 190.0)]
        h = tv.homography([(0, 0), (1, 0), (1, 1), (0, 1)], corners)
        black = np.zeros((240, 320, 3), dtype=np.uint8)
        marks = black.copy()
        for mx, my in tv.MARKS:
            p = h @ np.array([mx, my, 1.0])
            x, y = int(p[0] / p[2]), int(p[1] / p[2])
            marks[y - 3:y + 4, x - 3:x + 4] = 255
        found = tv.find_marks(marks, black)
        self.assertIsNotNone(found)
        for (fx, fy), (mx, my) in zip(found, tv.MARKS):
            p = h @ np.array([mx, my, 1.0])
            self.assertAlmostEqual(fx, p[0] / p[2], delta=1.5)
            self.assertAlmostEqual(fy, p[1] / p[2], delta=1.5)

    def test_govee_messages(self):
        rx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        rx.bind(('127.0.0.1', 0))
        rx.settimeout(2)
        g = tv.Govee()
        g.CONTROL = rx.getsockname()[1]
        g.color('127.0.0.1', (255, 40, 0))
        g.brightness('127.0.0.1', 64)
        g.on('127.0.0.1')
        got = [json.loads(rx.recvfrom(1024)[0]) for _ in range(3)]
        rx.close()
        g.tx.close()
        self.assertEqual(got[0], {'msg': {'cmd': 'colorwc', 'data': {'color': {'r': 255, 'g': 40, 'b': 0}, 'colorTemInKelvin': 0}}})
        self.assertEqual(got[1], {'msg': {'cmd': 'brightness', 'data': {'value': 64}}})
        self.assertEqual(got[2], {'msg': {'cmd': 'turn', 'data': {'value': 1}}})


if __name__ == '__main__':
    unittest.main()
