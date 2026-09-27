import { app, BrowserWindow, dialog, ipcMain, Menu, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ProjectFilesystem } from './filesystem';
import { LanguageServerManager } from './languageServer/LanguageServerManager';
import { BuildRunner } from './build/BuildRunner';
import type { BuildSettings, LanguageFeature, Position, SourceLocation } from '../shared/types';

const filesystem = new ProjectFilesystem();
const openedFiles = new Set<string>();
let window: BrowserWindow;
let dirty = false;
let forceClose = false;
let quitting = false;
const servers = new LanguageServerManager(
  event => { if (window && !window.isDestroyed()) window.webContents.send('lsp:diagnostics', event); },
  event => { if (window && !window.isDestroyed()) window.webContents.send('lsp:status', event); },
);
const builds = new BuildRunner(filesystem, event => {
  if (window && !window.isDestroyed()) window.webContents.send('build:event', event);
});
const devURL = !app.isPackaged ? process.env.SOURVIA_DEV_URL : undefined;
if (devURL && devURL !== 'http://127.0.0.1:5173') throw new Error('Invalid development URL.');
const rendererFile = path.join(__dirname, '../renderer/index.html');
function validate(event: IpcMainInvokeEvent | Electron.IpcMainEvent) {
  const expected = devURL ? `${devURL}/` : pathToFileURL(rendererFile).href;
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== expected) {
    throw new Error('Untrusted IPC sender.');
  }
}
function handle(channel: string, callback: (...args: any[]) => unknown) {
  ipcMain.handle(channel, (event, ...args: unknown[]) => { validate(event); return callback(...args); });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    width: 1380, height: 900, minWidth: 820, minHeight: 550,
    backgroundColor: '#13161c', title: 'Sourvia', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.once('ready-to-show', () => window.show());
  window.on('close', event => {
    if (dirty && !forceClose) {
      const answer = dialog.showMessageBoxSync(window, { type: 'warning', title: 'Unsaved changes',
        message: 'Close Sourvia and discard unsaved changes?', detail: 'Choose Cancel to return to the editor and save your files.',
        buttons: ['Cancel', 'Discard and close'], defaultId: 0, cancelId: 0, noLink: true });
      if (answer === 0) { event.preventDefault(); return; }
      forceClose = true;
    }
  });
  window.webContents.on('will-prevent-unload', event => {
    if (forceClose) event.preventDefault();
  });
  handle('project:open', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Open project folder', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    await builds.stop();
    const directory = await filesystem.open(result.filePaths[0]);
    await servers.setRoot(directory.root);
    openedFiles.clear();
    dirty = false;
    window.setTitle(`${directory.current.name} — Sourvia`);
    return directory;
  });
  handle('project:list', (file: string) => filesystem.list(file));
  handle('file:read', async (file: string) => {
    const document = await filesystem.read(file);
    openedFiles.add(document.path);
    return document;
  });
  handle('file:readUri', async (uri: string) => {
    const document = await filesystem.read(fileURLToPath(uri));
    openedFiles.add(document.path);
    return document;
  });
  handle('build:detect', () => builds.detect());
  handle('build:start', (settings: BuildSettings, run: boolean) => {
    if (typeof run !== 'boolean') throw new Error('Invalid run flag.');
    builds.start(settings, run);
  });
  handle('build:stop', () => builds.stop());
  for (const feature of ['definition', 'hover', 'completion'] as LanguageFeature[]) {
    handle(`lsp:${feature}`, async (file: string, text: string, position: Position) => {
      if (!openedFiles.has(file)) throw new Error('Open the document first.');
      if (typeof text !== 'string' || Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error('Invalid document text.');
      if (!position || !Number.isInteger(position.line) || position.line < 0 || !Number.isInteger(position.character) || position.character < 0) throw new Error('Invalid source position.');
      const root = filesystem.root;
      const result = await servers.feature(feature, file, text, position);
      if (root !== filesystem.root || !openedFiles.has(file)) return null;
      if (feature !== 'definition') return result;
      const locations: SourceLocation[] = [];
      for (const entry of result ? (Array.isArray(result) ? result : [result]) : []) {
        const uri = entry.targetUri ?? entry.uri;
        const range = entry.targetSelectionRange ?? entry.range;
        if (!range || ![range.start, range.end].every(p => p && Number.isInteger(p.line) && p.line >= 0 && Number.isInteger(p.character) && p.character >= 0)) continue;
        try {
          const target = await filesystem.resolve(fileURLToPath(uri));
          locations.push({ uri: pathToFileURL(target).href, range });
        } catch { /* Navigation follows the same project boundary as file reads. */ }
      }
      return locations;
    });
  }
  handle('file:save', async (file: string, text: string) => {
    await filesystem.save(file, text);
    void servers.saved(await filesystem.resolve(file), text).catch(console.error);
  });
  handle('lsp:sync', async (file: string, text: string) => {
    if (!openedFiles.has(file)) throw new Error('Open the document before synchronizing it.');
    if (typeof text !== 'string' || Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error('Invalid document text.');
    await servers.sync(file, text);
  });
  handle('lsp:close', async (file: string) => {
    // A file deleted externally must still be closable.
    if (!openedFiles.has(file)) return;
    openedFiles.delete(file);
    await servers.close(file);
    filesystem.close(file);
  });
  handle('file:confirm', async (names: string[]) => {
    if (!Array.isArray(names) || !names.every(name => typeof name === 'string')) throw new Error('Invalid file names.');
    const { response } = await dialog.showMessageBox(window, { type: 'question', title: 'Unsaved changes',
      message: 'Save your changes?', detail: names.join('\n'), buttons: ['Save', 'Discard', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true });
    return ['save', 'discard', 'cancel'][response];
  });
  ipcMain.on('window:dirty', (event, value: unknown) => { validate(event); dirty = value === true; });
  if (devURL) void window.loadURL(devURL);
  else void window.loadFile(rendererFile);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  // Let the window's close handler resolve dirty documents before shutting down LSP.
  if (window && !window.isDestroyed()) return;
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void Promise.all([servers.stop(), builds.stop()]).finally(() => app.quit());
});
