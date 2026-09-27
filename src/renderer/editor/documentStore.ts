import { useSyncExternalStore } from 'react';
import type { DocumentFile } from '../../shared/types';

export interface OpenDocument extends DocumentFile { savedText: string }
let state: { documents: OpenDocument[]; active: string | null } = { documents: [], active: null };
const listeners = new Set<() => void>();
function publish(next: typeof state) { state = next; listeners.forEach(fn => fn()); }
export const documents = {
  get: () => state,
  open(file: DocumentFile) {
    const existing = state.documents.some(d => d.path === file.path);
    publish({ documents: existing ? state.documents : [...state.documents, { ...file, savedText: file.text }], active: file.path });
  },
  activate(path: string) { publish({ ...state, active: path }); },
  edit(path: string, text: string) {
    publish({ ...state, documents: state.documents.map(d => d.path === path ? { ...d, text } : d) });
  },
  saved(path: string, text: string) {
    publish({ ...state, documents: state.documents.map(d => d.path === path ? { ...d, savedText: text } : d) });
  },
  close(path: string) {
    const index = state.documents.findIndex(d => d.path === path);
    const remaining = state.documents.filter(d => d.path !== path);
    publish({ documents: remaining, active: state.active === path ? remaining[Math.min(index, remaining.length - 1)]?.path ?? null : state.active });
  },
  reset() { publish({ documents: [], active: null }); },
};
export function useDocuments() {
  return useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, documents.get);
}
