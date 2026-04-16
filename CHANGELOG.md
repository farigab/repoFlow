# Changelog

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
