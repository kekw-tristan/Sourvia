import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectFilesystem } from '../src/main/filesystem';
import { findNativeLaunch } from '../src/main/build/nativeLaunch';
import type { BuildSettings } from '../src/shared/types';

test('native launch follows the solution startup order, selected configuration and project boundary', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sourvia-launch-'));
  const filesystem = new ProjectFilesystem();
  try {
    await fs.mkdir(path.join(root, 'project'));
    await fs.mkdir(path.join(root, 'bin'));
    await fs.writeFile(path.join(root, 'bin', 'Release.exe'), 'fixture');
    await fs.writeFile(path.join(root, 'project', 'library.vcxproj'), '<Project />');
    await fs.writeFile(path.join(root, 'project', 'game.vcxproj'), '<Project />');
    const solution = path.join(root, 'Workspace.sln');
    await fs.writeFile(solution, 'Project("{GUID}") = "library", "project\\library.vcxproj", "{A}"\nProject("{GUID}") = "game", "project\\game.vcxproj", "{B}"\n');
    await filesystem.open(root);
    const settings = { configuration: 'Release', platform: 'x64', target: '', runDirectory: '.' } as BuildSettings;
    const queried: string[] = [];
    const query = async (project: string, args: string[]) => {
      queried.push(path.basename(project));
      assert.ok(args.includes('/p:Configuration=Release'));
      return JSON.stringify({ Properties: { ConfigurationType: project.endsWith('library.vcxproj') ? 'StaticLibrary' : 'Application', TargetPath: path.join(root, 'bin', 'Release.exe') } });
    };
    const launch = await findNativeLaunch(filesystem, solution, settings, query);
    assert.equal(launch.executable, path.join(root, 'bin', 'Release.exe'));
    assert.equal(launch.cwd, path.join(root, 'bin'), 'Default to the executable folder so adjacent assets are found');
    assert.deepEqual(queried, ['library.vcxproj', 'game.vcxproj']);
    queried.length = 0;
    await findNativeLaunch(filesystem, solution, { ...settings, target: 'game' }, query);
    assert.deepEqual(queried, ['game.vcxproj']);
    await assert.rejects(findNativeLaunch(filesystem, solution, settings, async () => JSON.stringify({ Properties: { ConfigurationType: 'Application', TargetPath: path.dirname(root) } })), /outside the open project/);
    await assert.rejects(findNativeLaunch(filesystem, solution, settings, async () => JSON.stringify({ Properties: { ConfigurationType: 'StaticLibrary' } })), /No runnable application/);
    await assert.rejects(findNativeLaunch(filesystem, solution, settings, async () => 'invalid'), /Cannot read the program target/);
  } finally {
    if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('sourvia-launch-')) await fs.rm(root, { recursive: true, force: true });
  }
});
