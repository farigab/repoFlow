import * as path from 'node:path';
import type { RepoSpecialState } from '../core/models';

const CONTROL_OR_NUL = /[\0\r\n]/;
const COMMIT_HASH_PATTERN = /^[0-9a-f]{4,40}$/i;
const REFLOG_REF_PATTERN = /^HEAD@\{\d+\}$/;
const STASH_REF_PATTERN = /^stash@\{\d+\}$/;
const SPECIAL_STATES = new Set<RepoSpecialState>([
  'merging',
  'rebasing',
  'cherry-picking',
  'reverting',
  'bisecting',
  'detached'
]);

function ensureText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || CONTROL_OR_NUL.test(trimmed)) {
    throw new Error(`Invalid ${label}.`);
  }
  return trimmed;
}

export function assertCommitHash(value: string): string {
  const hash = ensureText(value, 'commit hash');
  if (!COMMIT_HASH_PATTERN.test(hash)) {
    throw new Error('Invalid commit hash.');
  }
  return hash;
}

export function assertReflogRef(value: string): string {
  const ref = ensureText(value, 'reflog ref');
  if (!REFLOG_REF_PATTERN.test(ref)) {
    throw new Error('Invalid undo target.');
  }
  return ref;
}

export function assertStashRef(value: string): string {
  const ref = ensureText(value, 'stash ref');
  if (!STASH_REF_PATTERN.test(ref)) {
    throw new Error('Invalid stash ref.');
  }
  return ref;
}

export function assertRepoSpecialState(value: string): RepoSpecialState {
  const state = ensureText(value, 'repository state') as RepoSpecialState;
  if (!SPECIAL_STATES.has(state)) {
    throw new Error('Invalid repository state.');
  }
  return state;
}

export function assertSafeGitRef(value: string, label = 'Git ref'): string {
  const ref = ensureText(value, label);
  if (
    ref.startsWith('-') ||
    ref.includes('..') ||
    ref.includes('@{') ||
    ref.includes('\\') ||
    ref.endsWith('.lock')
  ) {
    throw new Error(`Invalid ${label}.`);
  }
  return ref;
}

export function assertSafeBranchName(value: string): string {
  const branch = assertSafeGitRef(value, 'branch name');
  if (
    branch.startsWith('/') ||
    branch.endsWith('/') ||
    branch.includes('//') ||
    branch.endsWith('.')
  ) {
    throw new Error('Invalid branch name.');
  }
  return branch;
}

export function assertSafeRemoteName(value: string): string {
  const remote = ensureText(value, 'remote name');
  if (!/^[A-Za-z0-9._-]+$/.test(remote) || remote.startsWith('-')) {
    throw new Error('Invalid remote name.');
  }
  return remote;
}

export function assertSafeHookName(value: string): string {
  const hookName = ensureText(value, 'hook name');
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(hookName)) {
    throw new Error('Invalid hook name.');
  }
  return hookName;
}

export function assertSafeRelativeGitPath(value: string, label = 'file path'): string {
  const normalized = ensureText(value, label).replaceAll('\\', '/');
  const isWindowsAbsolute = /^[A-Za-z]:\//.test(normalized);
  if (normalized.startsWith('/') || isWindowsAbsolute) {
    throw new Error(`Invalid ${label}.`);
  }

  const parts = normalized.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`Invalid ${label}.`);
  }

  return normalized;
}

export function assertSafeRelativeGitPaths(values?: readonly string[]): string[] | undefined {
  if (!values) {
    return undefined;
  }

  const normalized = new Set<string>();
  for (const value of values) {
    normalized.add(assertSafeRelativeGitPath(value));
  }
  return [...normalized];
}

export function assertSafeAbsoluteFsPath(value: string, label = 'filesystem path'): string {
  const fsPath = ensureText(value, label);
  if (!path.win32.isAbsolute(fsPath) && !path.posix.isAbsolute(fsPath)) {
    throw new Error(`Invalid ${label}.`);
  }
  return fsPath;
}

export function normalizeFsPathForComparison(value: string): string {
  const resolved = path.resolve(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
