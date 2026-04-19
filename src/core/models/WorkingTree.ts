export interface WorkingTreeFile {
  path: string;
  originalPath?: string;
  indexStatus: string;
  workTreeStatus: string;
  conflicted: boolean;
}

export type RepoSpecialState =
  | 'merging'
  | 'rebasing'
  | 'cherry-picking'
  | 'reverting'
  | 'bisecting'
  | 'detached';

export interface WorkingTreeStatus {
  currentBranch?: string;
  /** Upstream tracking branch (e.g. "origin/main"), if configured. */
  upstream?: string;
  ahead: number;
  behind: number;
  staged: WorkingTreeFile[];
  unstaged: WorkingTreeFile[];
  conflicted: WorkingTreeFile[];
  /** Non-null when the repo is in a special in-progress state. */
  specialState?: RepoSpecialState;
  /** ISO timestamp from FETCH_HEAD mtime — when the last `git fetch` ran. */
  lastFetchAt?: string;
}
