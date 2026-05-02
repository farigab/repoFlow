import * as path from 'node:path';
import * as vscode from 'vscode';
import { DUPLICATE_FETCH_WINDOW_MS, type GitFetchCoordinator } from '../../application/fetch/GitFetchCoordinator';
import type { GraphFilters } from '../../core/models';
import type { GitRepository } from '../../core/ports/GitRepository';
import type { ExtensionToWebviewMessage } from '../../shared/protocol';
import {
  assertCommitHash,
  assertReflogRef,
  assertRepoSpecialState,
  assertSafeBranchName,
  assertSafeGitRef,
  assertSafeHookName,
  assertSafeRelativeGitPath,
  assertSafeRemoteName
} from '../../shared/gitInputValidation';
import type { GitGraphHostServices } from './GitGraphHostServices';
import type { MessageHandlerMap, PayloadFor } from './GitGraphMessageTypes';
import { buildPrUrl, resolvePreferredRemoteForPullRequest } from './GitGraphUtils';

interface RepoMessageHandlersOptions {
  repository: GitRepository;
  fetchCoordinator: GitFetchCoordinator;
  host: GitGraphHostServices;
  getFilters: () => GraphFilters;
  setFilters: (filters: GraphFilters) => void;
  setSelectedCommitHash: (commitHash: string | undefined) => void;
  refresh: () => Promise<void>;
  postMessage: (message: ExtensionToWebviewMessage) => Promise<void>;
}

export class RepoMessageHandlers {
  public constructor(private readonly options: RepoMessageHandlersOptions) { }

  public handlers(): MessageHandlerMap {
    return {
      ready: async () => this.options.refresh(),
      loadMore: async (payload) => this.handleLoadMore(payload),
      applyFilters: async (payload) => this.handleApplyFilters(payload),
      selectCommit: async (payload) => this.handleSelectCommit(payload),
      openDiff: async (payload) => this.handleOpenDiff(payload),
      createBranchPrompt: async (payload) => this.handleCreateBranchPrompt(payload),
      deleteBranch: async (payload) => this.handleDeleteBranch(payload),
      checkoutCommit: async (payload) => this.handleCheckoutCommit(payload),
      cherryPick: async (payload) => this.handleCherryPick(payload),
      revertCommit: async (payload) => this.handleRevertCommit(payload),
      dropCommit: async (payload) => this.handleDropCommit(payload),
      mergeCommit: async (payload) => this.handleMergeCommit(payload),
      rebaseOnCommit: async (payload) => this.handleRebaseOnCommit(payload),
      resetToCommit: async (payload) => this.handleResetToCommit(payload),
      copyHash: async (payload) => this.handleCopyHash(payload),
      copySubject: async (payload) => this.handleCopySubject(payload),
      openInTerminal: async (payload) => this.handleOpenInTerminal(payload),
      stageFile: async (payload) => this.handleStageFile(payload),
      unstageFile: async (payload) => this.handleUnstageFile(payload),
      discardFile: async (payload) => this.handleDiscardFile(payload),
      commitChangesPrompt: async (payload) => this.handleCommitChangesPrompt(payload),
      setGitUserName: async (payload) => this.handleSetGitUserName(payload),
      setGitUserEmail: async (payload) => this.handleSetGitUserEmail(payload),
      setGitHooksPath: async (payload) => this.handleSetGitHooksPath(payload),
      openHooksFolder: async (payload) => this.handleOpenHooksFolder(payload),
      openHookScript: async (payload) => this.handleOpenHookScript(payload),
      setRemoteUrl: async (payload) => this.handleSetRemoteUrl(payload),
      openPullRequest: async (payload) => this.handleOpenPullRequest(payload),
      continueOperation: async (payload) => this.handleContinueOperation(payload),
      skipOperation: async (payload) => this.handleSkipOperation(payload),
      abortOperation: async (payload) => this.handleAbortOperation(payload),
      pullRepo: async (payload) => this.handlePullRepo(payload),
      pushRepo: async (payload) => this.handlePushRepo(payload),
      fetchRepo: async (payload) => this.handleFetchRepo(payload),
      openFile: async (payload) => this.handleOpenFile(payload),
      compareBranches: async (payload) => this.handleCompareBranches(payload),
      listUndoEntries: async (payload) => this.handleListUndoEntries(payload),
      undoTo: async (payload) => this.handleUndoTo(payload)
    };
  }

