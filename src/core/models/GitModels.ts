export type GitRefType = 'head' | 'localBranch' | 'remoteBranch' | 'tag';

export interface GitRef {
  name: string;
  type: GitRefType;
}

export interface CommitSummary {
  hash: string;
  shortHash: string;
  parentHashes: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  subject: string;
  refs: GitRef[];
  isHead: boolean;
  isDirtyHead: boolean;
}

export interface CommitFileChange {
  path: string;
  originalPath?: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface CommitDetail extends CommitSummary {
  body: string;
  stats: {
    additions: number;
    deletions: number;
    filesChanged: number;
  };
  files: CommitFileChange[];
}

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

export interface BranchSummary {
  name: string;
  shortName: string;
  remote: boolean;
  current: boolean;
  targetHash: string;
  upstream?: string;
  tracking?: string;
}

export interface WorkingTreeFile {
  path: string;
  originalPath?: string;
  indexStatus: string;
  workTreeStatus: string;
  conflicted: boolean;
}

export interface WorkingTreeStatus {
  currentBranch?: string;
  ahead: number;
  behind: number;
  staged: WorkingTreeFile[];
  unstaged: WorkingTreeFile[];
  conflicted: WorkingTreeFile[];
}

export interface GraphFilters {
  author?: string;
  search?: string;
  includeRemotes: boolean;
  limit: number;
}

export interface RepoRemote {
  name: string;
  url: string;
}

export interface RepoGitConfig {
  userName: string;
  userEmail: string;
  remotes: RepoRemote[];
}

export interface GraphSnapshot {
  repoRoot: string;
  generatedAt: string;
  rows: GraphRow[];
  branches: BranchSummary[];
  localChanges: WorkingTreeStatus;
  filters: GraphFilters;
  hasMore: boolean;
  maxLane: number;
  repoConfig: RepoGitConfig;
}

export interface DiffRequest {
  repoRoot: string;
  commitHash: string;
  parentHash?: string;
  filePath: string;
  originalPath?: string;
}
