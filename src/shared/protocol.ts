import type { CommitDetail, DiffRequest, GraphFilters, GraphSnapshot, StashEntry, WorkingTreeFile } from '../core/models/GitModels';

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
  | { type: 'setRemoteUrl'; payload: { repoRoot: string; remoteName: string; url: string } }
  | { type: 'openPullRequest'; payload: { repoRoot: string; sourceBranch: string; targetBranch: string; title: string; description: string } }
  | { type: 'listStashes'; payload: { repoRoot: string } }
  | { type: 'stashChanges'; payload: { repoRoot: string; message?: string; includeUntracked: boolean } }
  | { type: 'applyStash'; payload: { repoRoot: string; ref: string } }
  | { type: 'popStash'; payload: { repoRoot: string; ref: string } }
  | { type: 'dropStash'; payload: { repoRoot: string; ref: string } };

export type ExtensionToWebviewMessage =
  | { type: 'graphSnapshot'; payload: GraphSnapshot }
  | { type: 'commitDetail'; payload: CommitDetail }
  | { type: 'busy'; payload: { value: boolean; label?: string } }
  | { type: 'notification'; payload: { kind: 'info' | 'error'; message: string } }
  | { type: 'stashList'; payload: { entries: StashEntry[] } };
