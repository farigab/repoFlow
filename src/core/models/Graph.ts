import type { BranchSummary } from './Branch';
import type { CommitSummary } from './Commit';
import type { RepoGitConfig } from './Repository';
import type { WorkingTreeStatus } from './WorkingTree';

export interface GraphParentConnection {
  parentHash: string;
  lane: number;
}

export interface GraphRow {
  row: number;
  lane: number;
  connections: GraphParentConnection[];
  commit: CommitSummary;
}

export interface GraphFilters {
  author?: string;
  search?: string;
  includeRemotes: boolean;
  limit: number;
}

export interface GraphSnapshot {
  repoRoot: string;
  generatedAt: string;
  rows: GraphRow[];
  branches: BranchSummary[];
  /** HEAD commit hashes of all linked (non-main) worktrees. */
  worktreeHeads: string[];
  localChanges: WorkingTreeStatus;
  filters: GraphFilters;
  hasMore: boolean;
  maxLane: number;
  repoConfig: RepoGitConfig;
}
