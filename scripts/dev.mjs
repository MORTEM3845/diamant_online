import { spawnSync, spawn } from 'node:child_process';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const task of ['build', 'db:migrate:local']) {
  const result = spawnSync(npm, ['run', task], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const args = process.argv.slice(2);
const argument = key => { const index = args.indexOf(key); return index < 0 ? undefined : args[index + 1]; };
const port = argument('--port') || process.env.PORT || '5173';
const host = argument('--host') || argument('--hostname') || '127.0.0.1';
const child = spawn(npm, ['exec', '--', 'wrangler', 'dev', '--ip', host, '--port', port, '--inspector-port', process.env.DIAMANT_INSPECTOR_PORT || '9229'], { stdio: 'inherit', env: process.env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 0));
