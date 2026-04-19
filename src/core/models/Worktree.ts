export interface WorktreeEntry {
  /** Absolute filesystem path of the worktree. */
  path: string;
  /** Full SHA-1 of the checked-out HEAD commit. */
  head: string;
  /** Full ref name (e.g. refs/heads/main), or null when in detached HEAD state. */
  branch: string | null;
  /** True only for the primary (main) worktree. */
  isMain: boolean;
  /** True when the worktree is locked (git worktree lock). */
  locked: boolean;
  /** True when the worktree has uncommitted changes. */
  dirty: boolean;
  /** Number of staged files. */
  staged: number;
  /** Number of unstaged/untracked files. */
  unstaged: number;
  /** Commits ahead of upstream (0 when no tracking branch). */
  ahead: number;
  /** Commits behind upstream (0 when no tracking branch). */
  behind: number;
}
