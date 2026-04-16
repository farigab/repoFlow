import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { buildGraphRows } from '../../application/graph/buildGraphRows';
import type {
  BlameEntry,
  BranchSummary,
  CommitDetail,
  CommitStats,
  DiffRequest,
  GraphFilters,
  GraphSnapshot,
  RepoGitConfig,
  StashEntry,
  WorkingTreeStatus
} from '../../core/models/GitModels';
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
  parseWorkingTreeStatus
} from './GitParsers';

const execFileAsync = promisify(execFile);

function escapePathSpec(filePath: string): string {
  return filePath.replace(/\\/g, '/');
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
    const index = indexMatch ? parseInt(indexMatch[1], 10) : 0;

    const branchMatch = /^(?:WIP on|On) ([^:]+):/.exec(subject);
    const branch = branchMatch ? branchMatch[1].trim() : '';

    entries.push({ index, ref, message: subject, branch, date });
  }

  return entries;
}

export class GitCliRepository implements GitRepository {
  private readonly graphCache = new GitCache<GraphSnapshot>(3_000);

  public constructor(
    private readonly output: vscode.OutputChannel,
    private readonly openDiffHandler: (request: DiffRequest) => Promise<void>
  ) { }

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

    if (filters.search && !/^[0-9a-f]{4,40}$/i.test(filters.search)) {
      logArgs.push(`--grep=${filters.search}`, '--regexp-ignore-case');
    }

    logArgs.push('--branches', '--tags');
    if (filters.includeRemotes) {
      logArgs.push('--remotes');
    }

    const [rawLog, branches, localChanges, repoConfig] = await Promise.all([
      this.runGit(repoRoot, logArgs),
      branchesPromise,
      localChangesPromise,
      this.getRepoConfig(repoRoot)
    ]);

    const filteredCommits = parseCommitLog(rawLog, this.hasDirtyChanges(localChanges)).filter((commit) => {
      if (!filters.search) {
        return true;
      }

      const search = filters.search.toLowerCase();
      return (
        commit.hash.toLowerCase().includes(search) ||
        commit.subject.toLowerCase().includes(search) ||
        commit.authorName.toLowerCase().includes(search)
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
      repoConfig
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
      '--format=%(refname)	%(objectname)	%(upstream:short)	%(HEAD)	%(upstream:trackshort)',
      'refs/heads',
      'refs/remotes'
    ]);

    return parseBranchList(raw);
  }

  public async getLocalChanges(repoRoot: string): Promise<WorkingTreeStatus> {
    const raw = await this.runGit(repoRoot, ['status', '--porcelain=2', '--branch', '--find-renames']);
    return parseWorkingTreeStatus(raw);
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

  public async discardFile(repoRoot: string, targetPath: string, tracked: boolean): Promise<void> {
    if (tracked) {
      await this.runGit(repoRoot, ['restore', '--source=HEAD', '--staged', '--worktree', '--', targetPath]);
    } else {
      await this.runGit(repoRoot, ['clean', '-fd', '--', targetPath]);
    }

    this.graphCache.clear();
  }

  public async commit(repoRoot: string, message: string): Promise<void> {
    await this.runGit(repoRoot, ['commit', '-m', message]);
    this.graphCache.clear();
  }

  public async createBranch(repoRoot: string, name: string, fromRef?: string): Promise<void> {
    const args = ['branch', name];
    if (fromRef) {
      args.push(fromRef);
    }

    await this.runGit(repoRoot, args);
    this.graphCache.clear();
  }

  public async deleteBranch(repoRoot: string, name: string): Promise<void> {
    await this.runGit(repoRoot, ['branch', '-d', name]);
    this.graphCache.clear();
  }

  public async checkout(repoRoot: string, ref: string): Promise<void> {
    await this.runGit(repoRoot, ['checkout', ref]);
    this.graphCache.clear();
  }

  public async merge(repoRoot: string, sourceBranch: string): Promise<void> {
    await this.runGit(repoRoot, ['merge', sourceBranch]);
    this.graphCache.clear();
  }

  public async fetch(repoRoot: string): Promise<void> {
    await this.runGit(repoRoot, ['fetch', '--all', '--prune']);
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

    return parseStashList(raw);
  }

  public async stashChanges(repoRoot: string, message?: string, includeUntracked = false): Promise<void> {
    const args = ['stash', 'push'];
    if (includeUntracked) {
      args.push('--include-untracked');
    }

    if (message?.trim()) {
      args.push('-m', message.trim());
    }

    await this.runGit(repoRoot, args);
    this.graphCache.clear();
  }

  public async applyStash(repoRoot: string, ref: string): Promise<void> {
    await this.runGit(repoRoot, ['stash', 'apply', ref]);
    this.graphCache.clear();
  }

  public async popStash(repoRoot: string, ref: string): Promise<void> {
    await this.runGit(repoRoot, ['stash', 'pop', ref]);
    this.graphCache.clear();
  }

  public async dropStash(repoRoot: string, ref: string): Promise<void> {
    await this.runGit(repoRoot, ['stash', 'drop', ref]);
    this.graphCache.clear();
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

  private hasDirtyChanges(localChanges: WorkingTreeStatus): boolean {
    return localChanges.staged.length + localChanges.unstaged.length + localChanges.conflicted.length > 0;
  }

  private async runGit(repoRoot: string, args: string[]): Promise<string> {
    this.output.appendLine(`git -C ${repoRoot} ${args.join(' ')}`);

    try {
      const result = await execFileAsync('git', ['-C', repoRoot, ...args], {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024
      });

      return result.stdout.trimEnd();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[error] ${message}`);
      throw new Error(message);
    }
  }
}
