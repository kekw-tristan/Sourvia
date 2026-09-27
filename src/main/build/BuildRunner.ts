import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BuildEvent, BuildSettings, BuildState, Diagnostic } from '../../shared/types';
import { ProjectFilesystem } from '../filesystem';
import { findMSBuild } from './visualStudio';
import { findNativeLaunch } from './nativeLaunch';
import { canDetectExecutable } from '../../shared/buildSettings';

export function parseCompilerDiagnostic(line: string): { file: string; diagnostic: Diagnostic } | null {
  line = line.replace(/^\s*(?:\d+>)?\s*/, '');
  // GCC/Clang (including Windows drive letters), then MSVC.
  const match = /^(.*?):(\d+)(?::(\d+))?:\s*(fatal error|error|warning|note):\s*(.*)$/.exec(line)
    ?? /^(.*?)\((\d+)(?:,(\d+))?\):\s*(fatal error|error|warning|note)(?:\s+\w+)?\s*:\s*(.*)$/.exec(line);
  if (!match) return null;
  const start = { line: Math.max(0, Number(match[2]) - 1), character: Math.max(0, Number(match[3] || 1) - 1) };
  return { file: match[1].trim(), diagnostic: { range: { start, end: { ...start, character: start.character + 1 } },
    severity: match[4] === 'warning' ? 2 : match[4] === 'note' ? 3 : 1, message: match[5], source: 'build' } };
}

export class BuildRunner {
  private task?: Promise<void>;
  private child?: ChildProcess;
  private cancelled = false;
  private stopping?: Promise<void>;
  private diagnostics = new Map<string, Diagnostic[]>();
  constructor(private filesystem: ProjectFilesystem, private emit: (event: BuildEvent) => void,
    private launch: (command: string, args: string[], options: SpawnOptions) => ChildProcess = spawn) {}
  private state(phase: BuildState['phase'], message: string) { this.emit({ type: 'state', state: { phase, message } }); }
  private output(text: string) { this.emit({ type: 'output', text }); }

  async detect(): Promise<BuildSettings> {
    const names = await fs.readdir(await this.filesystem.resolve(this.filesystem.root));
    let makeCommand = process.env.SOURVIA_MAKE || 'make';
    if (!process.env.SOURVIA_MAKE && process.platform === 'win32') {
      const folders = (process.env.PATH || '').split(path.delimiter);
      const exists = async (name: string) => (await Promise.all(folders.map(folder => fs.access(path.join(folder, name)).then(() => true, () => false)))).some(Boolean);
      if (!await exists('make.exe') && await exists('mingw32-make.exe')) makeCommand = 'mingw32-make';
    }
    const nativeWindows = process.platform === 'win32' && names.includes('vcpkg.json');
    const localPremake = path.join('scripts', process.platform === 'win32' ? 'premake5.exe' : 'premake5');
    const bundledPremake = await fs.access(path.join(this.filesystem.root, localPremake)).then(() => localPremake, () => 'premake5');
    return { system: names.includes('premake5.lua') ? 'premake' : 'make', makeCommand,
      premakeCommand: process.env.SOURVIA_PREMAKE || bundledPremake, premakeFile: 'premake5.lua', premakeAction: nativeWindows ? 'vs2022' : 'gmake',
      msbuildCommand: await findMSBuild(), solution: '', platform: 'x64',
      buildDirectory: '.', configuration: '', target: '', executable: '', args: [], runDirectory: '.' };
  }

  start(settings: BuildSettings, run: boolean): void {
    if (this.task) throw new Error('A build or program is already running.');
    if (!this.filesystem.root) throw new Error('Open a project folder first.');
    this.validate(settings);
    if (run && !settings.executable.trim() && !canDetectExecutable(settings)) throw new Error('Choose the program executable in Run settings first.');
    this.cancelled = false;
    for (const uri of this.diagnostics.keys()) this.emit({ type: 'diagnostics', event: { uri, diagnostics: [] } });
    this.diagnostics.clear();
    this.task = this.execute(settings, run).catch(error => {
      const message = this.cancelled ? 'Stopped.' : (error as Error).message;
      this.output(`\n${message}\n`);
      this.state(this.cancelled ? 'stopped' : 'failed', message);
    }).finally(() => { this.task = undefined; });
  }

