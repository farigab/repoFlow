import * as path from 'node:path';
import * as vscode from 'vscode';
import type { DiffRequest, GraphFilters, WorktreeEntry } from '../../core/models';
import type { GitRepository } from '../../core/ports/GitRepository';
import type { ExtensionToWebviewMessage } from '../../shared/protocol';
import {
  assertSafeAbsoluteFsPath,
  assertSafeGitRef,
  assertSafeHookName,
  assertSafeRelativeGitPath,
  assertSafeRelativeGitPaths,
  normalizeFsPathForComparison
} from '../../shared/gitInputValidation';

interface GitGraphHostServicesOptions {
  repository: GitRepository;
  output: vscode.OutputChannel;
  postMessage: (message: ExtensionToWebviewMessage) => Promise<void>;
  refresh: () => Promise<void>;
  onRepositoryChanged?: () => void;
}

interface TypedConfirmationOptions {
  title: string;
  prompt: string;
  expected: string;
  actionLabel: string;
}

function buildHookTemplate(hookName: string): string {
  switch (hookName) {
    case 'commit-msg':
      return [
        '#!/bin/sh',
        '',
        '# Validate the commit message file passed as the first argument.',
        '# Exit with a non-zero status to block the commit.',
        '',
        'MESSAGE_FILE="$1"',
        '',
        'echo "commit-msg: inspect $MESSAGE_FILE"',
        'exit 0',
        ''
      ].join('\n');
    case 'pre-push':
      return [
        '#!/bin/sh',
        '',
        '# Runs before refs are pushed to the remote.',
        '# stdin receives the refs that will be updated.',
        '',
        'echo "pre-push: add your checks here"',
        'exit 0',
        ''
      ].join('\n');
    case 'pre-commit':
      return [
        '#!/bin/sh',
        '',
        '# Runs before a commit is created.',
        '# Exit with a non-zero status to block the commit.',
        '',
        'echo "pre-commit: add your checks here"',
        'exit 0',
        ''
      ].join('\n');
    default:
      return [
        '#!/bin/sh',
        '',
        `# ${hookName} hook`,
        '# Exit with a non-zero status to block the Git action.',
        '',
        `echo "${hookName}: add your checks here"`,
        'exit 0',
        ''
      ].join('\n');
  }
}

export class GitGraphHostServices {
  public constructor(private readonly options: GitGraphHostServicesOptions) { }

  public normalizeFilters(filters: Partial<GraphFilters>): Partial<GraphFilters> {
    const normalized: Partial<GraphFilters> = {};

    if (typeof filters.includeRemotes === 'boolean') {
      normalized.includeRemotes = filters.includeRemotes;
    }

    if (typeof filters.limit === 'number' && Number.isFinite(filters.limit)) {
      normalized.limit = Math.min(Math.max(Math.trunc(filters.limit), 50), 5_000);
    }

    if (typeof filters.search === 'string') {
      normalized.search = filters.search.slice(0, 200);
    }

    if (typeof filters.author === 'string') {
      normalized.author = filters.author.slice(0, 200);
    }

    return normalized;
  }

  public async getTrustedRepoRoot(repoRoot: string): Promise<string> {
    const requested = assertSafeAbsoluteFsPath(repoRoot, 'repository root');
    const resolved = await this.options.repository.resolveRepositoryRoot(requested);

    if (normalizeFsPathForComparison(resolved) !== normalizeFsPathForComparison(requested)) {
      throw new Error('Invalid repository root.');
    }

    return resolved;
  }

  public async getKnownWorktree(repoRoot: string, worktreePath: string): Promise<{ repoRoot: string; entry: WorktreeEntry }> {
    const trustedRepoRoot = await this.getTrustedRepoRoot(repoRoot);
    const requestedPath = assertSafeAbsoluteFsPath(worktreePath, 'worktree path');
    const requestedKey = normalizeFsPathForComparison(requestedPath);
    const entries = await this.options.repository.listWorktrees(trustedRepoRoot);
    const entry = entries.find((candidate) => normalizeFsPathForComparison(candidate.path) === requestedKey);

    if (!entry) {
      throw new Error('Unknown worktree path.');
    }

    return { repoRoot: trustedRepoRoot, entry };
  }

