import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

export async function findMSBuild(): Promise<string> {
  if (process.env.SOURVIA_MSBUILD) return process.env.SOURVIA_MSBUILD;
  if (process.platform !== 'win32') return 'MSBuild.exe';
  const installer = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  try {
    const { stdout } = await promisify(execFile)(installer, [
      '-latest', '-products', '*', '-version', '[17.0,18.0)', '-requires', 'Microsoft.Component.MSBuild',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-find', 'MSBuild\\**\\Bin\\MSBuild.exe',
    ], { windowsHide: true, timeout: 5000, encoding: 'utf8' });
    return stdout.split(/\r?\n/).find(line => line.trim())?.trim() || 'MSBuild.exe';
  } catch { return 'MSBuild.exe'; }
}
