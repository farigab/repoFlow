import * as path from 'node:path';
import * as vscode from 'vscode';
import type { DiffRequest } from './core/models/GitModels';
import { GitCliRepository } from './infrastructure/git/GitCliRepository';
import { GitContentProvider } from './presentation/diff/GitContentProvider';
import { GitGraphViewProvider } from './presentation/webview/GitGraphViewProvider';
import { EMPTY_TREE } from './shared/constants';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Git Graphor');

  const repository = new GitCliRepository(output, async (request) => {
    await openNativeDiff(request, contentProvider);
  });

  const contentProvider = new GitContentProvider(repository);
  const graphViewProvider = new GitGraphViewProvider(context.extensionUri, repository, output);

  let refreshTimer: NodeJS.Timeout | undefined;
  const scheduleGraphRefresh = (): void => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(() => {
      void graphViewProvider.refresh().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(`[watcher-error] ${message}`);
      });
    }, 250);
  };

  const gitWatchers = [
    vscode.workspace.createFileSystemWatcher('**/.git/HEAD'),
    vscode.workspace.createFileSystemWatcher('**/.git/index'),
    vscode.workspace.createFileSystemWatcher('**/.git/refs/**')
  ];

  for (const watcher of gitWatchers) {
    watcher.onDidChange(scheduleGraphRefresh, undefined, context.subscriptions);
    watcher.onDidCreate(scheduleGraphRefresh, undefined, context.subscriptions);
    watcher.onDidDelete(scheduleGraphRefresh, undefined, context.subscriptions);
  }

  context.subscriptions.push(output);
  context.subscriptions.push(...gitWatchers);
  context.subscriptions.push(new vscode.Disposable(() => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
    }
  }));
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, contentProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitGraphor.openView', () => {
      graphViewProvider.openOrReveal();
    }),
    vscode.commands.registerCommand('gitGraphor.refresh', async () => {
      await graphViewProvider.refresh();
    }),
    vscode.commands.registerCommand('gitGraphor.fetch', async () => {
      const repoRoot = await repository.resolveRepositoryRoot();
      await repository.fetch(repoRoot);
      await graphViewProvider.refresh();
    }),
    vscode.commands.registerCommand('gitGraphor.pull', async () => {
      const repoRoot = await repository.resolveRepositoryRoot();
      await repository.pull(repoRoot);
      await graphViewProvider.refresh();
    }),
    vscode.commands.registerCommand('gitGraphor.push', async () => {
      const repoRoot = await repository.resolveRepositoryRoot();
      await repository.push(repoRoot);
      await graphViewProvider.refresh();
    }),
    vscode.commands.registerCommand('gitGraphor.createBranch', async () => {
      const repoRoot = await repository.resolveRepositoryRoot();
      const name = await vscode.window.showInputBox({
        title: 'Create Branch',
        prompt: 'New branch name',
        ignoreFocusOut: true
      });

      if (!name) {
        return;
      }

      await repository.createBranch(repoRoot, name.trim());
      await graphViewProvider.refresh();
    }),
    vscode.commands.registerCommand('gitGraphor.commitChanges', async () => {
      const repoRoot = await repository.resolveRepositoryRoot();
      const message = await vscode.window.showInputBox({
        title: 'Commit Changes',
        prompt: 'Commit message',
        ignoreFocusOut: true
      });

      if (!message) {
        return;
      }

      await repository.commit(repoRoot, message.trim());
      await graphViewProvider.refresh();
    })
  );
}

async function openNativeDiff(request: DiffRequest, provider: GitContentProvider): Promise<void> {
  const leftRef = request.parentHash ?? EMPTY_TREE;
  const leftPath = request.originalPath ?? request.filePath;
  const leftUri = provider.createUri(request.repoRoot, leftRef, leftPath);
  const rightUri = provider.createUri(request.repoRoot, request.commitHash, request.filePath);
  const title = `${path.basename(request.filePath)} (${leftRef.slice(0, 8)} ↔ ${request.commitHash.slice(0, 8)})`;

  await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, {
    preview: false
  });
}

export function deactivate(): void { }
