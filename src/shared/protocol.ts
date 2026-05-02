import type { BranchCompareResult, CommitDetail, DiffRequest, GraphFilters, GraphSnapshot, StashEntry, UndoEntry, WorkingTreeFile, WorktreeEntry } from '../core/models';

export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'loadMore'; payload: { limit: number } }
  | { type: 'applyFilters'; payload: Partial<GraphFilters> }
  | { type: 'selectCommit'; payload: { repoRoot: string; commitHash: string } }
  | { type: 'openDiff'; payload: DiffRequest }
  | { type: 'createBranchPrompt'; payload: { repoRoot: string; fromRef?: string } }
  | { type: 'deleteBranch'; payload: { repoRoot: string; branchName: string } }
  | { type: 'checkoutCommit'; payload: { repoRoot: string; commitHash: string } }
  | { type: 'cherryPick'; payload: { repoRoot: string; commitHash: string } }
  | { type: 'revertCommit'; payload: { repoRoot: string; commitHash: string } }
  | { type: 'dropCommit'; payload: { repoRoot: string; commitHash: string } }
  | { type: 'mergeCommit'; payload: { repoRoot: string; commitHash: string } }
  | { type: 'rebaseOnCommit'; payload: { repoRoot: string; commitHash: string } }
  | { type: 'resetToCommit'; payload: { repoRoot: string; commitHash: string } }
  | { type: 'copyHash'; payload: { hash: string } }
  | { type: 'copySubject'; payload: { subject: string } }
  | { type: 'openInTerminal'; payload: { repoRoot: string; commitHash: string } }
  | { type: 'stageFile'; payload: { repoRoot: string; file: WorkingTreeFile } }
  | { type: 'unstageFile'; payload: { repoRoot: string; file: WorkingTreeFile } }
  | { type: 'discardFile'; payload: { repoRoot: string; file: WorkingTreeFile } }
  | { type: 'commitChangesPrompt'; payload: { repoRoot: string } }
  | { type: 'setGitUserName'; payload: { repoRoot: string; name: string } }
  | { type: 'setGitUserEmail'; payload: { repoRoot: string; email: string } }
  | { type: 'setGitHooksPath'; payload: { repoRoot: string; hooksPath: string } }
  | { type: 'openHooksFolder'; payload: { repoRoot: string; hooksPath: string } }
  | { type: 'openHookScript'; payload: { repoRoot: string; hooksPath: string; hookName: string } }
  | { type: 'setRemoteUrl'; payload: { repoRoot: string; remoteName: string; url: string } }
  | { type: 'openPullRequest'; payload: { repoRoot: string; sourceBranch: string; targetBranch: string; title: string; description: string } }
  | { type: 'listStashes'; payload: { repoRoot: string } }
  | { type: 'stashChanges'; payload: { repoRoot: string; message?: string; includeUntracked: boolean; paths?: string[] } }
  | { type: 'previewStash'; payload: { repoRoot: string; ref: string } }
  | { type: 'applyStash'; payload: { repoRoot: string; ref: string; paths?: string[] } }
  | { type: 'popStash'; payload: { repoRoot: string; ref: string; paths?: string[] } }
  | { type: 'dropStash'; payload: { repoRoot: string; ref: string } }
  | { type: 'listWorktrees'; payload: { repoRoot: string } }
  | { type: 'addWorktree'; payload: { repoRoot: string; branch: string; createNew: boolean; worktreePath: string } }
  | { type: 'addWorktreeAtCommit'; payload: { repoRoot: string; worktreePath: string; commitHash: string } }
  | { type: 'removeWorktree'; payload: { repoRoot: string; path: string; force: boolean } }
  | { type: 'openWorktreeInWindow'; payload: { repoRoot: string; path: string } }
  | { type: 'revealWorktreeInOs'; payload: { repoRoot: string; path: string } }
  | { type: 'copyWorktreePath'; payload: { repoRoot: string; path: string } }
  | { type: 'lockWorktree'; payload: { repoRoot: string; path: string } }
  | { type: 'unlockWorktree'; payload: { repoRoot: string; path: string } }
  | { type: 'moveWorktree'; payload: { repoRoot: string; path: string; newPath: string } }
  | { type: 'continueOperation'; payload: { repoRoot: string; state: string } }
  | { type: 'skipOperation'; payload: { repoRoot: string } }
  | { type: 'abortOperation'; payload: { repoRoot: string; state: string } }
  | { type: 'pullRepo'; payload: { repoRoot: string } }
  | { type: 'pushRepo'; payload: { repoRoot: string } }
  | { type: 'fetchRepo'; payload: { repoRoot: string } }
  | { type: 'openFile'; payload: { repoRoot: string; filePath: string } }
  | { type: 'compareBranches'; payload: { repoRoot: string; baseRef: string; targetRef: string } }
  | { type: 'listUndoEntries'; payload: { repoRoot: string } }
  | { type: 'undoTo'; payload: { repoRoot: string; ref: string } };

export type ExtensionToWebviewMessage =
  | { type: 'graphSnapshot'; payload: GraphSnapshot }
  | { type: 'commitDetail'; payload: CommitDetail }
  | { type: 'revealCommit'; payload: { commitHash: string } }
  | { type: 'busy'; payload: { value: boolean; label?: string } }
  | { type: 'notification'; payload: { kind: 'info' | 'error'; message: string } }
  | { type: 'stashList'; payload: { entries: StashEntry[] } }
  | { type: 'worktreeList'; payload: { entries: WorktreeEntry[] } }
  | { type: 'worktreeError'; payload: { message: string; path?: string; canForce?: boolean } }
  | { type: 'branchCompareResult'; payload: BranchCompareResult }
  | { type: 'undoEntries'; payload: { entries: UndoEntry[] } };
