import { spawn } from 'node:child_process';
import electron from 'electron';
const env = { ...process.env, SOURVIA_TEST_NODE: process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SOURVIA_DEV_URL;
const child = spawn(electron, ['tests/electron-smoke.cjs'], { stdio: 'inherit', env });
child.on('exit', code => process.exit(code ?? 1));
child.on('error', error => { console.error(error); process.exit(1); });
