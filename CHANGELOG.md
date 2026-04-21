# Changelog

## 1.2.1 - 2026-04-20

- **Refactor:** Cleaned up `provideHover` in `GitBlameController`: hoisted shared `lineLength`/`range` computation, removed dead `dateLine` ternary (guaranteed non-empty after the uncommitted early-return), and fixed a double blank line that appeared in the tooltip when a commit had no author email.

## 1.2.0 — 2026-04-20

- **Changed:** Show author email in Commit Details (webview). The Commit Details panel now displays the author's email beneath their name.

## 1.1.9 — 2026-04-20

- **Changed:** Refactor `buildRepoSummary` to simplify summary construction and reduce cognitive complexity.
- **Fixed:** Deleting a remote branch that no longer exists no longer surfaces an unhandled git error. The extension now prunes local remote-tracking refs (runs `git fetch --all --prune`) and shows a friendly message so the Branches view refreshes and stale remote refs are removed.
- **Refactor:** Simplified `parseWorktreeStatusV2` (reduced cognitive complexity) and updated the branch-ab regex to use `\d`.
- **Refactor:** Simplified `parseBlameOutput` by extracting metadata parsing into `readBlameMeta`, inverted a negated condition for clarity, and lowered overall complexity.
- **Fixed:** Implemented a best-effort `openFile` fallback in `GitCliRepository` so callers that use the view port will open files in the editor; failures are logged to the extension output.
- **Chore:** Minor lint/code-style tweaks.

## Included commits - 1.1.9

