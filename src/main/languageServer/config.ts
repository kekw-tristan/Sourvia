export interface LanguageServerConfig { id: string; extensions: string[]; command: string; args?: string[] }
// Commands are trusted application configuration, never read from an opened project.
export const languageServers: LanguageServerConfig[] = [
  { id: 'cpp', extensions: ['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx'], command: process.env.SOURVIA_CLANGD || 'clangd', args: ['--background-index'] },
  { id: 'hlsl', extensions: ['.hlsl', '.hlsli'], command: process.env.SOURVIA_HLSL_SERVER || 'shader-language-server', args: ['--stdio', '--hlsl'] },
];
