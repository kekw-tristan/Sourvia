import { useEffect, useRef } from 'react';
import type { BuildState, DiagnosticsEvent } from '../../shared/types';

export function OutputPanel({ tab, onTab, onClose, onClear, output, state, diagnostics, onOpenLocation }: {
  tab: 'output' | 'problems'; onTab(tab: 'output' | 'problems'): void; onClose(): void; onClear(): void;
  output: string; state: BuildState; diagnostics: DiagnosticsEvent[];
  onOpenLocation(uri: string, line: number, column: number): Promise<void>;
}) {
  const log = useRef<HTMLPreElement>(null);
  const follow = useRef(true);
  useEffect(() => { if (log.current && follow.current) log.current.scrollTop = log.current.scrollHeight; }, [output, tab]);
  const count = diagnostics.reduce((sum, event) => sum + event.diagnostics.length, 0);
  return <section className="output-panel" aria-label="Build output and problems">
    <div className="output-toolbar"><div role="tablist" aria-label="Output views">
      <button role="tab" aria-selected={tab === 'output'} onClick={() => onTab('output')}>Output</button>
      <button role="tab" aria-selected={tab === 'problems'} onClick={() => onTab('problems')}>Problems ({count})</button>
    </div><span className={`build-status ${state.phase}`} role="status">{state.message}</span>
      <button onClick={onClear} disabled={!output}>Clear output</button><button onClick={onClose} aria-label="Close output panel">×</button></div>
    {tab === 'output' ? <pre ref={log} className="build-output" aria-label="Process output" onScroll={() => {
      const element = log.current!; follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 30;
    }}>{output || 'Build and program output will appear here.'}</pre> : <div className="problems-list">
      {!count && <p>No problems reported.</p>}
      {diagnostics.flatMap(event => event.diagnostics.map((diagnostic, index) => <button className="problem-row" key={`${event.uri}-${diagnostic.source}-${index}`}
        onClick={() => void onOpenLocation(event.uri, diagnostic.range.start.line + 1, diagnostic.range.start.character + 1)}>
        <span className={diagnostic.severity === 2 ? 'problem-warning' : 'problem-error'}>{diagnostic.severity === 2 ? 'Warning' : diagnostic.severity && diagnostic.severity > 2 ? 'Info' : 'Error'}</span>
        <span className="problem-message">{diagnostic.message}</span><span className="problem-location" title={event.uri}>
          {decodeURIComponent(event.uri.split('/').pop() ?? '')}:{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1} {diagnostic.source && `(${diagnostic.source})`}
        </span>
      </button>))}
    </div>}
  </section>;
}
