import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { languageForPath } from '../shared/languages';
import type { Directory, DocumentFile, ProjectNode } from '../shared/types';

export const ignoredNames = new Set(['.git', 'node_modules', 'bin', 'bin-int', 'build', '.vs', '.idea']);
const maxFileSize = 8 * 1024 * 1024;

export class ProjectFilesystem {
  root = '';
  private savedText = new Map<string, string>();

  async open(folder: string): Promise<Directory> {
    const root = await fs.realpath(folder);
    if (!(await fs.stat(root)).isDirectory()) throw new Error('Please select a directory.');
    const previous = this.root;
    this.root = root;
    try {
      const directory = await this.list(root);
      this.savedText.clear();
      return directory;
    } catch (error) { this.root = previous; throw error; }
  }

  async resolve(candidate: string): Promise<string> {
    if (!this.root) throw new Error('Open a project folder first.');
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) throw new Error('An absolute project path is required.');
    const resolved = await fs.realpath(candidate);
    const relative = path.relative(this.root, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('The path is outside the open project.');
    }
    return resolved;
  }

  private node(file: string, type: ProjectNode['type']): ProjectNode {
    return { id: file, path: file, name: path.basename(file) || file, type,
      parentPath: file === this.root ? undefined : path.dirname(file) };
  }

  async list(folder: string): Promise<Directory> {
    const resolved = await this.resolve(folder);
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const children = entries.filter(e => !ignoredNames.has(e.name) && (e.isDirectory() || e.isFile()))
      .map(e => this.node(path.join(resolved, e.name), e.isDirectory() ? 'folder' : 'file'))
      .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1);
    return { root: this.root, current: this.node(resolved, 'folder'), children };
  }

  async read(file: string): Promise<DocumentFile> {
    const resolved = await this.resolve(file);
    const stat = await fs.stat(resolved);
    if (!stat.isFile() || stat.size > maxFileSize) throw new Error('Only text files up to 8 MiB can be opened.');
    const bytes = await fs.readFile(resolved);
    if (bytes.includes(0)) throw new Error('Binary and UTF-16 files are not supported. Please use UTF-8.');
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    this.savedText.set(resolved, text);
    return { path: resolved, uri: pathToFileURL(resolved).href, name: path.basename(resolved), text, language: languageForPath(resolved) };
  }

  async save(file: string, text: string): Promise<void> {
    const resolved = await this.resolve(file);
    if (typeof text !== 'string' || Buffer.byteLength(text) > maxFileSize) throw new Error('File exceeds the 8 MiB limit.');
    if (!this.savedText.has(resolved)) throw new Error('Open the file before saving.');
    const disk = await fs.readFile(resolved, 'utf8');
    if (disk !== this.savedText.get(resolved)) throw new Error('This file changed on disk. Save was stopped to protect those changes. Close and reopen it to reload.');
    await fs.writeFile(resolved, text, 'utf8');
    this.savedText.set(resolved, text);
  }

  close(file: string): void { this.savedText.delete(file); }
}
