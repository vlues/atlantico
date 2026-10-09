// npm run setup — from nothing to a deployed Atlántico.
// Safe to run again: it reuses what already exists and only asks for what is missing.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { stdin, stdout } from 'node:process';

const root = new URL('..', import.meta.url).pathname;
const WRANGLER = `${root}node_modules/.bin/wrangler`;
const STATE_FILE = `${root}.atlantico.local.json`;
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
const rl = createInterface({ input: stdin, output: stdout });

const say = (s = '') => console.log(s);
const step = (s) => say(`\n— ${s}`);
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts });
const ok = (cmd, args) => run(cmd, args).status === 0;
const wrangler = (args, opts) => run(WRANGLER, args, opts);
const must = (r, what) => { if (r.status !== 0) { say(r.stdout ?? ''); say(r.stderr ?? ''); throw new Error(`${what} failed`); } return r; };

async function ask(q, def = '') {
  const a = (await rl.question(`  ${q}${def ? ` [${def}]` : ''}: `)).trim();
  return a || def;
}
// Typed secrets show as dots.
let muted = false;
rl._writeToOutput = (s) => stdout.write(muted ? s.replace(/[^\r\n]/g, '•') : s);
async function askSecret(q) {
  stdout.write(`  ${q}: `);
  muted = true;
  const a = await rl.question('');
  muted = false;
  return a.trim();
}
async function yes(q, def = true) {
  const a = (await ask(`${q} (${def ? 'Y/n' : 'y/N'})`)).toLowerCase();
  return a ? a.startsWith('y') : def;
}
function putSecret(name, value) {
  must(wrangler(['secret', 'put', name], { input: value, stdio: ['pipe', 'pipe', 'pipe'] }), `secret ${name}`);
}

