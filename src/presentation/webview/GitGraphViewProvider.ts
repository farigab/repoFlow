import * as vscode from 'vscode';
import type { GitFetchCoordinator } from '../../application/fetch/GitFetchCoordinator';
import type { GraphFilters } from '../../core/models';
import type { GitRepository } from '../../core/ports/GitRepository';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../../shared/protocol';
import { assertCommitHash } from '../../shared/gitInputValidation';
import { buildRepoStatusBarText, buildRepoSummary } from '../../shared/repoSummary';
import { GitGraphHostServices } from './GitGraphHostServices';
import type { MessageHandlerMap } from './GitGraphMessageTypes';
import { renderHtml } from './GitGraphRenderer';
import { RepoMessageHandlers } from './RepoMessageHandlers';
import { StashMessageHandlers } from './StashMessageHandlers';
import { WorktreeMessageHandlers } from './WorktreeMessageHandlers';

export class GitGraphViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'repoFlow.graphPanel';
  public static readonly viewId = 'repoFlow.graphView';

  private readonly host: GitGraphHostServices;
  private readonly messageHandlers: MessageHandlerMap;
  private currentPanel?: vscode.WebviewPanel;
  private currentView?: vscode.WebviewView;
  private viewDisposables: vscode.Disposable[] = [];
  private panelDisposables: vscode.Disposable[] = [];
  private filters: GraphFilters = {
    includeRemotes: true,
    limit: 200
  };
  private selectedCommitHash?: string;
  private pendingRevealHash?: string;
  private refreshGeneration = 0;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly repository: GitRepository,
    fetchCoordinator: GitFetchCoordinator,
    private readonly output: vscode.OutputChannel,
    private readonly repoStatusBar?: vscode.StatusBarItem,
    onRepositoryChanged?: () => void
  ) {
    const postMessage = (message: ExtensionToWebviewMessage) => this.postMessage(message);
    const refresh = () => this.refresh();
    this.host = new GitGraphHostServices({
      repository,
      output,
      postMessage,
      refresh,
      onRepositoryChanged
    });

    this.messageHandlers = {
      ...new RepoMessageHandlers({
        repository,
        fetchCoordinator,
        host: this.host,
        getFilters: () => this.filters,
        setFilters: (filters) => { this.filters = filters; },
        setSelectedCommitHash: (commitHash) => { this.selectedCommitHash = commitHash; },
        refresh,
        postMessage
      }).handlers(),
      ...new StashMessageHandlers({
        repository,
        host: this.host,
        output,
        postMessage
      }).handlers(),
      ...new WorktreeMessageHandlers({
        repository,
        host: this.host,
        output,
        postMessage
      }).handlers()
    };
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
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
      for (const disposable of this.viewDisposables) { disposable.dispose(); }
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
      for (const disposable of this.panelDisposables) { disposable.dispose(); }
      this.panelDisposables = [];
    }, undefined, this.panelDisposables);

    panel.onDidChangeViewState(() => {
      if (panel.visible) {
        void this.refresh();
      }
    }, undefined, this.panelDisposables);

    this.currentPanel = panel;
  }

  public openAndRevealCommit(commitHash: string): void {
    const trustedCommitHash = assertCommitHash(commitHash);
    this.openOrReveal();
    this.selectedCommitHash = trustedCommitHash;
    this.pendingRevealHash = trustedCommitHash;
  }

  public async refresh(): Promise<void> {
    if (!this.currentPanel && !this.currentView?.visible) {
      await this.refreshStatusBarOnly();
      return;
    }

    const refreshGeneration = ++this.refreshGeneration;
    const isCurrentRefresh = () => refreshGeneration === this.refreshGeneration;

    await this.postMessage({ type: 'busy', payload: { value: true, label: 'Refreshing Git graph...' } });
    try {
      let snapshot = await this.repository.getGraph(this.filters);
      if (!isCurrentRefresh()) return;

      while (
        this.pendingRevealHash
        && snapshot.hasMore
        && !snapshot.rows.some((row) => row.commit.hash === this.pendingRevealHash)
      ) {
        this.filters = { ...this.filters, limit: this.filters.limit + 200 };
        snapshot = await this.repository.getGraph(this.filters);
        if (!isCurrentRefresh()) return;
      }

      await this.postMessage({ type: 'graphSnapshot', payload: snapshot });

      if (this.repoStatusBar) {
        const status = snapshot.localChanges;
        this.repoStatusBar.text = buildRepoStatusBarText(status);
        this.repoStatusBar.tooltip = buildRepoSummary(status);
      }

      const revealedCommitHash = this.pendingRevealHash;
      const canRevealCommit = revealedCommitHash
        ? snapshot.rows.some((row) => row.commit.hash === revealedCommitHash)
        : false;

      if (revealedCommitHash && canRevealCommit) {
        await this.postMessage({ type: 'revealCommit', payload: { commitHash: revealedCommitHash } });
        this.pendingRevealHash = undefined;
      }

      if (this.selectedCommitHash) {
        const detail = await this.repository.getCommitDetail(snapshot.repoRoot, this.selectedCommitHash);
        if (!isCurrentRefresh()) return;
        await this.postMessage({ type: 'commitDetail', payload: detail });
      }
    } finally {
      if (isCurrentRefresh()) {
        await this.postMessage({ type: 'busy', payload: { value: false } });
      }
    }
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
      // Not in a git repository.
    }
  }

  private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    try {
      const handler = this.messageHandlers[message.type];
      if (handler) {
        const payload = (message as WebviewToExtensionMessage & { payload?: unknown }).payload;
        await (handler as (payload: unknown) => Promise<void>)(payload);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[webview-message] ${message.type}: ${errorMessage}`);
      await this.host.postNotification('error', errorMessage);
    }
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
}
