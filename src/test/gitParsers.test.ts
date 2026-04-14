import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCommitLog, parseWorkingTreeStatus } from '../infrastructure/git/GitParsers';

test('parseCommitLog reads commit metadata and refs', () => {
  const raw = 'abc12345\u001fdef67890 ghi11111\u001fJane Doe\u001fjane@example.com\u001f2026-04-14T12:30:00Z\u001ffeat: graph\u001fHEAD -> refs/heads/main, refs/remotes/origin/main\u001e';
  const commits = parseCommitLog(raw, true);

  assert.equal(commits.length, 1);
  assert.equal(commits[0]?.hash, 'abc12345');
  assert.equal(commits[0]?.parentHashes.length, 2);
  assert.equal(commits[0]?.isHead, true);
  assert.equal(commits[0]?.isDirtyHead, true);
  assert.equal(commits[0]?.refs[1]?.type, 'remoteBranch');
});

test('parseWorkingTreeStatus groups staged, unstaged and conflicts', () => {
  const raw = [
    '# branch.head main',
    '# branch.ab +2 -1',
    '1 M. N... 100644 100644 100644 1234567 1234567 src/app.ts',
    '1 .M N... 100644 100644 100644 1234567 1234567 README.md',
    'u UU N... 100644 100644 100644 100644 1234567 1234567 1234567 src/conflict.ts',
    '? docs/todo.md'
  ].join('\n');

  const status = parseWorkingTreeStatus(raw);
  assert.equal(status.currentBranch, 'main');
  assert.equal(status.ahead, 2);
  assert.equal(status.behind, 1);
  assert.equal(status.staged.length, 1);
  assert.equal(status.unstaged.length, 2);
  assert.equal(status.conflicted.length, 1);
});
