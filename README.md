# Git Graphor

**Git Graphor** is a Visual Studio Code extension that brings an interactive Git history graph directly into your editor — with native diff integration and Git actions built in, so you never have to leave VS Code.

![Git Graphor in action](https://raw.githubusercontent.com/farigab/gitgraphor/main/media/gitgraphor.gif)

## Features

### Interactive Git Graph

Visualize your entire commit history as a branching graph. Each node shows the commit hash, author, date and refs (local branches, remote branches and tags).

### Native Diff Integration

Click any file in a commit to open a native VS Code diff tab, labeled as `file (commitA ↔ commitB)`. No external tools required.

### Commit Details

Select any commit to see a full breakdown: changed files, additions/deletions per file, total stats and the full commit message.

### Branch Management

Create, delete, checkout and merge branches directly from the graph — no terminal needed.

### Remote Actions

Fetch, pull and push directly from the Git Graphor panel or using the Command Palette.

### Working Tree Panel

Stage, unstage and discard individual files. View staged, unstaged and conflicted files side by side. Commit with a message without leaving the panel.

### Search & Filters

Filter the graph by commit message, hash, author, branch or date range.

### Commit Context Menu

Right-click any commit to: checkout, cherry-pick, create a branch from it, copy the hash or open it in the terminal.

---

## Requirements

- Git must be installed and available in `PATH`.
- A folder with a valid Git repository must be open in VS Code.

---

## Commands

| Command | Description |
| --- | --- |
| `Git Graphor: Open Graph` | Opens the Git Graphor panel |
| `Git Graphor: Refresh` | Reloads the graph |
| `Git Graphor: Fetch` | Fetches from remote |
| `Git Graphor: Pull` | Pulls from remote |
| `Git Graphor: Push` | Pushes to remote |
| `Git Graphor: Create Branch` | Creates a new branch |
| `Git Graphor: Commit Changes` | Commits staged changes |

All commands are also accessible from the Command Palette (`Ctrl+Shift+P`).

---

## Getting Started

1. Open a Git repository in VS Code.
2. Click the **Git Graphor** icon in the Source Control title bar, or run `Git Graphor: Open Graph` from the Command Palette.
3. Browse commits, click to see details, and use the toolbar for branch and remote actions.

---

## Privacy

Git Graphor uses the local Git CLI only. No data is sent to any remote service and no credentials are stored or read by the extension.
