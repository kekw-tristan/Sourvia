import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { LanguageServer } from '../src/main/languageServer/LanguageServer';
import type { DiagnosticsEvent } from '../src/shared/types';

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sourvia-clangd-'));
  const events: DiagnosticsEvent[] = [];
  const server = new LanguageServer({ id: 'cpp', extensions: ['.cpp'], command: process.env.SOURVIA_CLANGD || 'clangd' }, root,
    event => events.push(event), event => console.log(`${event.id}: ${event.state} — ${event.message}`));
  try {
    const file = path.join(root, 'main.cpp');
    const uri = pathToFileURL(file).href;
    const text = 'int main() { return missing_symbol; }\n';
    await fs.writeFile(file, text);
    await fs.writeFile(path.join(root, 'compile_commands.json'), JSON.stringify([{ directory: root, file, arguments: ['clang++', '-std=c++17', '-c', file] }]));
    await server.sync(uri, 'cpp', text);
    for (let i = 0; i < 150 && !events.some(e => e.diagnostics.some(d => d.message.includes('missing_symbol'))); i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(events.some(e => e.diagnostics.some(d => d.message.includes('missing_symbol'))), 'Expected real clangd error');
    events.length = 0;
    await server.sync(uri, 'cpp', 'int main() { return 0; }\n');
    for (let i = 0; i < 150 && !events.some(e => e.diagnostics.length === 0); i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(events.some(e => e.diagnostics.length === 0), 'Expected error to clear after edit');
    await server.close(uri);
    console.log('PASS real clangd: compile_commands.json, diagnostic and correction.');
  } finally { await server.stop(); await fs.rm(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