  private async handleLoadMore(payload: PayloadFor<'loadMore'>): Promise<void> {
    const filters = {
      ...this.options.getFilters(),
      ...this.options.host.normalizeFilters({ limit: payload.limit })
    };
    this.options.setFilters(filters);
    await this.options.refresh();
  }

  private async handleApplyFilters(payload: PayloadFor<'applyFilters'>): Promise<void> {
    const filters = {
      ...this.options.getFilters(),
      ...this.options.host.normalizeFilters(payload)
    };
    this.options.setFilters(filters);
    await this.options.refresh();
  }

  private async handleSelectCommit(payload: PayloadFor<'selectCommit'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const commitHash = assertCommitHash(payload.commitHash);
    this.options.setSelectedCommitHash(commitHash);
    const detail = await this.options.repository.getCommitDetail(repoRoot, commitHash);
    await this.options.postMessage({ type: 'commitDetail', payload: detail });
  }

  private async handleOpenDiff(payload: PayloadFor<'openDiff'>): Promise<void> {
    const request = this.options.host.validateDiffRequest(payload);
    request.repoRoot = await this.options.host.getTrustedRepoRoot(request.repoRoot);
    await this.options.repository.openDiff(request);
  }

  private async handleCreateBranchPrompt(payload: PayloadFor<'createBranchPrompt'>): Promise<void> {
    const name = await vscode.window.showInputBox({
      title: 'Create Branch',
      prompt: 'New branch name',
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : 'Please enter a branch name.')
    });
    if (!name) return;
    const branchName = assertSafeBranchName(name);
    const fromRef = payload.fromRef ? assertSafeGitRef(payload.fromRef, 'source ref') : undefined;
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    await this.options.host.executeRepositoryAction('Creating branch...', async () => {
      await this.options.repository.createBranch(repoRoot, branchName, fromRef);
    });
  }

  private async handleDeleteBranch(payload: PayloadFor<'deleteBranch'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const branchName = assertSafeBranchName(payload.branchName);
    const confirmed = await vscode.window.showWarningMessage(
      `Delete branch ${branchName}?`,
      { modal: true },
      'Delete'
    );
    if (confirmed !== 'Delete') return;
    await this.options.host.executeRepositoryAction('Deleting branch...', async () => {
      await this.options.repository.deleteBranch(repoRoot, branchName);
    });
  }

  private async handleCheckoutCommit(payload: PayloadFor<'checkoutCommit'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const commitHash = assertCommitHash(payload.commitHash);
    const confirmed = await vscode.window.showWarningMessage(
      `Checkout detached HEAD at ${commitHash.slice(0, 8)}?`,
      { modal: true },
      'Checkout'
    );
    if (confirmed !== 'Checkout') return;
    await this.options.host.executeRepositoryAction('Checking out commit...', async () => {
      await this.options.repository.checkout(repoRoot, commitHash);
    });
  }

  private async handleCherryPick(payload: PayloadFor<'cherryPick'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const commitHash = assertCommitHash(payload.commitHash);
    await this.options.host.executeRepositoryAction('Cherry-picking...', async () => {
      await this.options.repository.cherryPick(repoRoot, commitHash);
    });
  }

  private async handleRevertCommit(payload: PayloadFor<'revertCommit'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const commitHash = assertCommitHash(payload.commitHash);
    const confirmed = await vscode.window.showWarningMessage(
      `Revert commit ${commitHash.slice(0, 8)}?`,
      { modal: true },
      'Revert'
    );
    if (confirmed !== 'Revert') return;
    await this.options.host.executeRepositoryAction('Reverting commit...', async () => {
      await this.options.repository.revert(repoRoot, commitHash);
    });
  }

  private async handleDropCommit(payload: PayloadFor<'dropCommit'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const commitHash = assertCommitHash(payload.commitHash);
    const shortHash = commitHash.slice(0, 8);
    const confirmed = await this.options.host.confirmTyped({
      title: 'Drop Commit',
      prompt: `Drop commit ${shortHash}? This rewrites history.`,
      expected: shortHash,
      actionLabel: 'drop the commit'
    });
    if (!confirmed) return;
    await this.options.host.executeRepositoryAction('Dropping commit...', async () => {
      await this.options.repository.dropCommit(repoRoot, commitHash);
    });
  }

  private async handleMergeCommit(payload: PayloadFor<'mergeCommit'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const commitHash = assertCommitHash(payload.commitHash);
    const confirmed = await vscode.window.showWarningMessage(
      `Merge commit ${commitHash.slice(0, 8)} into the current branch?`,
      { modal: true },
      'Merge'
    );
    if (confirmed !== 'Merge') return;
    await this.options.host.executeRepositoryAction('Merging...', async () => {
      await this.options.repository.merge(repoRoot, commitHash);
    });
  }

  private async handleRebaseOnCommit(payload: PayloadFor<'rebaseOnCommit'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const commitHash = assertCommitHash(payload.commitHash);
    const confirmed = await vscode.window.showWarningMessage(
      `Rebase current branch onto commit ${commitHash.slice(0, 8)}?`,
      { modal: true },
      'Rebase'
    );
    if (confirmed !== 'Rebase') return;
    await this.options.host.executeRepositoryAction('Rebasing...', async () => {
      await this.options.repository.rebase(repoRoot, commitHash);
    });
  }

  private async handleResetToCommit(payload: PayloadFor<'resetToCommit'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const commitHash = assertCommitHash(payload.commitHash);
    const shortHash = commitHash.slice(0, 8);
    const mode = await vscode.window.showQuickPick(
      [
        { label: 'Soft', description: 'Keep changes staged', value: 'soft' as const },
        { label: 'Mixed', description: 'Keep changes in working tree', value: 'mixed' as const },
        { label: 'Hard', description: 'Discard all changes', value: 'hard' as const }
      ],
      { title: `Reset to ${shortHash}`, placeHolder: 'Select reset mode' }
    );
    if (!mode) return;

    if (mode.value === 'hard') {
      const confirmed = await this.options.host.confirmTyped({
        title: 'Hard Reset',
        prompt: `Hard reset current branch to ${shortHash}? This can discard uncommitted changes.`,
        expected: shortHash,
        actionLabel: 'hard reset'
      });
      if (!confirmed) return;
    } else {
      const confirmed = await vscode.window.showWarningMessage(
        `Reset (${mode.label}) current branch to ${shortHash}?`,
        { modal: true },
        'Reset'
      );
      if (confirmed !== 'Reset') return;
    }

    await this.options.host.executeRepositoryAction('Resetting...', async () => {
      await this.options.repository.resetTo(repoRoot, commitHash, mode.value);
    });
  }

  private async handleCopyHash(payload: PayloadFor<'copyHash'>): Promise<void> {
    await vscode.env.clipboard.writeText(payload.hash);
    await this.options.host.postNotification('info', 'Hash copied to clipboard.');
  }

  private async handleCopySubject(payload: PayloadFor<'copySubject'>): Promise<void> {
    await vscode.env.clipboard.writeText(payload.subject);
    await this.options.host.postNotification('info', 'Subject copied to clipboard.');
  }

  private async handleOpenInTerminal(payload: PayloadFor<'openInTerminal'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const hash = assertCommitHash(payload.commitHash);
    const terminal = vscode.window.createTerminal({ cwd: repoRoot, name: 'RepoFlow' });
    terminal.show();
    terminal.sendText(`git show --stat ${hash}`, true);
  }

  private async handleStageFile(payload: PayloadFor<'stageFile'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const filePath = assertSafeRelativeGitPath(payload.file.path);
    await this.options.host.executeRepositoryAction('Staging file...', async () => {
      await this.options.repository.stageFile(repoRoot, filePath);
    });
  }

  private async handleUnstageFile(payload: PayloadFor<'unstageFile'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const filePath = assertSafeRelativeGitPath(payload.file.path);
    await this.options.host.executeRepositoryAction('Unstaging file...', async () => {
      await this.options.repository.unstageFile(repoRoot, filePath);
    });
  }

  private async handleDiscardFile(payload: PayloadFor<'discardFile'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const filePath = assertSafeRelativeGitPath(payload.file.path);
    const confirmed = await this.options.host.confirmTyped({
      title: 'Discard Changes',
      prompt: `Discard changes in ${filePath}?`,
      expected: filePath,
      actionLabel: 'discard changes'
    });
    if (!confirmed) return;
    const tracked = payload.file.indexStatus !== '?' && payload.file.workTreeStatus !== '?';
    const stagedAddition = payload.file.indexStatus === 'A';
    await this.options.host.executeRepositoryAction('Discarding changes...', async () => {
      await this.options.repository.discardFile(repoRoot, filePath, tracked, stagedAddition);
    });
  }

  private async handleCommitChangesPrompt(payload: PayloadFor<'commitChangesPrompt'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const messageText = await vscode.window.showInputBox({
      title: 'Commit Changes',
      prompt: 'Commit message',
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : 'Please enter a commit message.')
    });
    if (!messageText) return;
    const choice = await vscode.window.showQuickPick([
      { label: 'Commit', description: 'Create a new commit' },
      { label: 'Amend Last Commit', description: 'Amend the most recent commit' }
    ], {
      title: 'Commit or Amend?',
      placeHolder: 'Choose action',
      ignoreFocusOut: true
    });
    if (!choice) return;

    const amend = choice.label === 'Amend Last Commit';
    await this.options.host.executeRepositoryAction('Committing...', async () => {
      await this.options.repository.commit(repoRoot, messageText.trim(), amend);
    });
  }

  private async handleSetGitUserName(payload: PayloadFor<'setGitUserName'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    await this.options.host.executeRepositoryAction('Saving user.name...', async () => {
      await this.options.repository.setGitUserName(repoRoot, payload.name.trim());
    });
  }

  private async handleSetGitUserEmail(payload: PayloadFor<'setGitUserEmail'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    await this.options.host.executeRepositoryAction('Saving user.email...', async () => {
      await this.options.repository.setGitUserEmail(repoRoot, payload.email.trim());
    });
  }

  private async handleSetGitHooksPath(payload: PayloadFor<'setGitHooksPath'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    await this.options.host.executeRepositoryAction('Saving core.hooksPath...', async () => {
      await this.options.repository.setGitHooksPath(repoRoot, payload.hooksPath);
    });
  }

  private async handleOpenHooksFolder(payload: PayloadFor<'openHooksFolder'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    await this.options.host.executeUiAction('Opening hooks folder...', async () => {
      const hooksDirectory = await this.options.host.resolveHooksDirectory(repoRoot, payload.hooksPath);
      const hooksUri = vscode.Uri.file(hooksDirectory);
      await vscode.workspace.fs.createDirectory(hooksUri);
      const opened = await vscode.env.openExternal(hooksUri);
      if (!opened) {
        await vscode.commands.executeCommand('revealFileInOS', hooksUri);
      }
    }, 'Hooks folder opened.');
  }

  private async handleOpenHookScript(payload: PayloadFor<'openHookScript'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const hookName = assertSafeHookName(payload.hookName);
    await this.options.host.executeUiAction(`Opening ${hookName} hook...`, async () => {
      const scriptUri = await this.options.host.ensureHookScript(repoRoot, payload.hooksPath, hookName);
      await this.options.refresh();
      const doc = await vscode.workspace.openTextDocument(scriptUri);
      await vscode.window.showTextDocument(doc, { preserveFocus: false, preview: false });
    }, `${hookName} hook ready.`);
  }

  private async handleSetRemoteUrl(payload: PayloadFor<'setRemoteUrl'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const remoteName = assertSafeRemoteName(payload.remoteName);
    const remoteUrl = payload.url.trim();
    await this.options.host.executeRepositoryAction('Saving remote URL...', async () => {
      await this.options.repository.setRemoteUrl(repoRoot, remoteName, remoteUrl);
    });
  }

  private async handleOpenPullRequest(payload: PayloadFor<'openPullRequest'>): Promise<void> {
    const { repoRoot, sourceBranch, targetBranch, title, description } = payload;
    const trustedRepoRoot = await this.options.host.getTrustedRepoRoot(repoRoot);
    const trustedSourceBranch = assertSafeBranchName(sourceBranch);
    const trustedTargetBranch = assertSafeBranchName(targetBranch);
    const [config, branches] = await Promise.all([
      this.options.repository.getRepoConfig(trustedRepoRoot),
      this.options.repository.getBranches(trustedRepoRoot)
    ]);
    const remote = resolvePreferredRemoteForPullRequest(trustedSourceBranch, branches, config.remotes);
    const remoteUrl = remote?.url ?? '';
    const prUrl = buildPrUrl(remoteUrl, trustedSourceBranch, trustedTargetBranch, title, description);
    if (prUrl) {
      await vscode.env.openExternal(vscode.Uri.parse(prUrl));
    } else {
      await vscode.window.showWarningMessage(`Could not detect PR URL. Remote: ${remoteUrl || '(none)'}`);
    }
  }

  private async handleContinueOperation(payload: PayloadFor<'continueOperation'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const state = assertRepoSpecialState(payload.state);
    await this.options.host.executeRepositoryAction('Continuing...', async () => {
      await this.options.repository.continueOperation(repoRoot, state);
    });
  }

  private async handleSkipOperation(payload: PayloadFor<'skipOperation'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    await this.options.host.executeRepositoryAction('Skipping...', async () => {
      await this.options.repository.skipRebaseOperation(repoRoot);
    });
  }

  private async handleAbortOperation(payload: PayloadFor<'abortOperation'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const state = assertRepoSpecialState(payload.state);
    await this.options.host.executeRepositoryAction('Aborting...', async () => {
      await this.options.repository.abortOperation(repoRoot, state);
    });
  }

  private async handlePullRepo(payload: PayloadFor<'pullRepo'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    await this.options.host.executeRepositoryAction('Pulling...', async () => {
      await this.options.repository.pull(repoRoot);
    });
  }

  private async handlePushRepo(payload: PayloadFor<'pushRepo'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    await this.options.host.executeRepositoryAction('Pushing...', async () => {
      await this.options.repository.push(repoRoot);
    });
  }

  private async handleFetchRepo(payload: PayloadFor<'fetchRepo'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    await this.options.host.executeRepositoryAction('Fetching...', async () => {
      await this.options.fetchCoordinator.fetch(repoRoot, {
        reason: 'webview-fetch',
        minimumIntervalMs: DUPLICATE_FETCH_WINDOW_MS
      });
    });
  }

  private async handleOpenFile(payload: PayloadFor<'openFile'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const filePath = assertSafeRelativeGitPath(payload.filePath);
    const fullPath = vscode.Uri.file(path.join(repoRoot, filePath));
    const doc = await vscode.workspace.openTextDocument(fullPath);
    await vscode.window.showTextDocument(doc, { preserveFocus: false, preview: false });
  }

  private async handleCompareBranches(payload: PayloadFor<'compareBranches'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const baseRef = assertSafeGitRef(payload.baseRef, 'base ref');
    const targetRef = assertSafeGitRef(payload.targetRef, 'target ref');
    const result = await this.options.repository.compareBranches(repoRoot, baseRef, targetRef);
    await this.options.postMessage({ type: 'branchCompareResult', payload: result });
  }

  private async handleListUndoEntries(payload: PayloadFor<'listUndoEntries'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const entries = await this.options.repository.listUndoEntries(repoRoot);
    await this.options.postMessage({ type: 'undoEntries', payload: { entries } });
  }

  private async handleUndoTo(payload: PayloadFor<'undoTo'>): Promise<void> {
    const repoRoot = await this.options.host.getTrustedRepoRoot(payload.repoRoot);
    const ref = assertReflogRef(payload.ref);
    const confirmed = await this.options.host.confirmTyped({
      title: 'Undo Operation',
      prompt: `Undo to ${ref}? This performs a hard reset and can discard uncommitted changes.`,
      expected: ref,
      actionLabel: 'undo'
    });
    if (!confirmed) return;

    await this.options.host.executeRepositoryAction('Undoing last operation...', async () => {
      await this.options.repository.undoTo(repoRoot, ref);
    });
  }
}
