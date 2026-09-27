import { monaco } from './monaco';
import { documents } from './documentStore';
import type { HoverContent, SourceRange } from '../../shared/types';

export const editorRange = (range: SourceRange): monaco.Range => new monaco.Range(
  range.start.line + 1, range.start.character + 1, range.end.line + 1, range.end.character + 1,
);
function markdown(content: HoverContent): monaco.IMarkdownString {
  if (typeof content !== 'string' && 'language' in content) {
    return { value: `\`\`\`${content.language}\n${content.value}\n\`\`\``, isTrusted: false };
  }
  const value = typeof content === 'string' ? content : content.value;
  return { value: typeof content !== 'string' && content.kind === 'plaintext'
    ? value.replace(/[\\`*_{}\[\]<>()#+.!|~-]/g, '\\$&') : value, isTrusted: false, supportHtml: false };
}
const kinds = [
  'Text', 'Method', 'Function', 'Constructor', 'Field', 'Variable', 'Class', 'Interface', 'Module', 'Property',
  'Unit', 'Value', 'Enum', 'Keyword', 'Snippet', 'Color', 'File', 'Reference', 'Folder', 'EnumMember',
  'Constant', 'Struct', 'Event', 'Operator', 'TypeParameter',
] as const;

export function registerLanguageFeatures(onError: (error: unknown) => void): monaco.IDisposable {
  const registrations: monaco.IDisposable[] = [];
  function source(model: monaco.editor.ITextModel) {
    return documents.get().documents.find(file => monaco.Uri.parse(file.uri).toString() === model.uri.toString());
  }
  for (const language of ['c', 'cpp', 'hlsl']) {
    registrations.push(monaco.languages.registerDefinitionProvider(language, {
      async provideDefinition(model, position, token) {
        const file = source(model);
        if (!file || token.isCancellationRequested) return null;
        const version = model.getVersionId();
        try {
          const result = await window.desktop.definition(file.path, model.getValue(undefined, true), { line: position.lineNumber - 1, character: position.column - 1 });
          if (token.isCancellationRequested || model.isDisposed() || model.getVersionId() !== version) return null;
          return (result ?? []).map(location => ({ uri: monaco.Uri.parse(location.uri), range: editorRange(location.range) }));
        } catch (error) { if (!token.isCancellationRequested) onError(error); return null; }
      },
    }));
    registrations.push(monaco.languages.registerHoverProvider(language, {
      async provideHover(model, position, token) {
        const file = source(model);
        if (!file || token.isCancellationRequested) return null;
        const version = model.getVersionId();
        try {
          const hover = await window.desktop.hover(file.path, model.getValue(undefined, true), { line: position.lineNumber - 1, character: position.column - 1 });
          if (!hover || token.isCancellationRequested || model.isDisposed() || model.getVersionId() !== version) return null;
          return { contents: (Array.isArray(hover.contents) ? hover.contents : [hover.contents]).map(markdown),
            range: hover.range ? editorRange(hover.range) : undefined };
        } catch (error) { if (!token.isCancellationRequested) onError(error); return null; }
      },
    }));
    registrations.push(monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['.', '>', ':'],
      async provideCompletionItems(model, position, _context, token) {
        const file = source(model);
        if (!file || token.isCancellationRequested) return null;
        const version = model.getVersionId();
        try {
          const result = await window.desktop.completion(file.path, model.getValue(undefined, true), { line: position.lineNumber - 1, character: position.column - 1 });
          if (!result || token.isCancellationRequested || model.isDisposed() || model.getVersionId() !== version) return null;
          const word = model.getWordUntilPosition(position);
          const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
          return { incomplete: Array.isArray(result) ? false : result.isIncomplete,
            suggestions: (Array.isArray(result) ? result : result.items).map(item => ({
              label: item.label, kind: monaco.languages.CompletionItemKind[kinds[(item.kind ?? 1) - 1] ?? 'Text'],
              detail: item.detail, filterText: item.filterText, sortText: item.sortText,
              documentation: typeof item.documentation === 'string' ? item.documentation : item.documentation
                ? markdown({ kind: item.documentation.kind === 'markdown' ? 'markdown' : 'plaintext', value: item.documentation.value }) : undefined,
              insertText: item.textEdit?.newText ?? item.insertText ?? item.label,
              insertTextRules: item.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
              range: item.textEdit?.range ? editorRange(item.textEdit.range) : range,
              additionalTextEdits: item.additionalTextEdits?.map(edit => ({ range: editorRange(edit.range), text: edit.newText })),
            })) };
        } catch (error) { if (!token.isCancellationRequested) onError(error); return null; }
      },
    }));
  }
  return { dispose: () => registrations.forEach(registration => registration.dispose()) };
}
