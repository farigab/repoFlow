import type { RepoSpecialState } from '../models';

export interface GitOperationPort {
  continueOperation(repoRoot: string, state: RepoSpecialState): Promise<void>;
  abortOperation(repoRoot: string, state: RepoSpecialState): Promise<void>;
  skipRebaseOperation(repoRoot: string): Promise<void>;
}
