export interface GitBranchPort {
  createBranch(repoRoot: string, name: string, fromRef?: string): Promise<void>;
  deleteBranch(repoRoot: string, name: string, force?: boolean): Promise<void>;
  deleteRemoteBranch(repoRoot: string, remote: string, name: string): Promise<void>;
  checkout(repoRoot: string, ref: string): Promise<void>;
  merge(repoRoot: string, sourceBranch: string): Promise<void>;
  rebase(repoRoot: string, onto: string): Promise<void>;
}
