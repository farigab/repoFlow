import type {
    BranchSummary,
    CommitDetail,
    DiffRequest,
    GraphFilters,
    GraphSnapshot,
    WorkingTreeStatus
} from '../models/GitModels';

export interface GitRepository {
  resolveRepositoryRoot(preferredPath?: string): Promise<string>;
  getGraph(filters: GraphFilters): Promise<GraphSnapshot>;
  getCommitDetail(repoRoot: string, commitHash: string): Promise<CommitDetail>;
  getBranches(repoRoot: string): Promise<BranchSummary[]>;
  getLocalChanges(repoRoot: string): Promise<WorkingTreeStatus>;
  readBlobContent(repoRoot: string, ref: string, path: string): Promise<string>;
  stageFile(repoRoot: string, path: string): Promise<void>;
  unstageFile(repoRoot: string, path: string): Promise<void>;
  discardFile(repoRoot: string, path: string, tracked: boolean): Promise<void>;
  commit(repoRoot: string, message: string): Promise<void>;
  createBranch(repoRoot: string, name: string, fromRef?: string): Promise<void>;
  deleteBranch(repoRoot: string, name: string): Promise<void>;
  checkout(repoRoot: string, ref: string): Promise<void>;
  merge(repoRoot: string, sourceBranch: string): Promise<void>;
  fetch(repoRoot: string): Promise<void>;
  pull(repoRoot: string): Promise<void>;
  push(repoRoot: string): Promise<void>;
  cherryPick(repoRoot: string, commitHash: string): Promise<void>;
  openDiff(request: DiffRequest): Promise<void>;
}
