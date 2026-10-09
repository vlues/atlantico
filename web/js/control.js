import { api, API, ownerToken, toast, esc, ago } from './api.js';

const $ = (id) => document.getElementById(id);
let data = null;
let view = 'web';
let formsFilled = false;

// ── Login ─────────────────────────────────────────────────────────────────────
async function unlock() {
  try {
    data = await api('/api/overview', { owner: true });
    $('login').style.display = 'none';
    $('app').style.display = 'block';
    $('app').classList.add('fade-in');
    render();
    return true;
  } catch (err) {
    if (err.status === 401 || err.status === 429) { ownerToken.clear(); $('loginerr').textContent = err.status === 429 ? err.message : ''; }
    else $('loginerr').textContent = `Can't reach the Worker (${err.message}).`;
    return false;
  }
}
document.querySelector('#login form').addEventListener('submit', async (e) => {
  e.preventDefault();
  ownerToken.set($('pass').value);
  if (!(await unlock())) $('loginerr').textContent ||= 'That passcode did not work.';
});
$('logout').addEventListener('click', () => { ownerToken.clear(); location.reload(); });
if (ownerToken.get()) unlock();
if (window.ATLANTICO?.simulate && !ownerToken.get()) $('pass').placeholder = 'passcode (sim: sim-owner)';

async function refresh() {
  if (!ownerToken.get() || document.hidden) return;
  try { data = await api('/api/overview', { owner: true }); render(); } catch { /* keep last */ }
}
setInterval(refresh, 15000);
document.addEventListener('visibilitychange', refresh);

async function act(path, body, okMsg) {
  try {
    const r = await api(path, { method: 'POST', body, owner: true });
    if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
    await refresh();
    return r;
  } catch (err) { toast(err.message); }
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  if (!data) return;
  renderSource();
  renderScenes();
  if (!$('plants').contains(document.activeElement)) renderPlants();
  renderDemo();
  renderDevices();
  renderAlerts();
  renderGuests();
  renderConnections();
  if (view !== 'web') refreshInk();
}

function renderSource() {
  const c = data.wall.conditions;
  const when = c.fetchedAt ? ago(Date.parse(c.fetchedAt)) : '';
  const src = c.source === 'open-meteo'
    ? `Live sea and wind · Open-Meteo marine + forecast · updated ${when}`
    : `Demo sea: ${c.scenario} (simulated) · switch back to live in Demo below`;
  const sun = data.wall.sunOverride ? ` · sun fixed at “${data.wall.sunOverride}”` : ` · sun ${Math.round(data.wall.sun.altitude)}° (computed locally)`;
  $('source').textContent = `${src}${sun} · swell ${c.waveHeight.toFixed(1)} m ${Math.round(c.wavePeriod)} s · wind ${Math.round(c.windSpeed)} km/h · tide ${c.tide >= 0 ? '+' : ''}${c.tide.toFixed(2)} m`;
}

function renderScenes() {
  const current = data.wall.scene;
  $('scenes').innerHTML = data.scenes.map((s) => `<button class="btn ${s.id === current ? 'on' : ''}" data-scene="${s.id}">${esc(s.label)}</button>`).join('');
  const l = data.lights?.state;
  const a = current === 'auto' ? ' · follows sunrise and sunset' : '';
  $('lightstate').textContent = l ? `${l.on ? `${l.kelvin} K · ${l.brightness}%` : 'off'} · ${data.lights.adapter}${a}` : a;
}
$('scenes').addEventListener('click', (e) => {
  const s = e.target.closest('[data-scene]')?.dataset.scene;
  if (s) act('/api/scene', { scene: s }, `Scene: ${s}`);
});

