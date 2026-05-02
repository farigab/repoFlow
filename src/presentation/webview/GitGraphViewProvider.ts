import * as path from 'node:path';
import * as vscode from 'vscode';
import { DUPLICATE_FETCH_WINDOW_MS, type GitFetchCoordinator } from '../../application/fetch/GitFetchCoordinator';
import type { GraphFilters, WorktreeEntry } from '../../core/models';
import type { GitRepository } from '../../core/ports/GitRepository';

import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../../shared/protocol';
import {
  assertCommitHash,
  assertReflogRef,
  assertRepoSpecialState,
  assertSafeAbsoluteFsPath,
  assertSafeBranchName,
  assertSafeGitRef,
  assertSafeHookName,
  assertSafeRelativeGitPath,
  assertSafeRelativeGitPaths,
  assertSafeRemoteName,
  assertStashRef,
  normalizeFsPathForComparison
} from '../../shared/gitInputValidation';
import { buildRepoStatusBarText, buildRepoSummary } from '../../shared/repoSummary';
import { renderHtml } from './GitGraphRenderer';
import { buildPrUrl, resolvePreferredRemoteForPullRequest } from './GitGraphUtils';
type MessageType = WebviewToExtensionMessage['type'];
type PayloadFor<T extends MessageType> = Extract<WebviewToExtensionMessage, { type: T }> extends { payload: infer P } ? P : undefined;

function buildHookTemplate(hookName: string): string {
  switch (hookName) {
    case 'commit-msg':
      return [
        '#!/bin/sh',
        '',
        '# Validate the commit message file passed as the first argument.',
        '# Exit with a non-zero status to block the commit.',
        '',
        'MESSAGE_FILE="$1"',
        '',
        'echo "commit-msg: inspect $MESSAGE_FILE"',
        'exit 0',
        ''
      ].join('\n');
    case 'pre-push':
      return [
        '#!/bin/sh',
        '',
        '# Runs before refs are pushed to the remote.',
        '# stdin receives the refs that will be updated.',
        '',
        'echo "pre-push: add your checks here"',
        'exit 0',
        ''
      ].join('\n');
    case 'pre-commit':
      return [
        '#!/bin/sh',
        '',
        '# Runs before a commit is created.',
        '# Exit with a non-zero status to block the commit.',
        '',
        'echo "pre-commit: add your checks here"',
        'exit 0',
        ''
      ].join('\n');
    default:
      return [
        '#!/bin/sh',
        '',
        `# ${hookName} hook`,
        '# Exit with a non-zero status to block the Git action.',
        '',
        `echo "${hookName}: add your checks here"`,
        'exit 0',
        ''
      ].join('\n');
  }
}

