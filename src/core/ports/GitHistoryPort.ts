import type { BranchCompareResult, UndoEntry } from '../models';

export interface GitHistoryPort {
  cherryPick(repoRoot: string, commitHash: string): Promise<void>;
  revert(repoRoot: string, commitHash: string): Promise<void>;
  dropCommit(repoRoot: string, commitHash: string): Promise<void>;
  compareBranches(repoRoot: string, baseRef: string, targetRef: string): Promise<BranchCompareResult>;
  listUndoEntries(repoRoot: string): Promise<UndoEntry[]>;
  undoTo(repoRoot: string, ref: string): Promise<void>;
}