  private validate(settings: BuildSettings) {
    if (!settings || !['make', 'premake'].includes(settings.system) || !['gmake', 'gmake2', 'vs2022'].includes(settings.premakeAction)) throw new Error('Invalid build settings.');
    for (const key of ['makeCommand', 'premakeCommand', 'premakeFile', 'buildDirectory', 'configuration', 'target', 'executable', 'runDirectory', 'msbuildCommand', 'solution', 'platform'] as const) {
      if (typeof settings[key] !== 'string' || settings[key].length > 4096 || /[\0\r\n]/.test(settings[key])) throw new Error(`Invalid ${key}.`);
    }
    if (!settings.makeCommand.trim() || !settings.premakeCommand.trim()) throw new Error('Set the Make and Premake executable names or paths.');
    if (settings.system === 'premake' && settings.premakeAction === 'vs2022' && !settings.msbuildCommand.trim()) throw new Error('Set the MSBuild executable in Run settings. Install Visual Studio 2022 with Desktop development with C++ or its Build Tools.');
    if (settings.target.startsWith('-')) throw new Error('A Make target cannot start with a dash.');
    if (!Array.isArray(settings.args) || settings.args.length > 100 || settings.args.some(arg => typeof arg !== 'string' || arg.length > 8192 || arg.includes('\0'))) throw new Error('Invalid program arguments.');
    for (const candidate of [settings.buildDirectory, settings.premakeFile, settings.executable, settings.runDirectory, settings.solution]) this.projectPath(candidate || '.');
  }
  private projectPath(candidate: string) {
    const resolved = path.resolve(this.filesystem.root, candidate);
    const relative = path.relative(this.filesystem.root, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Build and run paths must stay inside the project.');
    return resolved;
  }
  private async directory(candidate: string) {
    const resolved = await this.filesystem.resolve(this.projectPath(candidate || '.'));
    if (!(await fs.stat(resolved)).isDirectory()) throw new Error(`Not a directory: ${candidate}`);
    return resolved;
  }
  private checkCancelled() { if (this.cancelled) throw new Error('Stopped.'); }
  private async execute(settings: BuildSettings, run: boolean) {
    if (settings.system === 'premake') {
      this.state('generating', settings.premakeAction === 'vs2022' ? 'Generating Visual Studio projects…' : 'Generating Makefiles…');
      const script = await this.filesystem.resolve(this.projectPath(settings.premakeFile));
      await this.command(settings.premakeCommand, [`--file=${script}`, settings.premakeAction], this.filesystem.root, false);
    }
    this.checkCancelled();
    this.state('building', 'Building…');
    const cwd = await this.directory(settings.buildDirectory);
    let nativeSolution: string | undefined;
    if (settings.system === 'premake' && settings.premakeAction === 'vs2022') {
      let solution = settings.solution ? this.projectPath(settings.solution) : '';
      if (!solution) {
        const solutions = (await fs.readdir(cwd)).filter(name => name.toLowerCase().endsWith('.sln'));
        if (solutions.length !== 1) throw new Error('Set the Visual Studio solution path in Run settings; the build directory must otherwise contain exactly one .sln file.');
        solution = path.join(cwd, solutions[0]);
      }
      solution = await this.filesystem.resolve(solution);
      nativeSolution = solution;
      const args = [solution, '/m', '/nologo', '/verbosity:minimal',
        `/p:Configuration=${settings.configuration || 'Debug'}`, `/p:Platform=${settings.platform || 'x64'}`,
        ...(settings.target ? [`/t:${settings.target}`] : [])];
      await this.command(settings.msbuildCommand, args, cwd, true);
    } else {
      const args = [...(settings.configuration ? [`config=${settings.configuration}`] : []), ...(settings.target ? [settings.target] : [])];
      await this.command(settings.makeCommand, args, cwd, true);
    }
    this.checkCancelled();
    if (run) {
      const launch = !settings.executable.trim() && nativeSolution
        ? await findNativeLaunch(this.filesystem, nativeSolution, settings,
          (project, args) => this.command(settings.msbuildCommand, [project, ...args], path.dirname(project), false, true))
        : { executable: await this.filesystem.resolve(this.projectPath(settings.executable)), cwd: await this.directory(settings.runDirectory) };
      const { executable, cwd: runDirectory } = launch;
      if (!(await fs.stat(executable)).isFile()) throw new Error('The program executable must be a file.');
      this.checkCancelled();
      this.state('running', 'Running…');
      await this.command(executable, settings.args, runDirectory, false);
    }
    this.checkCancelled();
    this.state('success', run ? 'Program exited successfully.' : 'Build succeeded.');
  }

  private async command(command: string, args: string[], cwd: string, parseDiagnostics: boolean, capture = false): Promise<string> {
    this.checkCancelled();
    if (!capture) this.output(`\n> ${[command, ...args].map(arg => /\s/.test(arg) ? JSON.stringify(arg) : arg).join(' ')}\n  ${cwd}\n`);
    let captured = '';
    await new Promise<void>((resolve, reject) => {
      const child = this.launch(command, args, { cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: 'pipe' });
      this.child = child;
      child.stdin?.on('error', () => {});
      child.stdin?.end();
      const pending = new Set<Promise<void>>();
      const directories = [cwd];
      const consumeLine = (line: string) => {
        if (!parseDiagnostics) return;
        const entering = /^(?:make|mingw32-make)(?:\[\d+\])?: Entering directory ['`](.*)'/.exec(line);
        if (entering) directories.push(path.resolve(directories.at(-1)!, entering[1]));
        if (/^(?:make|mingw32-make)(?:\[\d+\])?: Leaving directory /.test(line) && directories.length > 1) directories.pop();
        const parsed = parseCompilerDiagnostic(line.replace(/\x1b\[[0-9;]*m/g, ''));
        if (!parsed) return;
        const candidate = path.resolve(directories.at(-1)!, parsed.file);
        const task = this.filesystem.resolve(candidate).then(file => {
          const uri = pathToFileURL(file).href;
          const diagnostics = this.diagnostics.get(uri) ?? [];
          if (diagnostics.length >= 1000) return;
          diagnostics.push(parsed.diagnostic); this.diagnostics.set(uri, diagnostics);
          this.emit({ type: 'diagnostics', event: { uri, diagnostics: [...diagnostics] } });
        }).catch(() => { /* Keep external or missing-file diagnostics in the output. */ });
        pending.add(task);
        void task.finally(() => pending.delete(task));
      };
      for (const stream of [child.stdout, child.stderr]) {
        let buffer = '';
        stream?.setEncoding('utf8');
        stream?.on('data', (chunk: string) => {
          if (capture && stream === child.stdout) captured += chunk;
          else this.output(chunk);
          if (captured.length > 1024 * 1024) { captured = captured.slice(-1024 * 1024); child.kill(); }
          buffer += chunk;
          const lines = buffer.split(/\r?\n/); buffer = lines.pop()!;
          for (const line of lines) consumeLine(line);
          if (buffer.length > 65536) buffer = buffer.slice(-65536);
        });
        stream?.on('end', () => { if (buffer) consumeLine(buffer); });
      }
      let startupError: Error | undefined;
      child.once('error', error => { startupError = new Error(`Cannot start ${command}: ${error.message}. Check Run settings and your PATH.`); });
      child.once('close', (code, signal) => {
        if (this.child === child) this.child = undefined;
        void Promise.all(pending).then(() => {
          if (!capture || code !== 0) this.output(`\nProcess exited (${code ?? signal}).\n`);
          if (startupError) reject(startupError);
          else if (code === 0 && !this.cancelled) resolve();
          else reject(new Error(`${command} exited (${code ?? signal}).`));
        });
      });
    });
    return captured;
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = this.stopProcess().finally(() => { this.stopping = undefined; });
    return this.stopping;
  }
  private async stopProcess() {
    if (!this.task) return;
    this.cancelled = true;
    this.state('stopping', 'Stopping…');
    const child = this.child;
    if (child?.pid && child.exitCode === null) {
      if (process.platform === 'win32') {
        await new Promise<void>(resolve => {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
          killer.once('error', () => { child.kill(); resolve(); });
          killer.once('close', () => resolve());
        });
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
    }
    await this.task;
  }
}
