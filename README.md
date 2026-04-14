# Git Graphor

Git Graphor is a Visual Studio Code extension project focused on Git history exploration with a custom graph experience, native diff integration and direct Git actions.

## Current Scope

- Interactive Git graph rendered in a webview
- Commit list with hash, author, date and refs
- Commit details with changed files and summary stats
- Native VS Code diff tabs named as `file (commitA ↔ commitB)`
- Branch actions: create, delete, checkout and merge
- Remote actions: fetch, pull and push
- Working tree panel with staged, unstaged and conflicted files
- Search and filters by message, hash, author, branch and date
- Commit context menu with checkout, cherry-pick, branch creation, copy hash and terminal integration

## Architecture

The extension is separated into clear layers:

- `src/core`: shared models and ports
- `src/application`: graph layout use case
- `src/infrastructure`: Git CLI access, parsers and cache
- `src/presentation`: VS Code webview provider and diff document provider
- `webview/src`: React UI for the graph, details and local changes panels

## Development

Install dependencies:

```bash
npm install
```

Build extension and webview bundles:

```bash
npm run build
```

Run typecheck:

```bash
npm run typecheck
```

Run tests:

```bash
npm test
```

Start extension development:

1. Open this folder in VS Code.
2. Run `npm run build` once.
3. Press `F5` to launch an Extension Development Host.
4. Open a Git repository in the host window and open the `Git Graphor` activity bar icon.

## Notes

- The implementation uses the Git CLI and does not store credentials.
- The current version is optimized as a strong foundation for future additions like rebase flows, stash visualization, multi-repository support and AI insights.
