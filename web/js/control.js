import { api, API, ownerToken, toast, esc, ago } from './api.js';

const $ = (id) => document.getElementById(id);
let data = null;
let view = 'web';
let formsFilled = false;

// ── Sign in (once per browser) ────────────────────────────────────────────────
// The passcode is swapped for a session token that this browser keeps for a year after its
// last use. The passcode itself is never stored.
const deviceLabel = () => {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Browser';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '';
  const app = matchMedia('(display-mode: standalone)').matches ? 'home screen' : browser;
  return [device, app].filter(Boolean).join(' · ');
};
const session = (passcode) => api('/api/session', { method: 'POST', body: { passcode, label: deviceLabel() } });

async function unlock() {
  try {
    data = await api('/api/overview', { owner: true });
    // Signed in with a passcode kept from before sessions existed: swap it for a session.
    if (!ownerToken.get().startsWith('s1.')) ownerToken.set((await session(ownerToken.get())).token);
    // Sent here to sign in from another page (e.g. Add device, from a screen's QR): go back to it.
    const next = new URLSearchParams(location.search).get('next');
    if (next && /^add(\?[\w=&%-]*)?$/.test(next)) { location.href = next; return true; }
    $('login').style.display = 'none';
    $('app').style.display = 'block';
    $('app').classList.add('fade-in');
    render();
    renderSessions();
    return true;
  } catch (err) {
    if (err.status === 401 || err.status === 429) { ownerToken.clear(); $('loginerr').textContent = err.status === 429 ? err.message : ''; }
    else $('loginerr').textContent = `Can't reach the Worker (${err.message}).`;
    return false;
  }
}
document.querySelector('#login form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginerr').textContent = '';
  try {
    ownerToken.set((await session($('pass').value)).token);
    $('pass').value = '';
    await unlock();
  } catch (err) {
    $('loginerr').textContent = err.status === 401 ? 'That passcode did not work.' : err.message;
  }
});
$('logout').addEventListener('click', async () => {
  await api('/api/session', { method: 'DELETE', owner: true }).catch(() => {});
  ownerToken.clear();
  location.reload();
});

async function renderSessions() {
  try {
    const list = await api('/api/sessions', { owner: true });
    $('sessions').innerHTML = list.map((x) => `<div><span class="grow">${esc(x.label)} ${x.current ? '<span class="tag">this one</span>' : ''}
      <div class="small muted">signed in ${new Date(x.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · last used ${ago(x.last_used)}</div></span></div>`).join('')
      || '<div class="muted small">Only the passcode (scripts).</div>';
  } catch { /* keep the last list */ }
}
$('signout-all').addEventListener('click', async () => {
  if (!confirm('Sign out every browser, including this one? Each will need the passcode once more.')) return;
  await api('/api/sessions', { method: 'DELETE', owner: true }).catch((err) => toast(err.message));
  ownerToken.clear();
  location.reload();
});
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
  renderMusic();
  if (view !== 'web') refreshInk();
}

function renderSource() {
  const ed = data.wall.edition;
  $('edition').textContent = `Today: ${ed.label} · ${ed.palette} palette${data.demo.style !== 'today' ? ' (style previewed from Demo)' : ''} · a new edition every midnight`;
  const c = data.wall.conditions;
  const when = c.fetchedAt ? ago(Date.parse(c.fetchedAt)) : '';
  const src = c.source === 'open-meteo'
    ? `Live sea and wind · Open-Meteo marine + forecast · updated ${when}`
    : `Demo sea: ${c.scenario} (simulated) · switch back to live in Demo below`;
  const sun = data.wall.sunOverride ? ` · sun fixed at “${data.wall.sunOverride}”` : ` · sun ${Math.round(data.wall.sun.altitude)}° (computed locally)`;
  $('source').textContent = `${src}${sun} · swell ${c.waveHeight.toFixed(1)} m ${Math.round(c.wavePeriod)} s · wind ${Math.round(c.windSpeed)} km/h · tide ${c.tide >= 0 ? '+' : ''}${c.tide.toFixed(2)} m`;
}

