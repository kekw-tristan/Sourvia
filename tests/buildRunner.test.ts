import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BuildRunner, parseCompilerDiagnostic } from '../src/main/build/BuildRunner';
import { ProjectFilesystem } from '../src/main/filesystem';
import type { BuildEvent, BuildSettings } from '../src/shared/types';
import { restoreBuildSettings } from '../src/shared/buildSettings';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sourvia-build-'));
  await fs.writeFile(path.join(root, 'premake5.lua'), '-- fixture');
  await fs.writeFile(path.join(root, 'main.cpp'), 'int main() {\n    missing;\n}\n');
  await fs.writeFile(path.join(root, 'program'), 'fixture');
  const filesystem = new ProjectFilesystem();
  await filesystem.open(root);
  const events: BuildEvent[] = [];
  const runner = new BuildRunner(filesystem, event => events.push(event), (command, args, options) =>
    spawn(process.execPath, [path.resolve('tests/fixtures/build-tool.cjs'), command === 'premake5' ? 'premake' : command === 'make' ? 'make' : command === 'msbuild' ? 'msbuild' : 'program', ...args],
      { ...options, env: { ...process.env, SOURVIA_BUILD_TEST_ROOT: root } }));
  const settings: BuildSettings = { ...await runner.detect(), makeCommand: 'make', premakeCommand: 'premake5', buildDirectory: 'generated', executable: 'program' };
  return { root, filesystem, events, runner, settings,
    calls: async () => (await fs.readFile(path.join(root, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)),
    cleanup: async () => { await runner.stop(); await fs.rm(root, { recursive: true, force: true }); } };
}
async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 150; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('Build event timed out.');
}
function phase(events: BuildEvent[], name: string) { return events.some(event => event.type === 'state' && event.state.phase === name); }

test('compiler diagnostics handle GCC, Windows paths, MSVC and absent columns', () => {
  const gcc = parseCompilerDiagnostic('C:\\project space\\main.cpp:12:7: error: invalid value');
  assert.equal(gcc?.file, 'C:\\project space\\main.cpp');
  assert.deepEqual(gcc?.diagnostic.range.start, { line: 11, character: 6 });
  assert.equal(parseCompilerDiagnostic('src/a.cpp(4,2): warning C4101: unused variable')?.diagnostic.severity, 2);
  assert.equal(parseCompilerDiagnostic('  2>C:\\src\\a.cpp(4,2): error C1083: missing header')?.file, 'C:\\src\\a.cpp');
  assert.equal(parseCompilerDiagnostic('src/a.cpp:5: error: invalid')?.diagnostic.range.start.character, 0);
  assert.equal(parseCompilerDiagnostic('make: *** [all] Error 2'), null);
});

test('Premake Visual Studio builds the solution with MSBuild instead of Make', async () => {
  const f = await fixture();
  try {
    f.runner.start({ ...f.settings, premakeAction: 'vs2022', msbuildCommand: 'msbuild', configuration: 'Release', target: 'game' }, true);
    await waitFor(() => phase(f.events, 'success'));
    const calls = await f.calls();
    assert.deepEqual(calls.map(call => call.stage), ['premake', 'msbuild', 'program']);
    assert.deepEqual(calls[0].args, [`--file=${path.join(f.root, 'premake5.lua')}`, 'vs2022']);
    assert.equal(calls[1].args[0], path.join(f.root, 'generated', 'Fixture.sln'));
    assert.ok(calls[1].args.includes('/p:Configuration=Release'));
    assert.ok(calls[1].args.includes('/p:Platform=x64'));
    assert.ok(calls[1].args.includes('/t:game'));
    assert.ok(!calls.some(call => call.stage === 'make'));
  } finally { await f.cleanup(); }
});

