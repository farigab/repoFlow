import * as vscode from 'vscode';
import type { GitRepository } from '../../core/ports/GitRepository';
import type { GitGraphViewProvider } from '../webview/GitGraphViewProvider';

// ─────────────────────────────────────────────
// UI helpers
// ─────────────────────────────────────────────

interface RepoActionItem extends vscode.QuickPickItem { action: string; }
type RunAction = (repoRoot: string) => Promise<void>;

const SPECIAL_LABEL: Record<string, string> = {
  merging: 'MERGING',
  rebasing: 'REBASING',
  'cherry-picking': 'CHERRY-PICKING',
  reverting: 'REVERTING',
  bisecting: 'BISECTING'
};

async function pickRepoAction(
  repository: GitRepository,
  graphViewProvider: GitGraphViewProvider
): Promise<void> {
  const repoRoot = await repository.resolveRepositoryRoot();
  const status = await repository.getLocalChanges(repoRoot);
  const branch = status.currentBranch ?? 'HEAD';

  const items: RepoActionItem[] = [];

  if (status.specialState && status.specialState !== 'detached') {
    const label = SPECIAL_LABEL[status.specialState] ?? status.specialState.toUpperCase();
    items.push(
      { label: `$(play) Continue ${label}`, description: '', action: 'continue' },
      ...(status.specialState === 'rebasing'
        ? [{ label: '$(debug-step-over) Skip Commit', description: '', action: 'skip' } as RepoActionItem]
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
  items.push(
    { label: '$(sync) Fetch', description: 'Update remote refs', action: 'fetch' },
    { label: '', kind: vscode.QuickPickItemKind.Separator, description: '', action: '' },
    { label: '$(git-branch) Open Graph', description: '', action: 'openGraph' },
    { label: '$(git-branch) Create Branch...', description: '', action: 'createBranch' }
  );

  const choice = await vscode.window.showQuickPick(items, {
    title: `RepoFlow — ${branch}`,
    placeHolder: 'Select an action'
  });

  if (!choice?.action) return;

  // Capture once so TypeScript narrows the type through the closures below.
  const specialState = status.specialState;

  const runAndRefresh = async (fn: RunAction): Promise<void> => {
    await fn(repoRoot);
    await graphViewProvider.refresh();
  };

  const actions: Record<string, () => Promise<void>> = {
    continue: specialState ? () => runAndRefresh((r) => repository.continueOperation(r, specialState)) : async () => { /* noop */ },
    skip: () => runAndRefresh((r) => repository.skipRebaseOperation(r)),
    abort: specialState ? () => runAndRefresh((r) => repository.abortOperation(r, specialState)) : async () => { /* noop */ },
    pull: () => runAndRefresh((r) => repository.pull(r)),
    push: () => runAndRefresh((r) => repository.push(r)),
    fetch: () => runAndRefresh((r) => repository.fetch(r)),
    openGraph: async () => graphViewProvider.openOrReveal(),
    createBranch: async () => vscode.commands.executeCommand('repoFlow.createBranch'),
  };

  await actions[choice.action]?.();
}

async function pickCreateBranch(
  repository: GitRepository,
  graphViewProvider: GitGraphViewProvider
): Promise<void> {
  const repoRoot = await repository.resolveRepositoryRoot();

  const branches = await repository.getBranches(repoRoot);
  const localBranches = branches.filter((b) => !b.remote);
  const remoteBranches = branches.filter((b) => b.remote);
  const currentBranch = localBranches.find((b) => b.current);

  const branchItems = [
    { label: 'Local', kind: vscode.QuickPickItemKind.Separator, description: undefined },
    ...localBranches.map((b) => ({
      label: b.shortName,
      description: b.current ? '(current)' : undefined,
      kind: vscode.QuickPickItemKind.Default as number
    })),
    { label: 'Remote', kind: vscode.QuickPickItemKind.Separator, description: undefined },
    ...remoteBranches.map((b) => ({
      label: b.shortName,
      description: undefined as string | undefined,
      kind: vscode.QuickPickItemKind.Default as number
    }))
  ];

  const fromBranch = await vscode.window.showQuickPick(branchItems, {
    title: 'Select Source Branch',
    placeHolder: currentBranch ? `Current: ${currentBranch.shortName}` : 'Choose the branch to create from',
    ignoreFocusOut: true
  });
  if (!fromBranch) return;

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
  if (!branchType) return;

  const name = await vscode.window.showInputBox({
    title: 'Create Branch',
    prompt: `Enter branch name (prefix: ${branchType.description}, from: ${fromBranch.label})`,
    ignoreFocusOut: true
  });
  if (!name) return;

  await repository.createBranch(repoRoot, `${branchType.description}${name.trim()}`, fromBranch.label);
  await graphViewProvider.refresh();
}

// ─────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────

export function registerRepoCommands(
  repository: GitRepository,
  graphViewProvider: GitGraphViewProvider,
  subscriptions: vscode.ExtensionContext['subscriptions']
): void {
  subscriptions.push(
    vscode.commands.registerCommand('repoFlow.openView', () => {
      graphViewProvider.openOrReveal();
    }),
    vscode.commands.registerCommand('repoFlow.showRepoActions', async () => {
      try {
        await pickRepoAction(repository, graphViewProvider);
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
      try {
        await pickCreateBranch(repository, graphViewProvider);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`RepoFlow: ${msg}`);
      }
    }),
    vscode.commands.registerCommand('repoFlow.commitChanges', async () => {
      try {
        const repoRoot = await repository.resolveRepositoryRoot();
        const message = await vscode.window.showInputBox({
          title: 'Commit Changes',
          prompt: 'Commit message',
          ignoreFocusOut: true
        });
        if (!message) return;

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
        await repository.commit(repoRoot, message.trim(), amend);
        await graphViewProvider.refresh();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`RepoFlow: ${msg}`);
      }
    }),
    // Internal command — invoked from blame hover command URI
    vscode.commands.registerCommand('repoFlow.revealCommit', (commitHash: string) => {
      graphViewProvider.openAndRevealCommit(commitHash);
    })
  );
}
