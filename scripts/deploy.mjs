// npm run deploy — push code changes live (Worker now, site via the GitHub Action).
import { spawnSync } from 'node:child_process';
const root = new URL('..', import.meta.url).pathname;
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(`${root}node_modules/.bin/tsc`, ['--noEmit', '-p', '.']);
run(`${root}node_modules/.bin/wrangler`, ['d1', 'migrations', 'apply', 'atlantico', '--remote']);
run(`${root}node_modules/.bin/wrangler`, ['deploy']);
if (spawnSync('git', ['remote'], { cwd: root, encoding: 'utf8' }).stdout.trim()) run('git', ['push']);
