import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBlameOutput, parseBranchList, parseCommitLog, parseWorkingTreeStatus } from '../infrastructure/git/GitParsers';

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

test('parseBranchList detects remote refs independently of remote name', () => {
  const raw = [
    'refs/heads/feature/ui\tabc123\tupstream/main\t*\t[ahead 1]',
    'refs/remotes/upstream/main\tdef456\t\t\t',
    'refs/remotes/origin/feature/ui\tghi789\t\t\t'
  ].join('\n');

  const branches = parseBranchList(raw);
  const local = branches.find((branch) => branch.shortName === 'feature/ui');
  const upstreamMain = branches.find((branch) => branch.shortName === 'upstream/main');
  const originFeature = branches.find((branch) => branch.shortName === 'origin/feature/ui');

  assert.ok(local);
  assert.equal(local?.remote, false);
  assert.equal(local?.upstream, 'upstream/main');
  assert.equal(local?.current, true);

  assert.ok(upstreamMain);
  assert.equal(upstreamMain?.remote, true);

  assert.ok(originFeature);
  assert.equal(originFeature?.remote, true);
});

test('parseBlameOutput keeps the historical filename for blamed lines', () => {
  const raw = [
    '1234567890abcdef1234567890abcdef12345678 1 1 1',
    'author Jane Doe',
    'author-mail <jane@example.com>',
    'author-time 1715083200',
    'summary add config',
    'filename src/legacy/config.ts',
    '\tconst value = 1;'
  ].join('\n');

  const entries = parseBlameOutput(raw);

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.filePath, 'src/legacy/config.ts');
  assert.equal(entries[0]?.lineNumber, 1);
});