  public validateDiffRequest(payload: DiffRequest): DiffRequest {
    return {
      repoRoot: assertSafeAbsoluteFsPath(payload.repoRoot, 'repository root'),
      commitHash: assertSafeGitRef(payload.commitHash, 'commit ref'),
      parentHash: payload.parentHash ? assertSafeGitRef(payload.parentHash, 'parent ref') : undefined,
      filePath: assertSafeRelativeGitPath(payload.filePath),
      originalPath: payload.originalPath ? assertSafeRelativeGitPath(payload.originalPath, 'original file path') : undefined
    };
  }

  public getSelectedPaths(paths?: string[]): string[] | undefined {
    return assertSafeRelativeGitPaths(paths);
  }

  public async executeRepositoryAction(label: string, action: () => Promise<void>, successMessage = 'Operation completed successfully.'): Promise<boolean> {
    try {
      await this.withBusy(label, async () => {
        await action();
        if (this.options.onRepositoryChanged) {
          this.options.onRepositoryChanged();
        } else {
          await this.options.refresh();
        }
        await this.postNotification('info', successMessage);
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.output.appendLine(`[ui-error] ${message}`);
      await this.postNotification('error', message);
      return false;
    }
  }

  public async executeUiAction(label: string, action: () => Promise<void>, successMessage: string): Promise<boolean> {
    try {
      await this.withBusy(label, async () => {
        await action();
        await this.postNotification('info', successMessage);
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.output.appendLine(`[ui-error] ${message}`);
      await this.postNotification('error', message);
      return false;
    }
  }

  public async withBusy(label: string, action: () => Promise<void>): Promise<void> {
    await this.options.postMessage({ type: 'busy', payload: { value: true, label } });
    try {
      await action();
    } finally {
      await this.options.postMessage({ type: 'busy', payload: { value: false } });
    }
  }

  public async postNotification(kind: 'info' | 'error', message: string): Promise<void> {
    await this.options.postMessage({
      type: 'notification',
      payload: { kind, message }
    });
  }

  public async confirmTyped(options: TypedConfirmationOptions): Promise<boolean> {
    const value = await vscode.window.showInputBox({
      title: options.title,
      prompt: `${options.prompt} Type "${options.expected}" to confirm.`,
      placeHolder: options.expected,
      ignoreFocusOut: true,
      validateInput: (input) => input === options.expected ? undefined : `Type ${options.expected} to ${options.actionLabel}.`
    });

    return value === options.expected;
  }

  public async resolveHooksDirectory(repoRoot: string, hooksPath: string): Promise<string> {
    const configuredPath = hooksPath.trim();

    if (configuredPath) {
      return path.isAbsolute(configuredPath)
        ? configuredPath
        : path.join(repoRoot, configuredPath);
    }

    try {
      const [{ execFile }, { promisify }] = await Promise.all([
        import('node:child_process'),
        import('node:util')
      ]);
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: repoRoot });
      const resolvedPath = stdout.trim();
      if (resolvedPath) {
        return path.isAbsolute(resolvedPath)
          ? resolvedPath
          : path.join(repoRoot, resolvedPath);
      }
    } catch {
      // Fall back to the standard repository hooks directory when Git path resolution fails.
    }

    return path.join(repoRoot, '.git', 'hooks');
  }

  public async ensureHookScript(repoRoot: string, hooksPath: string, hookName: string): Promise<vscode.Uri> {
    const trustedHookName = assertSafeHookName(hookName);
    const { chmod } = await import('node:fs/promises');
    const hooksDirectory = await this.resolveHooksDirectory(repoRoot, hooksPath);
    const hooksUri = vscode.Uri.file(hooksDirectory);
    await vscode.workspace.fs.createDirectory(hooksUri);

    const scriptUri = vscode.Uri.file(path.join(hooksDirectory, trustedHookName));
    let exists = true;
    try {
      await vscode.workspace.fs.stat(scriptUri);
    } catch {
      exists = false;
    }

    if (!exists) {
      await vscode.workspace.fs.writeFile(scriptUri, Buffer.from(buildHookTemplate(trustedHookName), 'utf8'));
      if (process.platform !== 'win32') {
        await chmod(scriptUri.fsPath, 0o755).catch(() => undefined);
      }
    }

    return scriptUri;
  }
}
