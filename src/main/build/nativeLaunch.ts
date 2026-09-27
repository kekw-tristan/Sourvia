import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BuildSettings } from '../../shared/types';
import type { ProjectFilesystem } from '../filesystem';

export async function findNativeLaunch(filesystem: ProjectFilesystem, solution: string, settings: BuildSettings,
  query: (project: string, args: string[]) => Promise<string>): Promise<{ executable: string; cwd: string }> {
  const text = await fs.readFile(solution, 'utf8');
  // Premake puts its startproject first in the generated solution.
  const projects = [...text.matchAll(/^Project\("[^"\r\n]+"\)\s*=\s*"([^"\r\n]+)",\s*"([^"\r\n]+\.vcxproj)"/gim)];
  const target = settings.target.split(':')[0];
  const selected = projects.filter(project => project[1].toLowerCase() === target.toLowerCase());
  for (const project of selected.length ? selected : projects) {
    const projectPath = await filesystem.resolve(path.resolve(path.dirname(solution), project[2].replace(/\\/g, '/')));
    const result = await query(projectPath, ['/nologo', `/p:Configuration=${settings.configuration || 'Debug'}`,
      `/p:Platform=${settings.platform || 'x64'}`, '/getProperty:ConfigurationType,TargetPath,LocalDebuggerWorkingDirectory']);
    let properties: Record<string, string>;
    try { properties = JSON.parse(result.replace(/^\uFEFF/, '').trim()).Properties; }
    catch { throw new Error('Cannot read the program target from MSBuild. Use MSBuild 17.8 or newer, or set Program executable in Run settings.'); }
    if (properties?.ConfigurationType !== 'Application') continue;
    if (!properties.TargetPath) throw new Error(`MSBuild did not provide the program path for ${project[1]}.`);
    const executable = await filesystem.resolve(path.resolve(path.dirname(projectPath), properties.TargetPath));
    if (!(await fs.stat(executable)).isFile()) throw new Error('The detected program executable must be a file.');
    const workingDirectory = settings.runDirectory && settings.runDirectory !== '.'
      ? path.resolve(filesystem.root, settings.runDirectory)
      : properties.LocalDebuggerWorkingDirectory
        ? path.resolve(path.dirname(projectPath), properties.LocalDebuggerWorkingDirectory)
        : path.dirname(executable);
    const cwd = await filesystem.resolve(workingDirectory);
    if (!(await fs.stat(cwd)).isDirectory()) throw new Error('The detected program working directory must be a directory.');
    return { executable, cwd };
  }
  throw new Error('No runnable application was found in the solution. Set Program executable in Run settings.');
}
