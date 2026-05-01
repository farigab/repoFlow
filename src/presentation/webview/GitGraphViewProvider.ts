import * as vscode from 'vscode';
import type { GraphFilters } from '../../core/models';
import type { GitRepository } from '../../core/ports/GitRepository';

import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../../shared/protocol';
import { buildRepoStatusBarText, buildRepoSummary } from '../../shared/repoSummary';
import { renderHtml } from './GitGraphRenderer';
import { buildPrUrl, resolvePreferredRemoteForPullRequest } from './GitGraphUtils';
type MessageType = WebviewToExtensionMessage['type'];
type PayloadFor<T extends MessageType> = Extract<WebviewToExtensionMessage, { type: T }> extends { payload: infer P } ? P : undefined;

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
    private readonly output: vscode.OutputChannel,
    private readonly repoStatusBar?: vscode.StatusBarItem
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
    // openOrReveal() resets selectedCommitHash synchronously, so set ours back
    // immediately after — refresh() is async and reads it on next microtask.
    this.openOrReveal();
    this.selectedCommitHash = commitHash;
    this.pendingRevealHash = commitHash;
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

    const handler = handlers[message.type];
    if (handler) {
      const payload = (message as WebviewToExtensionMessage & { payload?: unknown }).payload;
      await (handler as (p: unknown) => Promise<void>)(payload);
    }
  }

  private async handleReady(): Promise<void> {
    await this.refresh();
  }

  private async handleLoadMore(payload: PayloadFor<'loadMore'>): Promise<void> {
    this.filters = { ...this.filters, limit: payload.limit };
    await this.refresh();
  }

  private async handleApplyFilters(payload: PayloadFor<'applyFilters'>): Promise<void> {
    this.filters = { ...this.filters, ...payload };
    await this.refresh();
  }

  private async handleSelectCommit(payload: PayloadFor<'selectCommit'>): Promise<void> {
    this.selectedCommitHash = payload.commitHash;
    const detail = await this.repository.getCommitDetail(payload.repoRoot, payload.commitHash);
    await this.postMessage({ type: 'commitDetail', payload: detail });
  }

  private async handleOpenDiff(payload: PayloadFor<'openDiff'>): Promise<void> {
    await this.repository.openDiff(payload);
  }

  private async handleCreateBranchPrompt(payload: PayloadFor<'createBranchPrompt'>): Promise<void> {
    const name = await vscode.window.showInputBox({
      title: 'Create Branch',
      prompt: 'New branch name',
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : 'Please enter a branch name.')
    });
    if (!name) return;
    await this.executeRepositoryAction('Creating branch...', async () => {
      await this.repository.createBranch(payload.repoRoot, name.trim(), payload.fromRef);
    });
  }

  private async handleDeleteBranch(payload: PayloadFor<'deleteBranch'>): Promise<void> {
    await this.executeRepositoryAction('Deleting branch...', async () => {
      await this.repository.deleteBranch(payload.repoRoot, payload.branchName);
    });
  }

  private async handleCheckoutCommit(payload: PayloadFor<'checkoutCommit'>): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
      `Checkout detached HEAD at ${payload.commitHash.slice(0, 8)}?`,
      { modal: true },
      'Checkout'
    );
    if (confirmed !== 'Checkout') return;
    await this.executeRepositoryAction('Checking out commit...', async () => {
      await this.repository.checkout(payload.repoRoot, payload.commitHash);
    });
  }

  private async handleCherryPick(payload: PayloadFor<'cherryPick'>): Promise<void> {
    await this.executeRepositoryAction('Cherry-picking...', async () => {
      await this.repository.cherryPick(payload.repoRoot, payload.commitHash);
    });
  }

  private async handleRevertCommit(payload: PayloadFor<'revertCommit'>): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
      `Revert commit ${payload.commitHash.slice(0, 8)}?`,
      { modal: true },
      'Revert'
    );
    if (confirmed !== 'Revert') return;
    await this.executeRepositoryAction('Reverting commit...', async () => {
      await this.repository.revert(payload.repoRoot, payload.commitHash);
    });
  }

  private async handleDropCommit(payload: PayloadFor<'dropCommit'>): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
      `Drop commit ${payload.commitHash.slice(0, 8)}? This rewrites history.`,
      { modal: true },
      'Drop'
    );
    if (confirmed !== 'Drop') return;
    await this.executeRepositoryAction('Dropping commit...', async () => {
      await this.repository.dropCommit(payload.repoRoot, payload.commitHash);
    });
  }

  private async handleMergeCommit(payload: PayloadFor<'mergeCommit'>): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
      `Merge commit ${payload.commitHash.slice(0, 8)} into the current branch?`,
      { modal: true },
      'Merge'
    );
    if (confirmed !== 'Merge') return;
    await this.executeRepositoryAction('Merging...', async () => {
      await this.repository.merge(payload.repoRoot, payload.commitHash);
    });
  }

  private async handleRebaseOnCommit(payload: PayloadFor<'rebaseOnCommit'>): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
      `Rebase current branch onto commit ${payload.commitHash.slice(0, 8)}?`,
      { modal: true },
      'Rebase'
    );
    if (confirmed !== 'Rebase') return;
    await this.executeRepositoryAction('Rebasing...', async () => {
      await this.repository.rebase(payload.repoRoot, payload.commitHash);
    });
  }

  private async handleResetToCommit(payload: PayloadFor<'resetToCommit'>): Promise<void> {
    const mode = await vscode.window.showQuickPick(
      [
        { label: 'Soft', description: 'Keep changes staged', value: 'soft' as const },
        { label: 'Mixed', description: 'Keep changes in working tree', value: 'mixed' as const },
        { label: 'Hard', description: 'Discard all changes', value: 'hard' as const }
      ],
      { title: `Reset to ${payload.commitHash.slice(0, 8)}`, placeHolder: 'Select reset mode' }
    );
    if (!mode) return;
    const confirmed = await vscode.window.showWarningMessage(
      `Reset (${mode.label}) current branch to ${payload.commitHash.slice(0, 8)}?`,
      { modal: true },
      'Reset'
    );
    if (confirmed !== 'Reset') return;
    await this.executeRepositoryAction('Resetting...', async () => {
      await this.repository.resetTo(payload.repoRoot, payload.commitHash, mode.value);
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
    const hash = payload.commitHash;
    if (!/^[0-9a-f]{4,40}$/i.test(hash)) {
      await this.postNotification('error', 'Invalid commit hash.');
      return;
    }
    const terminal = vscode.window.createTerminal({ cwd: payload.repoRoot, name: 'RepoFlow' });
    terminal.show();
    terminal.sendText(`git show --stat ${hash}`, true);
  }

  private async handleStageFile(payload: PayloadFor<'stageFile'>): Promise<void> {
    await this.executeRepositoryAction('Staging file...', async () => {
      await this.repository.stageFile(payload.repoRoot, payload.file.path);
    });
  }

  private async handleUnstageFile(payload: PayloadFor<'unstageFile'>): Promise<void> {
    await this.executeRepositoryAction('Unstaging file...', async () => {
      await this.repository.unstageFile(payload.repoRoot, payload.file.path);
    });
  }

  private async handleDiscardFile(payload: PayloadFor<'discardFile'>): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
      `Discard changes in ${payload.file.path}?`,
      { modal: true },
      'Discard'
    );
    if (confirmed !== 'Discard') return;
    const tracked = payload.file.indexStatus !== '?' && payload.file.workTreeStatus !== '?';
    const stagedAddition = payload.file.indexStatus === 'A';
    await this.executeRepositoryAction('Discarding changes...', async () => {
      await this.repository.discardFile(payload.repoRoot, payload.file.path, tracked, stagedAddition);
    });
  }

  private async handleCommitChangesPrompt(payload: PayloadFor<'commitChangesPrompt'>): Promise<void> {
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
      await this.repository.commit(payload.repoRoot, messageText.trim(), amend);
    });
  }

  private async handleSetGitUserName(payload: PayloadFor<'setGitUserName'>): Promise<void> {
    await this.executeRepositoryAction('Saving user.name...', async () => {
      await this.repository.setGitUserName(payload.repoRoot, payload.name);
    });
  }

  private async handleSetGitUserEmail(payload: PayloadFor<'setGitUserEmail'>): Promise<void> {
    await this.executeRepositoryAction('Saving user.email...', async () => {
      await this.repository.setGitUserEmail(payload.repoRoot, payload.email);
    });
  }

  private async handleSetRemoteUrl(payload: PayloadFor<'setRemoteUrl'>): Promise<void> {
    await this.executeRepositoryAction('Saving remote URL...', async () => {
      await this.repository.setRemoteUrl(payload.repoRoot, payload.remoteName, payload.url);
    });
  }

  private async handleOpenPullRequest(payload: PayloadFor<'openPullRequest'>): Promise<void> {
    const { repoRoot, sourceBranch, targetBranch, title, description } = payload;
    const [config, branches] = await Promise.all([
      this.repository.getRepoConfig(repoRoot),
      this.repository.getBranches(repoRoot)
    ]);
    const remote = resolvePreferredRemoteForPullRequest(sourceBranch, branches, config.remotes);
    const remoteUrl = remote?.url ?? '';
    const prUrl = buildPrUrl(remoteUrl, sourceBranch, targetBranch, title, description);
    if (prUrl) {
      await vscode.env.openExternal(vscode.Uri.parse(prUrl));
    } else {
      await vscode.window.showWarningMessage(`Could not detect PR URL. Remote: ${remoteUrl || '(none)'}`);
    }
  }

  private async handleListStashes(payload: PayloadFor<'listStashes'>): Promise<void> {
    const entries = await this.repository.listStashes(payload.repoRoot);
    await this.postMessage({ type: 'stashList', payload: { entries } });
  }

  private async handleStashChanges(payload: PayloadFor<'stashChanges'>): Promise<void> {
    const selectedPaths = payload.paths ? this.getSelectedPaths(payload.paths) ?? [] : undefined;
    if (selectedPaths !== undefined && selectedPaths.length === 0) {
      await this.postNotification('error', 'Select at least one file to stash.');
      return;
    }

    const ok = await this.executeRepositoryAction('Stashing selected files...', async () => {
      await this.repository.stashChanges(payload.repoRoot, payload.message, payload.includeUntracked, selectedPaths);
    }, selectedPaths ? 'Selected files stashed.' : undefined);
    if (!ok) return;
    const entries = await this.repository.listStashes(payload.repoRoot);
    await this.postMessage({ type: 'stashList', payload: { entries } });
  }

  private async handlePreviewStash(payload: PayloadFor<'previewStash'>): Promise<void> {
    try {
      await this.withBusy('Opening stash preview...', async () => {
        await this.repository.previewStash(payload.repoRoot, payload.ref);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[ui-error] ${message}`);
      await this.postNotification('error', message);
    }
  }

  private async handleApplyStash(payload: PayloadFor<'applyStash'>): Promise<void> {
    const selectedPaths = payload.paths ? this.getSelectedPaths(payload.paths) ?? [] : undefined;
    if (selectedPaths !== undefined && selectedPaths.length === 0) {
      await this.postNotification('error', 'Select at least one file to apply.');
      return;
    }

    const ok = await this.executeRepositoryAction(selectedPaths ? 'Applying selected stash files...' : 'Applying stash...', async () => {
      await this.repository.applyStash(payload.repoRoot, payload.ref, selectedPaths);
    }, selectedPaths ? 'Selected stash files applied.' : undefined);
    if (!ok) return;
    const entries = await this.repository.listStashes(payload.repoRoot);
    await this.postMessage({ type: 'stashList', payload: { entries } });
  }

  private async handlePopStash(payload: PayloadFor<'popStash'>): Promise<void> {
    const selectedPaths = payload.paths ? this.getSelectedPaths(payload.paths) ?? [] : undefined;
    if (selectedPaths !== undefined && selectedPaths.length === 0) {
      await this.postNotification('error', 'Select at least one file to pop.');
      return;
    }

    const entriesBefore = selectedPaths ? await this.repository.listStashes(payload.repoRoot) : [];
    const selectedStash = entriesBefore.find((entry) => entry.ref === payload.ref);
    const isPartialPop = Boolean(selectedPaths && selectedStash?.files.length && selectedPaths.length < selectedStash.files.length);

    const ok = await this.executeRepositoryAction(selectedPaths ? 'Restoring selected stash files...' : 'Popping stash...', async () => {
      await this.repository.popStash(payload.repoRoot, payload.ref, selectedPaths);
    }, isPartialPop ? 'Selected files restored. The stash was kept because only part of it was selected.' : undefined);
    if (!ok) return;
    const entries = await this.repository.listStashes(payload.repoRoot);
    await this.postMessage({ type: 'stashList', payload: { entries } });
  }

  private async handleDropStash(payload: PayloadFor<'dropStash'>): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(`Drop stash ${payload.ref}?`, { modal: true }, 'Drop');
    if (confirmed !== 'Drop') return;
    await this.executeRepositoryAction('Dropping stash...', async () => {
      await this.repository.dropStash(payload.repoRoot, payload.ref);
    });
    const entries = await this.repository.listStashes(payload.repoRoot);
    await this.postMessage({ type: 'stashList', payload: { entries } });
  }

  private async handleListWorktrees(payload: PayloadFor<'listWorktrees'>): Promise<void> {
    const worktrees = await this.repository.listWorktrees(payload.repoRoot);
    await this.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
  }

  private async handleAddWorktree(payload: PayloadFor<'addWorktree'>): Promise<void> {
    const { repoRoot, branch, createNew, worktreePath } = payload;
    try {
      await this.withBusy('Adding worktree...', async () => {
        await this.repository.addWorktree(repoRoot, worktreePath.trim(), branch, createNew);
      });
      const worktrees = await this.repository.listWorktrees(repoRoot);
      await this.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[worktree-add] ${msg}`);
      await this.postMessage({ type: 'worktreeError', payload: { message: msg } });
    }
  }

  private async handleRemoveWorktree(payload: PayloadFor<'removeWorktree'>): Promise<void> {
    const { repoRoot, path: worktreePath, force } = payload;
    try {
      await this.withBusy('Removing worktree...', async () => {
        await this.repository.removeWorktree(repoRoot, worktreePath, force);
        await this.repository.pruneWorktrees(repoRoot);
      });
      const worktrees = await this.repository.listWorktrees(repoRoot);
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
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(payload.path), { forceNewWindow: true });
    await this.postNotification('info', 'Worktree opened in a new window.');
  }

  private async handleRevealWorktreeInOs(payload: PayloadFor<'revealWorktreeInOs'>): Promise<void> {
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(payload.path));
  }

  private async handleCopyWorktreePath(payload: PayloadFor<'copyWorktreePath'>): Promise<void> {
    await vscode.env.clipboard.writeText(payload.path);
    await this.postNotification('info', 'Worktree path copied to clipboard.');
  }

  private async handleLockWorktree(payload: PayloadFor<'lockWorktree'>): Promise<void> {
    const { repoRoot, path: worktreePath } = payload;
    try {
      await this.repository.lockWorktree(repoRoot, worktreePath);
      const worktrees = await this.repository.listWorktrees(repoRoot);
      await this.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[worktree-lock] ${msg}`);
      await this.postMessage({ type: 'worktreeError', payload: { message: msg } });
    }
  }

  private async handleUnlockWorktree(payload: PayloadFor<'unlockWorktree'>): Promise<void> {
    const { repoRoot, path: worktreePath } = payload;
    try {
      await this.repository.unlockWorktree(repoRoot, worktreePath);
      const worktrees = await this.repository.listWorktrees(repoRoot);
      await this.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[worktree-unlock] ${msg}`);
      await this.postMessage({ type: 'worktreeError', payload: { message: msg } });
    }
  }

  private async handleMoveWorktree(payload: PayloadFor<'moveWorktree'>): Promise<void> {
    const { repoRoot, path: worktreePath, newPath } = payload;
    try {
      await this.withBusy('Moving worktree...', async () => {
        await this.repository.moveWorktree(repoRoot, worktreePath, newPath);
      });
      const worktrees = await this.repository.listWorktrees(repoRoot);
      await this.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[worktree-move] ${msg}`);
      await this.postMessage({ type: 'worktreeError', payload: { message: msg } });
    }
  }

  private async handleAddWorktreeAtCommit(payload: PayloadFor<'addWorktreeAtCommit'>): Promise<void> {
    const { repoRoot, worktreePath, commitHash } = payload;
    try {
      await this.withBusy('Adding detached worktree...', async () => {
        await this.repository.addWorktreeAtCommit(repoRoot, worktreePath.trim(), commitHash.trim());
      });
      const worktrees = await this.repository.listWorktrees(repoRoot);
      await this.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[worktree-add-detached] ${msg}`);
      await this.postMessage({ type: 'worktreeError', payload: { message: msg } });
    }
  }

  private async handleContinueOperation(payload: PayloadFor<'continueOperation'>): Promise<void> {
    await this.executeRepositoryAction('Continuing...', async () => {
      await this.repository.continueOperation(payload.repoRoot, payload.state as import('../../core/models').RepoSpecialState);
    });
  }

  private async handleSkipOperation(payload: PayloadFor<'skipOperation'>): Promise<void> {
    await this.executeRepositoryAction('Skipping...', async () => {
      await this.repository.skipRebaseOperation(payload.repoRoot);
    });
  }

  private async handleAbortOperation(payload: PayloadFor<'abortOperation'>): Promise<void> {
    await this.executeRepositoryAction('Aborting...', async () => {
      await this.repository.abortOperation(payload.repoRoot, payload.state as import('../../core/models').RepoSpecialState);
    });
  }

  private async handlePullRepo(payload: PayloadFor<'pullRepo'>): Promise<void> {
    await this.executeRepositoryAction('Pulling...', async () => {
      await this.repository.pull(payload.repoRoot);
    });
  }

  private async handlePushRepo(payload: PayloadFor<'pushRepo'>): Promise<void> {
    await this.executeRepositoryAction('Pushing...', async () => {
      await this.repository.push(payload.repoRoot);
    });
  }

  private async handleFetchRepo(payload: PayloadFor<'fetchRepo'>): Promise<void> {
    await this.executeRepositoryAction('Fetching...', async () => {
      await this.repository.fetch(payload.repoRoot);
    });
  }

  private async handleOpenFile(payload: PayloadFor<'openFile'>): Promise<void> {
    const nodePath = await import('node:path');
    const fullPath = vscode.Uri.file(nodePath.join(payload.repoRoot, payload.filePath));
    const doc = await vscode.workspace.openTextDocument(fullPath);
    await vscode.window.showTextDocument(doc, { preserveFocus: false, preview: false });
  }

  private async handleCompareBranches(payload: PayloadFor<'compareBranches'>): Promise<void> {
    const result = await this.repository.compareBranches(payload.repoRoot, payload.baseRef, payload.targetRef);
    await this.postMessage({ type: 'branchCompareResult', payload: result });
  }

  private async handleListUndoEntries(payload: PayloadFor<'listUndoEntries'>): Promise<void> {
    const entries = await this.repository.listUndoEntries(payload.repoRoot);
    await this.postMessage({ type: 'undoEntries', payload: { entries } });
  }

  private async handleUndoTo(payload: PayloadFor<'undoTo'>): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
      `Undo to ${payload.ref}? This performs a hard reset and can discard uncommitted changes.`,
      { modal: true },
      'Undo'
    );
    if (confirmed !== 'Undo') return;

    await this.executeRepositoryAction('Undoing last operation...', async () => {
      await this.repository.undoTo(payload.repoRoot, payload.ref);
    });
  }

  // Remote/PR helpers moved to GitGraphUtils.ts

  private getSelectedPaths(paths?: string[]): string[] | undefined {
    if (!paths) {
      return undefined;
    }

    return paths.filter((filePath) => filePath.trim().length > 0);
  }

  private async executeRepositoryAction(label: string, action: () => Promise<void>, successMessage = 'Operation completed successfully.'): Promise<boolean> {
    try {
      await this.withBusy(label, async () => {
        await action();
        await this.refresh();
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

  private isDirtyWorktreeRemovalError(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('contains modified or untracked files')
      || normalized.includes('has uncommitted changes')
      || normalized.includes('cannot remove: worktree contains');
  }


}
