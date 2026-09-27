import type { OpenDocument } from '../editor/documentStore';
export function EditorTabs({ items, active, onSelect, onClose }: {
  items: OpenDocument[]; active: string | null; onSelect(path: string): void; onClose(path: string): void;
}) {
  return <div className="tabs" role="tablist" aria-label="Open files">{items.map(file =>
    <div className={`tab ${active === file.path ? 'active' : ''}`} key={file.path}>
      <button role="tab" aria-selected={active === file.path} title={file.path} onClick={() => onSelect(file.path)}>
        <span className="file-glyph">{file.language === 'cpp' ? 'C++' : file.language === 'hlsl' ? 'H' : '≡'}</span>
        {file.name}{file.text !== file.savedText && <span className="dirty" aria-label="Unsaved changes">●</span>}
      </button>
      <button className="close-tab" aria-label={`Close ${file.name}`} onClick={() => onClose(file.path)}>×</button>
    </div>)}</div>;
}
