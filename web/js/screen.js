// This browser as a screen on the wall. Until the owner adds it, it shows a small code (and a QR
// for their phone); once added it checks in every few minutes, keeps the display awake, dims at
// night unless someone is arriving, and nudges the picture a few pixels now and then on OLED
// panels so nothing burns in.
const KEY = 'atlantico-screen';
const SKIP = 'atlantico-screen-skip';
const BEAT_MS = 5 * 60000;

const load = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; } };
const store = (v) => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* private mode */ } };

let api = '';
let me = load();
let lastBeat = 0;
let lock = null;

/** Called once by the wall page. Returns helpers the frame loop uses. */
export function screen({ api: base, canvas }) {
  api = base;
  const params = new URLSearchParams(location.search);
  let embedded = false;
  try { embedded = window.top !== window; } catch { embedded = true; }
  const quiet = embedded || params.has('preview');

  if (!quiet) {
    keepAwake();
    if (me) beat(true);
    else if (!params.has('nocode') && !skipped()) offerCode();
    setInterval(() => beat(false), BEAT_MS);
  }

  return {
    /** 0 = full picture … 1 = black. `busy` = an arrival, tour or song is playing. */
    night(now, busy) {
      const mode = me?.config?.night ?? 'on';
      if (quiet || mode === 'on' || busy) return 0;
      const h = madridHour(now);
      // From half past midnight to seven: a quiet hour either side.
      const t = h < 12 ? h + 24 : h;
      const inNight = t >= 24.5 && t < 31;
      const edge = Math.min(1, Math.max(0, Math.min(t - 24.5, 31 - t) * 2)); // fade over half an hour
      if (!inNight) return 0;
      return (mode === 'off' ? 1 : 0.72) * edge;
    },
    /** OLED care: a slow drift of a few pixels, applied to the canvas. */
    shift(now) {
      if (quiet || !me?.config?.oled) { canvas.style.transform = ''; return; }
      const dx = Math.round(5 * Math.sin(now / 517000)), dy = Math.round(4 * Math.sin(now / 731000));
      canvas.style.transform = `translate(${dx}px, ${dy}px)`;
    },
    /** The wall saw a change: settings may have changed too. */
    changed() { if (me && Date.now() - lastBeat > 20000) beat(false); },
    get name() { return me?.name ?? null; },
  };
}

function madridHour(ms) {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms)).split(':').map(Number);
  return h + m / 60;
}

// The display stays on while the wall is showing (where the browser supports it).
async function keepAwake() {
  const get = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch { /* not allowed yet */ } };
  await get();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') get(); });
  addEventListener('click', get);
}

async function beat(first) {
  if (!me) return;
  lastBeat = Date.now();
  try {
    const r = await fetch(`${api}/api/screen/beat`, {
      method: 'POST', headers: { authorization: `Bearer ${me.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ w: screen.width, h: screen.height }),
    });
    if (r.status === 401) { store((me = null)); if (first) offerCode(); return; } // removed on the control page
    if (r.ok) { const d = await r.json(); me = { ...me, name: d.name, config: d.config }; store(me); }
  } catch { /* offline: keep the last settings */ }
}

const skipped = () => { try { return Number(localStorage.getItem(SKIP) ?? 0) > Date.now(); } catch { return false; } };

// A quiet card in the corner: "add this screen", with the code and a QR for the owner's phone.
async function offerCode() {
  let hi;
  try {
    const r = await fetch(`${api}/api/screen/hello`, { method: 'POST' });
    if (!r.ok) return;
    hi = await r.json();
  } catch { return; }
  const addUrl = new URL(`add?screen=${hi.code}`, location.href).href;
  const card = document.createElement('div');
  card.className = 'screen-code';
  card.innerHTML = `<div class="qr"></div><div><p class="t">¿Añadir esta pantalla?<span>Add this screen</span></p>
    <p class="c"></p><p class="h">Escanéalo con tu móvil, o escribe el código en <b>Add device</b>.<br>Scan with your phone, or type the code on Add device.</p></div>
    <button type="button" aria-label="Not now">×</button>`;
  card.querySelector('.c').textContent = hi.code.split('').join(' ');
  if (window.qrcode) {
    const qr = window.qrcode(0, 'M');
    qr.addData(addUrl);
    qr.make();
    card.querySelector('.qr').innerHTML = qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
  }
  card.querySelector('button').addEventListener('click', () => {
    try { localStorage.setItem(SKIP, String(Date.now() + 30 * 86400000)); } catch { /* ignore */ }
    card.remove();
  });
  document.body.append(card);
  const until = Date.now() + hi.expiresInMin * 60000;
  const poll = setInterval(async () => {
    if (Date.now() > until) { clearInterval(poll); card.remove(); return; }
    try {
      const d = await fetch(`${api}/api/screen/hello?code=${hi.code}&claim=${hi.claim}`).then((r) => r.json());
      if (d.token) {
        clearInterval(poll);
        me = { token: d.token, deviceId: d.deviceId, name: d.name, config: d.config };
        store(me);
        card.innerHTML = `<div><p class="t">Conectada<span>Connected</span></p><p class="c small"></p></div>`;
        card.querySelector('.c').textContent = d.name;
        setTimeout(() => card.remove(), 6000);
        keepAwake();
      } else if (d.expired) { clearInterval(poll); card.remove(); }
    } catch { /* try again */ }
  }, 3000);
}