- [08c5417](https://github.com/farigab/repoFlow/commit/08c54170915d7e6a25d3af498bb0c2572a796c16) — refactor: streamline repo summary construction by modularizing helper functions
- [3ac30be](https://github.com/farigab/repoFlow/commit/3ac30beb859a10f2c736927b3ecc5c67ffd7db13) — refactor: enhance error handling in deleteRemoteBranch function and improve path escaping

## 1.1.8 — 2026-04-19

- **Added:** Centralized Git watchers and registration for repository events; improved command registration for repo-level actions.
- **Changed:** Refactor of model imports and module structure to reduce coupling and simplify component wiring.
- **Fixed:** Add watcher for `COMMIT_EDITMSG` to improve detection of special Git states (merge/rebase/cherry-pick).

## Included commits - 1.1.8

- [1dda154](https://github.com/farigab/repoFlow/commit/1dda154) — feat: implement Git watchers and command registration for improved repository management
- [7b7b801](https://github.com/farigab/repoFlow/commit/7b7b801) — fix: add file system watcher for COMMIT_EDITMSG to enhance Git state tracking
- [a914a7a](https://github.com/farigab/repoFlow/commit/a914a7a) — refactor: simplify BranchTreeItem initialization and enhance display logic
- [64b4474](https://github.com/farigab/repoFlow/commit/64b4474) — Refactor model imports and restructure codebase

## 1.1.7

- **Create Branch** option to repository actions and improve status bar summary
- Improve branch deletion functionality with support for force option and enhanced UI interactions

## 1.1.6

- Fixed **Show in RepoFlow** from blame now reliably opens the commit detail panel: a useEffect that syncs the selected commit with the graph snapshot was unconditionally clearing requestedCommitHashRef whenever selectedCommitHash was undefined. Because a graphSnapshot message can arrive between the revealCommit and commitDetail messages, the ref was being wiped out before the detail payload arrived, causing the guard to reject the message and leave the panel empty. The ref is now managed exclusively by user-action handlers (handleSelectCommit, handleSelectUncommitted, revealCommit, and the detail panel's onClose).

## 1.1.5

- **Branch ahead/behind indicators**: the branch tree view now shows `↑N` (commits to push) and `↓N` (commits to pull) as secondary text beside each branch that has an upstream. Both arrows appear together when diverged (e.g. `↑2 ↓1`). Falls back to `→ upstream` when in sync.

## 1.1.4

- adjust commit detail message handling for smoother UI updates

## 1.1.3

- **feat: Delete remote branch support**: added `deleteRemoteBranch` method to the `GitRepository` interface and implemented it in `GitCliRepository`, enabling remote branch deletion directly from the branch tree view.

## 1.1.2

- **Fixed checking out a remote branch no longer enters detached HEAD**: when checking out a remote branch (e.g. `origin/feat/changes`) from the branch tree, git now receives only the local name (`feat/changes`), correctly creating or switching to the local tracking branch instead of pointing to a bare commit.
- **Fixed `feat/` subfolders (and similar) now appear correctly under the Remote group**: the branch tree hierarchical grouping is now recursive. Branches such as `origin/feat/changes` produce the full hierarchy **Remote → origin → feat → changes** at any nesting depth.

## 1.1.1

- **Branch Tree View in Source Control**: a new collapsible **BRANCHES** section now appears in the Source Control sidebar (below REPOSITORIES / CHANGES), displaying all local and remote branches organised hierarchically by prefix.
  - Branches with a `/` in their name (e.g. `feat/login`, `hotfix/crash`) are automatically grouped under a named folder (`feat`, `hotfix`, etc.).
  - Branches without a prefix remain flat at the root of the Local or Remote group.
  - The currently checked-out branch is highlighted with a green icon and a `●` badge.
  - Upstream tracking info (e.g. `ahead 2 · behind 1`) is shown as secondary text beside each branch.
  - **Inline Checkout** button on every branch row.
  - **Right-click context menu** with Checkout, Merge into current, and Delete (with confirmation dialog).
  - A **Refresh** button in the view title bar forces an immediate update.
  - The tree refreshes automatically whenever `.git/refs/**` changes — the same watcher that drives the commit graph.

## 1.1.0

- UI enhancements

## 1.0.9

- **Repo status banner**: a persistent strip below the graph header always shows the current branch, upstream divergence (ahead/behind) and any in-progress special state (MERGING, REBASING, CHERRY-PICKING, REVERTING, BISECTING, detached HEAD).
- **Banner action buttons**: contextual buttons appear directly in the banner — no need to open a terminal:
  - *MERGING / CHERRY-PICKING / REVERTING* → **Continue** / **Abort**
  - *REBASING* → **Continue** / **Skip** / **Abort**
  - Branch *behind upstream* → **Pull** (shows commit count and upstream name)
  - Branch *ahead of upstream* → **Push**
  - **Fetch** button always visible in the banner
- **Conflict file list**: when a merge or rebase leaves conflicts, the banner expands to list each conflicted file as a clickable button that opens the file in the editor for resolution.
- **Last fetch indicator**: the banner displays how long ago the last `git fetch` ran (e.g. `fetched 2h ago`) derived from the `.git/FETCH_HEAD` mtime, with the exact timestamp on hover.
- **Status bar item**: a live status bar entry (bottom-left) shows the current branch, ahead/behind counts and any special state — updated automatically whenever HEAD, the index or refs change, even when the graph panel is closed.
- **Status bar quick-pick**: clicking the status bar item opens a contextual quick-pick with the same actions (Continue/Skip/Abort, Pull, Push, Fetch, Open Graph), so common operations are one click away from anywhere in VS Code.
- **Auto-detection of special states**: `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`, `rebase-merge/` and `rebase-apply/` are watched via `FileSystemWatcher` so the UI reacts within ~250 ms of any state change.
- **Upstream branch tracking**: `git status --porcelain=2` now also reads the `# branch.upstream` header so the exact upstream ref (e.g. `origin/main`) is shown in all summaries.

## 1.0.8

- **Local & remote source branches**: the source branch picker now lists both local and remote (origin) branches, grouped by separator, so you can create a branch from any ref.

## 1.0.7

- **Create Branch button in SCM title bar**: new branch creation button (`+`) now appears next to the "Open Graph" button in Source Control, with visibility synced to the native Git provider.
- **Branch source selection**: the "Create Branch" flow now prompts you to pick a source branch before choosing the type and name, and passes it as `fromRef` to `git branch`.
- **Commit Changes button in SCM title bar**: added icon for the commit command.

## 1.0.6

- UI adjustments: removed icon headers from modals.

## 1.0.5

- **Worktree dirty indicator**: each worktree row now shows an amber `●` badge when there are uncommitted changes — no need to open the worktree to check its status.
- **Detailed worktree status**: staged file count, unstaged/untracked count, commits ahead and commits behind upstream are shown as inline pills per worktree entry.
- **Reveal in Explorer**: new button per worktree row that opens the worktree directory in the OS file explorer.
- **Copy path to clipboard**: new button per worktree row that copies the absolute worktree path, ready to paste in a terminal.
- **Lock / Unlock worktree**: lock icon button toggles `git worktree lock / unlock` on each row, preventing accidental removal. Locked worktrees have the remove button disabled.
- **Move / Rename worktree**: edit icon button expands an inline path input that calls `git worktree move` on confirm, allowing renaming or relocating without recreating the worktree.
- **Detached HEAD worktree**: third creation mode "Commit hash" in the Add Worktree form — creates a detached-HEAD checkout of a specific commit or tag via `git worktree add --detach`.
- **Worktree head badges in the commit graph**: commits that are the current HEAD of a linked (non-main) worktree now display an amber hexagon outline directly on their graph node, similar to how GitLens marks worktree positions.

- Added **Worktree Manager**: create, list, open and remove git worktrees directly from the graph panel.
  - Supports checking out an existing branch or creating a new one in a separate worktree.
  - Each linked worktree can be opened in a new VS Code window with one click.
  - Removing a worktree with uncommitted changes shows an inline force-remove confirmation.
  - Errors (invalid path, branch already checked out, etc.) are displayed inline in the modal.

## 1.0.3

- Fixed alignment issue in the commit graph where commit nodes were slightly misaligned with their corresponding rows.

## 1.0.2

- Fixed "Show in RepoFlow" from Git blame not highlighting the commit in the history when the panel was opened for the first time.
- Fixed "Show in RepoFlow" not scrolling to old commits that were outside the initially loaded 200-commit window — the graph now automatically expands until the target commit is found.

## Initial Version

- Interactive Git history graph with commit details and native VS Code diff integration.
- Built-in Git actions for fetch, pull, push, branch creation, and commit directly from the extension interface.
- Working tree panel for staging, unstaging, and discarding file changes.
- Redesigned search bar with embedded icon, options grouped in a segmented control, match counter, and navigation arrows.
- Modal for deleting local branches with multi-select capability and two-step confirmation.
- Display of uncommitted files in the commit graph.
- Interactive panels for Commit Details and Commit History with responsive behavior and automatic reopening.
- Custom webview for the Git graph with support for branch, remote, and working tree actions.
- Unit tests for graph layout and Git status/log parsing.
