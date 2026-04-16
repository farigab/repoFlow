# Changelog

## 1.1.5 - 2026-04-16

### Added

- Inline blame now displays only the author's name next to the selected line.
- Hovering over a line shows a detailed modal with commit information (author, commit hash, and message).
- Added a command to open Git Graph history for the selected line.

### Improved

- Enhanced inline blame styling for better visibility.

## 1.1.4 - 2026-04-15

- Add close action to Commit Details panel.
- Collapse Commit Details and expand Commit History to full width when details are closed.
- Reopen Commit Details automatically when selecting a commit in History.
- Fix responsive layout gap when details are collapsed in non-maximized window sizes.
- Prevent stale commit-details flicker by only rendering details after the selected commit payload arrives.

## 1.1.3 - 2026-04-15

- Redesign find bar: search icon embedded inside input, option buttons (Aa / ab / .*) grouped in a single segmented control with dividers, match counter displayed as a pill, navigation arrows grouped side by side.
- Remove unused `Toolbar` component and all associated CSS classes.
- Show uncommitted files in the commit graph.

## 1.1.2 - 2026-04-15

- Improve find-bar appearance with icon-wrapped inputs and toggle pill styles.

## 1.1.1 - 2026-04-14

- Maintenance release for Marketplace republish.

## 1.1.0 - 2026-04-14

- Add delete local branches modal with multi-select capabilities.
- Interactive branch selection with "Select All" toggle.
- Two-step confirmation to prevent accidental deletions.
- Delete branches button in the commit graph header.

## 1.0.0 - 2026-04-14

- First stable release of Git Graphor.
- Interactive Git history graph with commit details and native VS Code diff integration.
- Built-in Git actions for fetch, pull, push, branch creation, and commit from the extension UI.
- Working tree panel for staging, unstaging, and discarding file changes.

## 0.1.0

- Initial extension scaffold
- Custom Git graph webview with commit details
- Native diff integration
- Branch, remote and working tree actions
- Unit tests for graph layout and Git status/log parsing