test('MSBuild failures publish diagnostics and do not launch the program', async () => {
  const f = await fixture();
  try {
    f.runner.start({ ...f.settings, premakeAction: 'vs2022', msbuildCommand: 'msbuild', target: 'fail' }, true);
    await waitFor(() => phase(f.events, 'failed'));
    assert.deepEqual((await f.calls()).map(call => call.stage), ['premake', 'msbuild']);
    assert.ok(f.events.some(event => event.type === 'diagnostics' && event.event.diagnostics.some(d => d.message.includes('MSVC error'))));
  } finally { await f.cleanup(); }
});

test('Run with no executable builds, detects the startup program and uses its working directory', async () => {
  const f = await fixture();
  try {
    f.runner.start({ ...f.settings, premakeAction: 'vs2022', msbuildCommand: 'msbuild', executable: '', configuration: 'Release', args: ['auto launch'] }, true);
    await waitFor(() => phase(f.events, 'success'));
    const calls = await f.calls();
    assert.deepEqual(calls.map(call => call.stage), ['premake', 'msbuild', 'msbuild', 'program']);
    assert.equal(calls[2].args[0], path.join(f.root, 'generated', 'App.vcxproj'));
    assert.ok(calls[2].args.includes('/p:Configuration=Release'));
    assert.ok(calls[2].args.some(arg => arg.startsWith('/getProperty:')));
    assert.equal(calls[3].cwd, path.join(f.root, 'generated'));
    assert.deepEqual(calls[3].args, ['auto launch']);
  } finally { await f.cleanup(); }
});

test('multiple solutions require an explicit choice; an explicit solution is honored', async () => {
  const f = await fixture();
  try {
    await fs.mkdir(path.join(f.root, 'generated'));
    await fs.writeFile(path.join(f.root, 'generated', 'Second.sln'), 'fixture');
    const settings = { ...f.settings, premakeAction: 'vs2022' as const, msbuildCommand: 'msbuild' };
    f.runner.start(settings, false);
    await waitFor(() => phase(f.events, 'failed'));
    assert.deepEqual((await f.calls()).map(call => call.stage), ['premake']);
    f.runner.start({ ...settings, solution: 'generated/Second.sln' }, false);
    await waitFor(() => phase(f.events, 'success'));
    assert.equal((await f.calls()).at(-1).args[0], path.join(f.root, 'generated', 'Second.sln'));
  } finally { await f.cleanup(); }
});

test('Windows vcpkg detection and legacy settings select the native toolchain', async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.root, 'vcpkg.json'), '{}');
    const detected = await f.runner.detect();
    assert.equal(detected.premakeAction, process.platform === 'win32' ? 'vs2022' : 'gmake');
    const native = { ...detected, premakeAction: 'vs2022' as const };
    const { msbuildCommand: _oldMissingField, solution: _oldMissingSolution, platform: _oldMissingPlatform, ...legacy } = f.settings;
    const restored = restoreBuildSettings(native, { ...legacy, target: 'all', executable: 'bin/game.exe' });
    assert.equal(restored.premakeAction, 'vs2022');
    assert.equal(restored.executable, 'bin/game.exe');
    assert.equal(restored.target, '');
    assert.equal(restored.msbuildCommand, detected.msbuildCommand);
    assert.equal(restoreBuildSettings(native, f.settings).premakeAction, 'gmake', 'Preserve an explicit choice saved by the new version');
    assert.equal(restoreBuildSettings(native, { ...legacy, premakeAction: 'gmake2' }).premakeAction, 'gmake2');
    assert.deepEqual(restoreBuildSettings(native, null), native);
  } finally { await f.cleanup(); }
});

