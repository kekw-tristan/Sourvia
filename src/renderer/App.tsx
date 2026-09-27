import { useCallback, useEffect, useRef, useState } from 'react';
import type { Directory, DiagnosticsEvent, ServerStatus } from '../shared/types';
import { ProjectGraph } from './components/ProjectGraph';
import { EditorTabs } from './components/EditorTabs';
import { CodeEditor } from './components/CodeEditor';
import { documents, useDocuments } from './editor/documentStore';

export function App() {
  const { documents: items, active } = useDocuments();
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [diagnostics, setDiagnostics] = useState<Record<string, DiagnosticsEvent>>({});
  const [servers, setServers] = useState<Record<string, ServerStatus>>({});
  const [position, setPosition] = useState({ line: 1, column: 1 });
  const sent = useRef(new Map<string, string>());
  const current = items.find(d => d.path === active);

  const report = useCallback((error: unknown) => setError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error)), []);
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await action(); } catch (error) { report(error); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function save(path: string) {
    const file = documents.get().documents.find(d => d.path === path);
    if (!file || file.text === file.savedText) return;
    await window.desktop.saveFile(path, file.text);
    documents.saved(path, file.text);
  }
  async function resolveChanges(paths: string[]) {
    const dirty = documents.get().documents.filter(d => paths.includes(d.path) && d.text !== d.savedText);
    if (!dirty.length) return true;
    const answer = await window.desktop.confirmChanges(dirty.map(d => d.name));
    if (answer === 'cancel') return false;
    if (answer === 'save') {
      for (const file of dirty) await save(file.path);
      // Edits made during an asynchronous save must not be discarded.
      if (documents.get().documents.some(d => paths.includes(d.path) && d.text !== d.savedText)) return false;
    }
    return true;
  }
  async function openFolder() {
    await run(async () => {
      if (!await resolveChanges(documents.get().documents.map(d => d.path))) return;
      const next = await window.desktop.openFolder();
      if (!next) return;
      documents.reset(); sent.current.clear(); setDiagnostics({}); setServers({});
      setDirectory(next); setHistory([]);
    });
  }
  async function navigate(path: string, back = false) {
    await run(async () => {
      const next = await window.desktop.listDirectory(path);
      setHistory(previous => back ? previous.slice(0, -1) : [...previous, directory!.current.path]);
      setDirectory(next);
    });
  }
  async function openFile(path: string) {
    await run(async () => {
      if (documents.get().documents.some(d => d.path === path)) documents.activate(path);
      else documents.open(await window.desktop.readFile(path));
    });
  }
  async function closeFile(path: string) {
    await run(async () => {
      if (!await resolveChanges([path])) return;
      await window.desktop.closeDocument(path);
      documents.close(path); sent.current.delete(path);
    });
  }

  useEffect(() => {
    const offDiagnostics = window.desktop.onDiagnostics(event => setDiagnostics(previous => ({ ...previous, [event.uri]: event })));
    const offStatus = window.desktop.onServerStatus(event => setServers(previous => ({ ...previous, [event.id]: event })));
    return () => { offDiagnostics(); offStatus(); };
  }, []);
  useEffect(() => {
    window.desktop.setDirty(items.some(d => d.text !== d.savedText));
    const timer = window.setTimeout(() => {
      if (busyRef.current) return;
      for (const file of items) {
        if (sent.current.get(file.path) === file.text) continue;
        sent.current.set(file.path, file.text);
        void window.desktop.syncDocument(file.path, file.text).catch(report);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [items, busy, report]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && ['o', 's', 'w', 'Tab'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (busyRef.current) return;
        if (event.key === 'o') void openFolder();
        if (event.key === 's' && active) void run(() => save(active));
        if (event.key === 'w' && active) void closeFile(active);
        if (event.key === 'Tab' && items.length) {
          const index = items.findIndex(d => d.path === active);
          documents.activate(items[(index + (event.shiftKey ? items.length - 1 : 1)) % items.length].path);
        }
      }
      if (event.altKey && ['ArrowLeft', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        const path = event.key === 'ArrowLeft' ? history.at(-1) : directory?.current.parentPath;
        if (path) void navigate(path, event.key === 'ArrowLeft');
      }
    };
    window.addEventListener('keydown', keydown, true);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (documents.get().documents.some(d => d.text !== d.savedText)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('keydown', keydown, true); window.removeEventListener('beforeunload', beforeUnload); };
  });

  const problemCount = Object.values(diagnostics).reduce((sum, event) => sum + event.diagnostics.length, 0);
  return <div className="app">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">S</span>Sourvia<span className="badge">PREVIEW</span></div>
      <div className="project-title">{directory?.root.split(/[\\/]/).pop() ?? 'Your next idea starts here'}<span>{directory ? 'LOCAL WORKSPACE' : 'VISUAL CODE EDITOR'}</span></div>
      <button className="open-button" disabled={busy} onClick={() => void openFolder()}>Open folder <kbd>Ctrl O</kbd></button>
    </header>
    {error && <div className="error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    <main className="workspace">
      <section className="graph-pane" aria-label="Project graph">
        <div className="pane-toolbar"><span className="section-label">PROJECT MAP</span><div className="nav-buttons">
          <button disabled={busy || !history.length} onClick={() => void navigate(history.at(-1)!, true)} title="Previous folder · Alt+Left" aria-label="Previous folder">←</button>
          <button disabled={busy || !directory?.current.parentPath} onClick={() => void navigate(directory!.current.parentPath!)} title="Parent folder · Alt+Up" aria-label="Parent folder">↑</button>
        </div></div>
        {directory ? <><div className="breadcrumb" title={directory.current.path}>{directory.current.path}</div><div className="graph-canvas"><ProjectGraph directory={directory} onSelect={node => void (node.type === 'folder' ? navigate(node.path) : openFile(node.path))} /></div>
          <div className="graph-footer"><span>{directory.children.filter(n => n.type === 'folder').length} folders · {directory.children.filter(n => n.type === 'file').length} files</span><span>Scroll to zoom · Drag to pan</span></div></>
          : <div className="empty graph-empty"><div className="orbit"><i /><i /><i /><span>▱</span></div><h1>A different perspective.</h1><p>Explore your project as a map.<br />Follow the connections. Find your code.</p><button className="primary" disabled={busy} onClick={() => void openFolder()}>Open a project folder <span>↗</span></button><small>Local files. Windows & Linux.</small></div>}
      </section>
      <section className="editor-pane" aria-label="Code editor">
        <EditorTabs items={items} active={active} onSelect={documents.activate} onClose={path => void closeFile(path)} />
        <div className="editor-path">{current ? <><span>{current.name}</span><button disabled={busy || current.text === current.savedText} onClick={() => void run(() => save(current.path))}>Save <kbd>Ctrl S</kbd></button></> : <span>EDITOR</span>}</div>
        <div className="editor-content"><CodeEditor items={items} active={active} diagnostics={diagnostics} onPosition={(line, column) => setPosition({ line, column })} />
          {!current && <div className="empty editor-empty"><div className="code-symbol">{ '{ }' }</div><h2>Make room for your code.</h2><p>Select a file on the map to begin editing.</p><div className="shortcut-list"><span>Open folder <kbd>Ctrl O</kbd></span><span>Save file <kbd>Ctrl S</kbd></span><span>Switch tabs <kbd>Ctrl Tab</kbd></span></div></div>}
        </div>
      </section>
    </main>
    <footer className="statusbar"><span className="status-dot" /><span>{busy ? 'Working…' : 'Ready'}</span><span className="status-divider" /><span>{problemCount} problems</span>
      {Object.values(servers).map(server => <span key={server.id} className={`server ${server.state}`} title={server.message}>{server.id}: {server.state}</span>)}
      <span className="status-spacer" /><span>{current ? `Ln ${position.line}, Col ${position.column}` : 'No file selected'}</span><span>{current?.language.toUpperCase()}</span><span>UTF-8</span>
    </footer>
  </div>;
}
