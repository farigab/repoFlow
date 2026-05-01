import * as path from 'node:path';
import * as vscode from 'vscode';
import type { DiffRequest } from './core/models';
import { GitCliRepository } from './infrastructure/git/GitCliRepository';
import { registerGitWatchers } from './infrastructure/watchers/gitWatchers';
import { GitBlameController } from './presentation/blame/GitBlameController';
import { BranchTreeDataProvider } from './presentation/branches/BranchTreeDataProvider';
import { registerBranchCommands } from './presentation/commands/registerBranchCommands';
import { registerRepoCommands } from './presentation/commands/registerRepoCommands';
import { GitContentProvider } from './presentation/diff/GitContentProvider';
import { GitGraphViewProvider } from './presentation/webview/GitGraphViewProvider';
import { EMPTY_TREE } from './shared/constants';
import { createDebounce } from './shared/debounce';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('RepoFlow');

  // Break the circular dependency cleanly: contentProvider is assigned before the
  // diff handler can ever be invoked (it requires a user action on a commit).
  let contentProvider!: GitContentProvider;
  const repository = new GitCliRepository(output, (request: DiffRequest) =>
    openNativeDiff(request, contentProvider)
  );
  contentProvider = new GitContentProvider(repository);

  const repoStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  repoStatusBar.command = 'repoFlow.showRepoActions';
  repoStatusBar.text = '$(git-branch) RepoFlow';
  repoStatusBar.tooltip = 'RepoFlow: Click to see repo actions';
  repoStatusBar.show();

  const graphViewProvider = new GitGraphViewProvider(context.extensionUri, repository, output, repoStatusBar);
  const blameController = new GitBlameController(repository, output);
  const branchTreeProvider = new BranchTreeDataProvider(repository);

  const branchTreeView = vscode.window.createTreeView('repoFlow.branchesView', {
    treeDataProvider: branchTreeProvider,
    showCollapseAll: true
  });

  const refreshDebounce = createDebounce(() => {
    blameController.invalidateCache();
    branchTreeProvider.refresh();
    void graphViewProvider.refresh().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`[watcher-error] ${message}`);
    });
  }, 250);

  context.subscriptions.push(
    output,
    repoStatusBar,
    branchTreeView,
    blameController,
    new vscode.Disposable(() => refreshDebounce.dispose()),
    vscode.workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, contentProvider)
  );

  registerGitWatchers(refreshDebounce.schedule, context.subscriptions);
  registerRepoCommands(repository, graphViewProvider, context.subscriptions);
  registerBranchCommands(repository, graphViewProvider, branchTreeProvider, context.subscriptions);
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
