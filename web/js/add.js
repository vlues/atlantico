import { api, API, ownerToken, toast, esc } from './api.js';

const $ = (id) => document.getElementById(id);
// Not signed in yet: sign in on the control page, then come straight back (with any screen code).
if (!ownerToken.get()) location.href = `control?next=${encodeURIComponent(`add${location.search}`)}`;

// Firmware builds published next to this page by the GitHub Action (see firmware/README).
const BOARDS = {
  panel: [
    { id: 'panel-xiao75', label: 'Seeed XIAO 7.5″ ePaper Panel (black/white, 800×480)', size: '800x480', colors: 2 },
    { id: 'panel-spectra6', label: '7.3″ Spectra 6 colour + ESP32-S3 driver (800×480)', size: '800x480', colors: 6 },
  ],
  plant: [{ id: 'plant-c3', label: 'XIAO ESP32-C3 plant node' }],
};

let type = null;
let code = null;
let plants = [];

// ── What to get ───────────────────────────────────────────────────────────────
// Ticks are remembered in this browser only, as a shopping checklist.
const KITS = [
  { title: 'Start here · no tools', note: 'Everything in this kit works out of the box.', items: [
    ['Seeed Studio XIAO 7.5″ ePaper Panel', 'The wall panel: board, 800×480 e-paper and battery in one. Black and white.', '≈ $70–85', 'Seeed XIAO 7.5 ePaper Panel'],
    ['Govee Wi-Fi LED bulbs, E27 (Spain) or E26 (US), 4-pack', 'Any Govee bulb that works with the Govee Home app and its API key.', '≈ $30–45', 'Govee wifi LED bulb E27'],
    ['NTAG215 NFC stickers, 10-pack', 'One by the door with the guest page on it.', '≈ $8–10', 'NTAG215 NFC stickers'],
    ['USB-C 5 V chargers (100–240 V) and USB-C data cables', 'One per device. A data cable for setup; the panel can run on its battery.', '≈ $8–12 each', 'USB C charger 5V 2A'],
    ['Large picture-hanging strips', 'Hangs the panel without drilling.', '≈ $10–15', 'Command picture hanging strips large'],
  ] },
  { title: 'Screens · colour and motion', note: 'Pick one: a matte tablet looks most like paper; an art TV is the big statement. Nothing here needs a screw.', items: [
    ['TCL NXTPAPER 14 (or NXTPAPER 11) matte tablet', 'Best for Atlántico: paper-like, no glare. 760 g (11″: 500 g).', '≈ $170–350', 'TCL NXTPAPER 14 tablet'],
    ['Slim case for it + Command Large picture-hanging strips (4 pairs)', 'Strips on the case, not the tablet. Rated 16 lb (≈ 7 kg) per 4 pairs. Smooth painted walls only.', '≈ $15 + 10', 'Command large picture hanging strips'],
    ['…or a tabletop easel tablet stand', 'For gotelé or wallpaper, or a shelf or sideboard. Holds it upright, no wall at all.', '≈ $20–35', 'aluminium tablet stand easel 14 inch'],
    ['Long USB-C cable (3 m, flat, white or black)', 'Keeps it powered; run it down behind furniture.', '≈ $10', 'USB C cable 3m flat'],
    ['Hisense CanvasTV 55″ (or Samsung The Frame / TCL NXTFRAME)', 'The big statement, matte like a print. About 18 kg: never on adhesive strips.', '≈ $900–1,500', 'Hisense CanvasTV 55'],
    ['Raspberry Pi 5 (4 GB) + official case + 27 W USB-C power supply + 32 GB microSD', 'Behind the TV: it only ever shows Atlántico, and turns the TV off at night.', '≈ $90–110', 'Raspberry Pi 5 4GB starter kit'],
    ['Micro-HDMI to HDMI cable (1 m)', 'Pi to TV.', '≈ $8', 'micro HDMI to HDMI cable 1m'],
    ['…or your own TV: just the Pi kit and cable above', 'The Pi rests on a spare HDMI input; the TV stays your TV.', '—', 'Raspberry Pi 5 4GB starter kit'],
    ['Floor easel TV stand, 43–65″, rated 35 kg+', 'Holds an art TV with no wall fixing. VIVO, ECOTINY or KONIC tripods.', '≈ $100–120', 'tripod easel TV stand 43-65 inch'],
    ['…or a floor-to-ceiling tension pole mount (Neomounts FPMA-CF200, 37–70″, 30 kg)', 'Presses between floor and ceiling: no holes. Needs a solid ceiling (not a drop ceiling).', '≈ $150–250', 'Neomounts FPMA-CF200 floor to ceiling'],
  ] },
  { title: 'Lights that follow the TV · optional', note: 'For the household TV: lamps beside it follow Atlántico and its surprises, and what you watch, side by side. Must be Govee lights with LAN Control (turn it on in the Govee Home app).', items: [
    ['Govee RGBIC TV Light Bars (H6046), a pair', 'One each side of the TV: left follows the left of the picture, right the right. LAN Control.', '≈ $60–80', 'Govee H6046 TV light bars'],
    ['Govee RGBICW Floor Lamp (H6076) or Table Lamp (H6052)', 'A corner of the room in the colours of the scene. LAN Control.', '≈ $60–110', 'Govee H6076 floor lamp'],
    ['Raspberry Pi Camera Module 3 Wide', 'Faces the TV so the lamps follow films and series too (the Pi can\'t see inside the TV\'s own apps otherwise). Not needed for Atlántico itself.', '≈ $35', 'Raspberry Pi Camera Module 3 Wide'],
    ['Raspberry Pi 5 camera cable, 300–500 mm', 'The Pi 5 uses the narrower connector; a longer cable lets the camera sit on a shelf facing the screen.', '≈ $5–8', 'Raspberry Pi 5 camera cable 500mm'],
  ] },
  { title: 'Colour e-ink instead (optional)', note: 'Swap the panel above for six-colour e-ink: guests who are here show in colour.', items: [
    ['Waveshare 7.3″ e-Paper (E) Spectra 6', 'The colour display.', '≈ $80', 'Waveshare 7.3 Spectra 6 e-paper'],
    ['Seeed XIAO ePaper driver board + XIAO ESP32-S3 Plus', 'Plugs onto the display ribbon. No soldering.', '≈ $40–55', 'Seeed XIAO ePaper driver board ESP32-S3 Plus'],
  ] },
  { title: 'Plants · per plant', note: 'Essentials water the plant; the extras add temperature and reservoir level. About 30 minutes with jumper wires.', items: [
    ['Seeed XIAO ESP32-C3 (3-pack + 1)', 'One per plant.', '≈ $25 + 9', 'Seeed XIAO ESP32-C3'],
    ['Capacitive soil moisture sensor v2.0 (5-pack)', 'Essential.', '≈ $8–10', 'capacitive soil moisture sensor v2.0'],
    ['5 V mini submersible pump + silicone tube', 'Essential. One per plant.', '≈ $8–11 each', '5V mini submersible pump silicone tube'],
    ['Logic-level MOSFET module (screw terminals) + 1N5819 diodes', 'Essential: switches the pump. Screw terminals mean no soldering.', '≈ $10–12', 'MOSFET module IRLZ44N screw terminal'],
    ['3–5 L opaque reservoir with lid', 'Essential. Food-safe box; the pump sits inside.', '≈ $10–15 each', 'opaque food storage box 4L lid'],
    ['DS18B20 waterproof temperature probe, with adapter board', 'Extra. The adapter board has the resistor built in.', '≈ $10–12', 'DS18B20 waterproof probe adapter module'],
    ['VL53L0X distance sensor, pins soldered', 'Extra: in the lid, it measures how full the reservoir is.', '≈ $6–9 each', 'VL53L0X module'],
    ['Dupont jumper wires (female–female)', 'Connects everything to the XIAO.', '≈ $6', 'dupont jumper wires female female'],
  ] },
];
const search = (q) => [
  ['Amazon.es', `https://www.amazon.es/s?k=${encodeURIComponent(q)}`],
  ['Amazon.com', `https://www.amazon.com/s?k=${encodeURIComponent(q)}`],
  ...(/Seeed/.test(q) ? [['Seeed', `https://www.seeedstudio.com/catalogsearch/result/?q=${encodeURIComponent(q.replace(/^Seeed\s*/, ''))}`]] : []),
];
const shopKey = 'atlantico-shop';
const ticked = (() => { try { return new Set(JSON.parse(localStorage.getItem(shopKey) ?? '[]')); } catch { return new Set(); } })();
function renderShop() {
  $('shoplist').innerHTML = KITS.map((k) => `<h4>${esc(k.title)}</h4><p class="kitnote">${esc(k.note)}</p>` + k.items.map(([name, why, price, q]) =>
    `<label><input type="checkbox" data-item="${esc(name)}" ${ticked.has(name) ? 'checked' : ''}><span>${esc(name)}</span><span class="small muted">${esc(price)}</span>
      <small>${esc(why)} ${search(q).map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${n} ↗</a>`).join('')}</small></label>`).join('')).join('');
  const all = KITS.flatMap((k) => k.items).length;
  $('shopcount').textContent = ticked.size ? `· ${ticked.size} of ${all} ticked` : '';
}
$('shoplist').addEventListener('change', (e) => {
  const n = e.target.dataset.item;
  if (!n) return;
  e.target.checked ? ticked.add(n) : ticked.delete(n);
  try { localStorage.setItem(shopKey, JSON.stringify([...ticked])); } catch { /* private mode */ }
  renderShop();
});
renderShop();

$('types').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-type]');
  if (!b) return;
  type = b.dataset.type;
  document.querySelectorAll('#types button').forEach((x) => x.classList.toggle('on', x === b));
  $('esp').hidden = type === 'lights' || type === 'screen';
  $('lights').hidden = type !== 'lights';
  $('screen').hidden = type !== 'screen';
  if (type === 'screen') setupScreen();
  else if (type !== 'lights') await setupEsp();
});

async function setupEsp() {
  code = null;
  $('code').textContent = '······';
  if (!plants.length) plants = (await api('/api/overview', { owner: true })).plants;
  const boards = BOARDS[type];
  $('opts').innerHTML = `
    <label class="field">Board<select id="board">${boards.map((b) => `<option value="${b.id}">${esc(b.label)}</option>`).join('')}</select></label>
    ${type === 'plant' ? `<label class="field">Waters which plant<select id="plantId">${plants.map((p) => `<option value="${p.id}">${esc(p.name)}${p.device && !p.device.simulated ? ' (has a node)' : ''}</option>`).join('')}</select></label>` : ''}
    ${type === 'panel' ? `<label class="field">Power<select id="power"><option value="usb">USB (instant welcomes)</option><option value="battery">Battery (wakes every 15 min)</option></select></label>
      <label class="field">Orientation<select id="rotate"><option value="0">Landscape</option><option value="1">Portrait</option></select></label>` : ''}
    <label class="field">Name<input type="text" id="devname" maxlength="40" placeholder="${type === 'panel' ? 'Wall panel' : 'Plant node'}"></label>`;
  $('board').addEventListener('change', checkFirmware);
  await checkFirmware();
  $('nobrowser').hidden = 'serial' in navigator;
  $('s-install').classList.toggle('live', 'serial' in navigator);
}

async function checkFirmware() {
  const id = $('board').value;
  const manifest = `firmware/${id}.json`;
  $('install').setAttribute('manifest', manifest);
  try {
    const m = await (await fetch(manifest, { cache: 'no-store' })).json();
    const bin = new URL(m.builds[0].parts[0].path, new URL(manifest, location.href));
    const ok = (await fetch(bin, { method: 'HEAD', cache: 'no-store' })).ok;
    $('nofw').hidden = ok;
    $('nofw').textContent = ok ? '' : 'Firmware not built yet. Push the repo to GitHub; the “Site + firmware” Action builds it and publishes it here. (In the local simulator there is no firmware to flash.)';
  } catch {
    $('nofw').hidden = false;
    $('nofw').textContent = 'Firmware manifest missing.';
  }
}

async function ensureCode() {
  if (code) return code;
  const board = BOARDS[type].find((b) => b.id === $('board').value);
  const config = type === 'panel'
    ? { size: board.size, colors: board.colors, power: $('power').value, rotate: $('rotate').value === '1', board: board.id }
    : { plantId: $('plantId').value, board: board.id };
  const r = await api('/api/pairing', { method: 'POST', owner: true, body: { type, name: $('devname').value || undefined, config } });
  code = r.code;
  $('code').textContent = code;
  $('codeexp').textContent = `valid ${r.expiresInMin} min`;
  return code;
}

// Make the code as soon as Install is pressed, so it is ready when flashing finishes.
let installing = false;
$('install').addEventListener('click', () => { installing = true; ensureCode().catch((e) => toast(e.message)); $('s-pair').classList.add('live'); }, true);

// When the install window closes, pair straight away: Chrome remembers the port it just used,
// so no second prompt is needed.
new MutationObserver(() => {
  if (installing && !document.querySelector('ewt-install-dialog')) {
    installing = false;
    $('pairstate').textContent = 'Pairing…';
    setTimeout(() => pair(false), 1500); // let the board finish restarting onto Wi-Fi
  }
}).observe(document.body, { childList: true });

const log = (s) => { $('log').textContent += `${s}\n`; $('log').scrollTop = 1e9; };

$('pairbtn').addEventListener('click', () => pair(true));

async function pair(fromButton) {
  $('s-pair').classList.add('live');
  try {
    const c = await ensureCode();
    let [port] = await navigator.serial.getPorts();
    if (!port && !fromButton) { $('pairstate').textContent = 'Press Pair to choose the board.'; return; }
    if (!port) port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 }).catch(() => {});
    $('pairstate').textContent = 'Sending code…';
    const writer = port.writable.getWriter();
    await writer.write(new TextEncoder().encode(`\nATLANTICO PAIR ${c} ${API}\n`));
    writer.releaseLock();

    // Read the device's replies for up to 30 s while it contacts the Worker.
    const reader = port.readable.getReader();
    const dec = new TextDecoder();
    let buf = '', ok = false;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !ok) {
      const { value, done } = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ value: null }), 1000))]);
      if (done) break;
      if (value) {
        buf += dec.decode(value);
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (line.startsWith('ATLANTICO')) log(line);
          if (line.startsWith('ATLANTICO PAIRED')) ok = true;
          if (line.startsWith('ATLANTICO ERROR')) throw new Error(line.slice(16));
        }
      }
    }
    reader.releaseLock();
    await port.close().catch(() => {});
    $('pairstate').textContent = ok ? 'Device confirmed. Checking with the Worker…' : 'No reply over USB yet. Waiting for the device to check in…';
    await waitPaired(c);
  } catch (err) {
    $('pairstate').textContent = `${err.message} Press Pair to try again.`;
  }
}

async function waitPaired(c) {
  for (let i = 0; i < 40; i++) {
    const s = await api(`/api/pairing/${c}`, { owner: true });
    if (s.paired) {
      $('pairstate').innerHTML = `Paired as <b>${esc(s.deviceId)}</b>. It replaced its simulated stand-in. <a href="control">Back to control</a>`;
      toast('Paired');
      return;
    }
    if (s.expired) { $('pairstate').textContent = 'Code expired. Reload and try again.'; return; }
    await new Promise((r) => setTimeout(r, 3000));
  }
  $('pairstate').textContent = 'Still waiting. Check the Wi-Fi password, then press Pair again.';
}

// ── Screens ───────────────────────────────────────────────────────────────────
function setupScreen() {
  const url = new URL('wall', location.href).href;
  $('kioskcmd').textContent = `curl -fsSL ${new URL('kiosk.sh', location.href).href} | bash -s -- art`;
  $('kioskshared').textContent = `curl -fsSL ${new URL('kiosk.sh', location.href).href} | bash -s -- shared`;
  $('wallurl').textContent = url.replace(/^https?:\/\//, '');
  if (window.qrcode && !$('wallqr').innerHTML) {
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('wallqr').innerHTML = qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
  }
}
$('skind').addEventListener('change', () => { $('soled').checked = $('skind').value === 'oled'; });
$('scode').addEventListener('input', () => { $('scode').value = $('scode').value.replace(/\D/g, ''); if ($('scode').value.length === 4) $('sname').focus(); });
$('sadd').addEventListener('click', async () => {
  $('sadd').disabled = true;
  try {
    const r = await api('/api/screen/claim', { method: 'POST', owner: true, body: {
      code: $('scode').value, name: $('sname').value || undefined,
      config: { kind: $('skind').value, night: $('snight').value, oled: $('soled').checked },
    } });
    $('sstate').innerHTML = `Added <b>${esc(r.name)}</b>. The screen says “Conectada” in a few seconds. <a href="control">Back to control</a>`;
    toast('Screen added');
  } catch (err) { $('sstate').textContent = err.message; }
  $('sadd').disabled = false;
});
// Arrived from the QR on a screen: everything is filled in but the name.
{
  const code = new URLSearchParams(location.search).get('screen');
  if (code && /^\d{4}$/.test(code)) {
    document.querySelector('[data-type="screen"]').click();
    $('scode').value = code;
    $('s-scode').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('sname').focus();
  }
}

// ── Lights ────────────────────────────────────────────────────────────────────
let found = [];
$('glist').addEventListener('click', async () => {
  try {
    const r = await api('/api/lights/govee', { method: 'POST', owner: true, body: { apiKey: $('gkey').value } });
    found = r.bulbs;
    $('bulbs').innerHTML = found.length ? found.map((b) => `<label><input type="checkbox" value="${esc(b.id)}" checked>
      <span class="grow">${esc(b.name)}<span class="small muted"> · ${esc(b.model ?? '')}${b.kelvin ? ` · ${b.kelvin[0]}–${b.kelvin[1]} K` : ''}</span></span>
      <select data-zone="${esc(b.id)}"><option value="wall">by the wall</option><option value="plants">by the plants</option><option value="sofa">by the sofa</option><option value="none" selected>elsewhere</option></select></label>`).join('')
      : '<p class="muted">No controllable lights on this account.</p>';
    $('s-bulbs').classList.add('live');
    $('gsave').disabled = !found.length;
  } catch (err) { toast(err.message); }
});
$('gsave').addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('#bulbs input:checked')].map((i) => i.value);
  try {
    await api('/api/lights/govee', { method: 'POST', owner: true, body: { apiKey: $('gkey').value, bulbs: ids } });
    const zones = Object.fromEntries([...document.querySelectorAll('#bulbs [data-zone]')].map((s) => [s.dataset.zone, s.value]));
    await api('/api/lights/zones', { method: 'PUT', owner: true, body: zones });
    toast(`Lights connected: ${ids.length} bulb${ids.length === 1 ? '' : 's'}`);
    setTimeout(() => (location.href = 'control'), 1200);
  } catch (err) { toast(err.message); }
});
$('gremove').addEventListener('click', async () => {
  await api('/api/lights/govee', { method: 'DELETE', owner: true }).catch((e) => toast(e.message));
  toast('Govee disconnected. Back to simulated bulbs.');
});
