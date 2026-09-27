import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { encodeMessage, MessageReader, type RpcMessage } from './jsonRpc';
import type { LanguageServerConfig } from './config';
import type { DiagnosticsEvent, LanguageFeature, Position, ServerStatus } from '../../shared/types';

interface SyncedDocument { text: string; version: number }
export class LanguageServer {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private documents = new Map<string, SyncedDocument>();
  private syncKind = 0;
  private openClose = false;
  private ready?: Promise<void>;
  private queue: Promise<void> = Promise.resolve();
  private stopping = false;
  private failed = false;
  private shutdown?: Promise<void>;
  private saveCapability: boolean | { includeText?: boolean } = false;
  private capabilities: Record<string, unknown> = {};

  constructor(readonly config: LanguageServerConfig, private root: string,
    private diagnostics: (event: DiagnosticsEvent) => void, private status: (event: ServerStatus) => void) {}

  private update(state: ServerStatus['state'], message: string) { this.status({ id: this.config.id, state, message }); }
  private fail(error: Error) {
    if (this.failed) return;
    this.failed = true;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
    for (const uri of this.documents.keys()) this.diagnostics({ uri, diagnostics: [] });
    if (!this.stopping) this.update('unavailable', error.message);
  }
  private send(message: RpcMessage) {
    if (!this.child || this.child.exitCode !== null || this.child.killed || this.failed) throw new Error(`${this.config.id} is not running.`);
    this.child.stdin.write(encodeMessage(message));
  }
  private notify(method: string, params?: unknown) { this.send({ method, params }); }
  private request(method: string, params?: unknown, timeout = 15000): Promise<any> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${this.config.id}: ${method} timed out.`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  private receive(message: RpcMessage) {
    if (message.method && message.id !== undefined) {
      if (message.method === 'workspace/configuration') {
        this.send({ id: message.id, result: (message.params?.items ?? []).map(() => null) });
      } else if (message.method === 'workspace/workspaceFolders') {
        this.send({ id: message.id, result: [{ uri: pathToFileURL(this.root).href, name: path.basename(this.root) }] });
      } else {
        this.send({ id: message.id, error: { code: -32601, message: 'Method not supported by Sourvia MVP' } });
      }
      return;
    }
    if (typeof message.id === 'number') {
      const request = this.pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer); this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    } else if (message.method === 'textDocument/publishDiagnostics') {
      const event = message.params as DiagnosticsEvent;
      if (!event || typeof event.uri !== 'string' || !Array.isArray(event.diagnostics)) return;
      const document = this.documents.get(event.uri);
      if (!document || (event.version !== undefined && event.version < document.version)) return;
      const diagnostics = event.diagnostics.filter(d => d && typeof d.message === 'string' &&
        Number.isInteger(d.range?.start?.line) && d.range.start.line >= 0 &&
        Number.isInteger(d.range?.start?.character) && d.range.start.character >= 0 &&
        Number.isInteger(d.range?.end?.line) && d.range.end.line >= 0 &&
        Number.isInteger(d.range?.end?.character) && d.range.end.character >= 0);
      this.diagnostics({ ...event, diagnostics });
    }
  }
  start(): Promise<void> {
    this.ready ??= this.initialize();
    return this.ready;
  }
  private async initialize() {
    this.update('starting', `Starting ${this.config.command}`);
    const child = spawn(this.config.command, this.config.args ?? [], { cwd: this.root, stdio: 'pipe', windowsHide: true, shell: false });
    this.child = child;
    const reader = new MessageReader(message => this.receive(message));
    child.stdout.on('data', (chunk: Buffer) => {
      try { reader.push(chunk); } catch (error) { this.fail(error as Error); child.kill(); }
    });
    child.stderr.on('data', (chunk: Buffer) => console.error(`[${this.config.id}] ${chunk.toString().trimEnd()}`));
    child.stdin.on('error', error => this.fail(error));
    child.on('error', error => this.fail(new Error(`${this.config.command}: ${error.message}. Install the server or configure its executable path.`)));
    child.on('exit', (code, signal) => this.fail(new Error(`${this.config.id} exited (${code ?? signal}). Reopen the project to restart.`)));
    try {
      const result = await this.request('initialize', {
        processId: process.pid, clientInfo: { name: 'Sourvia', version: '0.1.0' },
        rootUri: pathToFileURL(this.root).href,
        workspaceFolders: [{ uri: pathToFileURL(this.root).href, name: path.basename(this.root) }],
        capabilities: { general: { positionEncodings: ['utf-16'] }, workspace: { configuration: true },
          textDocument: { synchronization: { dynamicRegistration: false, didSave: true }, publishDiagnostics: { versionSupport: true },
            definition: { linkSupport: true }, hover: { contentFormat: ['markdown', 'plaintext'] },
            completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] } } } },
      });
      if (result?.capabilities?.positionEncoding && result.capabilities.positionEncoding !== 'utf-16') throw new Error('Only UTF-16 LSP positions are supported.');
      const sync = result?.capabilities?.textDocumentSync;
      this.capabilities = result?.capabilities ?? {};
      this.syncKind = typeof sync === 'number' ? sync : sync?.change ?? 0;
      this.openClose = typeof sync === 'number' ? sync !== 0 : sync?.openClose === true;
      this.saveCapability = typeof sync === 'object' ? sync.save ?? false : false;
      this.notify('initialized', {});
      this.update('ready', `${this.config.command} connected`);
    } catch (error) { this.fail(error as Error); child.kill(); throw error; }
  }
  private enqueue(action: () => Promise<void>): Promise<void> {
    const task = this.queue.then(action);
    this.queue = task.catch(() => {});
    return task;
  }
  async feature(feature: LanguageFeature, uri: string, position: Position): Promise<any> {
    await this.queue;
    if (this.failed || this.stopping || !this.documents.has(uri) || !this.capabilities[`${feature}Provider`]) return null;
    return this.request(`textDocument/${feature}`, { textDocument: { uri }, position }, 5000);
  }
  sync(uri: string, languageId: string, text: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopping || this.failed) return;
      await this.start();
      if (this.stopping) return;
      const previous = this.documents.get(uri);
      if (!previous) {
        this.documents.set(uri, { text, version: 1 });
        if (this.openClose) this.notify('textDocument/didOpen', { textDocument: { uri, languageId, version: 1, text } });
      } else if (previous.text !== text) {
        const version = previous.version + 1;
        const lines = previous.text.split('\n');
        // A whole-document ranged replacement is a valid incremental UTF-16 edit.
        const changes = this.syncKind === 2 ? [{ range: { start: { line: 0, character: 0 }, end: { line: lines.length - 1, character: lines.at(-1)!.length } }, text }] : [{ text }];
        this.documents.set(uri, { text, version });
        if (this.syncKind !== 0) this.notify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: changes });
      }
    });
  }
  close(uri: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.documents.delete(uri)) return;
      if (!this.stopping && !this.failed && this.openClose) this.notify('textDocument/didClose', { textDocument: { uri } });
      this.diagnostics({ uri, diagnostics: [] });
    });
  }
  saved(uri: string, text: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.failed && !this.stopping && this.documents.has(uri) && this.saveCapability) {
        this.notify('textDocument/didSave', { textDocument: { uri }, ...(typeof this.saveCapability === 'object' && this.saveCapability.includeText ? { text } : {}) });
      }
    });
  }
  stop(): Promise<void> {
    this.shutdown ??= this.stopProcess();
    return this.shutdown;
  }
  private async stopProcess() {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    if (child.exitCode === null && !child.killed && !this.failed) {
      try {
        for (const uri of this.documents.keys()) if (this.openClose) this.notify('textDocument/didClose', { textDocument: { uri } });
        await this.request('shutdown', null, 1200);
        this.notify('exit');
      } catch { /* A stalled or uninitialized server is terminated below. */ }
    }
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { child.kill(); resolve(); }, 800);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    this.fail(new Error('Server stopped.'));
    this.documents.clear();
    this.update('stopped', 'Server stopped.');
  }
}
