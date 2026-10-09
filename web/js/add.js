import { api, API, ownerToken, toast, esc } from './api.js';

const $ = (id) => document.getElementById(id);
if (!ownerToken.get()) location.href = 'control';

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

$('types').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-type]');
  if (!b) return;
  type = b.dataset.type;
  document.querySelectorAll('#types button').forEach((x) => x.classList.toggle('on', x === b));
  $('esp').hidden = type === 'lights';
  $('lights').hidden = type !== 'lights';
  if (type !== 'lights') await setupEsp();
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
$('install').addEventListener('click', () => { ensureCode().catch((e) => toast(e.message)); $('s-pair').classList.add('live'); }, true);

const log = (s) => { $('log').textContent += `${s}\n`; $('log').scrollTop = 1e9; };

$('pairbtn').addEventListener('click', async () => {
  $('s-pair').classList.add('live');
  try {
    const c = await ensureCode();
    let [port] = await navigator.serial.getPorts();
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
    $('pairstate').textContent = err.message;
  }
});

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

// ── Lights ────────────────────────────────────────────────────────────────────
let found = [];
$('glist').addEventListener('click', async () => {
  try {
    const r = await api('/api/lights/govee', { method: 'POST', owner: true, body: { apiKey: $('gkey').value } });
    found = r.bulbs;
    $('bulbs').innerHTML = found.length ? found.map((b) => `<label><input type="checkbox" value="${esc(b.id)}" checked>
      <span class="grow">${esc(b.name)}</span><span class="small muted">${esc(b.model ?? '')}${b.kelvin ? ` · ${b.kelvin[0]}–${b.kelvin[1]} K` : ''}</span></label>`).join('')
      : '<p class="muted">No controllable lights on this account.</p>';
    $('s-bulbs').classList.add('live');
    $('gsave').disabled = !found.length;
  } catch (err) { toast(err.message); }
});
$('gsave').addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('#bulbs input:checked')].map((i) => i.value);
  try {
    await api('/api/lights/govee', { method: 'POST', owner: true, body: { apiKey: $('gkey').value, bulbs: ids } });
    toast(`Lights connected: ${ids.length} bulb${ids.length === 1 ? '' : 's'}`);
    setTimeout(() => (location.href = 'control'), 1200);
  } catch (err) { toast(err.message); }
});
$('gremove').addEventListener('click', async () => {
  await api('/api/lights/govee', { method: 'DELETE', owner: true }).catch((e) => toast(e.message));
  toast('Govee disconnected. Back to simulated bulbs.');
});