async function main() {
  say('\nAtlántico setup. About ten minutes. Press Enter to accept [defaults].');

  step('Checking prerequisites');
  const [maj] = process.versions.node.split('.').map(Number);
  if (maj < 20) throw new Error(`Node 20+ needed (you have ${process.versions.node}). brew install node`);
  if (!ok('git', ['--version'])) throw new Error('git is missing. Run: xcode-select --install');
  const hasGh = ok('gh', ['--version']);
  say(`  node ${process.versions.node} · git ✓ · GitHub CLI ${hasGh ? '✓' : '✗ (brew install gh — needed for Pages and backups)'}`);
  if (!existsSync(WRANGLER)) must(run('npm', ['ci'], { stdio: 'inherit' }), 'npm ci');

  step('Cloudflare login');
  if (!ok(WRANGLER, ['whoami'])) {
    say('  A browser window opens; approve access for Wrangler.');
    must(wrangler(['login'], { stdio: 'inherit' }), 'wrangler login');
  }
  const who = wrangler(['whoami']).stdout;
  state.accountId ??= who.match(/[0-9a-f]{32}/)?.[0];
  say(`  logged in${state.accountId ? ` · account ${state.accountId}` : ''}`);

  step('Database (D1) and state (KV)');
  let toml = readFileSync(`${root}wrangler.toml`, 'utf8');
  if (!state.d1) {
    const list = wrangler(['d1', 'list', '--json']);
    const existing = list.status === 0 ? JSON.parse(list.stdout).find((d) => d.name === 'atlantico') : null;
    if (existing) state.d1 = existing.uuid;
    else {
      const r = must(wrangler(['d1', 'create', 'atlantico']), 'd1 create');
      state.d1 = (r.stdout + r.stderr).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
    }
    saveState();
  }
  if (!state.kv) {
    const list = wrangler(['kv', 'namespace', 'list']);
    const existing = list.status === 0 ? JSON.parse(list.stdout).find((n) => /atlantico.*STATE|^STATE$/.test(n.title)) : null;
    if (existing) state.kv = existing.id;
    else {
      const r = must(wrangler(['kv', 'namespace', 'create', 'STATE']), 'kv create');
      state.kv = (r.stdout + r.stderr).match(/[0-9a-f]{32}/)?.[0];
    }
    saveState();
  }
  if (!state.d1 || !state.kv) throw new Error('could not read the D1/KV ids from wrangler output');
  toml = toml.replace(/database_id = ".*"/, `database_id = "${state.d1}"`).replace(/^id = ".*"/m, `id = "${state.kv}"`);
  say(`  D1 ${state.d1}\n  KV ${state.kv}`);

  step('GitHub');
  let repo = state.repo;
  if (hasGh && !repo) {
    if (!ok('gh', ['auth', 'status'])) must(run('gh', ['auth', 'login', '--web', '-p', 'https'], { stdio: 'inherit' }), 'gh auth');
    const user = run('gh', ['api', 'user', '-q', '.login']).stdout.trim();
    repo = await ask('Repository (public, so GitHub Pages is free; backups are encrypted)', `${user}/atlantico`);
    state.repo = repo;
    saveState();
  }
  const owner = repo?.split('/')[0];
  const pagesOrigin = owner ? `https://${owner.toLowerCase()}.github.io` : 'http://localhost:8788';
  const pagesUrl = repo ? `${pagesOrigin}/${repo.split('/')[1]}` : null;

  step('Behaviour');
  const simulate = await yes('Start with simulated devices until real ones pair', state.simulate ?? true);
  state.simulate = simulate;
  saveState();
  toml = toml.replace(/SIMULATE = ".*"/, `SIMULATE = "${simulate}"`).replace(/PAGES_ORIGIN = ".*"/, `PAGES_ORIGIN = "${pagesOrigin}"`);
  writeFileSync(`${root}wrangler.toml`, toml);

  step('Deploying the Worker');
  must(wrangler(['d1', 'migrations', 'apply', 'atlantico', '--remote'], { input: 'y\n' }), 'migrations');
  const dep = must(wrangler(['deploy']), 'deploy');
  const workerUrl = (dep.stdout + dep.stderr).match(/https:\/\/[^\s]+workers\.dev/)?.[0] ?? state.workerUrl;
  if (!workerUrl) throw new Error('deployed, but could not find the workers.dev URL. Check `wrangler deploy` output.');
  state.workerUrl = workerUrl;
  saveState();
  say(`  ${workerUrl}`);

  step('Secrets (stored in Cloudflare, never in the repo)');
  const existing = new Set((JSON.parse(wrangler(['secret', 'list', '--format', 'json']).stdout || '[]')).map((s) => s.name));
  if (!existing.has('OWNER_TOKEN') || await yes('Change the owner passcode', false)) {
    const suggestion = randomBytes(9).toString('base64url');
    const pass = (await askSecret(`Owner passcode for the control page (Enter = generate one)`)) || suggestion;
    putSecret('OWNER_TOKEN', pass);
    if (pass === suggestion) say(`  Your passcode: ${pass}  (save it in your password manager)`);
  }
  if (!existing.has('ANTHROPIC_API_KEY')) {
    const k = await askSecret('Claude API key for the daily plant check (console.anthropic.com; Enter to skip)');
    if (k) putSecret('ANTHROPIC_API_KEY', k);
  }
  if (!existing.has('TELEGRAM_BOT_TOKEN') && await yes('Set up Telegram alerts now', false)) {
    say('  In Telegram, talk to @BotFather → /newbot → copy the token.');
    const t = await askSecret('Bot token');
    if (t) {
      say('  Now send any message to your new bot, then press Enter.');
      await ask('');
      const upd = await fetch(`https://api.telegram.org/bot${t}/getUpdates`).then((r) => r.json()).catch(() => null);
      const chat = upd?.result?.at(-1)?.message?.chat?.id;
      if (chat) { putSecret('TELEGRAM_BOT_TOKEN', t); putSecret('TELEGRAM_CHAT_ID', String(chat)); say(`  Linked to chat ${chat}.`); }
      else say('  Could not find your message. Run setup again later to finish this.');
    }
  }
  say('  Govee: paste the key later on the Add device page (no setup needed here).');

  if (hasGh && repo) {
    step('Publishing to GitHub');
    if (!existsSync(`${root}.git`)) {
      must(run('git', ['init', '-b', 'main']), 'git init');
    }
    run('git', ['add', '-A']);
    run('git', ['commit', '-m', 'Atlántico']);
    if (!ok('gh', ['repo', 'view', repo])) must(run('gh', ['repo', 'create', repo, '--public', '--source', '.', '--push']), 'gh repo create');
    else run('git', ['push', '-u', 'origin', 'main'], { stdio: 'inherit' });
    must(run('gh', ['variable', 'set', 'ATLANTICO_API', '--repo', repo, '--body', workerUrl]), 'gh variable');
    run('gh', ['api', '-X', 'POST', `repos/${repo}/pages`, '-f', 'build_type=workflow']); // ok if it already exists

    if (!state.backupReady) {
      say('\n  Backups and auto-deploys need a Cloudflare API token:');
      say('  dash.cloudflare.com/profile/api-tokens → Create token → "Edit Cloudflare Workers" template,');
      say('  then add permission  Account › D1 › Edit.  Create, copy, paste here.');
      const tok = await askSecret('Cloudflare API token (Enter to skip)');
      if (tok) {
        const pass = randomBytes(24).toString('base64url');
        must(run('gh', ['secret', 'set', 'CLOUDFLARE_API_TOKEN', '--repo', repo, '--body', tok]), 'gh secret');
        must(run('gh', ['secret', 'set', 'CLOUDFLARE_ACCOUNT_ID', '--repo', repo, '--body', state.accountId ?? '']), 'gh secret');
        must(run('gh', ['secret', 'set', 'BACKUP_PASSPHRASE', '--repo', repo, '--body', pass]), 'gh secret');
        say(`\n  BACKUP PASSPHRASE: ${pass}`);
        say('  Save this in your password manager now. Without it, backups cannot be restored.');
        state.backupReady = true;
        saveState();
      }
    }
    run('gh', ['workflow', 'run', 'site.yml', '--repo', repo]);
  } else {
    say('\n  Skipped GitHub (no gh CLI). Install it with `brew install gh` and run setup again for Pages and backups.');
  }

  say('\n────────────────────────────────────────────');
  say('  Atlántico is live.\n');
  say(`  Worker           ${workerUrl}`);
  say(`  E-ink image      ${workerUrl}/art/panel.png?size=800x480`);
  if (pagesUrl) {
    say(`  Wall             ${pagesUrl}/wall`);
    say(`  Control          ${pagesUrl}/control`);
    say(`  Guest page       ${pagesUrl}/hola   ← put this URL on the NFC tag / QR code`);
    say(`  Add device       ${pagesUrl}/add`);
    say('\n  GitHub Pages takes ~3 minutes to build the site and firmware the first time.');
  }
  say('────────────────────────────────────────────\n');
}

main().catch((e) => { console.error(`\n✗ ${e.message}`); process.exitCode = 1; }).finally(() => rl.close());
