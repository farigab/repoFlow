export interface GitStagingPort {
  stageFile(repoRoot: string, path: string): Promise<void>;
  unstageFile(repoRoot: string, path: string): Promise<void>;
  discardFile(repoRoot: string, path: string, tracked: boolean): Promise<void>;
  commit(repoRoot: string, message: string): Promise<void>;
  resetTo(repoRoot: string, commitHash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void>;
}
