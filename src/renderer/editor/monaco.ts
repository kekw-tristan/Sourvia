import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';

self.MonacoEnvironment = { getWorker: (_id, label) => label === 'json' ? new JsonWorker() : new EditorWorker() };
// The bundled C++ lexer covers HLSL's C-style syntax; semantic analysis belongs to the LSP.
monaco.languages.register({ id: 'hlsl', extensions: ['.hlsl', '.hlsli'] });
monaco.languages.onLanguage('hlsl', async () => {
  const { language, conf } = await import('monaco-editor/esm/vs/basic-languages/cpp/cpp');
  monaco.languages.setMonarchTokensProvider('hlsl', language);
  monaco.languages.setLanguageConfiguration('hlsl', conf);
});
monaco.editor.defineTheme('sourvia', {
  base: 'vs-dark', inherit: true, rules: [], colors: {
    'editor.background': '#13161c', 'editorLineNumber.foreground': '#50596c',
    'editor.lineHighlightBackground': '#1b2029', 'editorCursor.foreground': '#aa9bff',
    'editor.selectionBackground': '#63539b55',
  },
});
export { monaco };
