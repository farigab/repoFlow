import * as vscode from 'vscode';

const GIT_WATCH_PATTERNS = [
  '**/.git/HEAD',
  '**/.git/ORIG_HEAD',       // ← reset, merge, rebase
  '**/.git/FETCH_HEAD',      // ← fetch/pull
  '**/.git/MERGE_HEAD',
  '**/.git/CHERRY_PICK_HEAD',
  '**/.git/REVERT_HEAD',
  '**/.git/BISECT_LOG',

  // Index e refs
  '**/.git/index',
  '**/.git/refs/**',
  '**/.git/packed-refs',     // ← pack-refs compacta as refs

  // Stash
  '**/.git/stash',           // ← stash push/pop/drop

  // Operações em progresso
  '**/.git/rebase-merge/**',
  '**/.git/rebase-apply/**',
  '**/.git/sequencer/**',    // ← cherry-pick/revert em sequência

  // Worktrees e config
  '**/.git/worktrees/**',
  '**/.git/config',          // ← remote add/remove, tracking branch
  '**/.git/COMMIT_EDITMSG',
] as const;

export function registerGitWatchers(
  onChanged: () => void,
  subscriptions: vscode.ExtensionContext['subscriptions']
): void {
  for (const pattern of GIT_WATCH_PATTERNS) {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidChange(onChanged, undefined, subscriptions);
    watcher.onDidCreate(onChanged, undefined, subscriptions);
    watcher.onDidDelete(onChanged, undefined, subscriptions);
    subscriptions.push(watcher);
  }

  // Also listen to the built-in Git extension state changes. This captures
  // commits/actions performed from VS Code native Source Control even when
  // filesystem watchers miss events (e.g. worktree indirection).
  const gitExtension = vscode.extensions.getExtension('vscode.git');
  const gitExports = gitExtension?.isActive ? gitExtension.exports : gitExtension?.activate();

  void Promise.resolve(gitExports).then((exportsValue) => {
    const api = (exportsValue as { getAPI?: (version: number) => unknown } | undefined)?.getAPI?.(1) as
      | {
        repositories?: Array<{ state?: { onDidChange?: vscode.Event<unknown> } }>;
        onDidOpenRepository?: vscode.Event<{ state?: { onDidChange?: vscode.Event<unknown> } }>;
      }
      | undefined;

    if (!api) {
      return;
    }

    const attachRepositoryListener = (repository: { state?: { onDidChange?: vscode.Event<unknown> } }): void => {
      const stateChanged = repository.state?.onDidChange;
      if (!stateChanged) {
        return;
      }
      subscriptions.push(stateChanged(() => onChanged()));
    };

    for (const repository of api.repositories ?? []) {
      attachRepositoryListener(repository);
    }

    if (api.onDidOpenRepository) {
      subscriptions.push(
        api.onDidOpenRepository((repository) => {
          attachRepositoryListener(repository);
          onChanged();
        })
      );
    }
  });
}