test('Premake generates before Make, then runs with literal arguments and the chosen cwd', async () => {
  const f = await fixture();
  try {
    assert.equal(f.settings.system, 'premake');
    f.runner.start({ ...f.settings, configuration: 'debug', target: 'all', runDirectory: 'generated', args: ['space in argument', '$(literal);&'] }, true);
    await waitFor(() => phase(f.events, 'success'));
    const calls = await f.calls();
    assert.deepEqual(calls.map(call => call.stage), ['premake', 'make', 'program']);
    assert.deepEqual(calls[0].args, [`--file=${path.join(f.root, 'premake5.lua')}`, 'gmake']);
    assert.deepEqual(calls[1].args, ['config=debug', 'all']);
    assert.equal(calls[1].cwd, path.join(f.root, 'generated'));
    assert.deepEqual(calls[2].args, ['space in argument', '$(literal);&']);
    assert.equal(calls[2].cwd, path.join(f.root, 'generated'));
    assert.ok(f.events.some(event => event.type === 'output' && event.text.includes('PROGRAM OUTPUT')));
  } finally { await f.cleanup(); }
});

test('failed Make publishes source diagnostics and prevents program launch; next build clears them', async () => {
  const f = await fixture();
  try {
    f.runner.start({ ...f.settings, target: 'fail' }, true);
    await waitFor(() => phase(f.events, 'failed'));
    assert.deepEqual((await f.calls()).map(call => call.stage), ['premake', 'make']);
    const diagnostic = f.events.find(event => event.type === 'diagnostics' && event.event.diagnostics.length);
    assert.ok(diagnostic?.type === 'diagnostics');
    assert.equal(diagnostic.event.diagnostics[0].message, 'unknown identifier');
    f.runner.start({ ...f.settings, system: 'make' }, false);
    await waitFor(() => phase(f.events, 'success'));
    assert.ok(f.events.some(event => event.type === 'diagnostics' && event.event.diagnostics.length === 0));
    assert.deepEqual((await f.calls()).map(call => call.stage), ['premake', 'make', 'make']);
  } finally { await f.cleanup(); }
});

test('stop cancels a running build and disallows concurrent starts', async () => {
  const f = await fixture();
  try {
    f.runner.start({ ...f.settings, target: 'wait' }, true);
    await waitFor(() => f.events.some(event => event.type === 'output' && event.text.includes('BUILD WAITING')));
    assert.throws(() => f.runner.start(f.settings, false), /already running/);
    await f.runner.stop();
    assert.ok(phase(f.events, 'stopped'));
    assert.deepEqual((await f.calls()).map(call => call.stage), ['premake', 'make']);
  } finally { await f.cleanup(); }
});

test('stop terminates a launched program', async () => {
  const f = await fixture();
  try {
    f.runner.start({ ...f.settings, args: ['wait'] }, true);
    await waitFor(() => f.events.some(event => event.type === 'output' && event.text.includes('PROGRAM OUTPUT')));
    await f.runner.stop();
    assert.ok(phase(f.events, 'stopped'));
  } finally { await f.cleanup(); }
});

test('invalid settings and escaping paths are rejected before execution', async () => {
  const f = await fixture();
  try {
    assert.throws(() => f.runner.start({ ...f.settings, buildDirectory: '..' }, false), /inside the project/);
    assert.throws(() => f.runner.start({ ...f.settings, executable: '' }, true), /program executable/);
    assert.throws(() => f.runner.start({ ...f.settings, target: '--eval=anything' }, false), /dash/);
    assert.throws(() => f.runner.start({ ...f.settings, args: 'bad' as unknown as string[] }, true), /arguments/);
    assert.equal(f.events.length, 0);
  } finally { await f.cleanup(); }
});

test('a missing Make executable reports failure without an unhandled process error', async () => {
  const f = await fixture();
  const events: BuildEvent[] = [];
  const runner = new BuildRunner(f.filesystem, event => events.push(event));
  try {
    runner.start({ ...f.settings, system: 'make', buildDirectory: '.', makeCommand: 'sourvia-missing-make-command' }, false);
    await waitFor(() => phase(events, 'failed'));
    assert.ok(events.some(event => event.type === 'state' && event.state.message.includes('Check Run settings')));
  } finally { await runner.stop(); await f.cleanup(); }
});
