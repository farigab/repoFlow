export interface GitStagingPort {
  stageFile(repoRoot: string, path: string): Promise<void>;
  unstageFile(repoRoot: string, path: string): Promise<void>;
  discardFile(repoRoot: string, path: string, tracked: boolean, stagedAddition?: boolean): Promise<void>;
  commit(repoRoot: string, message: string, amend?: boolean): Promise<void>;
  resetTo(repoRoot: string, commitHash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void>;
}
