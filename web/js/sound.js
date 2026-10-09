import { scaleOf } from '../lib/surprise.js';

// Soft sounds, synthesized on the spot (no audio files): surf, bell-like chimes, a slow chord.
// Browsers only allow sound after a tap, so it is always opt-in; the choice is remembered.
const KEY = 'atlantico-sound';
let ac = null, out = null;

export const soundWanted = () => { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } };

/** Call from a tap. Returns whether sound is now playing. */
export async function enableSound(on = true) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
  if (!on) { await ac?.suspend(); return false; }
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    out = ac.createGain();
    out.gain.value = 0.7;
    out.connect(ac.destination);
  }
  await ac.resume().catch(() => {});
  return ac.state === 'running';
}

/** Without a tap this succeeds only where the browser already allows sound (kiosk tablets). */
export async function wakeSound() {
  if (!soundWanted()) return false;
  return enableSound(true).catch(() => false);
}

const live = () => ac && ac.state === 'running';

/** A bell: a few inharmonic partials, each fading at its own pace. */
export function chime(freq = 660, when = 0, level = 0.1) {
  if (!live()) return;
  const t = ac.currentTime + when;
  for (const [ratio, amp, decay] of [[1, 1, 2.8], [2, 0.38, 1.9], [2.76, 0.22, 1.3], [5.4, 0.08, 0.7]]) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine';
    o.frequency.value = freq * ratio;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level * amp, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + decay + 0.05);
  }
}

/** One wave reaching the shore: filtered noise that swells and draws back. */
export function surf(seconds = 5, level = 0.18) {
  if (!live()) return;
  const n = ac.sampleRate * seconds, buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
  let b = 0;
  for (let i = 0; i < n; i++) { b = 0.985 * b + 0.15 * (Math.random() * 2 - 1); d[i] = b; } // soft brown-ish noise
  const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), t = ac.currentTime;
  src.buffer = buf;
  f.type = 'lowpass';
  f.frequency.setValueAtTime(350, t);
  f.frequency.linearRampToValueAtTime(1400, t + seconds * 0.4);
  f.frequency.linearRampToValueAtTime(300, t + seconds);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + seconds * 0.4);
  g.gain.linearRampToValueAtTime(0, t + seconds);
  src.connect(f).connect(g).connect(out);
  src.start(t);
}

/** The arrival on the wall: three rising notes, like a star catching. */
export const arrivalSound = () => { chime(659, 0, 0.09); chime(988, 0.22, 0.08); chime(1319, 0.44, 0.07); };

/** Each tour stop has its own small sound. */
export function stopSound(stop) {
  switch (stop) {
    case 'sea': surf(5.5); chime(220, 0.6, 0.06); break;
    case 'star': chime(880, 0, 0.08); chime(1320, 0.18, 0.06); break;
    case 'edition': [523, 587, 659, 784, 880].forEach((f, i) => chime(f, i * 0.16, 0.06)); break;
    case 'sky': [392, 494, 587].forEach((f) => chime(f, 0, 0.05)); break;
    case 'plants': chime(660, 0, 0.07); chime(990, 0.1, 0.05); break;
    case 'light': chime(440, 0, 0.07); chime(330, 0.5, 0.07); break;
    case 'end': chime(523, 0, 0.07); chime(784, 0.3, 0.06); break;
  }
}

// ── Surprises: a melody grown from the recipe, plus sounds timed to what is happening ──────────

function tone(type, freq, when, level, attack, decay, glideTo = null) {
  const t = ac.currentTime + when, o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + attack + decay);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + attack + decay + 0.05);
}
function noise(when, seconds, level, from, to) {
  const n = Math.floor(ac.sampleRate * seconds), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
  const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), t = ac.currentTime + when;
  src.buffer = buf; f.type = 'bandpass'; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + seconds);
  g.gain.value = level;
  src.connect(f).connect(g).connect(out);
  src.start(t);
}
function note(timbre, f, when) {
  if (timbre === 'pluck') tone('triangle', f, when, 0.07, 0.005, 0.6);
  else if (timbre === 'glass') { tone('sine', f * 2, when, 0.04, 0.01, 1.6); tone('sine', f * 3.01, when, 0.015, 0.01, 1.1); }
  else if (timbre === 'pad') tone('sine', f / 2, when, 0.05, 0.6, 2.4);
  else chime(f, when, 0.06);
}

/** Play a surprise's sound: `cues(layer)` gives the moments things happen in that layer. */
export function surpriseSound(rec, cues) {
  if (!live()) return;
  const steps = scaleOf(rec.sound.mode);
  for (let i = 0; i < rec.sound.notes; i++) {
    const deg = rec.sound.steps[i % rec.sound.steps.length], oct = Math.floor(deg / steps.length);
    note(rec.sound.timbre, rec.sound.root * Math.pow(2, (steps[deg % steps.length] + 12 * oct) / 12), 0.2 + i * rec.sound.tempo);
  }
  for (const L of rec.layers) {
    const at = (m) => L.delay + m;
    for (const m of cues(L).slice(0, 14)) {
      if (L.kind === 'fireworks') { noise(at(m) + 0.7, 0.35, 0.5, 1800, 200); noise(at(m) + 0.75, 1.2, 0.08, 4000, 2500); }
      else if (L.kind === 'dolphins' || L.kind === 'dive' || L.kind === 'flyingfish') noise(at(m) + 1.2, 0.4, 0.25, 900, 2400);
      else if (L.kind === 'whale') tone('sine', 230, at(m) + 0.5, 0.06, 0.8, 2.6, 130);
      else if (L.kind === 'tallship') [0, 0.6, 1.2].forEach((d) => chime(523, at(m) + 1 + d, 0.07));
      else if (L.kind === 'lighthouse') tone('sine', 98, at(m) + 0.5, 0.07, 0.4, 2.2);
      else if (L.kind === 'meteors' || L.kind === 'comet' || L.kind === 'constellation') chime(1320 + 220 * Math.random(), at(m), 0.03);
    }
  }
}
