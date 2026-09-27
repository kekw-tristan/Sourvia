import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectFilesystem } from '../src/main/filesystem';

test('project browsing, safe UTF-8 editing, ignores, conflict and boundary checks', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sourvia-fs-'));
  try {
    const root = path.join(temp, 'project');
    await fs.mkdir(root);
    await fs.mkdir(path.join(root, 'src'));
    await fs.mkdir(path.join(root, '.git'));
    await fs.mkdir(path.join(root, 'node_modules'));
    const file = path.join(root, 'ä shader.hlsl');
    await fs.writeFile(file, '\uFEFFfloat4 main() { return 0; }\r\n');
    const outside = path.join(temp, 'secret.txt');
    await fs.writeFile(outside, 'outside');
    const project = new ProjectFilesystem();
    const directory = await project.open(root);
    assert.deepEqual(directory.children.map(e => e.name), ['src', 'ä shader.hlsl']);
    assert.equal(directory.current.parentPath, undefined);
    assert.equal((await project.list(path.join(root, 'src'))).current.parentPath, directory.root);
    const doc = await project.read(file);
    assert.equal(doc.language, 'hlsl');
    assert.ok(doc.uri.startsWith('file:'));
    assert.ok(doc.text.startsWith('\uFEFF'));
    await project.save(file, 'float4 main() { return 1; }\r\n');
    assert.equal(await fs.readFile(file, 'utf8'), 'float4 main() { return 1; }\r\n');
    await fs.writeFile(file, 'external change');
    await assert.rejects(project.save(file, 'overwrite'), /changed on disk/);
    await assert.rejects(project.read(outside), /outside/);
    await assert.rejects(project.list(temp), /outside/);
    await assert.rejects(project.read('relative.txt'), /absolute/);
    await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2]));
    await assert.rejects(project.read(path.join(root, 'binary.bin')), /Binary/);
    await fs.writeFile(path.join(root, 'invalid.txt'), Buffer.from([0xff, 0xfe]));
    await assert.rejects(project.read(path.join(root, 'invalid.txt')));
    await fs.symlink(temp, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(project.read(path.join(root, 'escape', 'secret.txt')), /outside/);
    assert.ok(!(await project.list(root)).children.some(e => e.name === 'escape'));
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
