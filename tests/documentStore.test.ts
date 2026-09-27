import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documents } from '../src/renderer/editor/documentStore';

test('tabs deduplicate, preserve edits during saves, and select a neighbour on close', () => {
  documents.reset();
  const file = { path: '/a.cpp', uri: 'file:///a.cpp', name: 'a.cpp', text: 'initial', language: 'cpp' };
  documents.open(file);
  documents.edit(file.path, 'first edit');
  documents.open(file);
  assert.equal(documents.get().documents.length, 1);
  assert.equal(documents.get().documents[0].text, 'first edit');
  documents.edit(file.path, 'second edit during save');
  documents.saved(file.path, 'first edit');
  assert.notEqual(documents.get().documents[0].text, documents.get().documents[0].savedText);
  documents.open({ ...file, path: '/b.cpp' });
  documents.close('/b.cpp');
  assert.equal(documents.get().active, '/a.cpp');
  documents.close('/a.cpp');
  assert.equal(documents.get().active, null);
});
