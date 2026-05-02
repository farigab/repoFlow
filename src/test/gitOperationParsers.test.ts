import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseNameStatusAndNumstat,
  parseStashFiles,
  parseStashList,
  parseUndoEntries
} from '../infrastructure/git/GitOperationParsers';

test('parseStashList reads stash metadata and branch names', () => {
  const raw = [
    'stash@{0}\u001fWIP on feature/test: abc123 subject\u001f2026-05-01 10:00:00 -0300\u001e',
    'stash@{1}\u001fOn main: manual stash\u001f2026-05-01 11:00:00 -0300\u001e'
  ].join('');

  const stashes = parseStashList(raw);

  assert.equal(stashes.length, 2);
  assert.equal(stashes[0]?.index, 0);
  assert.equal(stashes[0]?.branch, 'feature/test');
  assert.equal(stashes[1]?.branch, 'main');
});

test('parseStashFiles handles renamed and ordinary files', () => {
  const raw = [
    'R100\0',
    'src/old.ts\0',
    'src/new.ts\0',
    'M\0',
    'README.md\0'
  ].join('');

  const files = parseStashFiles(raw);

  assert.deepEqual(files, [
    { path: 'src/new.ts', originalPath: 'src/old.ts', status: 'R' },
    { path: 'README.md', status: 'M' }
  ]);
});

test('parseNameStatusAndNumstat merges rename metadata with stats', () => {
  const files = parseNameStatusAndNumstat(
    'R100\tsrc/old.ts\tsrc/new.ts\nM\tREADME.md',
    '2\t1\tsrc/old.ts\tsrc/new.ts\n5\t0\tREADME.md'
  );

  assert.deepEqual(files, [
    { status: 'R', path: 'src/new.ts', originalPath: 'src/old.ts', additions: 2, deletions: 1 },
    { status: 'M', path: 'README.md', originalPath: undefined, additions: 5, deletions: 0 }
  ]);
});

test('parseUndoEntries skips incomplete records', () => {
  const entries = parseUndoEntries(
    'abc123\u001fHEAD@{1}\u001f2026-05-01T10:00:00Z\u001fcommit: test\u001e' +
    '\u001fHEAD@{2}\u001f2026-05-01T09:00:00Z\u001fmissing hash\u001e'
  );

  assert.deepEqual(entries, [
    { hash: 'abc123', shortHash: 'abc123', ref: 'HEAD@{1}', date: '2026-05-01T10:00:00Z', message: 'commit: test' }
  ]);
});
