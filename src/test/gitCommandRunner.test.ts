import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { formatGitCommandForLog, GitCommandRunner, redactGitArgsForLog } from '../infrastructure/git/GitCommandRunner';

test('redactGitArgsForLog removes credentials from remote URLs', () => {
  const args = redactGitArgsForLog([
    'remote',
    'set-url',
    'origin',
    'https://ghp_secret-token@github.com/example/repo.git'
  ]);

  assert.equal(args[3], 'https://<redacted>@github.com/example/repo.git');
});

test('redactGitArgsForLog removes tokens from URL query strings', () => {
  const args = redactGitArgsForLog([
    'fetch',
    'https://github.com/example/repo.git?access_token=secret-value&x=1'
  ]);

  assert.equal(args[1], 'https://github.com/example/repo.git?access_token=<redacted>&x=1');
});

test('formatGitCommandForLog redacts commit message values', () => {
  const command = formatGitCommandForLog(String.raw`C:\repo with spaces`, ['commit', '-m', 'secret message']);

  assert.match(command, /<redacted-message>/);
  assert.doesNotMatch(command, /secret message/);
  assert.match(command, /"C:\\repo with spaces"/);
});

test('GitCommandRunner executes git commands and logs redacted commit messages', async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'repoflow-git-'));
  const lines: string[] = [];
  const runner = new GitCommandRunner({ appendLine: (value) => lines.push(value) });

  try {
    await runner.run(repoRoot, ['init']);
    await runner.run(repoRoot, ['config', 'user.name', 'RepoFlow Test']);
    await runner.run(repoRoot, ['config', 'user.email', 'repoflow@example.com']);
    await fs.writeFile(path.join(repoRoot, 'README.md'), '# test\n', 'utf8');
    await runner.run(repoRoot, ['add', 'README.md']);
    await runner.run(repoRoot, ['commit', '-m', 'secret integration message']);

    const subject = await runner.run(repoRoot, ['log', '--format=%s', '-1'], { logCommand: false });

    assert.equal(subject, 'secret integration message');
    assert.ok(lines.some((line) => line.includes('<redacted-message>')));
    assert.ok(lines.every((line) => !line.includes('secret integration message')));
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
