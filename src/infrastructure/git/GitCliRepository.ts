import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { buildGraphRows } from '../../application/graph/buildGraphRows';
import type {
  BlameEntry,
  BranchSummary,
  BranchCompareCommit,
  BranchCompareFile,
  BranchCompareResult,
  CommitDetail,
  CommitStats,
  DiffRequest,
  GraphFilters,
  GraphSnapshot,
  RepoGitConfig,
  RepoSpecialState,
  StashEntry,
  StashFile,
  UndoEntry,
  WorkingTreeStatus,
  WorktreeEntry
} from '../../core/models';
import type { GitRepository } from '../../core/ports/GitRepository';
import { EMPTY_TREE } from '../../shared/constants';
import { GitCache } from './GitCache';
import {
  parseBlameOutput,
  parseBranchList,
  parseCommitDetailHeader,
  parseCommitFiles,
  parseCommitLog,
  parseNumstatStats,
  parseWorkingTreeStatus,
  parseWorktreeList,
  parseWorktreeStatusV2
} from './GitParsers';

const execFileAsync = promisify(execFile);
const HASH_SEARCH_PATTERN = /^[0-9a-f]{4,40}$/i;

function escapePathSpec(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

function parseStashList(raw: string): StashEntry[] {
  if (!raw.trim()) {
    return [];
  }

  const entries: StashEntry[] = [];
  for (const record of raw.split('\x1e')) {
    const trimmed = record.trim();
    if (!trimmed) {
      continue;
    }

    const parts = trimmed.split('\x1f');
    if (parts.length < 3) {
      continue;
    }

    const ref = parts[0].trim();
    const subject = parts[1].trim();
    const date = parts[2].trim();

    const indexMatch = /stash@\{(\d+)\}/.exec(ref);
    const index = indexMatch ? Number.parseInt(indexMatch[1], 10) : 0;

    const branchMatch = /^(?:WIP on|On) ([^:]+):/.exec(subject);
    const branch = branchMatch ? branchMatch[1].trim() : '';

    entries.push({ index, ref, message: subject, branch, date, files: [] });
  }

  return entries;
}

function parseStashFiles(raw: string): StashFile[] {
  const parts = raw.split('\0').filter(Boolean);
  const files: StashFile[] = [];

  for (let index = 0; index < parts.length;) {
    const rawStatus = parts[index++]?.trim();
    if (!rawStatus) {
      continue;
    }

    const status = rawStatus.replaceAll(/\d+/g, '') || rawStatus;

    if (status.startsWith('R') || status.startsWith('C')) {
      const originalPath = parts[index++];
      const filePath = parts[index++];
      if (filePath) {
        files.push({ path: filePath, originalPath, status: status[0] });
      }
      continue;
    }

    const filePath = parts[index++];
    if (filePath) {
      files.push({ path: filePath, status: status[0] ?? status });
    }
  }

  return files;
}

function parseCompareCommits(raw: string): BranchCompareCommit[] {
  if (!raw.trim()) {
    return [];
  }

  return raw
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = '', authorName = '', authoredAt = '', subject = ''] = record.split('\x1f');
      return {
        hash,
        shortHash: hash.slice(0, 8),
        authorName,
        authoredAt,
        subject
      };
    })
    .filter((commit) => commit.hash.length > 0);
}

function parseNameStatusAndNumstat(nameStatusRaw: string, numstatRaw: string): BranchCompareFile[] {
  const files: BranchCompareFile[] = [];
  const numstatByPath = new Map<string, { additions: number; deletions: number }>();

  for (const line of numstatRaw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const [rawAdditions, rawDeletions, pathA, pathB] = trimmed.split('\t');
    const additions = rawAdditions === '-' ? 0 : Number.parseInt(rawAdditions ?? '0', 10);
    const deletions = rawDeletions === '-' ? 0 : Number.parseInt(rawDeletions ?? '0', 10);
    const key = pathB ?? pathA;
    if (key) {
      numstatByPath.set(key, { additions: Number.isFinite(additions) ? additions : 0, deletions: Number.isFinite(deletions) ? deletions : 0 });
    }
  }

  for (const line of nameStatusRaw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const [rawStatus, pathA, pathB] = trimmed.split('\t');
    if (!rawStatus || !pathA) {
      continue;
    }

    const status = rawStatus[0] ?? rawStatus;
    const finalPath = pathB ?? pathA;
    const stats = numstatByPath.get(finalPath) ?? { additions: 0, deletions: 0 };
    files.push({
      status,
      path: finalPath,
      originalPath: pathB ? pathA : undefined,
      additions: stats.additions,
      deletions: stats.deletions
    });
  }

  return files;
}

