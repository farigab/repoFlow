import * as path from 'node:path';
import * as vscode from 'vscode';
import type { DiffRequest } from './core/models/GitModels';
import { GitCliRepository } from './infrastructure/git/GitCliRepository';
import { GitBlameController } from './presentation/blame/GitBlameController';
import { BranchTreeDataProvider, BranchTreeItem } from './presentation/branches/BranchTreeDataProvider';
import { GitContentProvider } from './presentation/diff/GitContentProvider';
import { GitGraphViewProvider } from './presentation/webview/GitGraphViewProvider';
import { EMPTY_TREE } from './shared/constants';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('RepoFlow');

  const repository = new GitCliRepository(output, async (request) => {
    await openNativeDiff(request, contentProvider);
  });

  const contentProvider = new GitContentProvider(repository);

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

  context.subscriptions.push(branchTreeView);

  let refreshTimer: NodeJS.Timeout | undefined;
  const scheduleGraphRefresh = (): void => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(() => {
      blameController.invalidateCache();
      branchTreeProvider.refresh();
      void graphViewProvider.refresh().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(`[watcher-error] ${message}`);
      });
    }, 250);
  };

  const gitWatchers = [
    vscode.workspace.createFileSystemWatcher('**/.git/HEAD'),
    vscode.workspace.createFileSystemWatcher('**/.git/index'),
    vscode.workspace.createFileSystemWatcher('**/.git/refs/**'),
    vscode.workspace.createFileSystemWatcher('**/.git/worktrees/**'),
    // Special-state files (merge, rebase, cherry-pick, revert, bisect)
    vscode.workspace.createFileSystemWatcher('**/.git/MERGE_HEAD'),
    vscode.workspace.createFileSystemWatcher('**/.git/CHERRY_PICK_HEAD'),
    vscode.workspace.createFileSystemWatcher('**/.git/REVERT_HEAD'),
    vscode.workspace.createFileSystemWatcher('**/.git/BISECT_LOG'),
    vscode.workspace.createFileSystemWatcher('**/.git/rebase-merge/**'),
    vscode.workspace.createFileSystemWatcher('**/.git/rebase-apply/**')
  ];

  for (const watcher of gitWatchers) {
    watcher.onDidChange(scheduleGraphRefresh, undefined, context.subscriptions);
    watcher.onDidCreate(scheduleGraphRefresh, undefined, context.subscriptions);
    watcher.onDidDelete(scheduleGraphRefresh, undefined, context.subscriptions);
  }

  context.subscriptions.push(output);
  context.subscriptions.push(repoStatusBar);
  context.subscriptions.push(...gitWatchers);
  context.subscriptions.push(blameController);
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
    vscode.commands.registerCommand('repoFlow.openView', () => {
      graphViewProvider.openOrReveal();
    }),
    vscode.commands.registerCommand('repoFlow.showRepoActions', async () => {
      interface ActionItem extends vscode.QuickPickItem { action: string; }
      type RunAction = (repoRoot: string) => Promise<void>;

      const SPECIAL_LABEL: Record<string, string> = {
        merging: 'MERGING', rebasing: 'REBASING', 'cherry-picking': 'CHERRY-PICKING',
        reverting: 'REVERTING', bisecting: 'BISECTING'
      };

      try {
        const repoRoot = await repository.resolveRepositoryRoot();
        const status = await repository.getLocalChanges(repoRoot);
        const branch = status.currentBranch ?? 'HEAD';

        const items: ActionItem[] = [];

        if (status.specialState && status.specialState !== 'detached') {
          const label = SPECIAL_LABEL[status.specialState] ?? status.specialState.toUpperCase();
          items.push(
            { label: `$(play) Continue ${label}`, description: '', action: 'continue' },
            ...(status.specialState === 'rebasing'
              ? [{ label: '$(debug-step-over) Skip Commit', description: '', action: 'skip' } as ActionItem]
              : []),
            { label: `$(stop) Abort ${label}`, description: '', action: 'abort' },
            { label: '', kind: vscode.QuickPickItemKind.Separator, description: '', action: '' }
          );
        }

        if (status.behind > 0) {
          items.push({ label: `$(arrow-down) Pull  (${status.behind} behind ${status.upstream ?? 'upstream'})`, description: '', action: 'pull' });
        }
        if (status.ahead > 0) {
          items.push({ label: `$(arrow-up) Push  (${status.ahead} ahead of ${status.upstream ?? 'upstream'})`, description: '', action: 'push' });
        }
        items.push({ label: '$(sync) Fetch', description: 'Update remote refs', action: 'fetch' });
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator, description: '', action: '' });
        items.push({ label: '$(git-branch) Open Graph', description: '', action: 'openGraph' });

        const choice = await vscode.window.showQuickPick(items, {
          title: `RepoFlow — ${branch}`,
          placeHolder: 'Select an action'
        });

        if (!choice || !choice.action) return;

        const runAndRefresh = async (fn: RunAction): Promise<void> => {
          await fn(repoRoot);
          await graphViewProvider.refresh();
        };

        const actions: Record<string, () => Promise<void>> = {
          continue: () => runAndRefresh((r) => repository.continueOperation(r, status.specialState!)),
          skip: () => runAndRefresh((r) => repository.skipRebaseOperation(r)),
          abort: () => runAndRefresh((r) => repository.abortOperation(r, status.specialState!)),
          pull: () => runAndRefresh((r) => repository.pull(r)),
          push: () => runAndRefresh((r) => repository.push(r)),
          fetch: () => runAndRefresh((r) => repository.fetch(r)),
          openGraph: async () => graphViewProvider.openOrReveal()
        };

        await actions[choice.action]?.();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`RepoFlow: ${msg}`);
      }
    }),
    vscode.commands.registerCommand('repoFlow.refresh', async () => {
      await graphViewProvider.refresh();
    }),
    vscode.commands.registerCommand('repoFlow.fetch', async () => {
      const repoRoot = await repository.resolveRepositoryRoot();
      await repository.fetch(repoRoot);
      await graphViewProvider.refresh();
    }),
    vscode.commands.registerCommand('repoFlow.pull', async () => {
      const repoRoot = await repository.resolveRepositoryRoot();
      await repository.pull(repoRoot);
      await graphViewProvider.refresh();
    }),
    vscode.commands.registerCommand('repoFlow.push', async () => {
      const repoRoot = await repository.resolveRepositoryRoot();
      await repository.push(repoRoot);
      await graphViewProvider.refresh();
    }),
    vscode.commands.registerCommand('repoFlow.createBranch', async () => {
      const repoRoot = await repository.resolveRepositoryRoot();

      const branches = await repository.getBranches(repoRoot);
      const localBranches = branches.filter((b) => !b.remote);
      const remoteBranches = branches.filter((b) => b.remote);
      const currentBranch = localBranches.find((b) => b.current);

      const localItems = localBranches.map((b) => ({
        label: b.shortName,
        description: b.current ? '(current)' : undefined,
        kind: vscode.QuickPickItemKind.Default as number
      }));

      const remoteItems = remoteBranches.map((b) => ({
        label: b.shortName,
        description: undefined as string | undefined,
        kind: vscode.QuickPickItemKind.Default as number
      }));

      const branchItems = [
        { label: 'Local', kind: vscode.QuickPickItemKind.Separator, description: undefined },
        ...localItems,
        { label: 'Remote', kind: vscode.QuickPickItemKind.Separator, description: undefined },
        ...remoteItems
      ];

      const fromBranch = await vscode.window.showQuickPick(branchItems, {
        title: 'Select Source Branch',
        placeHolder: currentBranch ? `Current: ${currentBranch.shortName}` : 'Choose the branch to create from',
        ignoreFocusOut: true
      });

      if (!fromBranch) {
        return;
      }

      const branchType = await vscode.window.showQuickPick([
        { label: 'Feature', description: 'feat/' },
        { label: 'Hotfix', description: 'hotfix/' },
        { label: 'Bugfix', description: 'bugfix/' },
        { label: 'Release', description: 'release/' },
        { label: 'Other', description: '' }
      ], {
        title: 'Select Branch Type',
        placeHolder: 'Choose a branch type',
        ignoreFocusOut: true
      });

      if (!branchType) {
        return;
      }

      const name = await vscode.window.showInputBox({
        title: 'Create Branch',
        prompt: `Enter branch name (prefix: ${branchType.description}, from: ${fromBranch.label})`,
        ignoreFocusOut: true
      });

      if (!name) {
        return;
      }

      await repository.createBranch(repoRoot, `${branchType.description}${name.trim()}`, fromBranch.label);
      await graphViewProvider.refresh();
    }),
    vscode.commands.registerCommand('repoFlow.commitChanges', async () => {
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
    }),
    // Internal command — invoked from blame hover command URI
    vscode.commands.registerCommand('repoFlow.revealCommit', (commitHash: string) => {
      graphViewProvider.openAndRevealCommit(commitHash);
    }),
    // Branch tree view commands
    vscode.commands.registerCommand('repoFlow.branches.refresh', () => {
      branchTreeProvider.refresh();
    }),
    vscode.commands.registerCommand('repoFlow.branches.checkout', async (item: BranchTreeItem) => {
      if (!item?.branch) return;
      const repoRoot = await repository.resolveRepositoryRoot();
      // For remote branches (e.g. origin/feat/changes), strip the remote name so git can
      // create/switch to the local tracking branch instead of entering detached HEAD.
      const refToCheckout = item.branch.remote
        ? item.branch.shortName.slice(item.branch.shortName.indexOf('/') + 1)
        : item.branch.shortName;
      await repository.checkout(repoRoot, refToCheckout);
      branchTreeProvider.refresh();
      await graphViewProvider.refresh();
    }),
    vscode.commands.registerCommand('repoFlow.branches.delete', async (item: BranchTreeItem) => {
      if (!item?.branch) return;
      if (item.branch.current) {
        void vscode.window.showWarningMessage(`Cannot delete the currently checked-out branch '${item.branch.shortName}'.`);
        return;
      }
      const answer = await vscode.window.showWarningMessage(
        `Delete branch '${item.branch.shortName}'?`,
        { modal: true },
        'Delete'
      );
      if (answer !== 'Delete') return;
      const repoRoot = await repository.resolveRepositoryRoot();
      if (item.branch.remote) {
        // Remote branch: extract remote name and branch name from shortName (e.g. "origin/feat/changes")
        const slashIdx = item.branch.shortName.indexOf('/');
        const remoteName = item.branch.shortName.slice(0, slashIdx);
        const branchName = item.branch.shortName.slice(slashIdx + 1);
        await repository.deleteRemoteBranch(repoRoot, remoteName, branchName);
      } else {
        await repository.deleteBranch(repoRoot, item.branch.shortName);
      }
      branchTreeProvider.refresh();
      await graphViewProvider.refresh();
    }),
    vscode.commands.registerCommand('repoFlow.branches.merge', async (item: BranchTreeItem) => {
      if (!item?.branch) return;
      const repoRoot = await repository.resolveRepositoryRoot();
      await repository.merge(repoRoot, item.branch.shortName);
      branchTreeProvider.refresh();
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
