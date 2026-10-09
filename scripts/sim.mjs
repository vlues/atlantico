// npm run sim — everything locally, no hardware, no Cloudflare account needed.
//   Worker (wrangler dev, SIMULATE=true, local D1/KV)  → http://localhost:8787
//   Static site (web/)                                  → http://localhost:8788
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const WEB = join(root, 'web');
const API = 'http://localhost:8787';
const bin = (name) => join(root, 'node_modules', '.bin', name);

console.log('· applying database schema (local)');
const mig = spawnSync(bin('wrangler'), ['d1', 'migrations', 'apply', 'atlantico', '--local'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, CI: '1' },
});
if (mig.status !== 0) process.exit(mig.status ?? 1);

const worker = spawn(bin('wrangler'), [
  'dev', '--local', '--port', '8787', '--test-scheduled',
  '--var', 'SIMULATE:true', '--var', 'OWNER_TOKEN:sim-owner', '--var', 'PAGES_ORIGIN:http://localhost:8788',
], { cwd: root, stdio: 'inherit' });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.bin': 'application/octet-stream', '.ico': 'image/x-icon' };

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/config.js') {
    res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' });
    return res.end(`window.ATLANTICO = ${JSON.stringify({ api: API, simulate: true })};\n`);
  }
  let file = normalize(join(WEB, path));
  if (!file.startsWith(WEB)) { res.writeHead(403); return res.end(); }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    if (!extname(file)) file += '.html';
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(8788, () => {
  console.log('\n  Atlántico simulator');
  console.log('  wall piece     http://localhost:8788/wall');
  console.log('  control page   http://localhost:8788/control   (passcode: sim-owner)');
  console.log('  guest arrival  http://localhost:8788/hola');
  console.log(`  e-ink image    ${API}/art/panel.png?size=800x480\n`);
});

// Local stand-in for Cloudflare's cron: tick the simulator every minute.
async function tick(cron = '*/15 * * * *') {
  try { await fetch(`${API}/__scheduled?cron=${encodeURIComponent(cron)}`); } catch { /* worker still starting */ }
}
const waitForWorker = async () => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(API)).ok) return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
};
waitForWorker().then(async (up) => {
  if (!up) return;
  await tick();
  setInterval(tick, 60000);
});

const stop = () => { worker.kill('SIGINT'); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
worker.on('exit', (code) => process.exit(code ?? 0));
