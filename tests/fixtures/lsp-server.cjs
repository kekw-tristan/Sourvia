// A protocol peer used only by tests; checks real child-process I/O and shutdown.
const fs = require('node:fs');
let buffer = Buffer.alloc(0);
const log = process.argv[2];
const syncKind = Number(process.argv[3] || 2);
function send(message) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }));
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length) {
    const end = buffer.indexOf('\r\n\r\n');
    if (end < 0) return;
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
    if (buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length));
    buffer = buffer.subarray(end + 4 + length);
    fs.appendFileSync(log, JSON.stringify(message) + '\n');
    if (message.method === 'initialize') send({ id: message.id, result: { capabilities: { textDocumentSync: { openClose: true, change: syncKind, save: { includeText: true } } } } });
    if (message.method === 'initialized') send({ id: 'configuration', method: 'workspace/configuration', params: { items: [{ section: 'test' }] } });
    if (message.method === 'textDocument/didOpen' || message.method === 'textDocument/didChange') {
      send({ method: 'textDocument/publishDiagnostics', params: { uri: message.params.textDocument.uri, version: message.params.textDocument.version,
        diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, severity: 1, message: 'Test diagnostic' }] } });
    }
    if (message.method === 'shutdown') send({ id: message.id, result: null });
    if (message.method === 'exit') process.exit(0);
  }
});
