import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectFilesystem } from '../src/main/filesystem';
import { BuildRunner } from '../src/main/build/BuildRunner';
import type { BuildEvent } from '../src/shared/types';

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sourvia-real-make-'));
  const filesystem = new ProjectFilesystem();
  const events: BuildEvent[] = [];
  const runner = new BuildRunner(filesystem, event => {
    events.push(event);
    if (event.type === 'output') process.stdout.write(event.text);
  });
  async function finished() {
    for (let i = 0; i < 300; i++) {
      const result = events.find(event => event.type === 'state' && ['success', 'failed'].includes(event.state.phase));
      if (result?.type === 'state') return result.state;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Make integration test timed out.');
  }
  try {
    const program = process.platform === 'win32' ? 'app.exe' : 'app';
    await fs.writeFile(path.join(root, 'main.c'), '#include <stdio.h>\nint main(void) { puts("REAL MAKE RUN OK"); return 0; }\n');
    await fs.writeFile(path.join(root, 'Makefile'), `all:\n\tgcc main.c -o ${program}\n`);
    await filesystem.open(root);
    const settings = { ...await runner.detect(), executable: program };
    runner.start(settings, true);
    assert.equal((await finished()).phase, 'success');
    assert.ok(events.some(event => event.type === 'output' && event.text.includes('REAL MAKE RUN OK')));
    events.length = 0;
    await fs.writeFile(path.join(root, 'main.c'), 'int main(void) { return missing_symbol; }\n');
    runner.start(settings, true);
    assert.equal((await finished()).phase, 'failed');
    assert.ok(events.some(event => event.type === 'diagnostics' && event.event.diagnostics.some(diagnostic => diagnostic.message.includes('missing_symbol'))));
    assert.ok(!events.some(event => event.type === 'state' && event.state.phase === 'running'));
    console.log('PASS real Make/GCC: compilation, program output, source diagnostic and no launch after build failure.');
  } finally {
    await runner.stop();
    if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('sourvia-real-make-')) await fs.rm(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
