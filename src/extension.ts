import * as path from 'node:path';
import * as vscode from 'vscode';
import { GitFetchCoordinator } from './application/fetch/GitFetchCoordinator';
import { RefreshCoordinator } from './application/refresh/RefreshCoordinator';
import type { DiffRequest } from './core/models';
import { GitAutoFetchService } from './infrastructure/git/GitAutoFetchService';
import { GitCliRepository } from './infrastructure/git/GitCliRepository';
import { registerGitWatchers } from './infrastructure/watchers/gitWatchers';
import { GitBlameController } from './presentation/blame/GitBlameController';
import { BranchTreeDataProvider } from './presentation/branches/BranchTreeDataProvider';
import { registerBranchCommands } from './presentation/commands/registerBranchCommands';
import { registerRepoCommands } from './presentation/commands/registerRepoCommands';
import { GitContentProvider } from './presentation/diff/GitContentProvider';
import { GitGraphViewProvider } from './presentation/webview/GitGraphViewProvider';
import { EMPTY_TREE } from './shared/constants';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('RepoFlow');

  // Break the circular dependency cleanly: contentProvider is assigned before the
  // diff handler can ever be invoked (it requires a user action on a commit).
  let contentProvider!: GitContentProvider;
  const repository = new GitCliRepository(output, (request: DiffRequest) =>
    openNativeDiff(request, contentProvider)
  );
  contentProvider = new GitContentProvider(repository);
  const fetchCoordinator = new GitFetchCoordinator(repository, output);

  const repoStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  repoStatusBar.command = 'repoFlow.showRepoActions';
  repoStatusBar.text = '$(git-branch) RepoFlow';
  repoStatusBar.tooltip = 'RepoFlow: Click to see repo actions';
  repoStatusBar.show();

  let refreshCoordinator!: RefreshCoordinator;
  const graphViewProvider = new GitGraphViewProvider(
    context.extensionUri,
    repository,
    fetchCoordinator,
    output,
    repoStatusBar,
    () => refreshCoordinator.requestRefresh('webview-action')
  );
  const blameController = new GitBlameController(repository, output);
  const branchTreeProvider = new BranchTreeDataProvider(repository);

  const branchTreeView = vscode.window.createTreeView('repoFlow.branchesView', {
    treeDataProvider: branchTreeProvider,
    showCollapseAll: true
  });

  refreshCoordinator = new RefreshCoordinator({
    clearTransientCaches: () => repository.clearTransientCaches(),
    invalidateBlameCache: () => blameController.invalidateCache(),
    refreshBranchTree: () => branchTreeProvider.refresh(),
    refreshGraph: () => graphViewProvider.refresh(),
    output
  });
  const autoFetchService = new GitAutoFetchService(
    repository,
    fetchCoordinator,
    () => refreshCoordinator.requestRefresh('auto-fetch'),
    output
  );

  context.subscriptions.push(
    output,
    fetchCoordinator,
    repoStatusBar,
    branchTreeView,
    blameController,
    refreshCoordinator,
    autoFetchService,
    vscode.workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, contentProvider)
  );

  autoFetchService.start();
  registerGitWatchers(() => {
    if (!fetchCoordinator.isFetchActiveOrRecentlyCompleted()) {
      refreshCoordinator.requestRefresh('git-watcher');
    }
  }, context.subscriptions);
  registerRepoCommands(repository, fetchCoordinator, graphViewProvider, () => refreshCoordinator.requestRefresh('repo-command'), context.subscriptions);
  registerBranchCommands(
    repository,
    fetchCoordinator,
    branchTreeProvider,
    () => refreshCoordinator.requestRefresh('branch-command'),
    context.subscriptions
  );
}

async function openNativeDiff(request: DiffRequest, provider: GitContentProvider): Promise<void> {
  const leftRef = request.parentHash ?? EMPTY_TREE;
  const leftPath = request.originalPath ?? request.filePath;
  const leftUri = provider.createUri(request.repoRoot, leftRef, leftPath);
  const rightUri = provider.createUri(request.repoRoot, request.commitHash, request.filePath);
  const shortRef = (ref: string) => (/^[0-9a-f]{8,}$/i.test(ref) ? ref.slice(0, 8) : ref);
  const title = `${path.basename(request.filePath)} (${shortRef(leftRef)} <-> ${shortRef(request.commitHash)})`;

  await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, {
    preview: false
  });
}

export function deactivate(): void { /* noop */ }
