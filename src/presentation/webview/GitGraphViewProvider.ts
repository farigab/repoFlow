import * as vscode from 'vscode';
import type { BranchSummary, GraphFilters, RepoRemote } from '../../core/models';
import type { GitRepository } from '../../core/ports/GitRepository';
import { createNonce } from '../../shared/nonce';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../../shared/protocol';
import { buildRepoStatusBarText, buildRepoSummary } from '../../shared/repoSummary';

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
    void _context;
    void _token;
    this.currentView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.extensionUri, 'media')
      ]
    };

    webviewView.webview.html = this.renderHtml(webviewView.webview);

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
    panel.webview.html = this.renderHtml(panel.webview);

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

      if (this.pendingRevealHash) {
        // Send revealCommit BEFORE commitDetail so the webview can prime
        // requestedCommitHashRef before the detail message arrives.
        await this.postMessage({ type: 'revealCommit', payload: { commitHash: this.pendingRevealHash } });
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
    switch (message.type) {
      case 'ready':
        await this.refresh();
        return;
      case 'loadMore':
        this.filters = { ...this.filters, limit: message.payload.limit };
        await this.refresh();
        return;
      case 'applyFilters':
        this.filters = { ...this.filters, ...message.payload };
        await this.refresh();
        return;
      case 'selectCommit':
        this.selectedCommitHash = message.payload.commitHash;
        {
          const detail = await this.repository.getCommitDetail(message.payload.repoRoot, message.payload.commitHash);
          await this.postMessage({ type: 'commitDetail', payload: detail });
        }
        return;
      case 'openDiff':
        await this.repository.openDiff(message.payload);
        return;
      case 'createBranchPrompt': {
        const name = await vscode.window.showInputBox({
          title: 'Create Branch',
          prompt: 'New branch name',
          ignoreFocusOut: true,
          validateInput: (value) => (value.trim() ? undefined : 'Please enter a branch name.')
        });

        if (!name) {
          return;
        }

        await this.executeRepositoryAction('Creating branch...', async () => {
          await this.repository.createBranch(message.payload.repoRoot, name.trim(), message.payload.fromRef);
        });
        return;
      }
      case 'deleteBranch': {
        await this.executeRepositoryAction('Deleting branch...', async () => {
          await this.repository.deleteBranch(message.payload.repoRoot, message.payload.branchName);
        });
        return;
      }
      case 'checkoutCommit': {
        const confirmed = await vscode.window.showWarningMessage(
          `Checkout detached HEAD at ${message.payload.commitHash.slice(0, 8)}?`,
          { modal: true },
          'Checkout'
        );

        if (confirmed !== 'Checkout') {
          return;
        }

        await this.executeRepositoryAction('Checking out commit...', async () => {
          await this.repository.checkout(message.payload.repoRoot, message.payload.commitHash);
        });
        return;
      }
      case 'cherryPick':
        await this.executeRepositoryAction('Cherry-picking...', async () => {
          await this.repository.cherryPick(message.payload.repoRoot, message.payload.commitHash);
        });
        return;
      case 'revertCommit': {
        const confirmed = await vscode.window.showWarningMessage(
          `Revert commit ${message.payload.commitHash.slice(0, 8)}?`,
          { modal: true },
          'Revert'
        );

        if (confirmed !== 'Revert') {
          return;
        }

        await this.executeRepositoryAction('Reverting commit...', async () => {
          await this.repository.revert(message.payload.repoRoot, message.payload.commitHash);
        });
        return;
      }
      case 'dropCommit': {
        const confirmed = await vscode.window.showWarningMessage(
          `Drop commit ${message.payload.commitHash.slice(0, 8)}? This rewrites history.`,
          { modal: true },
          'Drop'
        );

        if (confirmed !== 'Drop') {
          return;
        }

        await this.executeRepositoryAction('Dropping commit...', async () => {
          await this.repository.dropCommit(message.payload.repoRoot, message.payload.commitHash);
        });
        return;
      }
      case 'mergeCommit': {
        const confirmed = await vscode.window.showWarningMessage(
          `Merge commit ${message.payload.commitHash.slice(0, 8)} into the current branch?`,
          { modal: true },
          'Merge'
        );

        if (confirmed !== 'Merge') {
          return;
        }

        await this.executeRepositoryAction('Merging...', async () => {
          await this.repository.merge(message.payload.repoRoot, message.payload.commitHash);
        });
        return;
      }
      case 'rebaseOnCommit': {
        const confirmed = await vscode.window.showWarningMessage(
          `Rebase current branch onto commit ${message.payload.commitHash.slice(0, 8)}?`,
          { modal: true },
          'Rebase'
        );

        if (confirmed !== 'Rebase') {
          return;
        }

        await this.executeRepositoryAction('Rebasing...', async () => {
          await this.repository.rebase(message.payload.repoRoot, message.payload.commitHash);
        });
        return;
      }
      case 'resetToCommit': {
        const mode = await vscode.window.showQuickPick(
          [
            { label: 'Soft', description: 'Keep changes staged', value: 'soft' as const },
            { label: 'Mixed', description: 'Keep changes in working tree', value: 'mixed' as const },
            { label: 'Hard', description: 'Discard all changes', value: 'hard' as const }
          ],
          { title: `Reset to ${message.payload.commitHash.slice(0, 8)}`, placeHolder: 'Select reset mode' }
        );

        if (!mode) {
          return;
        }

        const confirmed = await vscode.window.showWarningMessage(
          `Reset (${mode.label}) current branch to ${message.payload.commitHash.slice(0, 8)}?`,
          { modal: true },
          'Reset'
        );

        if (confirmed !== 'Reset') {
          return;
        }

        await this.executeRepositoryAction('Resetting...', async () => {
          await this.repository.resetTo(message.payload.repoRoot, message.payload.commitHash, mode.value);
        });
        return;
      }
      case 'copyHash':
        await vscode.env.clipboard.writeText(message.payload.hash);
        await this.postNotification('info', 'Hash copied to clipboard.');
        return;
      case 'copySubject':
        await vscode.env.clipboard.writeText(message.payload.subject);
        await this.postNotification('info', 'Subject copied to clipboard.');
        return;
      case 'openInTerminal': {
        const hash = message.payload.commitHash;
        if (!/^[0-9a-f]{4,40}$/i.test(hash)) {
          await this.postNotification('error', 'Invalid commit hash.');
          return;
        }
        const terminal = vscode.window.createTerminal({ cwd: message.payload.repoRoot, name: 'RepoFlow' });
        terminal.show();
        terminal.sendText(`git show --stat ${hash}`, true);
        return;
      }
      case 'stageFile':
        await this.executeRepositoryAction('Staging file...', async () => {
          await this.repository.stageFile(message.payload.repoRoot, message.payload.file.path);
        });
        return;
      case 'unstageFile':
        await this.executeRepositoryAction('Unstaging file...', async () => {
          await this.repository.unstageFile(message.payload.repoRoot, message.payload.file.path);
        });
        return;
      case 'discardFile': {
        const confirmed = await vscode.window.showWarningMessage(
          `Discard changes in ${message.payload.file.path}?`,
          { modal: true },
          'Discard'
        );

        if (confirmed !== 'Discard') {
          return;
        }

        const tracked = message.payload.file.indexStatus !== '?' && message.payload.file.workTreeStatus !== '?';
        await this.executeRepositoryAction('Discarding changes...', async () => {
          await this.repository.discardFile(message.payload.repoRoot, message.payload.file.path, tracked);
        });
        return;
      }
      case 'commitChangesPrompt': {
        const messageText = await vscode.window.showInputBox({
          title: 'Commit Changes',
          prompt: 'Commit message',
          ignoreFocusOut: true,
          validateInput: (value) => (value.trim() ? undefined : 'Please enter a commit message.')
        });

        if (!messageText) {
          return;
        }

        await this.executeRepositoryAction('Committing...', async () => {
          await this.repository.commit(message.payload.repoRoot, messageText.trim());
        });
        return;
      }
      case 'setGitUserName': {
        await this.executeRepositoryAction('Saving user.name...', async () => {
          await this.repository.setGitUserName(message.payload.repoRoot, message.payload.name);
        });
        return;
      }
      case 'setGitUserEmail': {
        await this.executeRepositoryAction('Saving user.email...', async () => {
          await this.repository.setGitUserEmail(message.payload.repoRoot, message.payload.email);
        });
        return;
      }
      case 'setRemoteUrl': {
        await this.executeRepositoryAction('Saving remote URL...', async () => {
          await this.repository.setRemoteUrl(message.payload.repoRoot, message.payload.remoteName, message.payload.url);
        });
        return;
      }
      case 'openPullRequest': {
        const { repoRoot, sourceBranch, targetBranch, title, description } = message.payload;
        const [config, branches] = await Promise.all([
          this.repository.getRepoConfig(repoRoot),
          this.repository.getBranches(repoRoot)
        ]);
        const remote = this.resolvePreferredRemoteForPullRequest(sourceBranch, branches, config.remotes);
        const remoteUrl = remote?.url ?? '';

        // Detect GitHub / GitLab / Bitbucket and build the compare URL
        const prUrl = this.buildPrUrl(remoteUrl, sourceBranch, targetBranch, title, description);
        if (prUrl) {
          await vscode.env.openExternal(vscode.Uri.parse(prUrl));
        } else {
          await vscode.window.showWarningMessage(
            `Could not detect PR URL. Remote: ${remoteUrl || '(none)'}`
          );
        }
        return;
      }
      case 'listStashes': {
        const entries = await this.repository.listStashes(message.payload.repoRoot);
        await this.postMessage({ type: 'stashList', payload: { entries } });
        return;
      }
      case 'stashChanges': {
        await this.executeRepositoryAction('Stashing changes...', async () => {
          await this.repository.stashChanges(
            message.payload.repoRoot,
            message.payload.message,
            message.payload.includeUntracked
          );
        });
        const entries = await this.repository.listStashes(message.payload.repoRoot);
        await this.postMessage({ type: 'stashList', payload: { entries } });
        return;
      }
      case 'applyStash': {
        await this.executeRepositoryAction('Applying stash...', async () => {
          await this.repository.applyStash(message.payload.repoRoot, message.payload.ref);
        });
        const entries = await this.repository.listStashes(message.payload.repoRoot);
        await this.postMessage({ type: 'stashList', payload: { entries } });
        return;
      }
      case 'popStash': {
        await this.executeRepositoryAction('Popping stash...', async () => {
          await this.repository.popStash(message.payload.repoRoot, message.payload.ref);
        });
        const entries = await this.repository.listStashes(message.payload.repoRoot);
        await this.postMessage({ type: 'stashList', payload: { entries } });
        return;
      }
      case 'dropStash': {
        const confirmed = await vscode.window.showWarningMessage(
          `Drop stash ${message.payload.ref}?`,
          { modal: true },
          'Drop'
        );

        if (confirmed !== 'Drop') {
          return;
        }

        await this.executeRepositoryAction('Dropping stash...', async () => {
          await this.repository.dropStash(message.payload.repoRoot, message.payload.ref);
        });
        const entries = await this.repository.listStashes(message.payload.repoRoot);
        await this.postMessage({ type: 'stashList', payload: { entries } });
        return;
      }
      case 'listWorktrees': {
        const worktrees = await this.repository.listWorktrees(message.payload.repoRoot);
        await this.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
        return;
      }
      case 'addWorktree': {
        const { repoRoot, branch, createNew, worktreePath } = message.payload;
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
        return;
      }
      case 'removeWorktree': {
        const { repoRoot, path: worktreePath, force } = message.payload;
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
            payload: { message: msg, path: worktreePath, canForce: !force }
          });
        }
        return;
      }
      case 'openWorktreeInWindow': {
        await vscode.commands.executeCommand(
          'vscode.openFolder',
          vscode.Uri.file(message.payload.path),
          { forceNewWindow: true }
        );
        return;
      }
      case 'revealWorktreeInOs': {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(message.payload.path));
        return;
      }
      case 'copyWorktreePath': {
        await vscode.env.clipboard.writeText(message.payload.path);
        return;
      }
      case 'lockWorktree': {
        const { repoRoot, path: worktreePath } = message.payload;
        try {
          await this.repository.lockWorktree(repoRoot, worktreePath);
          const worktrees = await this.repository.listWorktrees(repoRoot);
          await this.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.output.appendLine(`[worktree-lock] ${msg}`);
          await this.postMessage({ type: 'worktreeError', payload: { message: msg } });
        }
        return;
      }
      case 'unlockWorktree': {
        const { repoRoot, path: worktreePath } = message.payload;
        try {
          await this.repository.unlockWorktree(repoRoot, worktreePath);
          const worktrees = await this.repository.listWorktrees(repoRoot);
          await this.postMessage({ type: 'worktreeList', payload: { entries: worktrees } });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.output.appendLine(`[worktree-unlock] ${msg}`);
          await this.postMessage({ type: 'worktreeError', payload: { message: msg } });
        }
        return;
      }
      case 'moveWorktree': {
        const { repoRoot, path: worktreePath, newPath } = message.payload;
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
        return;
      }
      case 'addWorktreeAtCommit': {
        const { repoRoot, worktreePath, commitHash } = message.payload;
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
        return;
      }
      case 'continueOperation':
        await this.executeRepositoryAction('Continuing...', async () => {
          await this.repository.continueOperation(message.payload.repoRoot, message.payload.state as import('../../core/models').RepoSpecialState);
        });
        return;
      case 'skipOperation':
        await this.executeRepositoryAction('Skipping...', async () => {
          await this.repository.skipRebaseOperation(message.payload.repoRoot);
        });
        return;
      case 'abortOperation':
        await this.executeRepositoryAction('Aborting...', async () => {
          await this.repository.abortOperation(message.payload.repoRoot, message.payload.state as import('../../core/models').RepoSpecialState);
        });
        return;
      case 'pullRepo':
        await this.executeRepositoryAction('Pulling...', async () => {
          await this.repository.pull(message.payload.repoRoot);
        });
        return;
      case 'pushRepo':
        await this.executeRepositoryAction('Pushing...', async () => {
          await this.repository.push(message.payload.repoRoot);
        });
        return;
      case 'fetchRepo':
        await this.executeRepositoryAction('Fetching...', async () => {
          await this.repository.fetch(message.payload.repoRoot);
        });
        return;
      case 'openFile': {
        const nodePath = await import('node:path');
        const fullPath = vscode.Uri.file(
          nodePath.join(message.payload.repoRoot, message.payload.filePath)
        );
        const doc = await vscode.workspace.openTextDocument(fullPath);
        await vscode.window.showTextDocument(doc, { preserveFocus: false, preview: false });
        return;
      }
      default:
        return;
    }
  }

  private resolvePreferredRemoteForPullRequest(sourceBranch: string, branches: BranchSummary[], remotes: RepoRemote[]): RepoRemote | undefined {
    if (remotes.length === 0) {
      return undefined;
    }

    const source = branches.find((branch) => !branch.remote && branch.shortName === sourceBranch);
    const upstreamRemoteName = source?.upstream?.split('/')[0];
    if (upstreamRemoteName) {
      const upstreamRemote = remotes.find((remote) => remote.name === upstreamRemoteName);
      if (upstreamRemote) {
        return upstreamRemote;
      }
    }

    const origin = remotes.find((remote) => remote.name === 'origin');
    return origin ?? remotes[0];
  }

  private buildPrUrl(remoteUrl: string, source: string, target: string, title: string, description: string): string | null {
    // Normalize SSH → HTTPS
    const normalized = remoteUrl
      .replace(/^git@github\.com:/, 'https://github.com/')
      .replace(/^git@gitlab\.com:/, 'https://gitlab.com/')
      .replace(/^git@bitbucket\.org:/, 'https://bitbucket.org/')
      .replace(/\.git$/, '');

    const enc = encodeURIComponent;
    const encodedTitle = title ? `&title=${enc(title)}` : '';
    const encodedDescription = description ? `&body=${enc(description)}` : '';

    if (/github\.com/.test(normalized)) {
      const base = `${normalized}/compare/${enc(target)}...${enc(source)}`;
      const params = `?quick_pull=1${encodedTitle}${encodedDescription}`;
      return base + params;
    }

    if (/gitlab\.com/.test(normalized)) {
      return `${normalized}/-/merge_requests/new?merge_request[source_branch]=${enc(source)}&merge_request[target_branch]=${enc(target)}${title ? `&merge_request[title]=${enc(title)}` : ''}${description ? `&merge_request[description]=${enc(description)}` : ''}`;
    }

    if (/bitbucket\.org/.test(normalized)) {
      return `${normalized}/pull-requests/new?source=${enc(source)}&dest=${enc(target)}${title ? `&title=${enc(title)}` : ''}${description ? `&description=${enc(description)}` : ''}`;
    }

    return null;
  }

  private async executeRepositoryAction(label: string, action: () => Promise<void>): Promise<void> {
    await this.withBusy(label, async () => {
      await action();
      await this.refresh();
      await this.postNotification('info', 'Operation completed successfully.');
    }).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[ui-error] ${message}`);
      await this.postNotification('error', message);
    });
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

  private renderHtml(webview: vscode.Webview): string {
    const nonce = createNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'index.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'index.css'));
    const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'hero.svg'));
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource} data:`,
      `script-src 'nonce-${nonce}'`
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>RepoFlow</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}">
      window.__REPOFLOW_ASSETS__ = {
        hero: '${iconUri}'
      };
    </script>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}
