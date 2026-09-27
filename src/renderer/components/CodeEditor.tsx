import { useEffect, useRef } from 'react';
import { monaco } from '../editor/monaco';
import { documents, type OpenDocument } from '../editor/documentStore';
import type { DiagnosticsEvent } from '../../shared/types';
import { registerLanguageFeatures } from '../editor/languageFeatures';

export function CodeEditor({ items, active, diagnostics, buildDiagnostics, selection, onOpenLocation, onError, onPosition }: {
  items: OpenDocument[]; active: string | null; diagnostics: Record<string, DiagnosticsEvent>;
  buildDiagnostics: Record<string, DiagnosticsEvent>;
  selection: { path: string; line: number; column: number; id: number } | null;
  onOpenLocation(uri: string, line: number, column: number): Promise<void>;
  onError(error: unknown): void;
  onPosition(line: number, column: number): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(new Map<string, { model: monaco.editor.ITextModel; subscription: monaco.IDisposable }>());
  const views = useRef(new Map<string, monaco.editor.ICodeEditorViewState>());
  const previous = useRef<string | null>(null);
  const positionCallback = useRef(onPosition);
  positionCallback.current = onPosition;
  const callbacks = useRef({ onOpenLocation, onError });
  callbacks.current = { onOpenLocation, onError };

  useEffect(() => {
    const instance = monaco.editor.create(container.current!, {
      theme: 'sourvia', automaticLayout: true, fontSize: 14, lineHeight: 23,
      fontFamily: "'Cascadia Code', Consolas, 'DejaVu Sans Mono', monospace",
      minimap: { enabled: false }, padding: { top: 18 }, scrollBeyondLastLine: false,
      smoothScrolling: true, renderLineHighlight: 'all', fixedOverflowWidgets: true,
      multiCursorModifier: 'alt', hover: { enabled: true }, quickSuggestions: { other: true, comments: false, strings: false },
      gotoLocation: { multipleDefinitions: 'goto' },
    });
    editor.current = instance;
    const subscription = instance.onDidChangeCursorPosition(e => positionCallback.current(e.position.lineNumber, e.position.column));
    const features = registerLanguageFeatures(error => callbacks.current.onError(error));
    const opener = monaco.editor.registerEditorOpener({
      async openCodeEditor(_source, resource, target) {
        const line = target && ('startLineNumber' in target ? target.startLineNumber : target.lineNumber) || 1;
        const column = target && ('startColumn' in target ? target.startColumn : target.column) || 1;
        await callbacks.current.onOpenLocation(resource.toString(), line, column);
        return true;
      },
    });
    return () => {
      features.dispose(); opener.dispose();
      subscription.dispose(); instance.dispose(); editor.current = null;
      models.current.forEach(({ model, subscription }) => { subscription.dispose(); model.dispose(); });
      models.current.clear();
    };
  }, []);

  useEffect(() => {
    const instance = editor.current!;
    for (const file of items) {
      if (!models.current.has(file.path)) {
        const model = monaco.editor.createModel(file.text, file.language, monaco.Uri.parse(file.uri));
        const subscription = model.onDidChangeContent(() => documents.edit(file.path, model.getValue(undefined, true)));
        models.current.set(file.path, { model, subscription });
      }
    }
    if (active !== previous.current) {
      const view = instance.saveViewState();
      if (previous.current && view) views.current.set(previous.current, view);
      instance.setModel(active ? models.current.get(active)?.model ?? null : null);
      if (active) {
        instance.restoreViewState(views.current.get(active) ?? null);
        instance.focus();
      }
      previous.current = active;
    }
    for (const [path, entry] of models.current) {
      if (!items.some(file => file.path === path)) {
        entry.subscription.dispose(); entry.model.dispose(); models.current.delete(path); views.current.delete(path);
      }
    }
  }, [items, active]);

  useEffect(() => {
    for (const [owner, events] of [['lsp', diagnostics], ['build', buildDiagnostics]] as const) {
      const byUri = new Map(Object.values(events).map(event => [monaco.Uri.parse(event.uri).toString(), event]));
      for (const { model } of models.current.values()) {
        const event = byUri.get(model.uri.toString());
        monaco.editor.setModelMarkers(model, owner, (event?.diagnostics ?? []).map(d => ({
          startLineNumber: d.range.start.line + 1, startColumn: d.range.start.character + 1,
          endLineNumber: d.range.end.line + 1, endColumn: d.range.end.character + 1,
          message: d.message, source: d.source, code: d.code === undefined ? undefined : String(d.code),
          severity: d.severity === 2 ? monaco.MarkerSeverity.Warning : d.severity === 3 ? monaco.MarkerSeverity.Info : d.severity === 4 ? monaco.MarkerSeverity.Hint : monaco.MarkerSeverity.Error,
        })));
      }
    }
  }, [diagnostics, buildDiagnostics, items]);
  useEffect(() => {
    if (!selection || selection.path !== active || !editor.current) return;
    const position = { lineNumber: selection.line, column: selection.column };
    editor.current.setPosition(position);
    editor.current.revealPositionInCenter(position);
    editor.current.focus();
  }, [selection]);
  return <div className={`code-editor ${active ? '' : 'hidden'}`} ref={container} />;
}
