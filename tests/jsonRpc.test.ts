import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeMessage, MessageReader, type RpcMessage } from '../src/main/languageServer/jsonRpc';

test('decodes fragmented UTF-8 messages and multiple frames in one chunk', () => {
  const received: RpcMessage[] = [];
  const reader = new MessageReader(message => received.push(message));
  const first = { jsonrpc: '2.0', id: 1, method: 'test', params: { text: 'Grüße 世界 🌍' } };
  const second = { jsonrpc: '2.0', id: 2, result: null };
  const buffer = Buffer.concat([encodeMessage(first), encodeMessage(second)]);
  for (let i = 0; i < buffer.length; i += 3) reader.push(buffer.subarray(i, i + 3));
  assert.deepEqual(received, [first, second]);
  reader.push(Buffer.concat([encodeMessage(second), encodeMessage(second)]));
  assert.equal(received.length, 4);
});
test('rejects invalid, duplicated and excessive framing', () => {
  for (const header of ['No-Length: 3', 'Content-Length: -1', 'Content-Length: 999999999', 'Content-Length: 2\r\nContent-Length: 2']) {
    assert.throws(() => new MessageReader(() => {}).push(Buffer.from(`${header}\r\n\r\n{}`)));
  }
  assert.throws(() => new MessageReader(() => {}).push(Buffer.alloc(9000, 'a')));
});
