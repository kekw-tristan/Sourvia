import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { languageForPath } from '../../shared/languages';
import type { DiagnosticsEvent, ServerStatus } from '../../shared/types';
import { LanguageServer } from './LanguageServer';
import { languageServers, type LanguageServerConfig } from './config';

export class LanguageServerManager {
  private servers = new Map<string, LanguageServer>();
  private root = '';
  constructor(private diagnostics: (event: DiagnosticsEvent) => void,
    private status: (event: ServerStatus) => void,
    private configs: LanguageServerConfig[] = languageServers) {}
  async setRoot(root: string) { await this.stop(); this.root = root; }
  async sync(file: string, text: string) {
    if (!this.root) return;
    const config = this.configs.find(c => c.extensions.includes(path.extname(file).toLowerCase()));
    if (!config) return;
    let server = this.servers.get(config.id);
    if (!server) {
      server = new LanguageServer(config, this.root, this.diagnostics, this.status);
      this.servers.set(config.id, server);
    }
    // Server failures are reported as status events; editing remains available.
    try { await server.sync(pathToFileURL(file).href, languageForPath(file), text); } catch { /* status includes cause */ }
  }
  async close(file: string) {
    await Promise.all([...this.servers.values()].map(server => server.close(pathToFileURL(file).href)));
  }
  async saved(file: string, text: string) {
    await this.sync(file, text);
    await Promise.all([...this.servers.values()].map(server => server.saved(pathToFileURL(file).href, text)));
  }
  async stop() {
    const servers = [...this.servers.values()];
    this.servers.clear(); this.root = '';
    await Promise.all(servers.map(server => server.stop()));
  }
}
