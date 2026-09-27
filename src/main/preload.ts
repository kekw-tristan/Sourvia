import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI, DiagnosticsEvent, ServerStatus } from '../shared/types';

function subscribe<T>(channel: string, callback: (value: T) => void) {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
const api: DesktopAPI = {
  openFolder: () => ipcRenderer.invoke('project:open'),
  listDirectory: path => ipcRenderer.invoke('project:list', path),
  readFile: path => ipcRenderer.invoke('file:read', path),
  saveFile: (path, text) => ipcRenderer.invoke('file:save', path, text),
  confirmChanges: names => ipcRenderer.invoke('file:confirm', names),
  setDirty: dirty => ipcRenderer.send('window:dirty', dirty),
  syncDocument: (path, text) => ipcRenderer.invoke('lsp:sync', path, text),
  closeDocument: path => ipcRenderer.invoke('lsp:close', path),
  onDiagnostics: callback => subscribe<DiagnosticsEvent>('lsp:diagnostics', callback),
  onServerStatus: callback => subscribe<ServerStatus>('lsp:status', callback),
};
contextBridge.exposeInMainWorld('desktop', api);
