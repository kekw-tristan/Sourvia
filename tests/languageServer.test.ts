import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { LanguageServer } from '../src/main/languageServer/LanguageServer';
import type { DiagnosticsEvent, ServerStatus } from '../src/shared/types';

for (const syncKind of [1, 2]) test(`LSP lifecycle, diagnostics and sync kind ${syncKind}`, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sourvia-lsp-'));
  const log = path.join(root, 'messages.jsonl');
  const events: DiagnosticsEvent[] = [];
  const statuses: ServerStatus[] = [];
  const server = new LanguageServer({ id: 'test', extensions: ['.cpp'], command: process.execPath,
    args: [path.resolve('tests/fixtures/lsp-server.cjs'), log, String(syncKind)] }, root, event => events.push(event), status => statuses.push(status));
  try {
    const uri = pathToFileURL(path.join(root, 'a.cpp')).href;
    await server.sync(uri, 'cpp', 'int x;\r\n// 🌍');
    await server.sync(uri, 'cpp', 'int y;');
    await server.saved(uri, 'int y;');
    for (let i = 0; i < 50 && !events.some(event => event.version === 2); i++) await new Promise(resolve => setTimeout(resolve, 20));
    // Version 1 may already be stale when it reaches the client and is discarded.
    assert.equal(events.at(-1)?.version, 2);
    assert.equal(events.at(-1)?.diagnostics[0].message, 'Test diagnostic');
    await server.close(uri);
    await server.stop();
    const messages = (await fs.readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const methods = messages.map(m => m.method).filter(Boolean);
    assert.deepEqual(methods, ['initialize', 'initialized', 'textDocument/didOpen', 'textDocument/didChange', 'textDocument/didSave', 'textDocument/didClose', 'shutdown', 'exit']);
    assert.deepEqual(messages.find(m => m.id === 'configuration').result, [null]);
    const change = messages.find(m => m.method === 'textDocument/didChange').params.contentChanges[0];
    assert.equal(change.text, 'int y;');
    if (syncKind === 2) assert.deepEqual(change.range.end, { line: 1, character: 5 });
    else assert.equal(change.range, undefined);
    assert.equal(statuses[1].state, 'ready');
    assert.equal(statuses.at(-1)?.state, 'stopped');
  } finally { await server.stop(); await fs.rm(root, { recursive: true, force: true }); }
});
test('missing language server reports failure without an unhandled process error', async () => {
  const statuses: ServerStatus[] = [];
  const server = new LanguageServer({ id: 'missing', extensions: [], command: 'sourvia-nonexistent-language-server' }, process.cwd(), () => {}, status => statuses.push(status));
  await assert.rejects(server.start());
  await server.stop();
  assert.ok(statuses.some(status => status.state === 'unavailable'));
});

test('language features wait for current document sync and preserve LSP results', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sourvia-features-'));
  const log = path.join(root, 'messages.jsonl');
  const server = new LanguageServer({ id: 'test', extensions: ['.cpp'], command: process.execPath,
    args: [path.resolve('tests/fixtures/lsp-server.cjs'), log] }, root, () => {}, () => {});
  try {
    const uri = pathToFileURL(path.join(root, 'main.cpp')).href;
    const position = { line: 0, character: 4 };
    await server.sync(uri, 'cpp', 'int oldValue;');
    const sync = server.sync(uri, 'cpp', 'int newValue;');
    const hover = await server.feature('hover', uri, position);
    await sync;
    assert.equal(hover.contents.value, 'Symbol info: int newValue;');
    const definitions = await server.feature('definition', uri, position);
    assert.equal(definitions[0].targetUri, pathToFileURL(path.join(root, 'definition.hpp')).href);
    assert.equal(definitions[0].targetSelectionRange.start.character, 4);
    const completion = await server.feature('completion', uri, position);
    assert.equal(completion.items[0].label, 'sampleValue');
    await server.close(uri);
    assert.equal(await server.feature('hover', uri, position), null);
    await server.stop();
    const messages = (await fs.readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(messages.find(m => m.method === 'textDocument/hover').params.position, position);
    assert.equal(messages[0].params.capabilities.textDocument.definition.linkSupport, true);
  } finally { await server.stop(); await fs.rm(root, { recursive: true, force: true }); }
});
