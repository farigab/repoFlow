import * as path from 'node:path';
import * as vscode from 'vscode';
import type { BlameEntry, CommitStats, RepoGitConfig } from '../../core/models/GitModels';
import type { GitRepository } from '../../core/ports/GitRepository';

// ─── helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 0 || !words[0]) {
    return '?';
  }

  const first = words[0][0] ?? '';
  const second = words.length > 1 ? (words[words.length - 1][0] ?? '') : '';
  return (first + second).toUpperCase();
}

function formatRelativeDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (minutes < 1) { return 'just now'; }
  if (minutes < 60) { return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`; }
  if (hours < 24) { return `${hours} hour${hours !== 1 ? 's' : ''} ago`; }
  if (days < 7) { return `${days} day${days !== 1 ? 's' : ''} ago`; }
  if (weeks < 5) { return `${weeks} week${weeks !== 1 ? 's' : ''} ago`; }
  if (months < 12) { return `${months} month${months !== 1 ? 's' : ''} ago`; }
  return `${years} year${years !== 1 ? 's' : ''} ago`;
}

function formatAbsoluteDate(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleString('en-US', { month: 'long' });
  const day = d.getDate();
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${month} ${day}, ${year} at ${hours}:${minutes} ${ampm}`;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '\u2026' : text;
}

function buildGitHubCommitUrl(remotes: RepoGitConfig['remotes'], commitHash: string): string | undefined {
  for (const remote of remotes) {
    const httpsMatch = /https?:\/\/github\.com\/([^/]+\/[^/.]+?)(?:\.git)?\/?$/.exec(remote.url);
    if (httpsMatch) {
      return `https://github.com/${httpsMatch[1]}/commit/${commitHash}`;
    }

    const sshMatch = /git@github\.com:([^/]+\/[^/.]+?)(?:\.git)?\/?$/.exec(remote.url);
    if (sshMatch) {
      return `https://github.com/${sshMatch[1]}/commit/${commitHash}`;
    }
  }

  return undefined;
}

// ─── decoration types ────────────────────────────────────────────────────────