function spark(series, threshold) {
  if (!series.length) return '<svg class="spark"></svg>';
  const W = 300, H = 56;
  const t0 = series[0].t, t1 = series[series.length - 1].t || t0 + 1;
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const vals = [...series.map((p) => p.m), threshold];
  const lo = Math.max(0, Math.min(...vals) - 4), hi = Math.max(...vals) + 4;
  const y = (m) => H - 4 - ((m - lo) / Math.max(1, hi - lo)) * (H - 8);
  const d = series.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.m).toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <line x1="0" x2="${W}" y1="${y(threshold)}" y2="${y(threshold)}" stroke="rgba(201,164,106,.5)" stroke-width="1" stroke-dasharray="2 4" vector-effect="non-scaling-stroke"/>
    <path d="${d}" fill="none" stroke="#e9e6df" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>`;
}

const RULE_FIELDS = [
  ['waterBelow', 'Water below %'], ['doseMl', 'Dose ml'], ['minIntervalH', 'Min hours apart'],
  ['maxDailyMl', 'Max ml / day'], ['tempMin', 'Min °C'], ['tempMax', 'Max °C'],
  ['fallbackEveryDays', 'Offline: every N days'], ['pumpMlPerSec', 'Pump ml / s'],
];

function renderPlants() {
  const openRules = [...document.querySelectorAll('#plants details[open]')].map((d) => d.dataset.id);
  $('plants').innerHTML = data.plants.map((p) => {
    const l = p.latest ?? {};
    const lw = p.lastWatering;
    const flags = p.flags.map((f) => `<span class="tag warn">${esc(f)}</span>`).join(' ');
    return `<div class="cell plant">
      <div class="row spread"><h3>${esc(p.name)}</h3><div class="row" style="gap:6px">${flags}${p.device?.simulated ? '<span class="tag">simulated</span>' : p.device ? '' : '<span class="tag">no node</span>'}</div></div>
      <div class="species">${esc(p.species)}</div>
      <div class="row" style="align-items:baseline;gap:10px"><span class="big">${l.moisture != null ? Math.round(l.moisture) : '—'}</span><span class="muted small">% soil moisture · water below ${p.rules.waterBelow}%</span></div>
      ${spark(p.series, p.rules.waterBelow)}
      <div class="small muted">14 days</div>
      <div class="kv">
        <div><b>${l.temp != null ? l.temp.toFixed(1) : '—'}°</b><span>Temperature</span></div>
        <div><b>${l.reservoir != null ? Math.round(l.reservoir) + '%' : '—'}</b><span>Reservoir</span></div>
        <div><b>${lw ? ago(lw.ts) : '—'}</b><span>Last watered${lw ? ` · ${lw.ml} ml` : ''}</span></div>
      </div>
      <div class="bar"><i style="width:${Math.max(0, Math.min(100, l.reservoir ?? 0))}%"></i></div>
      <p class="note">${p.last_check ? esc(p.last_check) : '<span class="muted">The morning check will write here.</span>'}</p>
      <div class="row spread">
        <button class="btn small" data-water="${p.id}" ${p.device ? '' : 'disabled'}>${p.queuedMl ? `Queued · ${p.queuedMl} ml` : `Water now · ${p.rules.doseMl} ml`}</button>
        <span class="small muted">${l.ts ? `reading ${ago(l.ts)}` : ''}</span>
      </div>
      <details data-id="${p.id}" ${openRules.includes(p.id) ? 'open' : ''} style="margin-top:16px"><summary>Rules</summary>
        <form class="rules" data-rules="${p.id}">
          ${RULE_FIELDS.map(([k, label]) => `<label class="field">${label}<input type="number" step="any" min="0" name="${k}" value="${p.rules[k]}"></label>`).join('')}
          <div style="align-self:end"><button class="btn small" type="submit">Save rules</button></div>
        </form>
      </details>
    </div>`;
  }).join('');
}
$('plants').addEventListener('click', (e) => {
  const id = e.target.closest('[data-water]')?.dataset.water;
  if (id) act(`/api/plants/${id}/water`, {}, (r) => r.note);
});
$('plants').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = e.target.dataset.rules;
  const rules = Object.fromEntries([...new FormData(e.target)].map(([k, v]) => [k, Number(v)]));
  try { await api(`/api/plants/${id}`, { method: 'PUT', body: { rules }, owner: true }); toast('Rules saved. Nodes pick them up on their next wake.'); document.activeElement.blur(); refresh(); }
  catch (err) { toast(err.message); }
});

function chips(el, values, current, attr) {
  el.innerHTML = values.map((v) => `<button class="btn small ${v === current ? 'on' : ''}" data-${attr}="${esc(v)}">${esc(v)}</button>`).join('');
}

function renderDemo() {
  const d = data.demo;
  chips($('d-sea'), d.scenarios, d.scenario, 'sea');
  chips($('d-sun'), d.suns, d.sun, 'sun');
  const sel = $('d-plant');
  if (!sel.options.length) sel.innerHTML = data.plants.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const sims = data.devices.filter((x) => x.simulated).length;
  $('demonote').textContent = d.simulate
    ? `Simulator on: ${sims} simulated device${sims === 1 ? '' : 's'}. Each one disappears when its real device pairs. Weather is live unless you pick a sea below.`
    : 'Simulator off. Sea and time-of-day previews still work.';
}
$('d-sea').addEventListener('click', (e) => { const v = e.target.dataset.sea; if (v) act('/api/demo', { action: 'scenario', value: v }, `Sea: ${v}`); });
$('d-sun').addEventListener('click', (e) => { const v = e.target.dataset.sun; if (v) act('/api/demo', { action: 'sun', value: v }, `Sun: ${v}`); });
$('d-arrive').addEventListener('click', () => act('/api/demo', { action: 'arrive', value: $('d-name').value || 'Lucía' }, 'Welcome on the wall for 30 seconds · Hosting scene on'));
document.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', () =>
  act('/api/demo', { action: b.dataset.demo, value: $('d-plant').value }, 'Done')));
document.querySelectorAll('[data-ff]').forEach((b) => b.addEventListener('click', async () => {
  b.disabled = true;
  await act('/api/demo', { action: 'fastforward', value: Number(b.dataset.ff) }, `Plants moved forward ${b.textContent}`);
  b.disabled = false;
}));
$('d-check').addEventListener('click', async (e) => {
  e.target.disabled = true;
  await act('/api/demo', { action: 'check' }, (r) => `Plant check done (${r.via === 'claude' ? 'Claude' : 'simple rules, no Claude key'})`);
  e.target.disabled = false;
});
$('d-clear').addEventListener('click', () => act('/api/demo', { action: 'clear-demo-visitors' }, 'Demo visitors removed'));

function renderDevices() {
  const on = data.devices.filter((d) => d.online).length;
  $('devsummary').textContent = `${on} of ${data.devices.length} online`;
  $('devices').innerHTML = data.devices.map((d) => {
    const st = d.status;
    const extra = [d.type, d.config?.size, st?.battery != null ? `battery ${st.battery}%` : null, st?.rssi ? `${st.rssi} dBm` : null, st?.fw ? `fw ${st.fw}` : null].filter(Boolean).join(' · ');
    return `<div>
      <span class="dot ${d.online ? 'on' : ''}" title="${d.online ? 'online' : 'offline'}"></span>
      <div class="grow"><div>${esc(d.name)} ${d.simulated ? '<span class="tag">simulated</span>' : ''}</div>
        <div class="small muted">${esc(extra)} · ${d.online ? 'online' : 'offline'}${d.lastSeenS != null ? `, seen ${ago(Date.now() - d.lastSeenS * 1000)}` : ''}</div></div>
      ${d.simulated && data.demo.simulate ? `<button class="btn small quiet" data-offline="${d.id}">${data.demo.offline.includes(d.id) ? 'Bring online' : 'Simulate outage'}</button>` : ''}
      ${!d.simulated && d.id !== 'govee' ? `<button class="btn small quiet" data-remove="${d.id}">Unpair</button>` : ''}
    </div>`;
  }).join('');
}
$('devices').addEventListener('click', async (e) => {
  const off = e.target.dataset.offline, rm = e.target.dataset.remove;
  if (off) act('/api/demo', { action: 'offline', value: off }, 'Updated');
  if (rm && confirm('Unpair this device? It will need a new pairing code.')) {
    await api(`/api/devices/${rm}`, { method: 'DELETE', owner: true }).catch((err) => toast(err.message));
    refresh();
  }
});

function renderAlerts() {
  $('alerts').innerHTML = data.alerts.length ? data.alerts.slice(0, 30).map((a) => `<div>
    <span class="alert-time">${new Date(a.ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
    <span class="grow">${esc(a.message)}</span>
    <span class="tag ${a.kind === 'plant' || a.kind === 'device' ? 'warn' : ''}">${esc(a.kind)}</span>
    ${a.delivered ? '<span class="small muted" title="sent to Telegram or informational">✓</span>' : ''}</div>`).join('')
    : '<div class="muted small">Nothing to report. Alerts only appear when something needs you.</div>';
}

function renderGuests() {
  $('guestcount').textContent = `${data.visitors.length} on the wall`;
  $('visitors').innerHTML = data.visitors.map((v) => `<div>
    <span class="grow serif" style="font-size:18px">${esc(v.first_name)}</span>
    <span class="small muted">${new Date(v.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
    <button class="btn small quiet" data-visitor="${v.id}">Remove</button></div>`).join('') || '<div class="muted small">No visitors yet.</div>';
  if (!formsFilled) {
    const f = $('wifi');
    f.ssid.value = data.settings.wifi?.ssid ?? '';
    f.security.value = data.settings.wifi?.security ?? 'WPA';
    f.password.placeholder = data.settings.wifi?.hasPassword ? 'unchanged' : '';
    f.greeting.value = data.settings.greeting;
    formsFilled = true;
  }
}
$('visitors').addEventListener('click', async (e) => {
  const id = e.target.dataset.visitor;
  if (id) { await api(`/api/owner/visitors/${id}`, { method: 'DELETE', owner: true }).catch((err) => toast(err.message)); refresh(); }
});
$('wifi').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    let password = f.password.value;
    if (!password && data.settings.wifi?.hasPassword) password = (await api('/api/settings/wifi', { owner: true }))?.password ?? '';
    const wifi = f.ssid.value.trim() ? { ssid: f.ssid.value, password, security: f.security.value } : null;
    await api('/api/settings', { method: 'PUT', owner: true, body: { wifi, greeting: f.greeting.value } });
    f.password.value = '';
    toast('Saved');
    formsFilled = false;
    refresh();
  } catch (err) { toast(err.message); }
});

function renderConnections() {
  const s = data.settings;
  const rows = [
    ['Claude plant check', s.claude ? `on · last run ${data.check ? ago(data.check.at) + ` (${data.check.via})` : 'not yet'}` : 'no API key — simple rules are used instead', s.claude],
    ['Telegram alerts', s.telegram ? 'on' : 'off — add a bot token with npm run setup', s.telegram, s.telegram ? '<button class="btn small quiet" id="tgtest">Send test</button>' : ''],
    ['Lights', s.govee ? `Govee · ${s.govee.bulbs.map((b) => esc(b.name)).join(', ')}` : 'simulated bulbs — connect Govee on Add device', !!s.govee],
  ];
  $('connections').innerHTML = rows.map(([n, d, ok, extra = '']) => `<div><span class="dot ${ok ? 'on' : ''}"></span><span class="grow">${n}<div class="small muted">${d}</div></span>${extra}</div>`).join('');
  $('tgtest')?.addEventListener('click', () => act('/api/telegram/test', {}, (r) => (r.sent ? 'Sent' : 'Telegram did not accept it')));
}

// ── Preview: browser canvas vs. the actual e-ink bitmap ──────────────────────
function refreshInk() {
  const img = $('preview').querySelector('img');
  if (img) img.src = `${API}/art/panel.png?size=800x480&colors=${view === 'ink6' ? 6 : 2}&t=${Date.now()}`;
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
  view = b.dataset.view;
  document.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('on', x === b));
  $('preview').innerHTML = view === 'web' ? '<iframe src="wall" title="Wall piece"></iframe>' : '<img alt="E-ink panel image">';
  if (view !== 'web') refreshInk();
}));
