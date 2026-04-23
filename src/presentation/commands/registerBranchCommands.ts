import * as vscode from 'vscode';
import type { GitRepository } from '../../core/ports/GitRepository';
import { BranchTreeDataProvider, BranchTreeItem } from '../branches/BranchTreeDataProvider';
import type { GitGraphViewProvider } from '../webview/GitGraphViewProvider';

// ─────────────────────────────────────────────
// Deletion helpers — extracted to keep the delete command handler lean
// ─────────────────────────────────────────────

async function deleteRemoteBranchFromItem(
  repository: GitRepository,
  repoRoot: string,
  fullBranchName: string
): Promise<void> {
  const slashIdx = fullBranchName.indexOf('/');
  if (slashIdx === -1) {
    void vscode.window.showErrorMessage(`RepoFlow: Invalid remote branch name '${fullBranchName}'.`);
    return;
  }
  const remote = fullBranchName.slice(0, slashIdx);
  const name = fullBranchName.slice(slashIdx + 1);

  try {
    await repository.deleteRemoteBranch(repoRoot, remote, name);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // If the remote ref is already gone, attempt to prune local tracking refs so the UI updates.
    if (msg.includes('remote ref does not exist') || msg.includes('unable to delete') || msg.includes('failed to push some refs')) {
      try {
        await repository.fetch(repoRoot);
        void vscode.window.showInformationMessage(`Remote branch '${fullBranchName}' not found; pruned local tracking refs.`);
      } catch (fetchErr) {
        const fetchMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        void vscode.window.showWarningMessage(`RepoFlow: Failed to prune remote refs: ${fetchMsg}`);
      }
      return;
    }

    void vscode.window.showErrorMessage(`RepoFlow: ${msg}`);
  }
}

async function deleteLocalBranchWithConfirm(
  repository: GitRepository,
  repoRoot: string,
  branchName: string
): Promise<void> {
  try {
    await repository.deleteBranch(repoRoot, branchName);
    return;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes('not fully merged')) {
      void vscode.window.showErrorMessage(`RepoFlow: ${msg}`);
      return;
    }
  }

  const force = await vscode.window.showWarningMessage(
    `Branch '${branchName}' is not fully merged. Force delete?`,
    { modal: true },
    'Force Delete'
  );
  if (force !== 'Force Delete') return;

  try {
    await repository.deleteBranch(repoRoot, branchName, true);
  } catch (forceError) {
    const forceMsg = forceError instanceof Error ? forceError.message : String(forceError);
    void vscode.window.showErrorMessage(`RepoFlow: ${forceMsg}`);
  }
}

// ─────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────

export function registerBranchCommands(
  repository: GitRepository,
  graphViewProvider: GitGraphViewProvider,
  branchTreeProvider: BranchTreeDataProvider,
  subscriptions: vscode.ExtensionContext['subscriptions']
): void {
  subscriptions.push(
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

      let repoRoot: string;
      try {
        repoRoot = await repository.resolveRepositoryRoot();
      } catch {
        void vscode.window.showErrorMessage('RepoFlow: No Git repository found.');
        return;
      }

      if (item.branch.remote) {
        await deleteRemoteBranchFromItem(repository, repoRoot, item.branch.shortName);
      } else {
        await deleteLocalBranchWithConfirm(repository, repoRoot, item.branch.shortName);
      }

      branchTreeProvider.refresh();
      await graphViewProvider.refresh();
    }),
    vscode.commands.registerCommand('repoFlow.branches.merge', async (item: BranchTreeItem) => {
      if (!item?.branch) return;
      const repoRoot = await repository.resolveRepositoryRoot();

      const short = item.branch.shortName?.trim();
      if (!short) {
        void vscode.window.showErrorMessage('RepoFlow: Invalid branch name.');
        return;
      }

      // Use full ref names to avoid ambiguity and accidental pathspecs.
      const sourceRef = item.branch.remote ? `refs/remotes/${short}` : `refs/heads/${short}`;

      try {
        await repository.merge(repoRoot, sourceRef);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`RepoFlow: ${msg}`);
        return;
      }

      branchTreeProvider.refresh();
      await graphViewProvider.refresh();
    })
  );
}
