import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCommitHash,
  assertReflogRef,
  assertSafeAbsoluteFsPath,
  assertSafeBranchName,
  assertSafeRelativeGitPath,
  assertStashRef
} from '../shared/gitInputValidation';

test('assertSafeRelativeGitPath normalizes safe relative paths', () => {
  assert.equal(assertSafeRelativeGitPath(String.raw`src\app.ts`), 'src/app.ts');
  assert.equal(assertSafeRelativeGitPath('docs/read me.md'), 'docs/read me.md');
});

test('assertSafeRelativeGitPath rejects absolute or traversing paths', () => {
  assert.throws(() => assertSafeRelativeGitPath('../secret.txt'), /Invalid file path/);
  assert.throws(() => assertSafeRelativeGitPath('/etc/passwd'), /Invalid file path/);
  assert.throws(() => assertSafeRelativeGitPath(String.raw`C:\Users\me\.ssh\id_rsa`), /Invalid file path/);
});

test('assertSafeBranchName rejects option-like and malformed branch names', () => {
  assert.equal(assertSafeBranchName('feature/repo-flow'), 'feature/repo-flow');
  assert.throws(() => assertSafeBranchName('-delete'), /Invalid branch name/);
  assert.throws(() => assertSafeBranchName('feature..bad'), /Invalid branch name/);
  assert.throws(() => assertSafeBranchName('feature/@{bad}'), /Invalid branch name/);
});

test('assertCommitHash, assertReflogRef and assertStashRef validate ref shapes', () => {
  assert.equal(assertCommitHash('abcdef1'), 'abcdef1');
  assert.equal(assertReflogRef('HEAD@{12}'), 'HEAD@{12}');
  assert.equal(assertStashRef('stash@{3}'), 'stash@{3}');

  assert.throws(() => assertCommitHash('main'), /Invalid commit hash/);
  assert.throws(() => assertReflogRef('main@{1}'), /Invalid undo target/);
  assert.throws(() => assertStashRef('stash^{0}'), /Invalid stash ref/);
});

test('assertSafeAbsoluteFsPath accepts platform and VS Code remote absolute paths', () => {
  assert.equal(assertSafeAbsoluteFsPath(String.raw`C:\repo`), String.raw`C:\repo`);
  assert.equal(assertSafeAbsoluteFsPath('/workspace/repo'), '/workspace/repo');
  assert.throws(() => assertSafeAbsoluteFsPath('relative/repo'), /Invalid filesystem path/);
});