export class GitGraphViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'repoFlow.graphPanel';
  public static readonly viewId = 'repoFlow.graphView';

  private currentPanel?: vscode.WebviewPanel;
  private currentView?: vscode.WebviewView;
  private viewDisposables: vscode.Disposable[] = [];
  private panelDisposables: vscode.Disposable[] = [];
  private filters: GraphFilters = {
    includeRemotes: true,
    limit: 200
  };
  private selectedCommitHash?: string;
  /** Set before openOrReveal() to trigger a scroll-to-commit after next refresh. */
  private pendingRevealHash?: string;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly repository: GitRepository,
    private readonly fetchCoordinator: GitFetchCoordinator,
    private readonly output: vscode.OutputChannel,
    private readonly repoStatusBar?: vscode.StatusBarItem,
    private readonly onRepositoryChanged?: () => void
  ) { }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    // _context and _token are unused but kept in signature for API compatibility
    this.currentView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.extensionUri, 'media')
      ]
    };

    webviewView.webview.html = renderHtml(this.extensionUri, webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (message: WebviewToExtensionMessage) => { void this.handleMessage(message); },
      undefined,
      this.viewDisposables
    );

    webviewView.onDidDispose(() => {
      this.currentView = undefined;
      for (const d of this.viewDisposables) { d.dispose(); }
      this.viewDisposables = [];
    }, undefined, this.viewDisposables);

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this.refresh();
      }
    }, undefined, this.viewDisposables);

    void this.refresh();
  }

  public openOrReveal(): void {
    this.selectedCommitHash = undefined;
    this.filters = { includeRemotes: true, limit: 200 };

    if (this.currentPanel) {
      this.currentPanel.reveal(vscode.ViewColumn.One);
      void this.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      GitGraphViewProvider.viewType,
      'RepoFlow',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        enableFindWidget: false,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
          vscode.Uri.joinPath(this.extensionUri, 'media')
        ]
      }
    );

    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.svg');
    panel.webview.html = renderHtml(this.extensionUri, panel.webview);

    panel.webview.onDidReceiveMessage(
      (message: WebviewToExtensionMessage) => { void this.handleMessage(message); },
      undefined,
      this.panelDisposables
    );

    panel.onDidDispose(() => {
      this.currentPanel = undefined;
      for (const d of this.panelDisposables) { d.dispose(); }
      this.panelDisposables = [];
    }, undefined, this.panelDisposables);

    panel.onDidChangeViewState(() => {
      if (panel.visible) {
        void this.refresh();
      }
    }, undefined, this.panelDisposables);

    this.currentPanel = panel;
    // Do NOT call refresh() here — the webview JS hasn't loaded yet so any
    // postMessage would be silently dropped. The 'ready' event sent by the
    // webview after its JS initialises will trigger the first refresh, at
    // which point pendingRevealHash / selectedCommitHash are still set.
  }

  /**
   * Opens (or reveals) the RepoFlow panel and scrolls to the given commit,
   * selecting it and opening the detail panel. Called from the blame hover.
   */
  public openAndRevealCommit(commitHash: string): void {
    const trustedCommitHash = assertCommitHash(commitHash);
    // openOrReveal() resets selectedCommitHash synchronously, so set ours back
    // immediately after — refresh() is async and reads it on next microtask.
    this.openOrReveal();
    this.selectedCommitHash = trustedCommitHash;
    this.pendingRevealHash = trustedCommitHash;
  }

  public async refresh(): Promise<void> {
    if (!this.currentPanel && !this.currentView?.visible) {
      // Webview is not open — still refresh the status bar
      await this.refreshStatusBarOnly();
      return;
    }

    await this.withBusy('Refreshing Git graph...', async () => {
      let snapshot = await this.repository.getGraph(this.filters);

      // If a commit needs to be revealed but isn't within the loaded page,
      // keep expanding the limit until the commit is found or history is exhausted.
      if (this.pendingRevealHash) {
        while (
          snapshot.hasMore &&
          !snapshot.rows.some(r => r.commit.hash === this.pendingRevealHash)
        ) {
          this.filters = { ...this.filters, limit: this.filters.limit + 200 };
          snapshot = await this.repository.getGraph(this.filters);
        }
      }

      await this.postMessage({ type: 'graphSnapshot', payload: snapshot });

      if (this.repoStatusBar) {
        const status = snapshot.localChanges;
        this.repoStatusBar.text = buildRepoStatusBarText(status);
        this.repoStatusBar.tooltip = buildRepoSummary(status);
      }

      const revealedCommitHash = this.pendingRevealHash;
      const canRevealCommit = revealedCommitHash
        ? snapshot.rows.some((r) => r.commit.hash === revealedCommitHash)
        : false;

      if (revealedCommitHash && canRevealCommit) {
        // Send revealCommit BEFORE commitDetail so the webview can prime
        // requestedCommitHashRef before the detail message arrives.
        await this.postMessage({ type: 'revealCommit', payload: { commitHash: revealedCommitHash } });
        this.pendingRevealHash = undefined;
      }

      if (this.selectedCommitHash) {
        const detail = await this.repository.getCommitDetail(snapshot.repoRoot, this.selectedCommitHash);
        await this.postMessage({ type: 'commitDetail', payload: detail });
      }
    });
  }

  private async refreshStatusBarOnly(): Promise<void> {
    if (!this.repoStatusBar) {
      return;
    }
    try {
      const repoRoot = await this.repository.resolveRepositoryRoot();
      const status = await this.repository.getLocalChanges(repoRoot);
      this.repoStatusBar.text = buildRepoStatusBarText(status);
      this.repoStatusBar.tooltip = buildRepoSummary(status);
    } catch {
      // Not in a git repo — keep the default label
    }
  }

  private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    const handlers: Partial<{ [K in MessageType]: (payload: PayloadFor<K>) => Promise<void> }> = {
      ready: async () => this.handleReady(),
      loadMore: async (p) => this.handleLoadMore(p),
      applyFilters: async (p) => this.handleApplyFilters(p),
      selectCommit: async (p) => this.handleSelectCommit(p),
      openDiff: async (p) => this.handleOpenDiff(p),
      createBranchPrompt: async (p) => this.handleCreateBranchPrompt(p),
      deleteBranch: async (p) => this.handleDeleteBranch(p),
      checkoutCommit: async (p) => this.handleCheckoutCommit(p),
      cherryPick: async (p) => this.handleCherryPick(p),
      revertCommit: async (p) => this.handleRevertCommit(p),
      dropCommit: async (p) => this.handleDropCommit(p),
      mergeCommit: async (p) => this.handleMergeCommit(p),
      rebaseOnCommit: async (p) => this.handleRebaseOnCommit(p),
      resetToCommit: async (p) => this.handleResetToCommit(p),
      copyHash: async (p) => this.handleCopyHash(p),
      copySubject: async (p) => this.handleCopySubject(p),
      openInTerminal: async (p) => this.handleOpenInTerminal(p),
      stageFile: async (p) => this.handleStageFile(p),
      unstageFile: async (p) => this.handleUnstageFile(p),
      discardFile: async (p) => this.handleDiscardFile(p),
      commitChangesPrompt: async (p) => this.handleCommitChangesPrompt(p),
      setGitUserName: async (p) => this.handleSetGitUserName(p),
      setGitUserEmail: async (p) => this.handleSetGitUserEmail(p),
      setGitHooksPath: async (p) => this.handleSetGitHooksPath(p),
      openHooksFolder: async (p) => this.handleOpenHooksFolder(p),
      openHookScript: async (p) => this.handleOpenHookScript(p),
      setRemoteUrl: async (p) => this.handleSetRemoteUrl(p),
      openPullRequest: async (p) => this.handleOpenPullRequest(p),
      listStashes: async (p) => this.handleListStashes(p),
      stashChanges: async (p) => this.handleStashChanges(p),
      previewStash: async (p) => this.handlePreviewStash(p),
      applyStash: async (p) => this.handleApplyStash(p),
      popStash: async (p) => this.handlePopStash(p),
      dropStash: async (p) => this.handleDropStash(p),
      listWorktrees: async (p) => this.handleListWorktrees(p),
      addWorktree: async (p) => this.handleAddWorktree(p),
      removeWorktree: async (p) => this.handleRemoveWorktree(p),
      openWorktreeInWindow: async (p) => this.handleOpenWorktreeInWindow(p),
      revealWorktreeInOs: async (p) => this.handleRevealWorktreeInOs(p),
      copyWorktreePath: async (p) => this.handleCopyWorktreePath(p),
      lockWorktree: async (p) => this.handleLockWorktree(p),
      unlockWorktree: async (p) => this.handleUnlockWorktree(p),
      moveWorktree: async (p) => this.handleMoveWorktree(p),
      addWorktreeAtCommit: async (p) => this.handleAddWorktreeAtCommit(p),
      continueOperation: async (p) => this.handleContinueOperation(p),
      skipOperation: async (p) => this.handleSkipOperation(p),
      abortOperation: async (p) => this.handleAbortOperation(p),
      pullRepo: async (p) => this.handlePullRepo(p),
      pushRepo: async (p) => this.handlePushRepo(p),
      fetchRepo: async (p) => this.handleFetchRepo(p),
      openFile: async (p) => this.handleOpenFile(p),
      compareBranches: async (p) => this.handleCompareBranches(p),
      listUndoEntries: async (p) => this.handleListUndoEntries(p),
      undoTo: async (p) => this.handleUndoTo(p)
    };

    try {
      const handler = handlers[message.type];
      if (handler) {
        const payload = (message as WebviewToExtensionMessage & { payload?: unknown }).payload;
        await (handler as (p: unknown) => Promise<void>)(payload);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[webview-message] ${message.type}: ${errorMessage}`);
      await this.postNotification('error', errorMessage);
    }
  }

  private async handleReady(): Promise<void> {
    await this.refresh();
  }

  private async handleLoadMore(payload: PayloadFor<'loadMore'>): Promise<void> {
    this.filters = { ...this.filters, ...this.normalizeFilters({ limit: payload.limit }) };
    await this.refresh();
  }

  private async handleApplyFilters(payload: PayloadFor<'applyFilters'>): Promise<void> {
    this.filters = { ...this.filters, ...this.normalizeFilters(payload) };
    await this.refresh();
  }

  private async handleSelectCommit(payload: PayloadFor<'selectCommit'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const commitHash = assertCommitHash(payload.commitHash);
    this.selectedCommitHash = commitHash;
    const detail = await this.repository.getCommitDetail(repoRoot, commitHash);
    await this.postMessage({ type: 'commitDetail', payload: detail });
  }

  private async handleOpenDiff(payload: PayloadFor<'openDiff'>): Promise<void> {
    const request = this.validateDiffRequest(payload);
    request.repoRoot = await this.getTrustedRepoRoot(request.repoRoot);
    await this.repository.openDiff(request);
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
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    await this.executeRepositoryAction('Creating branch...', async () => {
      await this.repository.createBranch(repoRoot, branchName, fromRef);
    });
  }

  private async handleDeleteBranch(payload: PayloadFor<'deleteBranch'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const branchName = assertSafeBranchName(payload.branchName);
    const confirmed = await vscode.window.showWarningMessage(
      `Delete branch ${branchName}?`,
      { modal: true },
      'Delete'
    );
    if (confirmed !== 'Delete') return;
    await this.executeRepositoryAction('Deleting branch...', async () => {
      await this.repository.deleteBranch(repoRoot, branchName);
    });
  }

  private async handleCheckoutCommit(payload: PayloadFor<'checkoutCommit'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const commitHash = assertCommitHash(payload.commitHash);
    const confirmed = await vscode.window.showWarningMessage(
      `Checkout detached HEAD at ${commitHash.slice(0, 8)}?`,
      { modal: true },
      'Checkout'
    );
    if (confirmed !== 'Checkout') return;
    await this.executeRepositoryAction('Checking out commit...', async () => {
      await this.repository.checkout(repoRoot, commitHash);
    });
  }

  private async handleCherryPick(payload: PayloadFor<'cherryPick'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const commitHash = assertCommitHash(payload.commitHash);
    await this.executeRepositoryAction('Cherry-picking...', async () => {
      await this.repository.cherryPick(repoRoot, commitHash);
    });
  }

  private async handleRevertCommit(payload: PayloadFor<'revertCommit'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const commitHash = assertCommitHash(payload.commitHash);
    const confirmed = await vscode.window.showWarningMessage(
      `Revert commit ${commitHash.slice(0, 8)}?`,
      { modal: true },
      'Revert'
    );
    if (confirmed !== 'Revert') return;
    await this.executeRepositoryAction('Reverting commit...', async () => {
      await this.repository.revert(repoRoot, commitHash);
    });
  }

  private async handleDropCommit(payload: PayloadFor<'dropCommit'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const commitHash = assertCommitHash(payload.commitHash);
    const confirmed = await vscode.window.showWarningMessage(
      `Drop commit ${commitHash.slice(0, 8)}? This rewrites history.`,
      { modal: true },
      'Drop'
    );
    if (confirmed !== 'Drop') return;
    await this.executeRepositoryAction('Dropping commit...', async () => {
      await this.repository.dropCommit(repoRoot, commitHash);
    });
  }

  private async handleMergeCommit(payload: PayloadFor<'mergeCommit'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const commitHash = assertCommitHash(payload.commitHash);
    const confirmed = await vscode.window.showWarningMessage(
      `Merge commit ${commitHash.slice(0, 8)} into the current branch?`,
      { modal: true },
      'Merge'
    );
    if (confirmed !== 'Merge') return;
    await this.executeRepositoryAction('Merging...', async () => {
      await this.repository.merge(repoRoot, commitHash);
    });
  }

  private async handleRebaseOnCommit(payload: PayloadFor<'rebaseOnCommit'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const commitHash = assertCommitHash(payload.commitHash);
    const confirmed = await vscode.window.showWarningMessage(
      `Rebase current branch onto commit ${commitHash.slice(0, 8)}?`,
      { modal: true },
      'Rebase'
    );
    if (confirmed !== 'Rebase') return;
    await this.executeRepositoryAction('Rebasing...', async () => {
      await this.repository.rebase(repoRoot, commitHash);
    });
  }

  private async handleResetToCommit(payload: PayloadFor<'resetToCommit'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const commitHash = assertCommitHash(payload.commitHash);
    const mode = await vscode.window.showQuickPick(
      [
        { label: 'Soft', description: 'Keep changes staged', value: 'soft' as const },
        { label: 'Mixed', description: 'Keep changes in working tree', value: 'mixed' as const },
        { label: 'Hard', description: 'Discard all changes', value: 'hard' as const }
      ],
      { title: `Reset to ${commitHash.slice(0, 8)}`, placeHolder: 'Select reset mode' }
    );
    if (!mode) return;
    const confirmed = await vscode.window.showWarningMessage(
      `Reset (${mode.label}) current branch to ${commitHash.slice(0, 8)}?`,
      { modal: true },
      'Reset'
    );
    if (confirmed !== 'Reset') return;
    await this.executeRepositoryAction('Resetting...', async () => {
      await this.repository.resetTo(repoRoot, commitHash, mode.value);
    });
  }

  private async handleCopyHash(payload: PayloadFor<'copyHash'>): Promise<void> {
    await vscode.env.clipboard.writeText(payload.hash);
    await this.postNotification('info', 'Hash copied to clipboard.');
  }

  private async handleCopySubject(payload: PayloadFor<'copySubject'>): Promise<void> {
    await vscode.env.clipboard.writeText(payload.subject);
    await this.postNotification('info', 'Subject copied to clipboard.');
  }

  private async handleOpenInTerminal(payload: PayloadFor<'openInTerminal'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const hash = assertCommitHash(payload.commitHash);
    const terminal = vscode.window.createTerminal({ cwd: repoRoot, name: 'RepoFlow' });
    terminal.show();
    terminal.sendText(`git show --stat ${hash}`, true);
  }

  private async handleStageFile(payload: PayloadFor<'stageFile'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const filePath = assertSafeRelativeGitPath(payload.file.path);
    await this.executeRepositoryAction('Staging file...', async () => {
      await this.repository.stageFile(repoRoot, filePath);
    });
  }

  private async handleUnstageFile(payload: PayloadFor<'unstageFile'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const filePath = assertSafeRelativeGitPath(payload.file.path);
    await this.executeRepositoryAction('Unstaging file...', async () => {
      await this.repository.unstageFile(repoRoot, filePath);
    });
  }

  private async handleDiscardFile(payload: PayloadFor<'discardFile'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const filePath = assertSafeRelativeGitPath(payload.file.path);
    const confirmed = await vscode.window.showWarningMessage(
      `Discard changes in ${filePath}?`,
      { modal: true },
      'Discard'
    );
    if (confirmed !== 'Discard') return;
    const tracked = payload.file.indexStatus !== '?' && payload.file.workTreeStatus !== '?';
    const stagedAddition = payload.file.indexStatus === 'A';
    await this.executeRepositoryAction('Discarding changes...', async () => {
      await this.repository.discardFile(repoRoot, filePath, tracked, stagedAddition);
    });
  }

  private async handleCommitChangesPrompt(payload: PayloadFor<'commitChangesPrompt'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
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
    await this.executeRepositoryAction('Committing...', async () => {
      await this.repository.commit(repoRoot, messageText.trim(), amend);
    });
  }

  private async handleSetGitUserName(payload: PayloadFor<'setGitUserName'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    await this.executeRepositoryAction('Saving user.name...', async () => {
      await this.repository.setGitUserName(repoRoot, payload.name.trim());
    });
  }

  private async handleSetGitUserEmail(payload: PayloadFor<'setGitUserEmail'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    await this.executeRepositoryAction('Saving user.email...', async () => {
      await this.repository.setGitUserEmail(repoRoot, payload.email.trim());
    });
  }

  private async handleSetGitHooksPath(payload: PayloadFor<'setGitHooksPath'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    await this.executeRepositoryAction('Saving core.hooksPath...', async () => {
      await this.repository.setGitHooksPath(repoRoot, payload.hooksPath);
    });
  }

  private async handleOpenHooksFolder(payload: PayloadFor<'openHooksFolder'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    await this.executeUiAction('Opening hooks folder...', async () => {
      const hooksDirectory = await this.resolveHooksDirectory(repoRoot, payload.hooksPath);
      const hooksUri = vscode.Uri.file(hooksDirectory);
      await vscode.workspace.fs.createDirectory(hooksUri);
      const opened = await vscode.env.openExternal(hooksUri);
      if (!opened) {
        await vscode.commands.executeCommand('revealFileInOS', hooksUri);
      }
    }, 'Hooks folder opened.');
  }

  private async handleOpenHookScript(payload: PayloadFor<'openHookScript'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const hookName = assertSafeHookName(payload.hookName);
    await this.executeUiAction(`Opening ${hookName} hook...`, async () => {
      const scriptUri = await this.ensureHookScript(repoRoot, payload.hooksPath, hookName);
      await this.refresh();
      const doc = await vscode.workspace.openTextDocument(scriptUri);
      await vscode.window.showTextDocument(doc, { preserveFocus: false, preview: false });
    }, `${hookName} hook ready.`);
  }

  private async handleSetRemoteUrl(payload: PayloadFor<'setRemoteUrl'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const remoteName = assertSafeRemoteName(payload.remoteName);
    const remoteUrl = payload.url.trim();
    await this.executeRepositoryAction('Saving remote URL...', async () => {
      await this.repository.setRemoteUrl(repoRoot, remoteName, remoteUrl);
    });
  }

  private async handleOpenPullRequest(payload: PayloadFor<'openPullRequest'>): Promise<void> {
    const { repoRoot, sourceBranch, targetBranch, title, description } = payload;
    const trustedRepoRoot = await this.getTrustedRepoRoot(repoRoot);
    const trustedSourceBranch = assertSafeBranchName(sourceBranch);
    const trustedTargetBranch = assertSafeBranchName(targetBranch);
    const [config, branches] = await Promise.all([
      this.repository.getRepoConfig(trustedRepoRoot),
      this.repository.getBranches(trustedRepoRoot)
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

  private async handleListStashes(payload: PayloadFor<'listStashes'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const entries = await this.repository.listStashes(repoRoot);
    await this.postMessage({ type: 'stashList', payload: { entries } });
  }

  private async handleStashChanges(payload: PayloadFor<'stashChanges'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const selectedPaths = payload.paths ? this.getSelectedPaths(payload.paths) ?? [] : undefined;
    if (selectedPaths?.length === 0) {
      await this.postNotification('error', 'Select at least one file to stash.');
      return;
    }

    const ok = await this.executeRepositoryAction('Stashing selected files...', async () => {
      await this.repository.stashChanges(repoRoot, payload.message, payload.includeUntracked, selectedPaths);
    }, selectedPaths ? 'Selected files stashed.' : undefined);
    if (!ok) return;
    const entries = await this.repository.listStashes(repoRoot);
    await this.postMessage({ type: 'stashList', payload: { entries } });
  }

  private async handlePreviewStash(payload: PayloadFor<'previewStash'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const stashRef = assertStashRef(payload.ref);
    try {
      await this.withBusy('Opening stash preview...', async () => {
        await this.repository.previewStash(repoRoot, stashRef);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[ui-error] ${message}`);
      await this.postNotification('error', message);
    }
  }

  private async handleApplyStash(payload: PayloadFor<'applyStash'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const stashRef = assertStashRef(payload.ref);
    const selectedPaths = payload.paths ? this.getSelectedPaths(payload.paths) ?? [] : undefined;
    if (selectedPaths?.length === 0) {
      await this.postNotification('error', 'Select at least one file to apply.');
      return;
    }

    const ok = await this.executeRepositoryAction(selectedPaths ? 'Applying selected stash files...' : 'Applying stash...', async () => {
      await this.repository.applyStash(repoRoot, stashRef, selectedPaths);
    }, selectedPaths ? 'Selected stash files applied.' : undefined);
    if (!ok) return;
    const entries = await this.repository.listStashes(repoRoot);
    await this.postMessage({ type: 'stashList', payload: { entries } });
  }

  private async handlePopStash(payload: PayloadFor<'popStash'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const stashRef = assertStashRef(payload.ref);
    const selectedPaths = payload.paths ? this.getSelectedPaths(payload.paths) ?? [] : undefined;
    if (selectedPaths?.length === 0) {
      await this.postNotification('error', 'Select at least one file to pop.');
      return;
    }

    const entriesBefore = selectedPaths ? await this.repository.listStashes(repoRoot) : [];
    const selectedStash = entriesBefore.find((entry) => entry.ref === stashRef);
    const isPartialPop = Boolean(selectedPaths && selectedStash?.files.length && selectedPaths.length < selectedStash.files.length);

    const ok = await this.executeRepositoryAction(selectedPaths ? 'Restoring selected stash files...' : 'Popping stash...', async () => {
      await this.repository.popStash(repoRoot, stashRef, selectedPaths);
    }, isPartialPop ? 'Selected files restored. The stash was kept because only part of it was selected.' : undefined);
    if (!ok) return;
    const entries = await this.repository.listStashes(repoRoot);
    await this.postMessage({ type: 'stashList', payload: { entries } });
  }

  private async handleDropStash(payload: PayloadFor<'dropStash'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const stashRef = assertStashRef(payload.ref);
    const confirmed = await vscode.window.showWarningMessage(`Drop stash ${stashRef}?`, { modal: true }, 'Drop');
    if (confirmed !== 'Drop') return;
    await this.executeRepositoryAction('Dropping stash...', async () => {
      await this.repository.dropStash(repoRoot, stashRef);
    });
    const entries = await this.repository.listStashes(repoRoot);
    await this.postMessage({ type: 'stashList', payload: { entries } });
  }

  private async handleListWorktrees(payload: PayloadFor<'listWorktrees'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const worktrees = await this.repository.listWorktrees(repoRoot);
    await this.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
  }

  private async handleAddWorktree(payload: PayloadFor<'addWorktree'>): Promise<void> {
    const { repoRoot, branch, createNew, worktreePath } = payload;
    const trustedRepoRoot = await this.getTrustedRepoRoot(repoRoot);
    const trustedBranch = createNew ? assertSafeBranchName(branch) : assertSafeGitRef(branch, 'branch');
    const trustedWorktreePath = assertSafeAbsoluteFsPath(worktreePath, 'worktree path');
    try {
      await this.withBusy('Adding worktree...', async () => {
        await this.repository.addWorktree(trustedRepoRoot, trustedWorktreePath, trustedBranch, createNew);
      });
      const worktrees = await this.repository.listWorktrees(trustedRepoRoot);
      await this.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[worktree-add] ${msg}`);
      await this.postMessage({ type: 'worktreeError', payload: { message: msg } });
    }
  }

  private async handleRemoveWorktree(payload: PayloadFor<'removeWorktree'>): Promise<void> {
    const { repoRoot, path: worktreePath, force } = payload;
    const { repoRoot: trustedRepoRoot, entry } = await this.getKnownWorktree(repoRoot, worktreePath);
    if (entry.isMain) {
      throw new Error('Cannot remove the main worktree.');
    }
    try {
      await this.withBusy('Removing worktree...', async () => {
        await this.repository.removeWorktree(trustedRepoRoot, entry.path, force);
        await this.repository.pruneWorktrees(trustedRepoRoot);
      });
      const worktrees = await this.repository.listWorktrees(trustedRepoRoot);
      await this.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[worktree-remove] ${msg}`);
      await this.postMessage({
        type: 'worktreeError',
        payload: { message: msg, path: worktreePath, canForce: !force && this.isDirtyWorktreeRemovalError(msg) }
      });
    }
  }

  private async handleOpenWorktreeInWindow(payload: PayloadFor<'openWorktreeInWindow'>): Promise<void> {
    const { entry } = await this.getKnownWorktree(payload.repoRoot, payload.path);
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(entry.path), { forceNewWindow: true });
    await this.postNotification('info', 'Worktree opened in a new window.');
  }

  private async handleRevealWorktreeInOs(payload: PayloadFor<'revealWorktreeInOs'>): Promise<void> {
    const { entry } = await this.getKnownWorktree(payload.repoRoot, payload.path);
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(entry.path));
  }

  private async handleCopyWorktreePath(payload: PayloadFor<'copyWorktreePath'>): Promise<void> {
    const { entry } = await this.getKnownWorktree(payload.repoRoot, payload.path);
    await vscode.env.clipboard.writeText(entry.path);
    await this.postNotification('info', 'Worktree path copied to clipboard.');
  }

  private async handleLockWorktree(payload: PayloadFor<'lockWorktree'>): Promise<void> {
    const { repoRoot, path: worktreePath } = payload;
    const { repoRoot: trustedRepoRoot, entry } = await this.getKnownWorktree(repoRoot, worktreePath);
    if (entry.isMain) {
      throw new Error('Cannot lock the main worktree.');
    }
    try {
      await this.repository.lockWorktree(trustedRepoRoot, entry.path);
      const worktrees = await this.repository.listWorktrees(trustedRepoRoot);
      await this.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[worktree-lock] ${msg}`);
      await this.postMessage({ type: 'worktreeError', payload: { message: msg } });
    }
  }

  private async handleUnlockWorktree(payload: PayloadFor<'unlockWorktree'>): Promise<void> {
    const { repoRoot, path: worktreePath } = payload;
    const { repoRoot: trustedRepoRoot, entry } = await this.getKnownWorktree(repoRoot, worktreePath);
    if (entry.isMain) {
      throw new Error('Cannot unlock the main worktree.');
    }
    try {
      await this.repository.unlockWorktree(trustedRepoRoot, entry.path);
      const worktrees = await this.repository.listWorktrees(trustedRepoRoot);
      await this.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[worktree-unlock] ${msg}`);
      await this.postMessage({ type: 'worktreeError', payload: { message: msg } });
    }
  }

  private async handleMoveWorktree(payload: PayloadFor<'moveWorktree'>): Promise<void> {
    const { repoRoot, path: worktreePath, newPath } = payload;
    const { repoRoot: trustedRepoRoot, entry } = await this.getKnownWorktree(repoRoot, worktreePath);
    if (entry.isMain) {
      throw new Error('Cannot move the main worktree.');
    }
    const trustedNewPath = assertSafeAbsoluteFsPath(newPath, 'new worktree path');
    try {
      await this.withBusy('Moving worktree...', async () => {
        await this.repository.moveWorktree(trustedRepoRoot, entry.path, trustedNewPath);
      });
      const worktrees = await this.repository.listWorktrees(trustedRepoRoot);
      await this.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[worktree-move] ${msg}`);
      await this.postMessage({ type: 'worktreeError', payload: { message: msg } });
    }
  }

  private async handleAddWorktreeAtCommit(payload: PayloadFor<'addWorktreeAtCommit'>): Promise<void> {
    const { repoRoot, worktreePath, commitHash } = payload;
    const trustedRepoRoot = await this.getTrustedRepoRoot(repoRoot);
    const trustedWorktreePath = assertSafeAbsoluteFsPath(worktreePath, 'worktree path');
    const trustedCommitHash = assertCommitHash(commitHash);
    try {
      await this.withBusy('Adding detached worktree...', async () => {
        await this.repository.addWorktreeAtCommit(trustedRepoRoot, trustedWorktreePath, trustedCommitHash);
      });
      const worktrees = await this.repository.listWorktrees(trustedRepoRoot);
      await this.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[worktree-add-detached] ${msg}`);
      await this.postMessage({ type: 'worktreeError', payload: { message: msg } });
    }
  }

  private async handleContinueOperation(payload: PayloadFor<'continueOperation'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const state = assertRepoSpecialState(payload.state);
    await this.executeRepositoryAction('Continuing...', async () => {
      await this.repository.continueOperation(repoRoot, state);
    });
  }

  private async handleSkipOperation(payload: PayloadFor<'skipOperation'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    await this.executeRepositoryAction('Skipping...', async () => {
      await this.repository.skipRebaseOperation(repoRoot);
    });
  }

  private async handleAbortOperation(payload: PayloadFor<'abortOperation'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const state = assertRepoSpecialState(payload.state);
    await this.executeRepositoryAction('Aborting...', async () => {
      await this.repository.abortOperation(repoRoot, state);
    });
  }

  private async handlePullRepo(payload: PayloadFor<'pullRepo'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    await this.executeRepositoryAction('Pulling...', async () => {
      await this.repository.pull(repoRoot);
    });
  }

  private async handlePushRepo(payload: PayloadFor<'pushRepo'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    await this.executeRepositoryAction('Pushing...', async () => {
      await this.repository.push(repoRoot);
    });
  }

  private async handleFetchRepo(payload: PayloadFor<'fetchRepo'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    await this.executeRepositoryAction('Fetching...', async () => {
      await this.fetchCoordinator.fetch(repoRoot, {
        reason: 'webview-fetch',
        minimumIntervalMs: DUPLICATE_FETCH_WINDOW_MS
      });
    });
  }

  private async handleOpenFile(payload: PayloadFor<'openFile'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const filePath = assertSafeRelativeGitPath(payload.filePath);
    const fullPath = vscode.Uri.file(path.join(repoRoot, filePath));
    const doc = await vscode.workspace.openTextDocument(fullPath);
    await vscode.window.showTextDocument(doc, { preserveFocus: false, preview: false });
  }

  private async handleCompareBranches(payload: PayloadFor<'compareBranches'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const baseRef = assertSafeGitRef(payload.baseRef, 'base ref');
    const targetRef = assertSafeGitRef(payload.targetRef, 'target ref');
    const result = await this.repository.compareBranches(repoRoot, baseRef, targetRef);
    await this.postMessage({ type: 'branchCompareResult', payload: result });
  }

  private async handleListUndoEntries(payload: PayloadFor<'listUndoEntries'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const entries = await this.repository.listUndoEntries(repoRoot);
    await this.postMessage({ type: 'undoEntries', payload: { entries } });
  }

  private async handleUndoTo(payload: PayloadFor<'undoTo'>): Promise<void> {
    const repoRoot = await this.getTrustedRepoRoot(payload.repoRoot);
    const ref = assertReflogRef(payload.ref);
    const confirmed = await vscode.window.showWarningMessage(
      `Undo to ${ref}? This performs a hard reset and can discard uncommitted changes.`,
      { modal: true },
      'Undo'
    );
    if (confirmed !== 'Undo') return;

    await this.executeRepositoryAction('Undoing last operation...', async () => {
      await this.repository.undoTo(repoRoot, ref);
    });
  }

  // Remote/PR helpers moved to GitGraphUtils.ts

  private normalizeFilters(filters: Partial<GraphFilters>): Partial<GraphFilters> {
    const normalized: Partial<GraphFilters> = {};

    if (typeof filters.includeRemotes === 'boolean') {
      normalized.includeRemotes = filters.includeRemotes;
    }

    if (typeof filters.limit === 'number' && Number.isFinite(filters.limit)) {
      normalized.limit = Math.min(Math.max(Math.trunc(filters.limit), 50), 5_000);
    }

    if (typeof filters.search === 'string') {
      normalized.search = filters.search.slice(0, 200);
    }

    if (typeof filters.author === 'string') {
      normalized.author = filters.author.slice(0, 200);
    }

    return normalized;
  }

  private async getTrustedRepoRoot(repoRoot: string): Promise<string> {
    const requested = assertSafeAbsoluteFsPath(repoRoot, 'repository root');
    const resolved = await this.repository.resolveRepositoryRoot(requested);

    if (normalizeFsPathForComparison(resolved) !== normalizeFsPathForComparison(requested)) {
      throw new Error('Invalid repository root.');
    }

    return resolved;
  }

  private async getKnownWorktree(repoRoot: string, worktreePath: string): Promise<{ repoRoot: string; entry: WorktreeEntry }> {
    const trustedRepoRoot = await this.getTrustedRepoRoot(repoRoot);
    const requestedPath = assertSafeAbsoluteFsPath(worktreePath, 'worktree path');
    const requestedKey = normalizeFsPathForComparison(requestedPath);
    const entries = await this.repository.listWorktrees(trustedRepoRoot);
    const entry = entries.find((candidate) => normalizeFsPathForComparison(candidate.path) === requestedKey);

    if (!entry) {
      throw new Error('Unknown worktree path.');
    }

    return { repoRoot: trustedRepoRoot, entry };
  }

  private validateDiffRequest(payload: PayloadFor<'openDiff'>): PayloadFor<'openDiff'> {
    return {
      repoRoot: assertSafeAbsoluteFsPath(payload.repoRoot, 'repository root'),
      commitHash: assertSafeGitRef(payload.commitHash, 'commit ref'),
      parentHash: payload.parentHash ? assertSafeGitRef(payload.parentHash, 'parent ref') : undefined,
      filePath: assertSafeRelativeGitPath(payload.filePath),
      originalPath: payload.originalPath ? assertSafeRelativeGitPath(payload.originalPath, 'original file path') : undefined
    };
  }

  private getSelectedPaths(paths?: string[]): string[] | undefined {
    return assertSafeRelativeGitPaths(paths);
  }

  private async executeRepositoryAction(label: string, action: () => Promise<void>, successMessage = 'Operation completed successfully.'): Promise<boolean> {
    try {
      await this.withBusy(label, async () => {
        await action();
        if (this.onRepositoryChanged) {
          this.onRepositoryChanged();
        } else {
          await this.refresh();
        }
        await this.postNotification('info', successMessage);
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[ui-error] ${message}`);
      await this.postNotification('error', message);
      return false;
    }
  }

  private async executeUiAction(label: string, action: () => Promise<void>, successMessage: string): Promise<boolean> {
    try {
      await this.withBusy(label, async () => {
        await action();
        await this.postNotification('info', successMessage);
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[ui-error] ${message}`);
      await this.postNotification('error', message);
      return false;
    }
  }

  private async withBusy(label: string, action: () => Promise<void>): Promise<void> {
    await this.postMessage({ type: 'busy', payload: { value: true, label } });
    try {
      await action();
    } finally {
      await this.postMessage({ type: 'busy', payload: { value: false } });
    }
  }

  private async postNotification(kind: 'info' | 'error', message: string): Promise<void> {
    await this.postMessage({
      type: 'notification',
      payload: { kind, message }
    });
  }

  private async postMessage(message: ExtensionToWebviewMessage): Promise<void> {
    const sends: Array<Thenable<boolean>> = [];
    if (this.currentView?.visible) {
      sends.push(this.currentView.webview.postMessage(message));
    }
    if (this.currentPanel != null) {
      sends.push(this.currentPanel.webview.postMessage(message));
    }
    await Promise.all(sends);
  }

  private async resolveHooksDirectory(repoRoot: string, hooksPath: string): Promise<string> {
    const nodePath = await import('node:path');
    const configuredPath = hooksPath.trim();

    if (configuredPath) {
      return nodePath.isAbsolute(configuredPath)
        ? configuredPath
        : nodePath.join(repoRoot, configuredPath);
    }

    try {
      const [{ execFile }, { promisify }] = await Promise.all([
        import('node:child_process'),
        import('node:util')
      ]);
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: repoRoot });
      const resolvedPath = stdout.trim();
      if (resolvedPath) {
        return nodePath.isAbsolute(resolvedPath)
          ? resolvedPath
          : nodePath.join(repoRoot, resolvedPath);
      }
    } catch {
      // Fall back to the standard repository hooks directory when Git path resolution fails.
    }

    return nodePath.join(repoRoot, '.git', 'hooks');
  }

  private async ensureHookScript(repoRoot: string, hooksPath: string, hookName: string): Promise<vscode.Uri> {
    const trustedHookName = assertSafeHookName(hookName);

    const [{ chmod }, nodePath] = await Promise.all([
      import('node:fs/promises'),
      import('node:path')
    ]);
    const hooksDirectory = await this.resolveHooksDirectory(repoRoot, hooksPath);
    const hooksUri = vscode.Uri.file(hooksDirectory);
    await vscode.workspace.fs.createDirectory(hooksUri);

    const scriptUri = vscode.Uri.file(nodePath.join(hooksDirectory, trustedHookName));
    let exists = true;
    try {
      await vscode.workspace.fs.stat(scriptUri);
    } catch {
      exists = false;
    }

    if (!exists) {
      await vscode.workspace.fs.writeFile(scriptUri, Buffer.from(buildHookTemplate(trustedHookName), 'utf8'));
      if (process.platform !== 'win32') {
        await chmod(scriptUri.fsPath, 0o755).catch(() => undefined);
      }
    }

    return scriptUri;
  }

  private isDirtyWorktreeRemovalError(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('contains modified or untracked files')
      || normalized.includes('has uncommitted changes')
      || normalized.includes('cannot remove: worktree contains');
  }


}
