export function languageForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  if (['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx'].includes(ext)) return 'cpp';
  if (['.hlsl', '.hlsli'].includes(ext)) return 'hlsl';
  return ({ '.json': 'json', '.md': 'markdown', '.js': 'javascript', '.ts': 'typescript', '.css': 'css', '.html': 'html' } as Record<string, string>)[ext] ?? 'plaintext';
}
