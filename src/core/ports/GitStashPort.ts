export interface GitStashPort {
  stashChanges(repoRoot: string, message?: string, includeUntracked?: boolean): Promise<void>;
  applyStash(repoRoot: string, ref: string): Promise<void>;
  popStash(repoRoot: string, ref: string): Promise<void>;
  dropStash(repoRoot: string, ref: string): Promise<void>;
}
