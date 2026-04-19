import type {
  BlameEntry,
  BranchSummary,
  CommitDetail,
  CommitStats,
  GraphFilters,
  GraphSnapshot,
  RepoGitConfig,
  StashEntry,
  WorkingTreeStatus,
  WorktreeEntry,
} from '../models';

export interface GitQueryPort {
  resolveRepositoryRoot(preferredPath?: string): Promise<string>;
  getGraph(filters: GraphFilters): Promise<GraphSnapshot>;
  getCommitDetail(repoRoot: string, commitHash: string): Promise<CommitDetail>;
  getBranches(repoRoot: string): Promise<BranchSummary[]>;
  getLocalChanges(repoRoot: string): Promise<WorkingTreeStatus>;
  readBlobContent(repoRoot: string, ref: string, path: string): Promise<string>;
  getRepoConfig(repoRoot: string): Promise<RepoGitConfig>;
  listStashes(repoRoot: string): Promise<StashEntry[]>;
  getBlame(repoRoot: string, relativeFilePath: string): Promise<BlameEntry[]>;
  getCommitStats(repoRoot: string, commitHash: string): Promise<CommitStats>;
  resolveHeadHash(repoRoot: string): Promise<string>;
  listWorktrees(repoRoot: string): Promise<WorktreeEntry[]>;
}
