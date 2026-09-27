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
export interface SourceRange { start: Position; end: Position }
export interface SourceLocation { uri: string; range: SourceRange }
export type LanguageFeature = 'definition' | 'hover' | 'completion';
export type HoverContent = string | { kind: 'plaintext' | 'markdown'; value: string } | { language: string; value: string };
export interface Hover { contents: HoverContent | HoverContent[]; range?: SourceRange }
export interface CompletionItem {
  label: string; kind?: number; detail?: string; documentation?: string | { kind: string; value: string };
  insertText?: string; insertTextFormat?: number; filterText?: string; sortText?: string;
  textEdit?: { range: SourceRange; newText: string };
  additionalTextEdits?: { range: SourceRange; newText: string }[];
}
export interface CompletionList { isIncomplete: boolean; items: CompletionItem[] }
export interface BuildSettings {
  system: 'make' | 'premake'; makeCommand: string; premakeCommand: string;
  premakeFile: string; premakeAction: 'gmake' | 'gmake2' | 'vs2022'; buildDirectory: string;
  msbuildCommand: string; solution: string; platform: string;
  configuration: string; target: string; executable: string; args: string[]; runDirectory: string;
}
export interface BuildState { phase: 'idle' | 'generating' | 'building' | 'running' | 'stopping' | 'success' | 'failed' | 'stopped'; message: string }
export type BuildEvent = { type: 'state'; state: BuildState } | { type: 'output'; text: string } | { type: 'diagnostics'; event: DiagnosticsEvent };
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
  readUri(uri: string): Promise<DocumentFile>;
  saveFile(path: string, text: string): Promise<void>;
  confirmChanges(names: string[]): Promise<ConfirmChoice>;
  setDirty(dirty: boolean): void;
  syncDocument(path: string, text: string): Promise<void>;
  closeDocument(path: string): Promise<void>;
  definition(path: string, text: string, position: Position): Promise<SourceLocation[]>;
  hover(path: string, text: string, position: Position): Promise<Hover | null>;
  completion(path: string, text: string, position: Position): Promise<CompletionList | CompletionItem[] | null>;
  detectBuild(): Promise<BuildSettings>;
  startBuild(settings: BuildSettings, run: boolean): Promise<void>;
  stopBuild(): Promise<void>;
  onBuildEvent(callback: (event: BuildEvent) => void): () => void;
  onDiagnostics(callback: (event: DiagnosticsEvent) => void): () => void;
  onServerStatus(callback: (event: ServerStatus) => void): () => void;
}
