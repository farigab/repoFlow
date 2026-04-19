export interface GitHistoryPort {
  cherryPick(repoRoot: string, commitHash: string): Promise<void>;
  revert(repoRoot: string, commitHash: string): Promise<void>;
  dropCommit(repoRoot: string, commitHash: string): Promise<void>;
}
