# Changelog

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
