export interface GitStashPort {
  stashChanges(repoRoot: string, message?: string, includeUntracked?: boolean, paths?: string[]): Promise<void>;
  applyStash(repoRoot: string, ref: string, paths?: string[]): Promise<void>;
  popStash(repoRoot: string, ref: string, paths?: string[]): Promise<void>;
  dropStash(repoRoot: string, ref: string): Promise<void>;
}
