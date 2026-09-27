export interface ProjectNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'folder';
  parentPath?: string;
}
export interface Directory { root: string; current: ProjectNode; children: ProjectNode[] }
export interface DocumentFile { path: string; uri: string; name: string; text: string; language: string }
export interface Position { line: number; character: number }
export interface Diagnostic {
  range: { start: Position; end: Position };
  severity?: number; message: string; source?: string; code?: string | number;
}
export interface DiagnosticsEvent { uri: string; diagnostics: Diagnostic[]; version?: number }
export interface ServerStatus { id: string; state: 'starting' | 'ready' | 'unavailable' | 'stopped'; message: string }
export type ConfirmChoice = 'save' | 'discard' | 'cancel';
export interface DesktopAPI {
  openFolder(): Promise<Directory | null>;
  listDirectory(path: string): Promise<Directory>;
  readFile(path: string): Promise<DocumentFile>;
  saveFile(path: string, text: string): Promise<void>;
  confirmChanges(names: string[]): Promise<ConfirmChoice>;
  setDirty(dirty: boolean): void;
  syncDocument(path: string, text: string): Promise<void>;
  closeDocument(path: string): Promise<void>;
  onDiagnostics(callback: (event: DiagnosticsEvent) => void): () => void;
  onServerStatus(callback: (event: ServerStatus) => void): () => void;
}
