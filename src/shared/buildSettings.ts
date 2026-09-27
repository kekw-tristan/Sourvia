import type { BuildSettings } from './types';

export function canDetectExecutable(settings: BuildSettings): boolean {
  return settings.system === 'premake' && settings.premakeAction === 'vs2022';
}

export function restoreBuildSettings(detected: BuildSettings, stored: unknown): BuildSettings {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return detected;
  const previous = stored as Partial<BuildSettings>;
  const restored = { ...detected };
  for (const key of Object.keys(detected) as (keyof BuildSettings)[]) {
    const value = previous[key];
    if (key === 'args') {
      if (Array.isArray(value) && value.every(arg => typeof arg === 'string')) restored.args = value;
    } else if (key === 'system') {
      if (value === 'make' || value === 'premake') restored.system = value;
    } else if (key === 'premakeAction') {
      if (value === 'gmake' || value === 'gmake2' || value === 'vs2022') restored.premakeAction = value;
    } else if (typeof value === 'string') restored[key] = value;
  }
  // Earlier versions forced GNU Make even for Windows projects using MSBuild/vcpkg.
  // Migrate that old default once, while preserving subsequent explicit choices.
  if (!('msbuildCommand' in previous) && restored.system === 'premake'
    && previous.premakeAction === 'gmake' && detected.premakeAction === 'vs2022') {
    restored.premakeAction = 'vs2022';
    if (restored.target === 'all') restored.target = '';
  }
  return restored;
}
