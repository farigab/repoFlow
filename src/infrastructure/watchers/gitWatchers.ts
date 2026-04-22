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
}
