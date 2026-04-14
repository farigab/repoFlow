import type { CommitDetail, DiffRequest, GraphFilters, GraphSnapshot, WorkingTreeFile } from '../core/models/GitModels';

export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'loadMore'; payload: { limit: number } }
  | { type: 'applyFilters'; payload: Partial<GraphFilters> }
  | { type: 'selectCommit'; payload: { repoRoot: string; commitHash: string } }
  | { type: 'openDiff'; payload: DiffRequest }
  | { type: 'fetch'; payload: { repoRoot: string } }
  | { type: 'pull'; payload: { repoRoot: string } }
  | { type: 'push'; payload: { repoRoot: string } }
  | { type: 'createBranchPrompt'; payload: { repoRoot: string; fromRef?: string } }
  | { type: 'deleteBranch'; payload: { repoRoot: string; branchName: string } }
  | { type: 'checkoutBranch'; payload: { repoRoot: string; branchName: string } }
  | { type: 'mergeBranchPrompt'; payload: { repoRoot: string; branchName: string } }
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
  | { type: 'commitChangesPrompt'; payload: { repoRoot: string } };

export type ExtensionToWebviewMessage =
  | { type: 'graphSnapshot'; payload: GraphSnapshot }
  | { type: 'commitDetail'; payload: CommitDetail }
  | { type: 'busy'; payload: { value: boolean; label?: string } }
  | { type: 'notification'; payload: { kind: 'info' | 'error'; message: string } };
