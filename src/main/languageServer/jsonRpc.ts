export interface RpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string };
}
const maxBytes = 16 * 1024 * 1024;
export function encodeMessage(message: RpcMessage): Buffer {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}
export class MessageReader {
  private buffer: Buffer = Buffer.alloc(0);
  constructor(private onMessage: (message: RpcMessage) => void) {}
  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length) {
      const end = this.buffer.indexOf('\r\n\r\n');
      if (end === -1) {
        if (this.buffer.length > 8192) throw new Error('LSP header exceeds limit.');
        return;
      }
      const header = this.buffer.subarray(0, end).toString('ascii');
      const lengths = [...header.matchAll(/^Content-Length:\s*(\d+)\s*$/gim)];
      if (lengths.length !== 1) throw new Error('Invalid LSP Content-Length header.');
      const length = Number(lengths[0][1]);
      if (!Number.isSafeInteger(length) || length > maxBytes) throw new Error('LSP message exceeds limit.');
      if (this.buffer.length < end + 4 + length) return;
      const message: unknown = JSON.parse(this.buffer.subarray(end + 4, end + 4 + length).toString('utf8'));
      this.buffer = this.buffer.subarray(end + 4 + length);
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid JSON-RPC message.');
      this.onMessage(message as RpcMessage);
    }
  }
}
