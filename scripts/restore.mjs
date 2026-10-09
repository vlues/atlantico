// npm run restore — load the latest encrypted backup into the D1 database of the
// Cloudflare account you are logged into. Used when moving to a new account or home.
import { pbkdf2Sync, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const file = process.argv[2] ?? join(root, 'backups/atlantico.sql.enc');
const rl = createInterface({ input: process.stdin, output: process.stdout });

// Same format as `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt` (used by the backup Action).
function decrypt(buf, pass) {
  if (buf.subarray(0, 8).toString() !== 'Salted__') throw new Error('not an Atlántico backup');
  const salt = buf.subarray(8, 16);
  const kiv = pbkdf2Sync(pass, salt, 200000, 48, 'sha256');
  const d = createDecipheriv('aes-256-cbc', kiv.subarray(0, 32), kiv.subarray(32));
  return Buffer.concat([d.update(buf.subarray(16)), d.final()]).toString('utf8');
}

const pass = (await rl.question('Backup passphrase: ')).trim();
let sql;
try { sql = decrypt(readFileSync(file), pass); } catch { console.error('Wrong passphrase or damaged file.'); process.exit(1); }
const visitors = (sql.match(/INSERT INTO "?visitors"?/g) ?? []).length;
const readings = (sql.match(/INSERT INTO "?readings"?/g) ?? []).length;
console.log(`Backup contains ${visitors} visitors and ${readings} readings.`);
if (!/^y/i.test(await rl.question('Replace the remote database with this backup? (y/N) '))) process.exit(0);
rl.close();

const drop = ['visitors', 'devices', 'pairing_codes', 'plants', 'readings', 'waterings', 'alerts', 'settings', 'd1_migrations']
  .map((t) => `DROP TABLE IF EXISTS ${t};`).join('\n');
const tmp = join(tmpdir(), `atlantico-restore-${Date.now()}.sql`);
writeFileSync(tmp, `${drop}\n${sql}`, { mode: 0o600 });
const r = spawnSync(join(root, 'node_modules/.bin/wrangler'), ['d1', 'execute', 'atlantico', '--remote', '--yes', '--file', tmp], { stdio: 'inherit', cwd: root });
rmSync(tmp, { force: true });
console.log(r.status === 0 ? '\nRestored. Paired devices keep working if the Worker URL is the same; otherwise re-pair them.' : '\nRestore failed.');
process.exit(r.status ?? 1);
