export interface GitWorktreePort {
  addWorktree(repoRoot: string, worktreePath: string, branch: string, createNew: boolean): Promise<void>;
  addWorktreeAtCommit(repoRoot: string, worktreePath: string, commitHash: string): Promise<void>;
  removeWorktree(repoRoot: string, worktreePath: string, force?: boolean): Promise<void>;
  pruneWorktrees(repoRoot: string): Promise<void>;
  lockWorktree(repoRoot: string, worktreePath: string): Promise<void>;
  unlockWorktree(repoRoot: string, worktreePath: string): Promise<void>;
  moveWorktree(repoRoot: string, worktreePath: string, newPath: string): Promise<void>;
}