function renderScenes() {
  if (!$('zones').contains(document.activeElement)) {
    $('zones').innerHTML = data.bulbs.map((b) => `<div><span class="grow">${esc(b.name)}</span>
      <select data-zone="${esc(b.id)}">${data.zones.map((z) => `<option value="${z}" ${z === b.zone ? 'selected' : ''}>${{ wall: 'by the wall', plants: 'by the plants', sofa: 'by the sofa', none: 'elsewhere' }[z]}</option>`).join('')}</select></div>`).join('');
  }
  const current = data.wall.scene;
  $('scenes').innerHTML = data.scenes.map((s) => `<button class="btn ${s.id === current ? 'on' : ''}" data-scene="${s.id}">${esc(s.label)}</button>`).join('');
  const l = data.lights?.state;
  const a = current === 'auto' ? ' · follows sunrise and sunset' : '';
  $('lightstate').textContent = l ? `${l.on ? `${l.kelvin} K · ${l.brightness}%` : 'off'} · ${data.lights.adapter}${a}` : a;
}
$('zones').addEventListener('change', async () => {
  const zones = Object.fromEntries([...$('zones').querySelectorAll('[data-zone]')].map((s) => [s.dataset.zone, s.value]));
  try { await api('/api/lights/zones', { method: 'PUT', owner: true, body: zones }); toast('Saved'); document.activeElement.blur(); refresh(); }
  catch (err) { toast(err.message); }
});
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
  chips($('d-style'), d.styles, d.style, 'style');
  if (!$('d-elements').children.length) {
    $('d-elements').innerHTML = d.elements.map((x) => `<button class="btn small" data-element="${esc(x.id)}" title="${esc(x.en)}${x.when !== 'any' ? ` (${x.when === 'day' ? 'by day' : 'at night'}, shown now anyway)` : ''}">${esc(x.es)}</button>`).join('');
  }
  $('d-surprisestate').textContent = d.surprise ? `Nº ${d.surprise.id}: ${d.surprise.title.es} · ${d.surprise.title.en}${d.surprise.at > Date.now() ? ` (in ${Math.max(1, Math.round((d.surprise.at - Date.now()) / 60000))} min)` : ' (playing)'}` : 'They also come by themselves, at random, a few times a day.';
  $('d-days').innerHTML = d.coming.map((x) => `<button class="btn small ${x.day === d.day && d.style === 'today' ? 'on' : ''}" data-day="${x.day}" title="${esc(x.label)}">${x.day === 0 ? 'Today' : `Nº ${x.n}`} · ${esc(x.style)} · ${esc(x.palette)}</button>`).join('');
  const sel = $('d-plant');
  if (!sel.options.length) sel.innerHTML = data.plants.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const sims = data.devices.filter((x) => x.simulated).length;
  $('demonote').textContent = d.simulate
    ? `Simulator on: ${sims} simulated device${sims === 1 ? '' : 's'}. Each one disappears when its real device pairs. Weather is live unless you pick a sea below.`
    : 'Simulator off. Sea and time-of-day previews still work.';
}
$('d-sea').addEventListener('click', (e) => { const v = e.target.dataset.sea; if (v) act('/api/demo', { action: 'scenario', value: v }, `Sea: ${v}`); });
$('d-sun').addEventListener('click', (e) => { const v = e.target.dataset.sun; if (v) act('/api/demo', { action: 'sun', value: v }, `Sun: ${v}`); });
$('d-days').addEventListener('click', (e) => {
  const v = e.target.closest('[data-day]')?.dataset.day;
  if (v != null) act('/api/demo', { action: 'day', value: Number(v) }, v === '0' ? "Back to today's edition" : 'Previewing that day on the wall');
});
const surpriseNow = async (value) => {
  const r = await act('/api/demo', { action: 'surprise', value });
  if (r?.title) toast(`Nº ${r.id}: ${r.title.es} · on every screen in a moment`);
};
$('d-surprise').addEventListener('click', () => surpriseNow('random'));
$('d-surprise-small').addEventListener('click', () => surpriseNow('small'));
$('d-elements').addEventListener('click', (e) => { const v = e.target.closest('[data-element]')?.dataset.element; if (v) surpriseNow(v); });
$('d-showcase').addEventListener('click', () => act('/api/demo', { action: 'showcase' }, 'Every style in turn, on the wall, for 40 seconds'));
// The guest tour, played from here: each stop for seven seconds, then the lamps settle back.
let touring = false;
$('d-tour').addEventListener('click', async (e) => {
  if (touring) return;
  touring = true;
  e.target.disabled = true;
  for (const stop of data.demo.stops) {
    $('d-tourstate').textContent = `now: ${stop}`;
    await api('/api/demo', { method: 'POST', owner: true, body: { action: 'tour', value: stop } }).catch((err) => toast(err.message));
    if (stop !== 'end') await new Promise((r) => setTimeout(r, stop === 'edition' ? 15000 : 7000));
  }
  $('d-tourstate').textContent = 'done · the lamps are back to the scene';
  e.target.disabled = false;
  touring = false;
});
$('d-style').addEventListener('click', (e) => { const v = e.target.dataset.style; if (v) act('/api/demo', { action: 'style', value: v }, v === 'today' ? "Back to today's edition" : `Previewing: ${v}`); });
$('d-arrive').addEventListener('click', () => act('/api/demo', { action: 'arrive', value: $('d-name').value || 'Lucía' },
  (r) => `${r.returning ? `Welcome back, ${r.name} · visit ${r.visits}` : `Welcome, ${r.name} · new star`} · on every screen for 30 s · Hosting scene on`));
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
  if ($('devices').contains(document.activeElement)) return; // don't redraw under a choice being made
  const on = data.devices.filter((d) => d.online).length;
  $('devsummary').textContent = `${on} of ${data.devices.length} online`;
  $('devices').innerHTML = data.devices.map((d) => {
    const st = d.status;
    const extra = [d.type === 'screen' ? `screen${d.config?.kind ? ` · ${d.config.kind}` : ''}` : d.type, d.config?.size ?? st?.size, st?.battery != null ? `battery ${st.battery}%` : null, st?.rssi ? `${st.rssi} dBm` : null, st?.fw ? `fw ${st.fw}` : null].filter(Boolean).join(' · ');
    return `<div>
      <span class="dot ${d.online ? 'on' : ''}" title="${d.online ? 'online' : 'offline'}"></span>
      <div class="grow"><div>${esc(d.name)} ${d.simulated ? '<span class="tag">simulated</span>' : ''}</div>
        <div class="small muted">${esc(extra)} · ${d.online ? 'online' : 'offline'}${d.lastSeenS != null ? `, seen ${ago(Date.now() - d.lastSeenS * 1000)}` : ''}</div></div>
      ${d.type === 'screen' ? `<select data-night="${d.id}" title="At night (00:30–07:00)">${[['dim', 'dims at night'], ['off', 'dark at night'], ['on', 'always on']].map(([v, l]) => `<option value="${v}" ${d.config.night === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label class="small muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-oled="${d.id}" ${d.config.oled ? 'checked' : ''}> OLED care</label>` : ''}
      ${d.simulated && data.demo.simulate ? `<button class="btn small quiet" data-offline="${d.id}">${data.demo.offline.includes(d.id) ? 'Bring online' : 'Simulate outage'}</button>` : ''}
      ${!d.simulated && d.id !== 'govee' ? `<button class="btn small quiet" data-remove="${d.id}">Unpair</button>` : ''}
    </div>`;
  }).join('');
}
$('devices').addEventListener('change', async (e) => {
  const id = e.target.dataset.night ?? e.target.dataset.oled;
  if (!id) return;
  const config = e.target.dataset.night ? { night: e.target.value } : { oled: e.target.checked };
  try { await api(`/api/devices/${id}`, { method: 'PATCH', owner: true, body: { config } }); toast('Saved · the screen updates in a few seconds'); }
  catch (err) { toast(err.message); }
});
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
  const here = data.visitors.filter((v) => v.here).length;
  $('guestcount').textContent = `${data.visitors.length} on the wall${here ? ` · ${here} here now` : ''}`;
  const date = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  $('visitors').innerHTML = data.visitors.map((v) => `<div>
    <span class="grow"><span class="serif" style="font-size:18px">${esc(v.first_name)}</span> ${v.here ? '<span class="tag warn">here now</span>' : ''}
      <div class="small muted">${v.visits} visit${v.visits === 1 ? '' : 's'} · ${v.visits > 1 ? `last ${date(v.last_seen ?? v.created_at)} · first ${date(v.created_at)}` : date(v.created_at)}</div></span>
    ${v.here ? `<button class="btn small quiet" data-leave="${v.id}">End visit</button>` : ''}
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
  const id = e.target.dataset.visitor, leave = e.target.dataset.leave;
  if (id) { await api(`/api/owner/visitors/${id}`, { method: 'DELETE', owner: true }).catch((err) => toast(err.message)); refresh(); }
  if (leave) act(`/api/owner/visitors/${leave}/leave`, {}, 'Visit ended · their star rests');
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

// ── Music: connect Spotify once; guests add songs from their phones without signing in ────────
let musicDrawn = null;
function renderMusic() {
  const m = data.music;
  const np = m.now;
  $('musicstate').textContent = m.connected ? `Spotify · ${m.device ? `plays on ${m.device}` : 'plays on whatever speaker is on'}${np ? ` · now: ${np.title}${np.by ? ` (${np.by.name}'s)` : ''}` : ''}` : 'not connected';
  const mode = m.connected ? 'on' : 'off';
  if (musicDrawn === mode || $('musicbody').contains(document.activeElement)) return;
  musicDrawn = mode;
  const redirect = `${API}/api/music/callback`;
  $('musicbody').innerHTML = m.connected ? `
    <p class="small muted">Guests see a Music section after they check in: search, paste a link from Spotify, Apple Music or YouTube, or ask for a suggestion. When a guest's song comes on, the wall says whose it is and the lamps by the wall breathe once.</p>
    <div class="row"><button class="btn small" id="mdev">Choose the room's speaker</button><span class="small muted">used when nothing is playing</span>
      <button class="btn quiet small" id="mdisc">Disconnect</button></div>
    <div class="list" id="mdevices" style="margin-top:12px"></div>`
    : `<ol class="small" style="line-height:1.9;padding-left:1.2em;margin:0 0 16px">
      <li>On <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard ↗</a>, sign in with the Spotify account that plays in the flat (Premium) and press <b>Create app</b>.</li>
      <li>Any name; tick <b>Web API</b>; add this <b>Redirect URI</b>: <code id="mredir">${esc(redirect)}</code> <button class="btn quiet small" id="mcopy" type="button">copy</button></li>
      <li>Paste the app's Client ID and Client secret here, press Connect, and approve.</li></ol>
    <form id="mform" class="row"><input type="text" name="clientId" placeholder="Client ID" style="flex:1;min-width:160px">
      <input type="password" name="clientSecret" placeholder="Client secret" style="flex:1;min-width:160px">
      <button class="btn small" type="submit">Connect Spotify</button></form>
    <p class="small muted" style="margin-top:10px">Guests never sign in to anything. Play music in the flat from any Spotify Connect speaker (or this Mac) and their songs join the queue.</p>`;
  $('mcopy')?.addEventListener('click', () => navigator.clipboard.writeText(redirect).then(() => toast('Copied')));
  $('mform')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/music/spotify', { method: 'PUT', owner: true, body: { clientId: e.target.clientId.value, clientSecret: e.target.clientSecret.value } });
      location.href = r.url;
    } catch (err) { toast(err.message); }
  });
  $('mdisc')?.addEventListener('click', async () => { await api('/api/music/spotify', { method: 'DELETE', owner: true }).catch((err) => toast(err.message)); musicDrawn = null; refresh(); });
  $('mdev')?.addEventListener('click', async () => {
    try {
      const list = await api('/api/music/devices', { owner: true });
      $('mdevices').innerHTML = list.map((d) => `<div><span class="grow">${esc(d.name)} <span class="small muted">${esc(d.type)}${d.active ? ' · playing' : ''}</span></span>
        <button class="btn small" data-dev="${esc(d.id)}" data-name="${esc(d.name)}">Use this</button></div>`).join('') || '<div class="small muted">No speakers awake. Open Spotify on one, then try again.</div>';
    } catch (err) { toast(err.message); }
  });
  $('mdevices')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-dev]');
    if (!b) return;
    await api('/api/music/device', { method: 'PUT', owner: true, body: { id: b.dataset.dev, name: b.dataset.name } }).catch((err) => toast(err.message));
    toast(`Guests' songs will start on ${b.dataset.name} when nothing is playing`);
    refresh();
  });
}
{
  const q = new URLSearchParams(location.search).get('music');
  if (q) { toast(q === 'connected' ? 'Spotify connected' : `Spotify: ${q}`); history.replaceState(null, '', location.pathname + location.hash); }
}

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
  $('preview').innerHTML = view === 'web' ? '<iframe src="wall?preview" title="Wall piece"></iframe>' : '<img alt="E-ink panel image">';
  if (view !== 'web') refreshInk();
}));