function parseUndoEntries(raw: string): UndoEntry[] {
  if (!raw.trim()) {
    return [];
  }

  return raw
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = '', ref = '', date = '', message = ''] = record.split('\x1f');
      return { hash, shortHash: hash.slice(0, 8), ref, date, message };
    })
    .filter((entry) => entry.hash.length > 0 && entry.ref.length > 0);
}

export class GitCliRepository implements GitRepository {
  private readonly graphCache = new GitCache<GraphSnapshot>(3_000);

  public constructor(
    private readonly output: vscode.OutputChannel,
    private readonly openDiffHandler: (request: DiffRequest) => Promise<void>
  ) { }

  public clearTransientCaches(): void {
    this.graphCache.clear();
  }

  public async resolveRepositoryRoot(preferredPath?: string): Promise<string> {
    const candidates = new Set<string>();

    if (preferredPath) {
      candidates.add(preferredPath);
    }

    for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
      candidates.add(workspaceFolder.uri.fsPath);
    }

    for (const candidate of candidates) {
      try {
        const output = await this.runGit(candidate, ['rev-parse', '--show-toplevel']);
        return output.trim();
      } catch {
        continue;
      }
    }

    throw new Error('Nenhum repositório Git foi encontrado no workspace atual.');
  }

  public async getGraph(filters: GraphFilters): Promise<GraphSnapshot> {
    const repoRoot = await this.resolveRepositoryRoot();
    const cacheKey = JSON.stringify({ repoRoot, filters });
    const cached = this.graphCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const branchesPromise = this.getBranches(repoRoot);
    const localChangesPromise = this.getLocalChanges(repoRoot);
    const search = filters.search?.trim();
    const isHashSearch = search ? HASH_SEARCH_PATTERN.test(search) : false;

    const logArgs = [
      'log',
      '--date=iso-strict',
      '--decorate=full',
      '--topo-order',
      `--max-count=${Math.max(filters.limit + 1, 201)}`,
      '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%D%x1e'
    ];

    if (filters.author) {
      logArgs.push(`--author=${filters.author}`);
    }

    if (search && !isHashSearch) {
      logArgs.push(`--grep=${search}`, '--regexp-ignore-case');
    }

    logArgs.push('--branches', '--tags');
    if (filters.includeRemotes) {
      logArgs.push('--remotes');
    }

    const [rawLog, branches, localChanges, repoConfig, rawWorktrees] = await Promise.all([
      isHashSearch ? this.getHashSearchLog(repoRoot, search ?? '', logArgs) : this.runGit(repoRoot, logArgs),
      branchesPromise,
      localChangesPromise,
      this.getRepoConfig(repoRoot),
      this.runGit(repoRoot, ['worktree', 'list', '--porcelain']).catch(() => '')
    ]);

    const worktreeHeads = parseWorktreeList(rawWorktrees)
      .filter((w) => !w.isMain)
      .map((w) => w.head);

    const authorSearch = filters.author?.trim().toLowerCase();
    const filteredCommits = parseCommitLog(rawLog, this.hasDirtyChanges(localChanges)).filter((commit) => {
      if (isHashSearch && authorSearch) {
        const authorMatches =
          commit.authorName.toLowerCase().includes(authorSearch) ||
          commit.authorEmail.toLowerCase().includes(authorSearch);
        if (!authorMatches) {
          return false;
        }
      }

      if (!search) {
        return true;
      }

      const normalizedSearch = search.toLowerCase();
      return (
        commit.hash.toLowerCase().includes(normalizedSearch) ||
        commit.subject.toLowerCase().includes(normalizedSearch) ||
        commit.authorName.toLowerCase().includes(normalizedSearch)
      );
    });

    const hasMore = filteredCommits.length > filters.limit;
    const slicedCommits = filteredCommits.slice(0, filters.limit);
    const graph = buildGraphRows(slicedCommits);

    const snapshot: GraphSnapshot = {
      repoRoot,
      generatedAt: new Date().toISOString(),
      rows: graph.rows,
      branches,
      localChanges,
      filters,
      hasMore,
      maxLane: graph.maxLane,
      repoConfig,
      worktreeHeads
    };

    this.graphCache.set(cacheKey, snapshot);
    return snapshot;
  }

  public async getCommitDetail(repoRoot: string, commitHash: string): Promise<CommitDetail> {
    const [headerRaw, numstatRaw, nameStatusRaw, localChanges] = await Promise.all([
      this.runGit(repoRoot, [
        'show',
        '--no-patch',
        '--date=iso-strict',
        '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%b%x1f%D',
        commitHash
      ]),
      this.runGit(repoRoot, ['show', '--format=', '--numstat', '--find-renames', '--find-copies', '--root', commitHash]),
      this.runGit(repoRoot, ['show', '--format=', '--name-status', '--find-renames', '--find-copies', '--root', commitHash]),
      this.getLocalChanges(repoRoot)
    ]);

    const detail = parseCommitDetailHeader(headerRaw, this.hasDirtyChanges(localChanges));
    detail.files = parseCommitFiles(numstatRaw, nameStatusRaw);
    detail.stats = detail.files.reduce(
      (accumulator, file) => ({
        additions: accumulator.additions + file.additions,
        deletions: accumulator.deletions + file.deletions,
        filesChanged: accumulator.filesChanged + 1
      }),
      {
        additions: 0,
        deletions: 0,
        filesChanged: 0
      }
    );

    return detail;
  }

  public async getBranches(repoRoot: string): Promise<BranchSummary[]> {
    const raw = await this.runGit(repoRoot, [
      'for-each-ref',
      '--format=%(refname)	%(objectname)	%(upstream:short)	%(HEAD)	%(upstream:track)',
      'refs/heads',
      'refs/remotes'
    ]);

    return parseBranchList(raw);
  }

  public async getLocalChanges(repoRoot: string): Promise<WorkingTreeStatus> {
    const [raw, rawGitDir] = await Promise.all([
      this.runGit(repoRoot, ['status', '--porcelain=2', '--branch', '--find-renames']),
      this.runGit(repoRoot, ['rev-parse', '--git-dir'])
    ]);

    const status = parseWorkingTreeStatus(raw);

    const gitDir = rawGitDir.trim();
    const resolvedGitDir = path.isAbsolute(gitDir) ? gitDir : path.join(repoRoot, gitDir);

    const exists = (p: string): Promise<boolean> =>
      fs.access(p).then(() => true, () => false);

    const [isMerging, isRebaseMerge, isRebaseApply, isCherryPicking, isReverting, isBisecting, fetchHeadStat] =
      await Promise.all([
        exists(path.join(resolvedGitDir, 'MERGE_HEAD')),
        exists(path.join(resolvedGitDir, 'rebase-merge')),
        exists(path.join(resolvedGitDir, 'rebase-apply')),
        exists(path.join(resolvedGitDir, 'CHERRY_PICK_HEAD')),
        exists(path.join(resolvedGitDir, 'REVERT_HEAD')),
        exists(path.join(resolvedGitDir, 'BISECT_LOG')),
        fs.stat(path.join(resolvedGitDir, 'FETCH_HEAD')).catch(() => null)
      ]);

    if (isMerging) {
      status.specialState = 'merging';
    } else if (isRebaseMerge || isRebaseApply) {
      status.specialState = 'rebasing';
    } else if (isCherryPicking) {
      status.specialState = 'cherry-picking';
    } else if (isReverting) {
      status.specialState = 'reverting';
    } else if (isBisecting) {
      status.specialState = 'bisecting';
    } else if (status.currentBranch === '(detached)') {
      status.specialState = 'detached';
    }

    if (fetchHeadStat) {
      status.lastFetchAt = fetchHeadStat.mtime.toISOString();
    }

    return status;
  }

  public async readBlobContent(repoRoot: string, ref: string, targetPath: string): Promise<string> {
    if (ref === 'WORKTREE') {
      const absolutePath = path.join(repoRoot, targetPath);
      return fs.readFile(absolutePath, 'utf8');
    }

    if (ref === EMPTY_TREE) {
      return '';
    }

    try {
      return await this.runGit(repoRoot, ['show', `${ref}:${escapePathSpec(targetPath)}`]);
    } catch (error) {
      this.output.appendLine(`[readBlob] ${ref}:${targetPath} — ${error instanceof Error ? error.message : String(error)}`);
      return '';
    }
  }

  public async stageFile(repoRoot: string, targetPath: string): Promise<void> {
    await this.runGit(repoRoot, ['add', '--', targetPath]);
    this.graphCache.clear();
  }

  public async unstageFile(repoRoot: string, targetPath: string): Promise<void> {
    await this.runGit(repoRoot, ['restore', '--staged', '--', targetPath]);
    this.graphCache.clear();
  }

  public async discardFile(repoRoot: string, targetPath: string, tracked: boolean, stagedAddition = false): Promise<void> {
    if (stagedAddition) {
      await this.runGit(repoRoot, ['rm', '--force', '--', targetPath]);
    } else if (tracked) {
      await this.runGit(repoRoot, ['restore', '--source=HEAD', '--staged', '--worktree', '--', targetPath]);
    } else {
      await this.runGit(repoRoot, ['clean', '-fd', '--', targetPath]);
    }

    this.graphCache.clear();
  }

  public async commit(repoRoot: string, message: string, amend = false): Promise<void> {
    const args: string[] = ['commit'];
    if (amend) {
      args.push('--amend');
    }
    args.push('-m', message);
    await this.runGit(repoRoot, args);
    this.graphCache.clear();
  }

  public async createBranch(repoRoot: string, name: string, fromRef?: string): Promise<void> {
    if (fromRef) {
      // Determine whether the requested fromRef exists as a remote branch
      // (refs/remotes/...). Relying on the presence of '/' is incorrect
      // because local branch names commonly contain slashes.
      let isRemoteRef = false;
      try {
        await this.runGit(repoRoot, ['show-ref', '--verify', '--quiet', `refs/remotes/${fromRef}`]);
        isRemoteRef = true;
      } catch {
        isRemoteRef = false;
      }

      let createError: unknown;
      try {
        if (isRemoteRef) {
          await this.runGit(repoRoot, ['checkout', '--track', '-b', name, fromRef]);
        } else {
          await this.runGit(repoRoot, ['checkout', '-b', name, fromRef]);
        }
      } catch (error) {
        createError = error;
        // If creation fails (e.g. branch already exists) attempt to
        // checkout the existing branch so the user ends up on it.
        try {
          await this.runGit(repoRoot, ['checkout', name]);
        } catch {
          const message = createError instanceof Error ? createError.message : String(createError);
          throw new Error(message);
        }
      }
    } else {
      await this.runGit(repoRoot, ['checkout', '-b', name]);
    }

    this.graphCache.clear();
  }

  public async deleteBranch(repoRoot: string, name: string, force = false): Promise<void> {
    await this.runGit(repoRoot, ['branch', force ? '-D' : '-d', name]);
    this.graphCache.clear();
  }

  public async deleteRemoteBranch(repoRoot: string, remote: string, name: string): Promise<void> {
    await this.runGit(repoRoot, ['push', remote, '--delete', name]);
    this.graphCache.clear();
  }

  public async checkout(repoRoot: string, ref: string): Promise<void> {
    const remoteBranch = this.parseRemoteBranchRef(ref);
    if (remoteBranch) {
      await this.checkoutRemoteBranch(repoRoot, remoteBranch.remoteRef, remoteBranch.localName);
      this.graphCache.clear();
      return;
    }

    await this.runGit(repoRoot, ['checkout', ref]);
    this.graphCache.clear();
  }

  public async merge(repoRoot: string, sourceBranch: string): Promise<void> {
    const source = sourceBranch?.trim();
    if (!source) {
      throw new Error('Invalid branch specified for merge.');
    }

    // Remove a stray trailing dot separated by whitespace (e.g. "teste .")
    // but keep legitimate dots inside branch names (e.g. "v1.0").
    const sanitized = source.replace(/\s+\.$/, '');

    if (sanitized === '' || sanitized === '.') {
      throw new Error('Invalid branch specified for merge.');
    }

    await this.runGit(repoRoot, ['merge', sanitized]);
    this.graphCache.clear();
  }

  public async fetch(repoRoot: string, options?: { quiet?: boolean }): Promise<void> {
    const args = ['fetch', '--all', '--prune'];
    if (options?.quiet) {
      args.push('--quiet');
    }
    await this.runGit(repoRoot, args, { logCommand: options?.quiet !== true });
    this.graphCache.clear();
  }

  public async pull(repoRoot: string): Promise<void> {
    await this.runGit(repoRoot, ['pull']);
    this.graphCache.clear();
  }

  public async push(repoRoot: string): Promise<void> {
    await this.runGit(repoRoot, ['push']);
    this.graphCache.clear();
  }

  public async cherryPick(repoRoot: string, commitHash: string): Promise<void> {
    await this.runGit(repoRoot, ['cherry-pick', commitHash]);
    this.graphCache.clear();
  }

  public async revert(repoRoot: string, commitHash: string): Promise<void> {
    await this.runGit(repoRoot, ['revert', '--no-edit', commitHash]);
    this.graphCache.clear();
  }

  public async dropCommit(repoRoot: string, commitHash: string): Promise<void> {
    await this.runGit(repoRoot, ['rebase', '--onto', `${commitHash}^`, commitHash]);
    this.graphCache.clear();
  }

  public async compareBranches(repoRoot: string, baseRef: string, targetRef: string): Promise<BranchCompareResult> {
    const [countsRaw, commitsAheadRaw, commitsBehindRaw, nameStatusRaw, numstatRaw] = await Promise.all([
      this.runGit(repoRoot, ['rev-list', '--left-right', '--count', `${baseRef}...${targetRef}`]),
      this.runGit(repoRoot, ['log', '--date=iso-strict', '--format=%H%x1f%an%x1f%ad%x1f%s%x1e', `${baseRef}..${targetRef}`]),
      this.runGit(repoRoot, ['log', '--date=iso-strict', '--format=%H%x1f%an%x1f%ad%x1f%s%x1e', `${targetRef}..${baseRef}`]),
      this.runGit(repoRoot, ['diff', '--name-status', '--find-renames', '--find-copies', `${baseRef}...${targetRef}`]),
      this.runGit(repoRoot, ['diff', '--numstat', '--find-renames', '--find-copies', `${baseRef}...${targetRef}`])
    ]);

    const [behindRaw = '0', aheadRaw = '0'] = countsRaw.trim().split(/\s+/);
    return {
      baseRef,
      targetRef,
      ahead: Number.parseInt(aheadRaw, 10) || 0,
      behind: Number.parseInt(behindRaw, 10) || 0,
      commitsAhead: parseCompareCommits(commitsAheadRaw),
      commitsBehind: parseCompareCommits(commitsBehindRaw),
      files: parseNameStatusAndNumstat(nameStatusRaw, numstatRaw)
    };
  }

  public async listUndoEntries(repoRoot: string): Promise<UndoEntry[]> {
    const raw = await this.runGit(repoRoot, [
      'reflog',
      '-n',
      '25',
      '--date=iso-strict',
      '--format=%H%x1f%gd%x1f%cd%x1f%gs%x1e'
    ]).catch(() => '');

    // Skip HEAD@{0}: it's the current position, not an undo target.
    return parseUndoEntries(raw).filter((entry) => entry.ref !== 'HEAD@{0}');
  }

  public async undoTo(repoRoot: string, ref: string): Promise<void> {
    await this.runGit(repoRoot, ['reset', '--hard', ref]);
    this.graphCache.clear();
  }

  public async rebase(repoRoot: string, onto: string): Promise<void> {
    await this.runGit(repoRoot, ['rebase', onto]);
    this.graphCache.clear();
  }

  public async resetTo(repoRoot: string, commitHash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    await this.runGit(repoRoot, ['reset', `--${mode}`, commitHash]);
    this.graphCache.clear();
  }

  public async openDiff(request: DiffRequest): Promise<void> {
    await this.openDiffHandler(request);
  }

  public async getRepoConfig(repoRoot: string): Promise<RepoGitConfig> {
    const [userName, userEmail, remoteRaw] = await Promise.all([
      this.runGit(repoRoot, ['config', '--get', 'user.name']).catch(() => ''),
      this.runGit(repoRoot, ['config', '--get', 'user.email']).catch(() => ''),
      this.runGit(repoRoot, ['remote', '-v']).catch(() => '')
    ]);

    const seenRemotes = new Set<string>();
    const remotes: RepoGitConfig['remotes'] = [];
    for (const line of remoteRaw.split('\n')) {
      const match = /^(\S+)\s+(\S+)\s+\(fetch\)/.exec(line);
      if (match && !seenRemotes.has(match[1])) {
        seenRemotes.add(match[1]);
        remotes.push({ name: match[1], url: match[2] });
      }
    }

    return { userName: userName.trim(), userEmail: userEmail.trim(), remotes };
  }

  public async setGitUserName(repoRoot: string, name: string): Promise<void> {
    await this.runGit(repoRoot, ['config', 'user.name', name]);
    this.graphCache.clear();
  }

  public async setGitUserEmail(repoRoot: string, email: string): Promise<void> {
    await this.runGit(repoRoot, ['config', 'user.email', email]);
    this.graphCache.clear();
  }

  public async setRemoteUrl(repoRoot: string, remoteName: string, url: string): Promise<void> {
    await this.runGit(repoRoot, ['remote', 'set-url', remoteName, url]);
    this.graphCache.clear();
  }

  public async listStashes(repoRoot: string): Promise<StashEntry[]> {
    const raw = await this.runGit(repoRoot, [
      'stash', 'list',
      '--format=%gd\x1f%s\x1f%ci\x1e'
    ]).catch(() => '');

    const entries = parseStashList(raw);
    return Promise.all(entries.map(async (entry) => ({
      ...entry,
      files: await this.listStashFiles(repoRoot, entry.ref).catch(() => [])
    })));
  }

  public async stashChanges(repoRoot: string, message?: string, includeUntracked = false, paths?: string[]): Promise<void> {
    const args = ['stash', 'push'];
    const selectedPaths = this.normalizePathList(paths);

    if (includeUntracked) args.push('--include-untracked');
    if (message?.trim()) args.push('-m', message.trim());
    if (selectedPaths.length > 0) {
      args.push('--', ...selectedPaths);
    }
    await this.runGit(repoRoot, args);
    this.graphCache.clear();
  }

  public async applyStash(repoRoot: string, ref: string, paths?: string[]): Promise<void> {
    const selectedPaths = this.normalizePathList(paths);
    if (selectedPaths.length === 0) {
      await this.runGit(repoRoot, ['stash', 'apply', ref]);
      this.graphCache.clear();
      return;
    }

    const files = await this.listStashFiles(repoRoot, ref).catch(() => []);
    await this.restoreStashPaths(repoRoot, ref, selectedPaths, files);
    this.graphCache.clear();
  }

  public async popStash(repoRoot: string, ref: string, paths?: string[]): Promise<void> {
    const selectedPaths = this.normalizePathList(paths);
    if (selectedPaths.length === 0) {
      await this.runGit(repoRoot, ['stash', 'pop', ref]);
      this.graphCache.clear();
      return;
    }

    const files = await this.listStashFiles(repoRoot, ref).catch(() => []);
    await this.restoreStashPaths(repoRoot, ref, selectedPaths, files);

    const allPaths = new Set(files.map((file) => escapePathSpec(file.path)));
    const selectedAllPaths = allPaths.size > 0 && selectedPaths.length >= allPaths.size && selectedPaths.every((filePath) => allPaths.has(filePath));
    if (selectedAllPaths) {
      await this.runGit(repoRoot, ['stash', 'drop', ref]);
    }

    this.graphCache.clear();
  }

  public async dropStash(repoRoot: string, ref: string): Promise<void> {
    await this.runGit(repoRoot, ['stash', 'drop', ref]);
    this.graphCache.clear();
  }

  public async previewStash(repoRoot: string, ref: string): Promise<void> {
    const files = await this.listStashFiles(repoRoot, ref);
    if (files.length === 0) {
      throw new Error(`No files found in ${ref}.`);
    }

    const picks = [
      { label: '$(files) Open all files', description: `${files.length} file(s)`, path: '__ALL__' },
      ...files.map((file) => ({
        label: file.path,
        description: `${file.status}${file.originalPath ? ` from ${file.originalPath}` : ''}`,
        path: file.path
      }))
    ];

    const selection = await vscode.window.showQuickPick(picks, {
      title: `Preview ${ref}`,
      placeHolder: 'Choose a file to open in native diff'
    });
    if (!selection) {
      return;
    }

    if (selection.path === '__ALL__') {
      for (const file of files) {
        await this.openStashFileDiff(repoRoot, ref, file);
      }
      return;
    }

    const selectedFile = files.find((file) => file.path === selection.path);
    if (!selectedFile) {
      return;
    }

    await this.openStashFileDiff(repoRoot, ref, selectedFile);
  }

  public async getBlame(repoRoot: string, relativeFilePath: string): Promise<BlameEntry[]> {
    const raw = await this.runGit(repoRoot, [
      'blame',
      '--porcelain',
      '--',
      relativeFilePath
    ]);
    return parseBlameOutput(raw);
  }

  public async getCommitStats(repoRoot: string, commitHash: string): Promise<CommitStats> {
    const raw = await this.runGit(repoRoot, [
      'show',
      '--format=',
      '--numstat',
      commitHash
    ]);
    return parseNumstatStats(raw);
  }

  public async resolveHeadHash(repoRoot: string): Promise<string> {
    const raw = await this.runGit(repoRoot, ['rev-parse', 'HEAD']);
    return raw.trim();
  }

  public async listWorktrees(repoRoot: string): Promise<WorktreeEntry[]> {
    const raw = await this.runGit(repoRoot, ['worktree', 'list', '--porcelain']);
    const entries = parseWorktreeList(raw);
    // Enrich each worktree with live status (dirty counts, ahead/behind).
    const enriched = await Promise.all(
      entries.map(async (entry) => {
        try {
          const statusRaw = await this.runGit(entry.path, ['status', '--porcelain=v2', '--branch']);
          return { ...entry, ...parseWorktreeStatusV2(statusRaw) };
        } catch {
          return entry; // inaccessible / bare worktree — leave defaults
        }
      })
    );
    return enriched;
  }

  public async addWorktree(repoRoot: string, worktreePath: string, branch: string, createNew: boolean): Promise<void> {
    const args = ['worktree', 'add'];
    if (createNew) {
      args.push('-b', branch);
    }
    args.push(worktreePath);
    if (!createNew) {
      args.push(branch);
    }
    await this.runGit(repoRoot, args);
    this.graphCache.clear();
  }

  public async removeWorktree(repoRoot: string, worktreePath: string, force = false): Promise<void> {
    const args = ['worktree', 'remove'];
    if (force) {
      args.push('--force');
    }
    args.push(worktreePath);
    await this.runGit(repoRoot, args);
    this.graphCache.clear();
  }

  public async pruneWorktrees(repoRoot: string): Promise<void> {
    await this.runGit(repoRoot, ['worktree', 'prune']);
  }

  public async lockWorktree(repoRoot: string, worktreePath: string): Promise<void> {
    await this.runGit(repoRoot, ['worktree', 'lock', worktreePath]);
  }

  public async unlockWorktree(repoRoot: string, worktreePath: string): Promise<void> {
    await this.runGit(repoRoot, ['worktree', 'unlock', worktreePath]);
  }

  public async moveWorktree(repoRoot: string, worktreePath: string, newPath: string): Promise<void> {
    await this.runGit(repoRoot, ['worktree', 'move', worktreePath, newPath]);
    this.graphCache.clear();
  }

  public async addWorktreeAtCommit(repoRoot: string, worktreePath: string, commitHash: string): Promise<void> {
    await this.runGit(repoRoot, ['worktree', 'add', '--detach', worktreePath, commitHash]);
    this.graphCache.clear();
  }

  public async continueOperation(repoRoot: string, state: RepoSpecialState): Promise<void> {
    switch (state) {
      case 'merging':
        await this.runGit(repoRoot, ['merge', '--continue', '--no-edit']);
        break;
      case 'rebasing':
        await this.runGit(repoRoot, ['rebase', '--continue']);
        break;
      case 'cherry-picking':
        await this.runGit(repoRoot, ['cherry-pick', '--continue', '--no-edit']);
        break;
      case 'reverting':
        await this.runGit(repoRoot, ['revert', '--continue', '--no-edit']);
        break;
      default:
        break;
    }
    this.graphCache.clear();
  }

  public async abortOperation(repoRoot: string, state: RepoSpecialState): Promise<void> {
    switch (state) {
      case 'merging':
        await this.runGit(repoRoot, ['merge', '--abort']);
        break;
      case 'rebasing':
        await this.runGit(repoRoot, ['rebase', '--abort']);
        break;
      case 'cherry-picking':
        await this.runGit(repoRoot, ['cherry-pick', '--abort']);
        break;
      case 'reverting':
        await this.runGit(repoRoot, ['revert', '--abort']);
        break;
      case 'bisecting':
        await this.runGit(repoRoot, ['bisect', 'reset']);
        break;
      default:
        break;
    }
    this.graphCache.clear();
  }

  public async skipRebaseOperation(repoRoot: string): Promise<void> {
    await this.runGit(repoRoot, ['rebase', '--skip']);
    this.graphCache.clear();
  }

  // openFile is primarily handled on the extension host side via GitGraphViewProvider.
  // Provide a best-effort fallback here so the method is not an empty stub and
  // callers that invoke the port directly still get a sensible behavior.
  public async openFile(repoRoot: string, filePath: string): Promise<void> {
    try {
      const fullPath = path.join(repoRoot, filePath);
      const doc = await vscode.workspace.openTextDocument(fullPath);
      await vscode.window.showTextDocument(doc, { preserveFocus: false, preview: false });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[openFile] Failed to open ${repoRoot}/${filePath}: ${msg}`);
    }
  }

  private async listStashFiles(repoRoot: string, ref: string): Promise<StashFile[]> {
    const raw = await this.runGit(repoRoot, [
      'stash',
      'show',
      '--include-untracked',
      '--name-status',
      '--find-renames',
      '--find-copies',
      '-z',
      ref
    ], { logErrors: false }).catch(() => '');

    return parseStashFiles(raw);
  }

  private async restoreStashPaths(repoRoot: string, ref: string, paths: string[], files: StashFile[]): Promise<void> {
    const fileByPath = new Map(files.map((file) => [escapePathSpec(file.path), file]));
    const expandedPaths = new Set(paths);
    for (const filePath of paths) {
      const originalPath = fileByPath.get(filePath)?.originalPath;
      if (originalPath) {
        expandedPaths.add(escapePathSpec(originalPath));
      }
    }

    for (const filePath of expandedPaths) {
      const sources = [ref, `${ref}^3`];
      let lastError: unknown;

      for (const source of sources) {
        try {
          await this.runGit(repoRoot, ['restore', '--source', source, '--worktree', '--', filePath], { logErrors: false });
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (lastError) {
        throw lastError;
      }
    }
  }

  private async openStashFileDiff(repoRoot: string, ref: string, file: StashFile): Promise<void> {
    const leftPath = file.originalPath ?? file.path;
    const parentRef = `${ref}^1`;
    await this.openDiffHandler({
      repoRoot,
      commitHash: ref,
      parentHash: parentRef,
      filePath: file.path,
      originalPath: leftPath
    });
  }

  private normalizePathList(paths?: string[]): string[] {
    const normalized = new Set<string>();
    for (const filePath of paths ?? []) {
      const cleanPath = escapePathSpec(filePath);
      if (cleanPath.trim()) {
        normalized.add(cleanPath);
      }
    }
    return [...normalized];
  }

  private hasDirtyChanges(localChanges: WorkingTreeStatus): boolean {
    return localChanges.staged.length + localChanges.unstaged.length + localChanges.conflicted.length > 0;
  }

  private async getHashSearchLog(repoRoot: string, query: string, fallbackLogArgs: string[]): Promise<string> {
    const rawCommit = await this.runGit(repoRoot, [
      'show',
      '--no-patch',
      '--date=iso-strict',
      '--decorate=full',
      '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%D%x1e',
      `${query}^{commit}`
    ], { logErrors: false }).catch(() => '');

    return rawCommit || this.runGit(repoRoot, fallbackLogArgs);
  }

  private parseRemoteBranchRef(ref: string): { remoteRef: string; localName: string } | undefined {
    const prefix = 'refs/remotes/';
    if (!ref.startsWith(prefix)) {
      return undefined;
    }

    const remoteRef = ref.slice(prefix.length);
    const slashIndex = remoteRef.indexOf('/');
    if (slashIndex === -1 || slashIndex === remoteRef.length - 1) {
      return undefined;
    }

    return {
      remoteRef,
      localName: remoteRef.slice(slashIndex + 1)
    };
  }

  private async checkoutRemoteBranch(repoRoot: string, remoteRef: string, localName: string): Promise<void> {
    const localRef = `refs/heads/${localName}`;
    const localExists = await this.runGit(repoRoot, ['show-ref', '--verify', '--quiet', localRef], { logErrors: false })
      .then(() => true, () => false);

    if (!localExists) {
      await this.runGit(repoRoot, ['checkout', '--track', '-b', localName, `refs/remotes/${remoteRef}`]);
      return;
    }

    const upstream = await this.runGit(repoRoot, ['rev-parse', '--abbrev-ref', `${localName}@{upstream}`], { logErrors: false })
      .then((raw) => raw.trim(), () => '');

    if (upstream !== remoteRef) {
      throw new Error(`Local branch '${localName}' already exists and does not track '${remoteRef}'.`);
    }

    await this.runGit(repoRoot, ['checkout', localName]);
  }

  private async runGit(repoRoot: string, args: string[], options?: { logErrors?: boolean; logCommand?: boolean }): Promise<string> {
    if (options?.logCommand !== false) {
      this.output.appendLine(`git -C ${repoRoot} ${args.join(' ')}`);
    }

    try {
      const result = await execFileAsync('git', ['-C', repoRoot, ...args], {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024
      });

      return result.stdout.trimEnd();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options?.logErrors !== false) {
        this.output.appendLine(`[error] ${message}`);
      }
      throw new Error(message);
    }
  }
}