const BLAME_DECORATION = vscode.window.createTextEditorDecorationType({
  after: {
    margin: '0 0 0 3ch',
    color: new vscode.ThemeColor('editorLineNumber.foreground'),
    fontStyle: 'normal',
    fontWeight: 'normal',
  },
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

// ─── controller ─────────────────────────────────────────────────────────────

interface BlameCacheEntry {
  headHash: string;
  /** 0-based index → BlameEntry for line (lineNumber - 1) */
  byLine: BlameEntry[];
}

export class GitBlameController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  /** filePath → cached blame (keyed by HEAD hash for auto-invalidation) */
  private readonly blameCache = new Map<string, BlameCacheEntry>();

  /** commitHash → stats (stable: commit content never changes) */
  private readonly statsCache = new Map<string, CommitStats>();

  /** repoRoot → { hash, remotes } */
  private readonly repoMetaCache = new Map<string, { headHash: string; config: RepoGitConfig }>();

  /**
   * Stores the currently decorated line's data per file so the HoverProvider
   * can build the tooltip without re-running git.
   */
  private readonly activeDecoration = new Map<
    string,
    { line: number; entry: BlameEntry; config: RepoGitConfig }
  >();

  private currentEditor: vscode.TextEditor | undefined;
  private currentLine = -1;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor(
    private readonly repository: GitRepository,
    private readonly output: vscode.OutputChannel
  ) {
    this.disposables.push(
      BLAME_DECORATION,
      vscode.window.onDidChangeTextEditorSelection(this.onSelectionChange, this),
      vscode.window.onDidChangeActiveTextEditor(this.onActiveEditorChange, this),
      // HoverProvider covers all file-scheme documents so it can show the
      // blame popup when the user hovers over a decorated line.
      vscode.languages.registerHoverProvider(
        { scheme: 'file' },
        { provideHover: (doc, pos) => this.provideHover(doc, pos) },
      ),
    );

    if (vscode.window.activeTextEditor) {
      this.currentEditor = vscode.window.activeTextEditor;
    }
  }

  /** Call when git state changes (HEAD/index/refs) to invalidate cached blame. */
  public invalidateCache(): void {
    this.blameCache.clear();
    this.repoMetaCache.clear();
    // statsCache is intentionally kept — commit content is immutable
  }

  // ── event handlers ──────────────────────────────────────────────────────

  private onActiveEditorChange(editor: vscode.TextEditor | undefined): void {
    if (this.currentEditor && this.currentEditor !== editor) {
      this.clearDecoration(this.currentEditor);
    }

    this.currentEditor = editor;
    this.currentLine = -1;
  }

  private onSelectionChange(event: vscode.TextEditorSelectionChangeEvent): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      void this.updateBlame(event.textEditor);
    }, 100);
  }

  // ── blame update ─────────────────────────────────────────────────────────

  private async updateBlame(editor: vscode.TextEditor): Promise<void> {
    const doc = editor.document;

    if (doc.isUntitled || doc.uri.scheme !== 'file') {
      this.clearDecoration(editor);
      return;
    }

    const line = editor.selection.active.line;
    if (line === this.currentLine && this.currentEditor === editor) {
      return;
    }

    this.currentLine = line;
    this.currentEditor = editor;

    const filePath = doc.uri.fsPath;

    try {
      const repoRoot = await this.repository.resolveRepositoryRoot(path.dirname(filePath));
      const headHash = await this.getHeadHash(repoRoot);

      const cacheKey = filePath;
      let cached = this.blameCache.get(cacheKey);

      if (!cached || cached.headHash !== headHash) {
        const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
        const entries = await this.repository.getBlame(repoRoot, relPath);

        const byLine: BlameEntry[] = [];
        for (const entry of entries) {
          byLine[entry.lineNumber - 1] = entry;
        }

        cached = { headHash, byLine };
        this.blameCache.set(cacheKey, cached);
      }

      const entry = cached.byLine[line];
      if (!entry) {
        this.clearDecoration(editor);
        return;
      }

      const config = await this.getRepoConfig(repoRoot, headHash);
      const cachedStats = this.statsCache.get(entry.commitHash);

      this.applyDecoration(editor, line, entry, config);

      if (!cachedStats) {
        void this.fetchStats(entry, repoRoot);
      }
    } catch (err) {
      this.output.appendLine(`[blame] ${err instanceof Error ? err.message : String(err)}`);
      this.clearDecoration(editor);
    }
  }

  private async fetchStats(
    entry: BlameEntry,
    repoRoot: string,
  ): Promise<void> {
    try {
      const stats = await this.repository.getCommitStats(repoRoot, entry.commitHash);
      this.statsCache.set(entry.commitHash, stats);
    } catch {
      // stats are optional — swallow silently
    }
  }

  // ── decoration rendering ─────────────────────────────────────────────────

  private applyDecoration(
    editor: vscode.TextEditor,
    line: number,
    entry: BlameEntry,
    config: RepoGitConfig,
  ): void {
    const initials = getInitials(entry.authorName);
    const relDate = formatRelativeDate(entry.committedAt);
    const truncMsg = truncate(entry.commitMessage, 50);
    const contentText = `[${initials}]  ${entry.authorName}  \u2022  ${relDate}  \u2022  ${truncMsg}`;

    // Place the range at the END of the line so the `after` pseudo-element
    // appears after the last character and does not push code rightward.
    const lineLength = editor.document.lineAt(line).text.length;
    const range = new vscode.Range(line, lineLength, line, lineLength);

    // Cache for the HoverProvider — hoverMessage on after-decorations is
    // unreliable; a registered HoverProvider is the correct approach.
    this.activeDecoration.set(editor.document.uri.fsPath, { line, entry, config });

    editor.setDecorations(BLAME_DECORATION, [
      {
        range,
        renderOptions: { after: { contentText } },
      },
    ]);
  }

  private clearDecoration(editor: vscode.TextEditor): void {
    this.activeDecoration.delete(editor.document.uri.fsPath);
    editor.setDecorations(BLAME_DECORATION, []);
  }

  // ── hover provider ───────────────────────────────────────────────────────

  private provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    const active = this.activeDecoration.get(document.uri.fsPath);
    if (!active || active.line !== position.line) {
      return undefined;
    }

    const { entry, config } = active;
    const shortHash = entry.commitHash.slice(0, 7);
    const absDate = formatAbsoluteDate(entry.committedAt);
    const stats = this.statsCache.get(entry.commitHash);

    const statsLine = stats
      ? `$(diff-added) **+${stats.insertions}** \u2009$(diff-removed) **-${stats.deletions}** \u00a0\u2022\u00a0 ${stats.filesChanged} file${stats.filesChanged !== 1 ? 's' : ''} changed`
      : '$(loading~spin) Loading stats\u2026';

    const ghUrl = buildGitHubCommitUrl(config.remotes, entry.commitHash);
    const ghPart = ghUrl ? `[$(link-external) Open on GitHub](${ghUrl})` : '';

    const revealArgs = encodeURIComponent(JSON.stringify([entry.commitHash]));
    const revealPart = `[$(git-commit) Show in Git Graphor](command:gitGraphor.revealCommit?${revealArgs})`;

    const linksLine = [ghPart, revealPart].filter(Boolean).join(' \u00a0\u2502\u00a0 ');

    const md = new vscode.MarkdownString(
      [
        `\`${shortHash}\` **${entry.commitMessage}**`,
        '',
        `$(account) **${entry.authorName}**`,
        '',
        `$(calendar) *${absDate}*`,
        '',
        statsLine,
        '',
        linksLine,
      ].join('\n'),
      /* supportThemeIcons */ true,
    );
    md.isTrusted = true;

    // Cover the full line so hovering anywhere on it triggers the popup.
    const lineLength = document.lineAt(position.line).text.length;
    const range = new vscode.Range(position.line, 0, position.line, lineLength);
    return new vscode.Hover(md, range);
  }

  // ── cached accessors ─────────────────────────────────────────────────────

  private async getHeadHash(repoRoot: string): Promise<string> {
    const cached = this.repoMetaCache.get(repoRoot);
    if (cached) {
      return cached.headHash;
    }

    const headHash = await this.repository.resolveHeadHash(repoRoot);
    const config = await this.repository.getRepoConfig(repoRoot);
    this.repoMetaCache.set(repoRoot, { headHash, config });
    return headHash;
  }

  private async getRepoConfig(repoRoot: string, headHash: string): Promise<RepoGitConfig> {
    const cached = this.repoMetaCache.get(repoRoot);
    if (cached) {
      return cached.config;
    }

    const config = await this.repository.getRepoConfig(repoRoot);
    this.repoMetaCache.set(repoRoot, { headHash, config });
    return config;
  }

  // ── dispose ──────────────────────────────────────────────────────────────

  public dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
