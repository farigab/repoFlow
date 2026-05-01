import * as path from 'node:path';
import * as vscode from 'vscode';
import type { BlameEntry, CommitStats, RepoGitConfig } from '../../core/models';
import { GitRepository } from '../../core/ports';

// ─── helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 0 || !words[0]) {
    return '?';
  }

  const first = words[0][0] ?? '';
  const second = words.length > 1 ? (words.at(-1)![0] ?? '') : '';
  return (first + second).toUpperCase();
}

function pluralize(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
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
  if (minutes < 60) { return pluralize(minutes, 'minute'); }
  if (hours < 24) { return pluralize(hours, 'hour'); }
  if (days < 7) { return pluralize(days, 'day'); }
  if (weeks < 5) { return pluralize(weeks, 'week'); }
  if (months < 12) { return pluralize(months, 'month'); }
  return pluralize(years, 'year');
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

function escapeMarkdown(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/[\\`*_{}\[\]()#+\-.!|>]/g, '\\$&');
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

const UNCOMMITTED_HASH_PREFIX = '0000000';

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
      vscode.languages.registerHoverProvider(
        { scheme: 'file' },
        { provideHover: (doc, pos) => this.provideHover(doc, pos) },
      ),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        this.blameCache.delete(doc.uri.fsPath);
        if (this.currentEditor?.document === doc) {
          void this.updateBlame(this.currentEditor);
        }
      }),
    );

    this.initialize();
  }

  private initialize(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      this.currentEditor = editor;
      void this.updateBlame(editor);
      return;
    }

    // Editor not ready yet — wait for the first activation
    const disposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
      disposable.dispose();
      if (editor) {
        this.currentEditor = editor;
        void this.updateBlame(editor);
      }
    });
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

    if (editor) {
      void this.updateBlame(editor);
    }
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

      if (cached?.headHash !== headHash) {
        const relPath = path.relative(repoRoot, filePath).replaceAll('\\', '/');
        const entries = await this.repository.getBlame(repoRoot, relPath);

        const byLine: BlameEntry[] = [];
        for (const entry of entries) {
          byLine[entry.lineNumber - 1] = entry;
        }

        cached = { headHash, byLine };
        this.blameCache.set(cacheKey, cached);
      }

      const entry = cached.byLine[line];

      // Line has no blame data — happens when the document has unsaved changes
      // and the cursor is on a new/modified line that git hasn't seen yet.
      if (!entry) {
        if (doc.isDirty) {
          this.applyUncommittedDecoration(editor, line);
        } else {
          this.clearDecoration(editor);
        }
        return;
      }

      const config = await this.getRepoConfig(repoRoot, headHash);
      const isUncommitted = entry.commitHash.startsWith(UNCOMMITTED_HASH_PREFIX);
      const cachedStats = this.statsCache.get(entry.commitHash);

      this.applyDecoration(editor, line, entry, config);

      if (!cachedStats && !isUncommitted) {
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
    const isUncommitted = entry.commitHash.startsWith(UNCOMMITTED_HASH_PREFIX);

    const contentText = isUncommitted
      ? '\u270E  Uncommitted Changes'
      : `${truncate(entry.commitMessage, 50)}  \u2022  ${initials}  \u2022  ${formatRelativeDate(entry.committedAt)}`;

    const lineLength = editor.document.lineAt(line).text.length;
    const range = new vscode.Range(line, lineLength, line, lineLength);

    this.activeDecoration.set(editor.document.uri.fsPath, { line, entry, config });

    editor.setDecorations(BLAME_DECORATION, [
      {
        range,
        renderOptions: { after: { contentText } },
      },
    ]);
  }

  private applyUncommittedDecoration(editor: vscode.TextEditor, line: number): void {
    const lineLength = editor.document.lineAt(line).text.length;
    const range = new vscode.Range(line, lineLength, line, lineLength);
    editor.setDecorations(BLAME_DECORATION, [
      { range, renderOptions: { after: { contentText: '\u270E  Uncommitted Changes' } } },
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
    if (active?.line !== position.line) {
      return undefined;
    }

    const { entry, config } = active;
    const stats = this.statsCache.get(entry.commitHash);
    const isUncommitted = entry.commitHash.startsWith(UNCOMMITTED_HASH_PREFIX);

    const statsLine = this.buildStatsLine(entry, stats);
    const linksLine = isUncommitted ? '' : this.buildLinksLine(entry, config);
    const headerLine = isUncommitted
      ? '$(edit) **Uncommitted Changes**'
      : `\`${entry.commitHash.slice(0, 7)}\` **${escapeMarkdown(entry.commitMessage)}**`;

    const lineLength = document.lineAt(position.line).text.length;
    const range = new vscode.Range(position.line, 0, position.line, lineLength);

    // If the line is uncommitted, show only a simple hover message.
    // Author-time for uncommitted lines is meaningless (git echoes the file's
    // mtime at blame time), so we skip the date / stats / links sections.
    if (isUncommitted) {
      const md = new vscode.MarkdownString(headerLine, /* supportThemeIcons */ true);
      return new vscode.Hover(md, range);
    }

    const dateLine = `$(calendar) *${escapeMarkdown(formatAbsoluteDate(entry.committedAt))}*`;

    const lines: string[] = [
      headerLine,
      '',
      `$(account) **${escapeMarkdown(entry.authorName)}**`,
    ];

    if (entry.authorEmail) {
      lines.push('', `$(mail) *${escapeMarkdown(entry.authorEmail)}*`);
    }

    lines.push('', dateLine, '', statsLine, '', linksLine);

    const md = new vscode.MarkdownString(lines.join('\n'), /* supportThemeIcons */ true);
    md.isTrusted = { enabledCommands: ['repoFlow.revealCommit'] };
    return new vscode.Hover(md, range);
  }

  private buildLinksLine(entry: BlameEntry, config: RepoGitConfig): string {
    const ghUrl = buildGitHubCommitUrl(config.remotes, entry.commitHash);
    const ghPart = ghUrl ? `[$(link-external) Open on GitHub](${ghUrl})` : '';

    const revealArgs = encodeURIComponent(JSON.stringify([entry.commitHash]));
    const revealPart = `[$(git-commit) Show in RepoFlow](command:repoFlow.revealCommit?${revealArgs})`;

    return [ghPart, revealPart].filter(Boolean).join(' \u00a0\u2502\u00a0 ');
  }

  private buildStatsLine(entry: BlameEntry, stats: CommitStats | undefined): string {
    const isUncommitted = entry.commitHash.startsWith(UNCOMMITTED_HASH_PREFIX);
    if (isUncommitted) return '$(circle-slash) Not Committed Yet';
    if (!stats) return '$(loading~spin) Loading stats\u2026';

    const ins = `+${stats.insertions} insertion${stats.insertions === 1 ? '' : 's'}`;
    const del = `-${stats.deletions} deletion${stats.deletions === 1 ? '' : 's'}`;
    const files = `${stats.filesChanged} file${stats.filesChanged === 1 ? '' : 's'} changed`;
    return [ins, del, files].join('  ');
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
