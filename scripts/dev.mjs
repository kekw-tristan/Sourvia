import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';

const compile = spawn(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.main.json'], { stdio: 'inherit' });
if (await new Promise(resolve => compile.on('exit', resolve))) process.exit(1);
const server = await createServer();
await server.listen();
const env = { ...process.env, SOURVIA_DEV_URL: 'http://127.0.0.1:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  child.kill();
  await server.close();
}
child.on('exit', async code => { await close(); process.exit(code ?? 0); });
process.on('SIGINT', close);
process.on('SIGTERM', close);
