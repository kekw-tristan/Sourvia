import { useEffect, useRef, useState } from 'react';
import type { BuildSettings } from '../../shared/types';

export function RunSettings({ settings, onSave, onClose }: {
  settings: BuildSettings; onSave(settings: BuildSettings): void; onClose(): void;
}) {
  const [draft, setDraft] = useState(settings);
  const [args, setArgs] = useState(settings.args.join('\n'));
  const visualStudio = draft.system === 'premake' && draft.premakeAction === 'vs2022';
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  function field(key: keyof BuildSettings, label: string, placeholder = '', required = false) {
    return <label>{label}<input required={required} value={String(draft[key])} placeholder={placeholder}
      onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))} /></label>;
  }
  return <dialog className="run-settings" ref={dialog} onCancel={onClose} aria-labelledby="run-settings-title">
    <form onSubmit={event => { event.preventDefault(); onSave({ ...draft, args: args ? args.split('\n') : [] }); }}>
      <div className="settings-heading"><h2 id="run-settings-title">Build & Run settings</h2><button type="button" onClick={onClose} aria-label="Close Run settings">×</button></div>
      <p>Paths are relative to the project folder. Run saves all open files, builds, then starts your program.</p>
      <div className="settings-grid">
        <label>Build system<select value={draft.system} onChange={event => setDraft({ ...draft, system: event.target.value as BuildSettings['system'] })}>
          <option value="make">Make</option><option value="premake">Premake</option>
        </select></label>
        {!visualStudio && field('makeCommand', 'Make executable', 'make or mingw32-make', true)}
        {draft.system === 'premake' && <>
          {field('premakeCommand', 'Premake executable', 'premake5', true)}
          {field('premakeFile', 'Premake script', 'premake5.lua', true)}
          <label>Premake generator<select value={draft.premakeAction} onChange={event => setDraft({ ...draft, premakeAction: event.target.value as BuildSettings['premakeAction'] })}>
            <option value="gmake">gmake</option><option value="gmake2">gmake2 (older Premake)</option>
            <option value="vs2022">Visual Studio 2022 + MSBuild</option>
          </select></label>
        </>}
        {visualStudio && <>
          {field('msbuildCommand', 'MSBuild executable', 'MSBuild.exe', true)}
          {field('solution', 'Visual Studio solution (optional)', 'Auto-detect .sln in build directory')}
          {field('platform', 'Platform', 'x64')}
        </>}
        {field('buildDirectory', visualStudio ? 'Build directory' : 'Makefile directory', '.')}
        {field('configuration', 'Configuration (optional)', visualStudio ? 'Debug (default), Release or Dist' : 'debug or release')}
        {field('target', visualStudio ? 'MSBuild target (optional)' : 'Make target (optional)', visualStudio ? 'Build entire solution' : 'Default target')}
        {field('executable', 'Program executable', visualStudio ? 'Automatic from the startup project' : 'bin/Debug/MyApp.exe')}
        {field('runDirectory', 'Program working directory', visualStudio && !draft.executable.trim() ? 'Automatic from the startup project' : '.')}
        <label className="settings-wide">Program arguments (one per line)<textarea rows={3} value={args} onChange={event => setArgs(event.target.value)} placeholder={'--verbose\nfile with spaces.txt'} /></label>
      </div>
      {visualStudio && !draft.executable.trim() && <p>Run detects the startup program after building. An empty working directory or “.” uses the project’s debugger directory, or the executable’s folder.</p>}
      <p>{visualStudio ? 'Requires Premake and Visual Studio 2022 with C++ tools. MSBuild uses your project’s vcpkg integration for dependencies such as GLFW.' : 'Make, your compiler and, when selected, Premake must be installed.'} Output is shown below the editor; interactive console input is not supported.</p>
      <div className="settings-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="primary">Save settings</button></div>
    </form>
  </dialog>;
}
